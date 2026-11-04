import { env } from "../config/env";
import { GoogleCalendar, type IGoogleCalendar } from "../models/googleCalendar.model";
import { unseal } from "./secretBox";

// Talking to Google for the Calendar page: the sign-in that connects an account (OAuth 2.0),
// and reading the meetings on that account's calendar. Read only — nothing is changed in Google.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
// Leave to add events: for booking clients' calls on the calendar (utils/booking.ts).
export const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const SCOPES = ["openid", "email", "profile", CALENDAR_SCOPE, EVENTS_SCOPE];
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

export const googleConfigured = () => Boolean(env.google.clientId && env.google.clientSecret);

// Google's sign-in page for connecting an account: read its calendar, and add the calls clients
// book. `prompt=consent` so Google always gives a refresh token — without one the connection
// would stop working within the hour.
export const googleAuthUrl = (state: string) =>
  `${AUTH_URL}?${new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: env.google.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })}`;

type TokenAnswer = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
};

const askForToken = async (body: Record<string, string>) => {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.google.clientId, client_secret: env.google.clientSecret, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const answer = (await response.json().catch(() => ({}))) as TokenAnswer;
  return { ok: response.ok, answer };
};

// What the id token says about the account. It came straight from Google over TLS, in answer to
// our own request, so it is read without checking its signature.
const accountOf = (idToken?: string): { email?: string; name?: string } => {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8"));
    return { email: typeof payload.email === "string" ? payload.email : undefined, name: typeof payload.name === "string" ? payload.name : undefined };
  } catch {
    return {};
  }
};

// The account behind the code Google sent back after sign-in, and its refresh token.
export const exchangeCode = async (code: string) => {
  const { ok, answer } = await askForToken({ code, redirect_uri: env.google.redirectUri, grant_type: "authorization_code" });
  if (!ok || !answer.access_token) throw new Error(answer.error || "Google refused the sign-in");
  const { email, name } = accountOf(answer.id_token);
  return {
    email,
    name,
    refreshToken: answer.refresh_token,
    calendarAllowed: String(answer.scope ?? "").split(" ").includes(CALENDAR_SCOPE),
    eventsAllowed: String(answer.scope ?? "").split(" ").includes(EVENTS_SCOPE),
    accessToken: answer.access_token,
    expiresIn: answer.expires_in ?? 3600,
  };
};

// Access tokens last an hour; kept here until a minute before they run out.
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

export const rememberAccessToken = (accountId: string, token: string, expiresIn: number) =>
  accessTokens.set(accountId, { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });

export class GoogleAccessLost extends Error {}

const accessTokenFor = async (account: IGoogleCalendar) => {
  const id = String(account._id);
  const kept = accessTokens.get(id);
  if (kept && kept.expiresAt > Date.now()) return kept.token;

  const { ok, answer } = await askForToken({ refresh_token: unseal(account.refreshTokenSealed), grant_type: "refresh_token" });
  if (!ok || !answer.access_token) {
    // invalid_grant: the access was taken back, or the token expired. Only connecting again helps.
    if (answer.error === "invalid_grant") {
      accessTokens.delete(id);
      await GoogleCalendar.updateOne({ _id: account._id }, { broken: true });
      throw new GoogleAccessLost(account.email);
    }
    throw new Error(answer.error || "Google didn't answer");
  }
  rememberAccessToken(id, answer.access_token, answer.expires_in ?? 3600);
  return answer.access_token;
};

export const forgetAccessToken = (accountId: string) => accessTokens.delete(accountId);

// Tells Google the portal no longer holds this access. Best effort.
export const revokeToken = async (account: IGoogleCalendar) => {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: unseal(account.refreshTokenSealed) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // The connection is removed here either way.
  }
};

export type GoogleEvent = {
  id: string;
  status?: string;
  created?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean; resource?: boolean }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

// A call to the Calendar API as the account. Throws with Google's own reason when it says no:
// "Google Calendar API has not been used in project … or it is disabled", …
const googleFetch = async <T,>(account: IGoogleCalendar, url: string, init: RequestInit = {}): Promise<T> => {
  const token = await accessTokenFor(account);
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401) {
    forgetAccessToken(String(account._id));
    throw new Error("Google turned the access token down");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || `Google answered ${response.status}`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
};

// The meetings on the account's main calendar between two times, repeating ones as each time.
// `q`: only those that mention it — Google matches a guest's email too.
export const eventsOf = async (account: IGoogleCalendar, from: Date, to: Date, q?: string): Promise<GoogleEvent[]> => {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      ...(q ? { q } : {}),
      ...(pageToken ? { pageToken } : {}),
    });
    const body = await googleFetch<{ items?: GoogleEvent[]; nextPageToken?: string }>(account, `${EVENTS_URL}?${params}`);
    events.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken && events.length < 2500);
  return events;
};

// When the account's main calendar is taken between two times.
export const busyOf = async (account: IGoogleCalendar, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> => {
  const body = await googleFetch<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(account, FREEBUSY_URL, {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
  });
  return (body.calendars?.primary?.busy ?? []).map((busy) => ({ start: new Date(busy.start), end: new Date(busy.end) }));
};

// Adds a meeting with a Google Meet link, and Google sends the guests their invitation.
export const createEvent = async (
  account: IGoogleCalendar,
  input: { start: Date; end: Date; timeZone: string; summary: string; description?: string; guests: { email: string; name?: string }[] }
) => {
  const params = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: "all" });
  return googleFetch<GoogleEvent>(account, `${EVENTS_URL}?${params}`, {
    method: "POST",
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
      attendees: input.guests.map((guest) => ({ email: guest.email, displayName: guest.name })),
      conferenceData: { createRequest: { requestId: `bayshore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      reminders: { useDefault: true },
    }),
  });
};

// Takes a meeting off the calendar, telling its guests. Already gone is fine.
export const deleteEvent = async (account: IGoogleCalendar, eventId: string) => {
  try {
    await googleFetch(account, `${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof Error && /not found|deleted/i.test(error.message))) throw error;
  }
};

export const videoLinkOf = (event: GoogleEvent) =>
  event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
