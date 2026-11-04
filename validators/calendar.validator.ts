import { body, param, query, type ValidationChain } from "express-validator";

export const googleCalendarIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid Google account id")];

export const calendarEventsRules: ValidationChain[] = [
  query("from").isISO8601().withMessage("`from` must be a date and time (ISO 8601)"),
  query("to").isISO8601().withMessage("`to` must be a date and time (ISO 8601)"),
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const bookingHoursRules: ValidationChain[] = [
  ...googleCalendarIdRule,
  body("enabled").optional().isBoolean().withMessage("`enabled` must be true or false").toBoolean(),
  body("timeZone").optional().isString().trim().notEmpty().withMessage("Pick a time zone"),
  body("days").optional().isArray().withMessage("`days` must be a list"),
  body("days.*").isInt({ min: 0, max: 6 }).withMessage("Days are 0 (Sunday) to 6 (Saturday)").toInt(),
  body("start").optional().matches(TIME).withMessage("Start must be a time like 09:00"),
  body("end").optional().matches(TIME).withMessage("End must be a time like 17:00"),
  body("duration").optional().isInt({ min: 15, max: 180 }).withMessage("A call is 15 to 180 minutes").toInt(),
  body("notice").optional().isInt({ min: 0, max: 168 }).withMessage("Notice is 0 to 168 hours").toInt(),
  body("ahead").optional().isInt({ min: 1, max: 90 }).withMessage("Book up to 1 to 90 days ahead").toInt(),
];

export const meetingOutcomeRules: ValidationChain[] = [
  ...googleCalendarIdRule,
  param("eventId").isString().isLength({ min: 1, max: 1024 }).withMessage("Invalid event id"),
  body("outcome")
    .custom((value) => value === null || value === "done" || value === "missed")
    .withMessage("`outcome` must be done, missed or null"),
];
