import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { Client } from "../models/client.model";
import { GoogleCalendar } from "../models/googleCalendar.model";
import { CalendarMark, type MeetingOutcome } from "../models/calendarMark.model";
import { User, type UserRole } from "../models/user.model";
import { ApiError } from "../utils/ApiError";
import { ApiResponse } from "../utils/ApiResponse";
import { clientScopeFor } from "../utils/clientAccess";
import {
  GoogleAccessLost,
  eventsOf,
  exchangeCode,
  forgetAccessToken,
  googleAuthUrl,
  googleConfigured,
  rememberAccessToken,
  revokeToken,
  videoLinkOf,
  type GoogleEvent,
} from "../utils/googleCalendar";
import { seal } from "../utils/secretBox";
import { hoursOf, validTimeZone } from "../utils/booking";
import { clientMeetings } from "../utils/clientMeetings";
import { DEFAULT_BOOKING_HOURS } from "../models/googleCalendar.model";

// The company portal's Calendar page: Google accounts the team connects, and the meetings on
// their calendars — each matched to the client it is with, by the guests' emails.

// Who may connect or remove a Google account (company-portal: canManageClients).
export const CAN_CONNECT_CALENDAR: UserRole[] = ["assistant_manager", "manager", "admin", "superadmin"];

const STATE_PURPOSE = "google-calendar";
// The longest stretch one request may ask for: a month view shows six weeks.
const MAX_RANGE_DAYS = 62;

const backToCalendar = (res: Response, outcome: string) =>
  res.redirect(`${env.companyPortalUrl}/calendar?google=${encodeURIComponent(outcome)}`);

const accountsView = async () =>
  GoogleCalendar.find().sort({ createdAt: 1 }).populate("connectedBy", "fullName").select("email name connectedBy broken canBook booking createdAt").lean();

// GET /calendar/google — the connected accounts, and whether Google sign-in is set up at all.
export const listGoogleCalendars = asyncHandler(async (req: Request, res: Response) => {
  return ApiResponse(res, 200, "Google calendars fetched", {
    configured: googleConfigured(),
    canConnect: CAN_CONNECT_CALENDAR.includes(req.user!.role),
    accounts: await accountsView(),
  });
});

// GET /calendar/google/connect — where to send the browser to connect a Google account.
export const connectGoogleCalendar = asyncHandler(async (req: Request, res: Response) => {
  if (!googleConfigured()) throw new ApiError(503, "Google sign-in isn't set up on the server yet.");
  // Says who started it, so the answer Google sends back (to an open route) can be trusted.
  const state = jwt.sign({ uid: String(req.user!._id), purpose: STATE_PURPOSE }, env.jwtSecret, { expiresIn: "10m" });
  return ApiResponse(res, 200, "Google sign-in ready", { url: googleAuthUrl(state) });
});

// GET /calendar/google/callback — Google sends the browser back here after sign-in. Open:
// the signed state says who asked. Always ends on the Calendar page, saying how it went.
export const googleCalendarCallback = async (req: Request, res: Response) => {
  if (req.query.error) return backToCalendar(res, "denied");

  let uid: string;
  try {
    const payload = jwt.verify(String(req.query.state ?? ""), env.jwtSecret) as { uid?: string; purpose?: string };
    if (payload.purpose !== STATE_PURPOSE || !payload.uid) throw new Error("Not ours");
    uid = payload.uid;
  } catch {
    return backToCalendar(res, "expired");
  }

  try {
    const user = await User.findById(uid).select("role status");
    if (!user || user.status !== "active" || !CAN_CONNECT_CALENDAR.includes(user.role)) return backToCalendar(res, "not_allowed");

    const google = await exchangeCode(String(req.query.code ?? ""));
    if (!google.calendarAllowed) return backToCalendar(res, "no_calendar");
    if (!google.email) return backToCalendar(res, "error");

    const existing = await GoogleCalendar.findOne({ email: google.email.toLowerCase() }).select("+refreshTokenSealed");
    const refreshToken = google.refreshToken;
    if (!refreshToken && !existing) return backToCalendar(res, "error");

    const account = existing ?? new GoogleCalendar({ email: google.email });
    if (refreshToken) account.refreshTokenSealed = seal(refreshToken);
    account.name = google.name ?? account.name;
    account.connectedBy = user._id as typeof account.connectedBy;
    account.broken = false;
    account.canBook = google.eventsAllowed;
    await account.save();
    rememberAccessToken(String(account._id), google.accessToken, google.expiresIn);

    return backToCalendar(res, "connected");
  } catch {
    return backToCalendar(res, "error");
  }
};

// DELETE /calendar/google/:id — stop showing an account's calendar, and give Google back the access.
export const disconnectGoogleCalendar = asyncHandler(async (req: Request, res: Response) => {
  const account = await GoogleCalendar.findById(req.params.id).select("+refreshTokenSealed");
  if (!account) throw new ApiError(404, "That Google account isn't connected");
  await revokeToken(account);
  forgetAccessToken(String(account._id));
  await account.deleteOne();
  return ApiResponse(res, 200, "Google account disconnected", null);
});

// Google's description may hold HTML: shown as plain text.
const plainText = (html?: string) =>
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


// GET /calendar/events?from&to — the meetings on every connected calendar in that stretch.
export const listCalendarEvents = asyncHandler(async (req: Request, res: Response) => {
  const from = new Date(String(req.query.from));
  const to = new Date(String(req.query.to));
  if (!(to > from)) throw new ApiError(400, "`to` must be after `from`");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) throw new ApiError(400, `Ask for ${MAX_RANGE_DAYS} days at most`);

  const accounts = await GoogleCalendar.find({ broken: false }).select("+refreshTokenSealed");
  const results = await Promise.allSettled(accounts.map((account) => eventsOf(account, from, to)));

  const failed: { _id: string; email: string; lost: boolean; reason?: string }[] = [];
  const found: { account: (typeof accounts)[number]; event: GoogleEvent }[] = [];
  results.forEach((result, index) => {
    const account = accounts[index];
    if (result.status === "rejected") {
      const lost = result.reason instanceof GoogleAccessLost;
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Calendar: couldn't read ${account.email}: ${reason}`);
      failed.push({ _id: String(account._id), email: account.email, lost, reason: lost ? undefined : reason.slice(0, 300) });
      return;
    }
    for (const event of result.value) {
      if (event.status !== "cancelled" && event.start) found.push({ account, event });
    }
  });

  // Which client each meeting is with: a guest who is a client (or one of its logins), among
  // the clients this person may see.
  const guestEmails = [...new Set(found.flatMap(({ event }) => (event.attendees ?? []).map((guest) => guest.email?.toLowerCase()).filter(Boolean) as string[]))];
  const byEmail = new Map<string, { _id: string; companyName: string }>();
  if (guestEmails.length) {
    const logins = await User.find({ role: "client", email: { $in: guestEmails } }).select("email client").lean();
    const loginClient = new Map(logins.filter((login) => login.client && login.email).map((login) => [String(login.client), login.email!.toLowerCase()]));
    const clients = await Client.find({
      $and: [{ $or: [{ email: { $in: guestEmails } }, { _id: { $in: [...loginClient.keys()] } }] }, clientScopeFor(req.user!)],
    })
      .select("companyName email")
      .lean();
    for (const client of clients) {
      const view = { _id: String(client._id), companyName: client.companyName };
      if (client.email) byEmail.set(client.email.toLowerCase(), view);
      const loginEmail = loginClient.get(String(client._id));
      if (loginEmail) byEmail.set(loginEmail, view);
    }
  }

  // How the past ones went, where the team marked it.
  const marks = found.length
    ? await CalendarMark.find({ $or: accounts.map((account) => ({ calendar: account._id, eventId: { $in: found.filter((each) => each.account === account).map((each) => each.event.id) } })) })
        .select("calendar eventId outcome")
        .lean()
    : [];
  const outcomeOf = new Map(marks.map((mark) => [`${mark.calendar}:${mark.eventId}`, mark.outcome]));

  const events = found
    .map(({ account, event }) => {
      const guests = (event.attendees ?? []).filter((guest) => guest.email && !guest.resource);
      const client = guests.map((guest) => byEmail.get(guest.email!.toLowerCase())).find(Boolean) ?? null;
      const allDay = Boolean(event.start?.date && !event.start?.dateTime);
      return {
        id: `${account._id}:${event.id}`,
        accountId: String(account._id),
        accountEmail: account.email,
        title: event.summary?.trim() || "(No title)",
        start: event.start?.dateTime ?? event.start?.date,
        end: event.end?.dateTime ?? event.end?.date ?? event.start?.dateTime ?? event.start?.date,
        allDay,
        location: event.location,
        description: plainText(event.description),
        meetLink: videoLinkOf(event),
        link: event.htmlLink,
        organizer: event.organizer?.email,
        guests: guests.map((guest) => ({
          email: guest.email!,
          name: guest.displayName,
          status: guest.responseStatus,
          organizer: Boolean(guest.organizer),
        })),
        client,
        // Marked by the team: "done" or "missed". Unmarked, the page works it out from the time.
        outcome: outcomeOf.get(`${account._id}:${event.id}`) ?? null,
      };
    })
    .sort((a, b) => new Date(String(a.start)).getTime() - new Date(String(b.start)).getTime());

  return ApiResponse(res, 200, "Calendar events fetched", { events, failed });
});

// PATCH /calendar/google/:id/booking — whether clients book their call on this calendar, and the
// hours it offers. Only one calendar takes bookings: turning it on here turns it off on the rest.
export const updateBookingHours = asyncHandler(async (req: Request, res: Response) => {
  const account = await GoogleCalendar.findById(req.params.id);
  if (!account) throw new ApiError(404, "That Google account isn't connected");

  const hours = { ...hoursOf(account), ...req.body };
  hours.days = [...new Set((hours.days as number[]).map(Number))].sort();
  if (!validTimeZone(hours.timeZone)) throw new ApiError(400, "Unknown time zone");
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  if (toMinutes(hours.end) - toMinutes(hours.start) < hours.duration) throw new ApiError(400, "The day must be long enough for at least one call");
  if (hours.enabled && !account.canBook) throw new ApiError(409, "Connect this account again and allow adding events to book calls on it");
  if (hours.enabled && !hours.days.length) throw new ApiError(400, "Pick at least one day");

  if (hours.enabled) await GoogleCalendar.updateMany({ _id: { $ne: account._id } }, { $set: { "booking.enabled": false } });
  account.booking = { ...DEFAULT_BOOKING_HOURS, ...hours };
  await account.save();
  return ApiResponse(res, 200, "Booking hours saved", account.booking);
});

// PUT /calendar/google/:id/events/:eventId/outcome — mark how a meeting went: "done", "missed",
// or null to take the mark off.
export const markMeetingOutcome = asyncHandler(async (req: Request, res: Response) => {
  const account = await GoogleCalendar.exists({ _id: req.params.id });
  if (!account) throw new ApiError(404, "That Google account isn't connected");
  const outcome = req.body.outcome as MeetingOutcome | null;
  const where = { calendar: req.params.id, eventId: String(req.params.eventId) };
  if (outcome) await CalendarMark.updateOne(where, { $set: { outcome, markedBy: req.user!._id } }, { upsert: true });
  else await CalendarMark.deleteOne(where);
  return ApiResponse(res, 200, "Meeting marked", { outcome: outcome ?? null });
});

// ── The client's own meetings (client portal: Calendar) ─────────────────────

// How far back and ahead a client's meetings are looked for.
const MY_MEETINGS_PAST_DAYS = 365;
const MY_MEETINGS_AHEAD_DAYS = 365;

// GET /calendar/me — the meetings the signed-in client is a guest on, on any connected calendar:
// the ones to come and the ones gone by, each with how the team marked it (done or missed).
export const listMyMeetings = asyncHandler(async (req: Request, res: Response) => {
  const clientId = req.user!.client;
  if (!clientId) throw new ApiError(403, "This account is not linked to a client");
  const now = Date.now();
  const { meetings, partial } = await clientMeetings(
    clientId,
    req.user!.email,
    new Date(now - MY_MEETINGS_PAST_DAYS * 24 * 60 * 60 * 1000),
    new Date(now + MY_MEETINGS_AHEAD_DAYS * 24 * 60 * 60 * 1000)
  );
  return ApiResponse(res, 200, "Meetings fetched", { meetings, partial });
});
