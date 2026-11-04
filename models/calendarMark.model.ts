import mongoose, { Schema, Document } from "mongoose";

// How a past meeting on a connected calendar went, as the team marked it on the Calendar page:
// held ("done") or not ("missed"). Google can't tell; without a mark a past meeting counts as done.
export const MEETING_OUTCOMES = ["done", "missed"] as const;
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];

export interface ICalendarMark extends Document {
  calendar: mongoose.Types.ObjectId;
  eventId: string;
  outcome: MeetingOutcome;
  markedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const calendarMarkSchema = new Schema<ICalendarMark>(
  {
    calendar: { type: Schema.Types.ObjectId, ref: "GoogleCalendar", required: true },
    eventId: { type: String, required: true },
    outcome: { type: String, enum: MEETING_OUTCOMES, required: true },
    markedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

calendarMarkSchema.index({ calendar: 1, eventId: 1 }, { unique: true });

export const CalendarMark = mongoose.model<ICalendarMark>("CalendarMark", calendarMarkSchema);
