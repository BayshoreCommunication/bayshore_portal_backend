import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Meeting, type IMeeting, type IMeetingParticipant } from "../models/meeting.model";
import { Client } from "../models/client.model";
import { type IUser } from "../models/user.model";
import { GoogleCalendar } from "../models/googleCalendar.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { bookingCalendar, freeSlots } from "../utils/booking";
import { createEvent, deleteEvent, videoLinkOf } from "../utils/googleCalendar";
import { taskManagerTeam } from "../utils/taskManagerAuth";

// Client-opened meetings (models/meeting.model.ts): a client picks a free time on the booking
// calendar and the team members they want on it (the team lives in the task manager). A
// participant is kept by email; a staff member sees a meeting when their email is on it, a "super
// user" (admin) sees all. Kept in step with Google.

const MINUTE = 60 * 1000;

// Who sees every meeting — the super users.
const MEETING_SUPER_ROLES = ["admin", "superadmin"];
const isSuperUser = (user: IUser) => MEETING_SUPER_ROLES.includes(user.role);

// A staff member sees a meeting only when their email is on it; a super user sees them all.
const staffScope = (user: IUser): mongoose.FilterQuery<IMeeting> =>
  isSuperUser(user) ? {} : { "participants.email": (user.email ?? "").toLowerCase() };

type Populated = Omit<IMeeting, "client" | "createdBy"> & {
  client: { _id: unknown; companyName: string; contactName?: string } | null;
  createdBy: { _id: unknown; fullName: string } | null;
};

const populate = <T extends mongoose.Query<unknown, IMeeting>>(query: T) =>
  query.populate("client", "companyName contactName").populate("createdBy", "fullName");

const viewOf = (meeting: Populated) => ({
  _id: String(meeting._id),
  client: meeting.client ? { _id: String(meeting.client._id), companyName: meeting.client.companyName, contactName: meeting.client.contactName } : null,
  title: meeting.title,
  notes: meeting.notes ?? "",
  start: meeting.start?.toISOString?.() ?? meeting.start,
  end: meeting.end?.toISOString?.() ?? meeting.end,
  timeZone: meeting.timeZone,
  status: meeting.status,
  meetLink: meeting.meetLink ?? null,
  createdBy: meeting.createdBy ? { _id: String(meeting.createdBy._id), fullName: meeting.createdBy.fullName } : null,
  participants: meeting.participants.map((person) => ({ email: person.email, name: person.name, role: person.role ?? "", avatar: person.avatar ?? null })),
  createdAt: meeting.createdAt?.toISOString?.() ?? meeting.createdAt,
});

const findPopulated = async (id: string, scope: mongoose.FilterQuery<IMeeting> = {}) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, "Meeting not found");
  const meeting = (await populate(Meeting.findOne({ $and: [{ _id: id }, scope] })).lean()) as unknown as Populated | null;
  if (!meeting) throw new ApiError(404, "Meeting not found");
  return meeting;
};

const removeEvent = async (meeting: Pick<IMeeting, "calendar" | "googleEventId">) => {
  if (!meeting.googleEventId) return;
  const account = meeting.calendar ? await GoogleCalendar.findById(meeting.calendar).select("+refreshTokenSealed") : null;
  if (account) await deleteEvent(account, meeting.googleEventId).catch((error) => console.error("Meeting: couldn't remove the Google event:", error));
};

// ── Staff (company portal) ───────────────────────────────────────────────────

export const listMeetings = asyncHandler(async (req: Request, res: Response) => {
  const meetings = (await populate(Meeting.find(staffScope(req.user!)).sort({ start: -1 })).lean()) as unknown as Populated[];
  return ApiResponse(res, 200, "Meetings fetched", { meetings: meetings.map(viewOf) });
});

export const getMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await findPopulated(req.params.id, staffScope(req.user!));
  return ApiResponse(res, 200, "Meeting fetched", viewOf(meeting));
});

export const cancelMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await Meeting.findOne({ $and: [{ _id: req.params.id }, staffScope(req.user!)] });
  if (!meeting) throw new ApiError(404, "Meeting not found");
  if (meeting.status !== "cancelled") {
    await removeEvent(meeting);
    meeting.status = "cancelled";
    await meeting.save();
  }
  return ApiResponse(res, 200, "Meeting cancelled", viewOf(await findPopulated(String(meeting._id))));
});

// ── Client (client portal) ───────────────────────────────────────────────────

const myClientId = (req: Request) => {
  const clientId = req.user!.client;
  if (!clientId) throw new ApiError(403, "This account is not linked to a client");
  return clientId;
};

export const listSlots = asyncHandler(async (_req: Request, res: Response) => {
  const account = await bookingCalendar();
  if (!account) return ApiResponse(res, 200, "Slots fetched", { available: false, slots: [], duration: 0 });
  const { hours, slots } = await freeSlots(account);
  return ApiResponse(res, 200, "Slots fetched", {
    available: true,
    duration: hours.duration,
    timeZone: hours.timeZone,
    host: account.name || account.email,
    slots: slots.map((slot) => slot.toISOString()),
  });
});

// GET /meetings/me/staff — the whole team (from the task manager) a client may put on a meeting.
// Super users aren't offered as participants — a client picks the team they work with.
const HIDDEN_FROM_PICKER = new Set(["admin", "superadmin"]);
export const listSelectableStaff = asyncHandler(async (_req: Request, res: Response) => {
  const team = await taskManagerTeam();
  return ApiResponse(res, 200, "Staff fetched", {
    staff: team
      .filter((member) => !HIDDEN_FROM_PICKER.has(member.role))
      .map((member) => ({ email: member.email, name: member.name, role: member.role, avatar: member.avatar ?? null, designation: member.designation ?? "", department: member.department ?? "" })),
  });
});

export const listMyMeetings = asyncHandler(async (req: Request, res: Response) => {
  const meetings = (await populate(Meeting.find({ client: myClientId(req) }).sort({ start: -1 })).lean()) as unknown as Populated[];
  return ApiResponse(res, 200, "Meetings fetched", { meetings: meetings.map(viewOf) });
});

export const createMyMeeting = asyncHandler(async (req: Request, res: Response) => {
  const clientId = myClientId(req);
  const client = await Client.findById(clientId);
  if (!client) throw new ApiError(403, "This account is not linked to a client");

  const title = String(req.body.title ?? "").trim();
  if (!title) throw new ApiError(422, "A meeting title is required");
  const start = new Date(String(req.body.start));
  if (Number.isNaN(start.getTime())) throw new ApiError(422, "A valid start time is required");

  const account = await bookingCalendar();
  if (!account) throw new ApiError(409, "Online booking isn't open right now. Please try again later.");

  const { hours, slots } = await freeSlots(account);
  if (!slots.some((slot) => slot.getTime() === start.getTime())) {
    throw new ApiError(409, "That time is booked or no longer available. Please pick another.");
  }

  // Only real team members (by email, from the task manager) can be put on it.
  const wanted = new Set((Array.isArray(req.body.participants) ? req.body.participants : []).map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean));
  const team = await taskManagerTeam();
  const chosen = team.filter((member) => wanted.has(member.email.toLowerCase()));
  if (!chosen.length) throw new ApiError(422, "Choose at least one team member for the meeting");

  const end = new Date(start.getTime() + hours.duration * MINUTE);
  const participants: IMeetingParticipant[] = chosen.map((member) => ({ email: member.email.toLowerCase(), name: member.name, role: member.role, avatar: member.avatar ?? undefined }));

  // Everyone who gets the Google invitation: the team chosen, and the client's own contacts.
  const guests = new Map<string, { email: string; name?: string }>();
  for (const member of chosen) guests.set(member.email.toLowerCase(), { email: member.email, name: member.name });
  if (client.email) guests.set(client.email.toLowerCase(), { email: client.email, name: client.contactName });

  const event = await createEvent(account, {
    start,
    end,
    timeZone: hours.timeZone,
    summary: title,
    description: [req.body.notes ? String(req.body.notes).trim() : "", `Requested by ${client.contactName || client.companyName} in the BayShore client portal.`].filter(Boolean).join("\n\n"),
    guests: [...guests.values()],
  });

  const meeting = await Meeting.create({
    client: client._id,
    createdBy: req.user!._id,
    title,
    notes: req.body.notes ? String(req.body.notes).trim() : "",
    start,
    end,
    timeZone: hours.timeZone,
    participants,
    status: "scheduled",
    googleEventId: event.id,
    calendar: account._id,
    meetLink: videoLinkOf(event),
  });

  return ApiResponse(res, 201, "Meeting created", viewOf(await findPopulated(String(meeting._id))));
});

export const cancelMyMeeting = asyncHandler(async (req: Request, res: Response) => {
  const meeting = await Meeting.findOne({ _id: req.params.id, client: myClientId(req) });
  if (!meeting) throw new ApiError(404, "Meeting not found");
  if (meeting.status !== "cancelled") {
    await removeEvent(meeting);
    meeting.status = "cancelled";
    await meeting.save();
  }
  return ApiResponse(res, 200, "Meeting cancelled", viewOf(await findPopulated(String(meeting._id))));
});
