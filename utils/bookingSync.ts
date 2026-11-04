import { Client } from "../models/client.model";
import { GoogleCalendar } from "../models/googleCalendar.model";
import { User } from "../models/user.model";
import { eventsOf } from "./googleCalendar";
import { emailReady } from "./email";
import { emailCallBooked, sendDueReminders } from "./onboardingEmails";
import { notifyCallBooked, notifyClientCallBooked } from "./notifications";

// A client books their onboarding call on a Google Calendar appointment schedule, which doesn't
// tell the portal. But the booking lands on the calendar of whoever owns that schedule — and when
// that account is connected on the company portal's Calendar page, it can be found there: a
// meeting with the client (or one of its logins) as a guest. Found, the call is marked booked,
// with when it is, just as if the client had said so — and no reminder goes to them.

const DAY = 24 * 60 * 60 * 1000;
// Clients still onboarding, made within this long, are looked for.
const LOOK_BACK = 30 * DAY;
// And their call can be this far ahead.
const LOOK_AHEAD = 90 * DAY;

export const syncBookedCalls = async () => {
  const now = Date.now();
  const pending = await Client.find({
    status: "onboarding",
    user: { $exists: true },
    "onboarding.kickoffCall.booked": { $ne: true },
    createdAt: { $gte: new Date(now - LOOK_BACK) },
  })
    .select("email user createdAt")
    .limit(200)
    .lean();
  if (!pending.length) return;

  const accounts = await GoogleCalendar.find({ broken: false }).select("+refreshTokenSealed");
  if (!accounts.length) return;

  // Each email a pending client may have booked with: theirs, and their logins'.
  const clientOf = new Map<string, (typeof pending)[number]>();
  for (const client of pending) if (client.email) clientOf.set(client.email.toLowerCase(), client);
  const logins = await User.find({ role: "client", client: { $in: pending.map((client) => client._id) } })
    .select("email client")
    .lean();
  for (const login of logins) {
    const client = pending.find((each) => String(each._id) === String(login.client));
    if (client && login.email) clientOf.set(login.email.toLowerCase(), client);
  }

  const from = new Date(Math.min(...pending.map((client) => new Date(client.createdAt).getTime())) - DAY);
  const to = new Date(now + LOOK_AHEAD);

  // The first call found for each client: at or after they signed up.
  const found = new Map<string, Date>();
  for (const account of accounts) {
    let events;
    try {
      events = await eventsOf(account, from, to);
    } catch (error) {
      console.error(`Booking sync: couldn't read ${account.email}:`, error instanceof Error ? error.message : error);
      continue;
    }
    for (const event of events) {
      const start = event.start?.dateTime ?? event.start?.date;
      if (event.status === "cancelled" || !start) continue;
      const at = new Date(start);
      for (const guest of event.attendees ?? []) {
        if (guest.responseStatus === "declined") continue;
        const client = guest.email ? clientOf.get(guest.email.toLowerCase()) : undefined;
        if (!client || at.getTime() < new Date(client.createdAt).getTime() - DAY) continue;
        const id = String(client._id);
        const earlier = found.get(id);
        if (!earlier || at < earlier) found.set(id, at);
      }
    }
  }

  for (const [id, at] of found) {
    // Claimed on the record, so a client who said so meanwhile isn't told twice.
    const marked = await Client.updateOne(
      { _id: id, "onboarding.kickoffCall.booked": { $ne: true } },
      { $set: { "onboarding.kickoffCall.booked": true, "onboarding.kickoffCall.bookedAt": new Date(), "onboarding.kickoffCall.callAt": at } }
    );
    if (!marked.modifiedCount) continue;
    const client = await Client.findById(id);
    if (!client) continue;
    void emailCallBooked(client);
    void notifyClientCallBooked(client._id, at);
    const login = client.user ? await User.findById(client.user) : null;
    if (login) void notifyCallBooked(client._id, login);
  }
};

// Every 5 minutes, from a minute after the server starts: bookings found on the connected
// calendars first, then the reminders due — so a client who booked is never reminded. The server
// runs as one process (ecosystem.config.js), so this runs once; the claims on the record keep it
// safe if not.
const CHECK_EVERY = 5 * 60 * 1000;

export const startOnboardingChecks = () => {
  if (!emailReady) console.log("Onboarding reminder emails off: email isn't set up (RESEND_API_KEY, EMAIL_FROM). The bell still gets them.");
  const run = async () => {
    await syncBookedCalls().catch((error) => console.error("Booking sync failed:", error));
    await sendDueReminders().catch((error) => console.error("Onboarding reminders failed:", error));
  };
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, CHECK_EVERY).unref();
};
