import { body, param, type ValidationChain } from "express-validator";
import { MEETING_TITLE_MAX_LENGTH, MEETING_NOTES_MAX_LENGTH, MEETING_MAX_PARTICIPANTS } from "../models/meeting.model";

export const meetingIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid meeting id")];

// A client opening a meeting: a title, a chosen start time, and the staff to put on it.
export const createMyMeetingRules: ValidationChain[] = [
  body("title").isString().withMessage("A meeting title is required").bail().trim().notEmpty().withMessage("A meeting title is required").isLength({ max: MEETING_TITLE_MAX_LENGTH }).withMessage(`Title cannot exceed ${MEETING_TITLE_MAX_LENGTH} characters`),
  body("start").isISO8601().withMessage("A valid start time is required"),
  body("participants").isArray({ min: 1, max: MEETING_MAX_PARTICIPANTS }).withMessage(`Choose 1 to ${MEETING_MAX_PARTICIPANTS} staff members`),
  body("participants.*").isEmail().withMessage("Invalid participant email"),
  body("notes").optional({ values: "falsy" }).isString().withMessage("Notes must be text").trim().isLength({ max: MEETING_NOTES_MAX_LENGTH }).withMessage(`Notes cannot exceed ${MEETING_NOTES_MAX_LENGTH} characters`),
];
