import type mongoose from "mongoose";
import { Client } from "../models/client.model";
import { GoogleCalendar } from "../models/googleCalendar.model";
import { User } from "../models/user.model";
import { eventsOf, videoLinkOf } from "./googleCalendar";
import { emailReady } from "./email";
import { emailCallBooked, sendDueReminders } from "./onboardingEmails";
import { notifyCallBooked, notifyClientCallBooked } from "./notifications";

// A client may book their onboarding call on Google's own booking page, which doesn't tell the
// portal. But the booking lands on the calendar of whoever owns that page — and when that account
// is connected on the company portal's Calendar page, it can be found there: a meeting, booked
// after the client signed up and still to come, with the client (or one of its logins) as a guest.
// Found, it is kept on the client — when it is, its Meet link, the event — and the client gets the
// "call booked" email with the date, time and link from it.
//
// Looked for: right away when the client says "I've booked my call" (lookUpCall), and every five
// minutes for every client still onboarding who hasn't booked, or said so without a time found yet.
// One who said so and still has nothing found half an hour later gets the email without a time.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// Clients still onboarding, made within this long, are looked for.
const LOOK_BACK = 30 * DAY;
// And their call can be this far ahead.
const LOOK_AHEAD = 90 * DAY;
// A meeting made a little before the account (the clocks of two servers) still counts.
const SLACK = 5 * MINUTE;
// Said they booked, nothing found: the email goes without a time after this long.
const WAIT_FOR_TIME = 30 * MINUTE;

type Pending = { _id: mongoose.Types.ObjectId; email?: string; createdAt: Date };
type FoundCall = { at: Date; meetLink?: string; eventId: string; calendar: mongoose.Types.ObjectId };

// The first call still to come for each client, on any connected calendar.
const callsOf = async (clients: Pending[]) => {
  const found = new Map<string, FoundCall>();
  if (!clients.length) return found;
  const accounts = await GoogleCalendar.find({ broken: false }).select("+refreshTokenSealed");
  if (!accounts.length) return found;

  // Each email a client may have booked with: theirs, and their logins'.
  const clientOf = new Map<string, Pending>();
  for (const client of clients) if (client.email) clientOf.set(client.email.toLowerCase(), client);
  const logins = await User.find({ role: "client", client: { $in: clients.map((client) => client._id) } })
    .select("email client")
    .lean();
  for (const login of logins) {
    const client = clients.find((each) => String(each._id) === String(login.client));
    if (client && login.email) clientOf.set(login.email.toLowerCase(), client);
  }

  const now = Date.now();
  for (const account of accounts) {
    let events;
    try {
      events = await eventsOf(account, new Date(now), new Date(now + LOOK_AHEAD));
    } catch (error) {
      console.error(`Booking sync: couldn't read ${account.email}:`, error instanceof Error ? error.message : error);
      continue;
    }
    for (const event of events) {
      const start = event.start?.dateTime ?? event.start?.date;
      if (event.status === "cancelled" || !start) continue;
      const at = new Date(start);
      if (at.getTime() < now) continue;
      // An older meeting with the same email — a test account deleted and made again, someone
      // invited before — isn't their booking.
      const created = event.created ? new Date(event.created).getTime() : 0;
      for (const guest of event.attendees ?? []) {
        if (guest.responseStatus === "declined" || guest.organizer || guest.self) continue;
        const client = guest.email ? clientOf.get(guest.email.toLowerCase()) : undefined;
        if (!client || created < new Date(client.createdAt).getTime() - SLACK) continue;
        const id = String(client._id);
        const earlier = found.get(id);
        if (!earlier || at < earlier.at) found.set(id, { at, meetLink: videoLinkOf(event), eventId: event.id, calendar: account._id as mongoose.Types.ObjectId });
      }
    }
  }
  return found;
};

// Keeps a found call on the client, and tells them: the "call booked" email with its time and
// link (once), and — when `tell` says so — their bell and the team's.
const recordCall = async (clientId: string, call: FoundCall, tell: { client: boolean; team: boolean }) => {
  // Booked from now on, if they hadn't said so.
  await Client.updateOne(
    { _id: clientId, "onboarding.kickoffCall.booked": { $ne: true } },
    { $set: { "onboarding.kickoffCall.booked": true, "onboarding.kickoffCall.bookedAt": new Date() } }
  );
  // Claimed on the record, so two checks at once don't both tell them.
  const marked = await Client.updateOne(
    { _id: clientId, "onboarding.kickoffCall.callAt": { $exists: false } },
    {
      $set: {
        "onboarding.kickoffCall.callAt": call.at,
        "onboarding.kickoffCall.eventId": call.eventId,
        "onboarding.kickoffCall.calendar": call.calendar,
        ...(call.meetLink ? { "onboarding.kickoffCall.meetLink": call.meetLink } : {}),
      },
    }
  );
  if (!marked.modifiedCount) return;
  const client = await Client.findById(clientId);
  if (!client) return;
  void emailCallBooked(client);
  if (tell.client) void notifyClientCallBooked(client._id, call.at);
  if (tell.team) {
    const login = client.user ? await User.findById(client.user) : null;
    if (login) void notifyCallBooked(client._id, login);
  }
};

// The client just said they booked their call: find it now, so the email has its date, time and
// link. Not found yet, the five-minute check keeps looking.
export const lookUpCall = async (clientId: mongoose.Types.ObjectId | string) => {
  try {
    const client = await Client.findById(clientId).select("email createdAt").lean();
    if (!client) return false;
    const call = (await callsOf([client as Pending])).get(String(clientId));
    if (!call) return false;
    await recordCall(String(clientId), call, { client: true, team: false });
    return true;
  } catch (error) {
    console.error("Booking look-up failed:", error);
    return false;
  }
};

export const syncBookedCalls = async () => {
  const now = Date.now();
  // Still onboarding, and either not booked, or said so without a time found yet.
  const pending = await Client.find({
    status: "onboarding",
    user: { $exists: true },
    createdAt: { $gte: new Date(now - LOOK_BACK) },
    $or: [{ "onboarding.kickoffCall.booked": { $ne: true } }, { "onboarding.kickoffCall.booked": true, "onboarding.kickoffCall.callAt": { $exists: false } }],
  })
    .select("email user createdAt onboarding.kickoffCall onboardingEmails.callBookedSentAt")
    .limit(200)
    .lean();
  if (!pending.length) return;

  const found = await callsOf(pending as Pending[]);
  for (const [id, call] of found) {
    const said = pending.find((client) => String(client._id) === id)?.onboarding?.kickoffCall?.booked === true;
    // Found without being told: everyone hears of it now. Said already: the team heard then.
    await recordCall(id, call, { client: true, team: !said });
  }

  // Said they booked half an hour ago, and nothing turned up (no calendar connected, or booked
  // with another email): the email goes without a time, rather than not at all.
  for (const client of pending) {
    const call = client.onboarding?.kickoffCall;
    if (found.has(String(client._id)) || !call?.booked || call.callAt || client.onboardingEmails?.callBookedSentAt) continue;
    if (!call.bookedAt || new Date(call.bookedAt).getTime() > now - WAIT_FOR_TIME) continue;
    const full = await Client.findById(client._id);
    if (full) void emailCallBooked(full);
  }
};

// Every 5 minutes, from a minute after the server starts: bookings found on the connected
// calendars first, then the reminders due — so a client who booked is never reminded. The server
// runs as one process (ecosystem.config.js), so this runs once; the claims on the record keep it
// safe if not.
const CHECK_EVERY = 5 * MINUTE;

export const startOnboardingChecks = () => {
  if (!emailReady) console.log("Onboarding reminder emails off: email isn't set up (RESEND_API_KEY, EMAIL_FROM). The bell still gets them.");
  const run = async () => {
    await syncBookedCalls().catch((error) => console.error("Booking sync failed:", error));
    await sendDueReminders().catch((error) => console.error("Onboarding reminders failed:", error));
  };
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, CHECK_EVERY).unref();
};
