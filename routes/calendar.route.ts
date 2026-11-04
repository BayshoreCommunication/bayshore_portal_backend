import { Router } from "express";
import {
  CAN_CONNECT_CALENDAR,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  googleCalendarCallback,
  listCalendarEvents,
  listGoogleCalendars,
  listMyMeetings,
  markMeetingOutcome,
  updateBookingHours,
} from "../controllers/calendar.controller";
import { authorize, protect } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { USER_ROLES, type UserRole } from "../models/user.model";
import { bookingHoursRules, calendarEventsRules, googleCalendarIdRule, meetingOutcomeRules } from "../validators/calendar.validator";

const router = Router();

const STAFF_ROLES = USER_ROLES.filter((role) => role !== "client") as UserRole[];

/**
 * @swagger
 * tags:
 *   name: Calendar
 *   description: >
 *     The company portal's Calendar page. The team connects Google accounts (read-only access to
 *     their calendar); everyone on the team then sees the meetings on them, each matched to its
 *     client by the guests' emails. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.
 */

/**
 * @swagger
 * /calendar/google:
 *   get:
 *     summary: The connected Google accounts
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: >
 *           `configured` is false until Google sign-in is set up on the server; `canConnect` says
 *           whether the caller may connect or remove accounts.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     configured:
 *                       type: boolean
 *                     canConnect:
 *                       type: boolean
 *                     accounts:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/GoogleCalendarAccount'
 */
router.get("/google", protect, authorize(...STAFF_ROLES), listGoogleCalendars);

/**
 * @swagger
 * /calendar/google/connect:
 *   get:
 *     summary: Start connecting a Google account
 *     description: Returns Google's sign-in page `url`; send the browser there. Google sends it back to /calendar/google/callback.
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "`url`: Google's sign-in page"
 *       503:
 *         description: Google sign-in isn't set up on the server
 */
router.get("/google/connect", protect, authorize(...CAN_CONNECT_CALENDAR), connectGoogleCalendar);

/**
 * @swagger
 * /calendar/google/callback:
 *   get:
 *     summary: Where Google sends the browser back after sign-in
 *     description: >
 *       Open (Google calls it). Saves the account, then redirects to the company portal's
 *       /calendar?google=connected — or denied, expired, not_allowed, no_calendar or error.
 *     tags: [Calendar]
 *     responses:
 *       302:
 *         description: Back to the Calendar page
 */
router.get("/google/callback", googleCalendarCallback);

/**
 * @swagger
 * /calendar/google/{id}:
 *   delete:
 *     summary: Disconnect a Google account
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Disconnected, and the access handed back to Google
 */
router.delete("/google/:id", protect, authorize(...CAN_CONNECT_CALENDAR), googleCalendarIdRule, validate, disconnectGoogleCalendar);

/**
 * @swagger
 * /calendar/google/{id}/booking:
 *   patch:
 *     summary: Set the hours clients can book their onboarding call on this calendar
 *     description: >
 *       Turning `enabled` on makes this the booking calendar and turns it off on every other one.
 *       Needs the account connected with leave to add events (`canBook`).
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BookingHours'
 *     responses:
 *       200:
 *         description: Saved
 */
router.patch("/google/:id/booking", protect, authorize(...CAN_CONNECT_CALENDAR), bookingHoursRules, validate, updateBookingHours);

/**
 * @swagger
 * /calendar/google/{id}/events/{eventId}/outcome:
 *   put:
 *     summary: Mark how a meeting went
 *     description: "`done` or `missed`; `null` takes the mark off (a past meeting then counts as done)."
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               outcome:
 *                 type: string
 *                 nullable: true
 *                 enum: [done, missed]
 *     responses:
 *       200:
 *         description: Marked
 */
router.put("/google/:id/events/:eventId/outcome", protect, authorize(...STAFF_ROLES), meetingOutcomeRules, validate, markMeetingOutcome);

/**
 * @swagger
 * /calendar/events:
 *   get:
 *     summary: The meetings on every connected calendar
 *     description: >
 *       Between `from` and `to` (62 days at most). Each says which Google account it is on and,
 *       when one of its guests is a client the caller may see, which client. `failed` lists the
 *       accounts that couldn't be read this time (`lost`: it must be connected again).
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Events fetched
 */
router.get("/events", protect, authorize(...STAFF_ROLES), calendarEventsRules, validate, listCalendarEvents);

/**
 * @swagger
 * /calendar/me:
 *   get:
 *     summary: The signed-in client's meetings
 *     description: >
 *       Every meeting on a connected calendar the client (or one of its logins) is a guest on, from a
 *       year back to a year ahead, each with how the team marked it (`outcome`: done or missed).
 *       `partial` is true when a calendar couldn't be read this time.
 *     tags: [Calendar]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Meetings fetched
 */
router.get("/me", protect, authorize("client"), listMyMeetings);

export default router;
