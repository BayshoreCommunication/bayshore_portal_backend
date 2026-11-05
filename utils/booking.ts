import { Client, type IClient } from "../models/client.model";
import { DEFAULT_BOOKING_HOURS, GoogleCalendar, type IBookingHours, type IGoogleCalendar } from "../models/googleCalendar.model";
import { User } from "../models/user.model";
import { ApiError } from "./ApiError";
import { busyOf, createEvent, deleteEvent, videoLinkOf } from "./googleCalendar";
import { callBookedOf, emailCallBooked, emailCallMoved } from "./onboardingEmails";
import { notifyCallBooked, notifyClientCallBooked } from "./notifications";

// Clients book their onboarding call in the portal itself: the free times on the booking calendar
// (the connected Google account the team chose on the Calendar page), and the call added to it —
// with a Google Meet link, and Google's invitation to the client. When no calendar is set up for
// it, the portals fall back to the Google appointment page (BOOKING_URL).

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The calendar clients book on, when one is set up and may take events.
export const bookingCalendar = () =>
  GoogleCalendar.findOne({ "booking.enabled": true, broken: false, canBook: true }).select("+refreshTokenSealed");

export const hoursOf = (account: Pick<IGoogleCalendar, "booking">): IBookingHours => ({ ...DEFAULT_BOOKING_HOURS, ...(account.booking ?? {}) });

// ── Time zones, without a library ────────────────────────────────────────────

// How far ahead of UTC a time zone is at a moment, in ms.
const offsetAt = (moment: number, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(moment))
      .map((part) => [part.type, part.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(moment / 1000) * 1000;
};

// The moment a wall-clock time is in a time zone ("2026-11-04 09:00" in New York).
const zonedMoment = (year: number, month: number, day: number, minutes: number, timeZone: string) => {
  const wall = Date.UTC(year, month, day, 0, minutes);
  let moment = wall - offsetAt(wall, timeZone);
  // Once more, for a clock change between the guess and the answer.
  moment = wall - offsetAt(moment, timeZone);
  return moment;
};

// Today's date in a time zone.
const todayIn = (timeZone: string, now: number) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value])
  );
  return { year: +parts.year, month: +parts.month - 1, day: +parts.day };
};

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
};

export const validTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

// ── Free times ───────────────────────────────────────────────────────────────

// Every time a call could start, as the hours say, from the soonest allowed to the latest.
export const candidates = (hours: IBookingHours, now: number) => {
  const soonest = now + hours.notice * HOUR;
  const latest = now + hours.ahead * DAY;
  const first = minutesOf(hours.start);
  const last = minutesOf(hours.end) - hours.duration;
  const today = todayIn(hours.timeZone, now);
  const slots: number[] = [];
  for (let offset = 0; offset <= hours.ahead + 1; offset++) {
    const date = new Date(Date.UTC(today.year, today.month, today.day + offset));
    if (!hours.days.includes(date.getUTCDay())) continue;
    for (let minutes = first; minutes <= last; minutes += hours.duration) {
      const moment = zonedMoment(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), minutes, hours.timeZone);
      if (moment >= soonest && moment <= latest) slots.push(moment);
    }
  }
  return slots;
};

// The times a call can be booked at: those the hours offer that nothing on the calendar overlaps.
export const freeSlots = async (account: IGoogleCalendar, now = Date.now()) => {
  const hours = hoursOf(account);
  const slots = candidates(hours, now);
  if (!slots.length) return { hours, slots: [] as Date[] };
  const busy = await busyOf(account, new Date(slots[0]), new Date(slots[slots.length - 1] + hours.duration * MINUTE));
  const free = slots.filter((start) => {
    const end = start + hours.duration * MINUTE;
    return !busy.some((taken) => taken.start.getTime() < end && taken.end.getTime() > start);
  });
  return { hours, slots: free.map((moment) => new Date(moment)) };
};

// ── Booking ──────────────────────────────────────────────────────────────────

export const bookedCallOf = (client: Pick<IClient, "onboarding">) => {
  const call = client.onboarding?.kickoffCall;
  if (!call?.booked) return null;
  return { callAt: call.callAt ?? null, meetLink: call.meetLink ?? null, inPortal: Boolean(call.eventId) };
};

// Books the client's call at `start` — one of the free times — on the booking calendar. A call
// booked here before is moved: the new one is added, then the old one taken off.
export const bookCall = async (client: IClient, start: Date) => {
  const account = await bookingCalendar();
  if (!account) throw new ApiError(409, "Online booking isn't open right now. Please use the booking page instead.");

  const { hours, slots } = await freeSlots(account);
  if (!slots.some((slot) => slot.getTime() === start.getTime())) {
    throw new ApiError(409, "That time was just taken or is no longer available. Please pick another.");
  }

  const logins = await User.find({ client: client._id, role: "client", status: "active" }).select("email fullName").lean();
  const guests = new Map<string, { email: string; name?: string }>();
  if (client.email) guests.set(client.email.toLowerCase(), { email: client.email, name: client.contactName });
  for (const login of logins) if (login.email && !guests.has(login.email.toLowerCase())) guests.set(login.email.toLowerCase(), { email: login.email, name: login.fullName });

  const event = await createEvent(account, {
    start,
    end: new Date(start.getTime() + hours.duration * MINUTE),
    timeZone: hours.timeZone,
    summary: `Onboarding call — ${client.companyName || client.contactName}`,
    description: [
      `Onboarding call with ${client.contactName}${client.companyName ? ` (${client.companyName})` : ""}.`,
      client.phone ? `Phone: ${client.phone}` : "",
      "Booked in the BayShore client portal.",
    ]
      .filter(Boolean)
      .join("\n"),
    guests: [...guests.values()],
  });

  const before = client.onboarding?.kickoffCall;
  const wasBooked = callBookedOf(client);
  client.set("onboarding.kickoffCall", {
    booked: true,
    bookedAt: before?.bookedAt ?? new Date(),
    callAt: start,
    eventId: event.id,
    calendar: account._id,
    meetLink: videoLinkOf(event),
  });
  await client.save();

  // The call it replaces, off the calendar it was on.
  if (before?.eventId && before.eventId !== event.id) {
    const old = before.calendar ? await GoogleCalendar.findById(before.calendar).select("+refreshTokenSealed") : account;
    if (old) await deleteEvent(old, before.eventId).catch((error) => console.error("Booking: couldn't remove the old call:", error));
  }

  if (!wasBooked) {
    void emailCallBooked(client);
    void notifyClientCallBooked(client._id, start);
    const login = client.user ? await User.findById(client.user) : null;
    if (login) void notifyCallBooked(client._id, login);
  } else if (!before?.callAt || new Date(before.callAt).getTime() !== start.getTime()) {
    // Booked before — on Google's page, or here at another time: this is the time now.
    void (before?.callAt ? emailCallMoved(client) : emailCallBooked(client));
    void notifyClientCallBooked(client._id, start);
  }
  return bookedCallOf(client);
};

// What the client portal shows for booking: the free times, or — with no booking calendar —
// that the Google booking page is the way.
export const bookingFor = async (clientId: unknown) => {
  const client = await Client.findById(clientId).select("onboarding.kickoffCall");
  const booked = client ? bookedCallOf(client) : null;
  const account = await bookingCalendar();
  if (!account) return { available: false as const, booked };
  const { hours, slots } = await freeSlots(account);
  return {
    available: true as const,
    booked,
    duration: hours.duration,
    host: account.name || account.email,
    slots: slots.map((slot) => slot.toISOString()),
  };
};
