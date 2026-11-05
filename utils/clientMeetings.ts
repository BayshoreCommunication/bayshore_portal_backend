import type mongoose from "mongoose";
import { CalendarMark } from "../models/calendarMark.model";
import { Client } from "../models/client.model";
import { DEFAULT_BOOKING_HOURS, GoogleCalendar } from "../models/googleCalendar.model";
import { User } from "../models/user.model";
import { eventsOf, videoLinkOf, type GoogleEvent } from "./googleCalendar";

// A client's meetings with the team: every meeting on a connected Google Calendar the client (or
// one of its logins) is a guest on, between two times — each with how the team marked it once it
// was over. The client portal's Calendar page shows a year either side; its dashboard, the next few.

// Google's description may hold HTML: shown as plain text.
export const plainText = (html?: string) =>
  html
    ?.replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2000) || undefined;


export const clientMeetings = async (clientId: mongoose.Types.ObjectId | string, viewerEmail: string | undefined, from: Date, to: Date) => {
  const client = await Client.findById(clientId).select("companyName email onboarding.kickoffCall").lean();
  if (!client) return { meetings: [], partial: false };

  // Their emails: the client's own, and every login on it.
  const logins = await User.find({ client: clientId, role: "client" }).select("email").lean();
  const emails = new Set([client.email, viewerEmail, ...logins.map((login) => login.email)].filter(Boolean).map((email) => String(email).toLowerCase()));

  const accounts = await GoogleCalendar.find({ broken: false }).select("+refreshTokenSealed");
  const searches = accounts.flatMap((account) => [...emails].map((email) => ({ account, email })));
  const results = await Promise.allSettled(searches.map(({ account, email }) => eventsOf(account, from, to, email)));

  // The same meeting turns up once per email and per calendar it is on: kept once.
  let partial = false;
  const seen = new Map<string, { account: (typeof accounts)[number]; event: GoogleEvent }>();
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      partial = true;
      return;
    }
    const { account } = searches[index];
    for (const event of result.value) {
      if (event.status === "cancelled" || !event.start) continue;
      // Google's search is loose: only those they are really a guest on.
      if (!(event.attendees ?? []).some((guest) => guest.email && emails.has(guest.email.toLowerCase()))) continue;
      const key = event.id;
      if (!seen.has(key)) seen.set(key, { account, event });
    }
  });
  const found = [...seen.values()];

  const marks = found.length
    ? await CalendarMark.find({ $or: found.map(({ account, event }) => ({ calendar: account._id, eventId: event.id })) })
        .select("calendar eventId outcome")
        .lean()
    : [];
  const outcomeOf = new Map(marks.map((mark) => [`${mark.calendar}:${mark.eventId}`, mark.outcome]));
  const kickoff = client.onboarding?.kickoffCall;

  const meetings = found
    .map(({ account, event }) => {
      const guests = (event.attendees ?? []).filter((guest) => guest.email && !guest.resource);
      const mine = guests.find((guest) => emails.has(guest.email!.toLowerCase()));
      const host = guests.find((guest) => guest.organizer) ?? event.organizer;
      return {
        id: `${account._id}:${event.id}`,
        title: event.summary?.trim() || "Meeting with BayShore",
        start: event.start?.dateTime ?? event.start?.date,
        end: event.end?.dateTime ?? event.end?.date ?? event.start?.dateTime ?? event.start?.date,
        allDay: Boolean(event.start?.date && !event.start?.dateTime),
        location: event.location,
        description: plainText(event.description),
        meetLink: videoLinkOf(event),
        host: { email: host?.email ?? account.email, name: host?.displayName ?? (host?.email === account.email ? account.name : undefined) },
        guests: guests.map((guest) => ({ email: guest.email!, name: guest.displayName, status: guest.responseStatus, organizer: Boolean(guest.organizer) })),
        // Their own answer to the invitation: "accepted", "declined", "tentative" or "needsAction".
        response: mine?.responseStatus,
        // The onboarding (kickoff) call.
        kickoff: Boolean(kickoff?.eventId && kickoff.eventId === event.id),
        outcome: outcomeOf.get(`${account._id}:${event.id}`) ?? null,
      };
    })
    .sort((a, b) => new Date(String(a.start)).getTime() - new Date(String(b.start)).getTime());

  // Their kickoff call, when no connected calendar shows it (yet).
  if (kickoff?.booked && kickoff.callAt && kickoff.callAt >= from && kickoff.callAt <= to && !meetings.some((meeting) => meeting.kickoff)) {
    meetings.push({
      id: "kickoff",
      title: "Kickoff call with BayShore",
      start: new Date(kickoff.callAt).toISOString(),
      end: new Date(new Date(kickoff.callAt).getTime() + DEFAULT_BOOKING_HOURS.duration * 60 * 1000).toISOString(),
      allDay: false,
      location: undefined,
      description: undefined,
      meetLink: kickoff.meetLink,
      host: { email: "", name: "BayShore team" },
      guests: [],
      response: undefined,
      kickoff: true,
      outcome: null,
    });
    meetings.sort((a, b) => new Date(String(a.start)).getTime() - new Date(String(b.start)).getTime());
  }

  return { meetings, partial };
};
