import mongoose, { Schema, Document } from "mongoose";

// A meeting a client opens from their portal: they pick a free time on the booking calendar and
// choose which team members they want on it. The team lives in the task manager, so a participant
// is kept by email (with a name/role/avatar snapshot) — matched to a company-portal staff member
// by their email when they sign in. Only those people (and the client) see it; admins see all.
// Kept in step with Google Calendar — created there with a Meet link, removed when cancelled.

export const MEETING_STATUSES = ["scheduled", "cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_TITLE_MAX_LENGTH = 140;
export const MEETING_NOTES_MAX_LENGTH = 2000;
export const MEETING_MAX_PARTICIPANTS = 20;

export interface IMeetingParticipant {
  email: string;
  name: string;
  role?: string;
  avatar?: string;
}

export interface IMeeting extends Document {
  client: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  title: string;
  notes?: string;
  start: Date;
  end: Date;
  timeZone: string;
  // The team members chosen — by email, the only ones who see it (besides admins and the client).
  participants: IMeetingParticipant[];
  status: MeetingStatus;
  googleEventId?: string;
  calendar?: mongoose.Types.ObjectId;
  meetLink?: string;
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<IMeetingParticipant>(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, trim: true, default: "" },
    role: { type: String, trim: true },
    avatar: { type: String },
  },
  { _id: false }
);

const meetingSchema = new Schema<IMeeting>(
  {
    client: { type: Schema.Types.ObjectId, ref: "Client", required: [true, "Client is required"], index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: {
      type: String,
      required: [true, "Meeting title is required"],
      trim: true,
      maxlength: [MEETING_TITLE_MAX_LENGTH, `Title cannot exceed ${MEETING_TITLE_MAX_LENGTH} characters`],
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: [MEETING_NOTES_MAX_LENGTH, `Notes cannot exceed ${MEETING_NOTES_MAX_LENGTH} characters`],
    },
    start: { type: Date, required: [true, "Start time is required"] },
    end: { type: Date, required: [true, "End time is required"] },
    timeZone: { type: String, trim: true, default: "UTC" },
    participants: {
      type: [participantSchema],
      default: [],
      validate: {
        validator: (people: IMeetingParticipant[]) => people.length <= MEETING_MAX_PARTICIPANTS,
        message: `A meeting can have at most ${MEETING_MAX_PARTICIPANTS} participants`,
      },
    },
    status: { type: String, enum: MEETING_STATUSES, default: "scheduled" },
    googleEventId: { type: String },
    calendar: { type: Schema.Types.ObjectId, ref: "GoogleCalendar" },
    meetLink: { type: String },
  },
  { timestamps: true }
);

meetingSchema.index({ client: 1, start: -1 });
// A team member's meetings (the ones they're on), by their email.
meetingSchema.index({ "participants.email": 1, start: -1 });
meetingSchema.index({ status: 1, start: -1 });

export const Meeting = mongoose.model<IMeeting>("Meeting", meetingSchema);
