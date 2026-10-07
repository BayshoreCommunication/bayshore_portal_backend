import { body, param, query, type Meta, type ValidationChain } from "express-validator";
import {
  MEETING_LINK_MAX_LENGTH,
  MEETING_LOCATION_MAX_LENGTH,
  MEETING_TITLE_MAX_LENGTH,
  MESSAGE_POSTABLE_KINDS,
  MESSAGE_TEXT_MAX_LENGTH,
} from "../models/message.model";

export const conversationIdRule: ValidationChain[] = [param("clientId").isMongoId().withMessage("Invalid client id")];

export const listMessagesRules: ValidationChain[] = [
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  query("before").optional().isISO8601().withMessage("before must be a date"),
  query("content").optional().isMongoId().withMessage("Invalid content id"),
];

export const listConversationsRules: ValidationChain[] = [query("limit").optional().isInt({ min: 1, max: 100 }).toInt()];

// Attached files arrive as multipart and are parsed before this runs.
const fileCount = (req: Meta["req"]) => ((req.files as Record<string, unknown[]> | undefined)?.files ?? []).length;
const isMeeting = (req: Meta["req"]) => req.body?.kind === "meeting";

export const sendMessageRules: ValidationChain[] = [
  body("kind").optional().isIn(MESSAGE_POSTABLE_KINDS).withMessage(`kind must be one of: ${MESSAGE_POSTABLE_KINDS.join(", ")}`),
  body("text")
    .customSanitizer((value) => (typeof value === "string" ? value.trim() : ""))
    .custom((text: string, { req }) => {
      // A meeting can stand on its own; a message needs words, files, or both.
      if (!isMeeting(req) && !text && !fileCount(req)) throw new Error("Write a message or attach a file");
      return true;
    })
    .isLength({ max: MESSAGE_TEXT_MAX_LENGTH })
    .withMessage(`Message cannot exceed ${MESSAGE_TEXT_MAX_LENGTH} characters`),
  body("content").optional({ checkFalsy: true }).isMongoId().withMessage("Invalid content id"),

  body("meeting.title")
    .if((_value, { req }) => isMeeting(req))
    .isString()
    .trim()
    .notEmpty()
    .withMessage("A meeting needs a title")
    .isLength({ max: MEETING_TITLE_MAX_LENGTH })
    .withMessage(`Meeting title cannot exceed ${MEETING_TITLE_MAX_LENGTH} characters`),
  body("meeting.startsAt")
    .if((_value, { req }) => isMeeting(req))
    .isISO8601()
    .withMessage("A meeting needs a start time"),
  body("meeting.endsAt")
    .if((_value, { req }) => isMeeting(req))
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("endsAt must be a date"),
  body("meeting.location")
    .if((_value, { req }) => isMeeting(req))
    .optional({ checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: MEETING_LOCATION_MAX_LENGTH })
    .withMessage(`Location cannot exceed ${MEETING_LOCATION_MAX_LENGTH} characters`),
  body("meeting.link")
    .if((_value, { req }) => isMeeting(req))
    .optional({ checkFalsy: true })
    .isURL({ protocols: ["http", "https"], require_protocol: true })
    .withMessage("Meeting link must be a full http(s) URL")
    .isLength({ max: MEETING_LINK_MAX_LENGTH })
    .withMessage("Meeting link is too long"),
];
