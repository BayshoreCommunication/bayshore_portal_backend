import mongoose, { Schema, Document } from "mongoose";

// A Google account the team connected on the company portal's Calendar page, so its calendar's
// meetings show there. One per Google account; the whole team sees what is on it.
export interface IGoogleCalendar extends Document {
  email: string;
  name?: string;
  // The account's refresh token, sealed (utils/secretBox.ts). Never sent anywhere.
  refreshTokenSealed: string;
  connectedBy: mongoose.Types.ObjectId;
  // Google stopped accepting the token (access removed, password changed…): it must be connected again.
  broken: boolean;
  // It was connected with leave to add events — needed to book clients' calls on it.
  canBook: boolean;
  // Clients book their onboarding call on this calendar (one at most): the hours it offers.
  booking?: IBookingHours;
  createdAt: Date;
  updatedAt: Date;
}

// When clients may book a call, in the calendar's own time zone.
export interface IBookingHours {
  enabled: boolean;
  timeZone: string;
  // 0 = Sunday … 6 = Saturday.
  days: number[];
  // "09:00" to "17:00": the last call ends by then.
  start: string;
  end: string;
  // Minutes each call takes; a new one can start every this many minutes.
  duration: number;
  // Hours ahead the soonest call can be, and days ahead the latest.
  notice: number;
  ahead: number;
}

export const DEFAULT_BOOKING_HOURS: IBookingHours = {
  enabled: false,
  timeZone: "America/New_York",
  days: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "17:00",
  duration: 45,
  notice: 2,
  ahead: 30,
};

/**
 * @swagger
 * components:
 *   schemas:
 *     GoogleCalendarAccount:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         email:
 *           type: string
 *         name:
 *           type: string
 *         connectedBy:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *             fullName:
 *               type: string
 *         broken:
 *           type: boolean
 *           description: Google no longer accepts this connection — connect the account again.
 *         canBook:
 *           type: boolean
 *           description: Connected with leave to add events, so clients' calls can be booked on it.
 *         booking:
 *           $ref: '#/components/schemas/BookingHours'
 *     BookingHours:
 *       type: object
 *       properties:
 *         enabled:
 *           type: boolean
 *           description: Clients book their onboarding call on this calendar.
 *         timeZone:
 *           type: string
 *           example: America/New_York
 *         days:
 *           type: array
 *           items:
 *             type: integer
 *           description: 0 = Sunday … 6 = Saturday
 *         start:
 *           type: string
 *           example: "09:00"
 *         end:
 *           type: string
 *           example: "17:00"
 *         duration:
 *           type: integer
 *           description: Minutes per call
 *         notice:
 *           type: integer
 *           description: Hours ahead the soonest call can be
 *         ahead:
 *           type: integer
 *           description: Days ahead the latest call can be
 *         createdAt:
 *           type: string
 *           format: date-time
 */
const googleCalendarSchema = new Schema<IGoogleCalendar>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, trim: true },
    refreshTokenSealed: { type: String, required: true, select: false },
    connectedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    broken: { type: Boolean, default: false },
    canBook: { type: Boolean, default: false },
    booking: {
      type: new Schema<IBookingHours>(
        {
          enabled: { type: Boolean, default: false },
          timeZone: { type: String, default: DEFAULT_BOOKING_HOURS.timeZone },
          days: { type: [Number], default: DEFAULT_BOOKING_HOURS.days },
          start: { type: String, default: DEFAULT_BOOKING_HOURS.start },
          end: { type: String, default: DEFAULT_BOOKING_HOURS.end },
          duration: { type: Number, default: DEFAULT_BOOKING_HOURS.duration },
          notice: { type: Number, default: DEFAULT_BOOKING_HOURS.notice },
          ahead: { type: Number, default: DEFAULT_BOOKING_HOURS.ahead },
        },
        { _id: false }
      ),
    },
  },
  { timestamps: true }
);

export const GoogleCalendar = mongoose.model<IGoogleCalendar>("GoogleCalendar", googleCalendarSchema);
