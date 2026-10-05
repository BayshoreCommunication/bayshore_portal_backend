import { body, param, query, type ValidationChain } from "express-validator";
import {
  LEAD_CASE_TYPE_MAX_LENGTH,
  LEAD_CHANNELS,
  LEAD_LOST_REASON_MAX_LENGTH,
  LEAD_NAME_MAX_LENGTH,
  LEAD_NOTES_MAX_LENGTH,
  LEAD_SOURCES,
  LEAD_STATUSES,
} from "../models/lead.model";
import { PHONE_REGEX } from "../models/user.model";
import { normalizePhone } from "../utils/phone";

export const leadIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid lead id")];

const oneOf = (values: readonly string[]) => `must be one of: ${values.join(", ")}`;

const text = (path: string, label: string, max: number) =>
  body(path)
    .optional({ values: "null" })
    .isString()
    .withMessage(`${label} must be text`)
    .trim()
    .isLength({ max })
    .withMessage(`${label} cannot exceed ${max} characters`);

const caseTypeRule = (chain: ValidationChain) =>
  chain
    .isString()
    .withMessage("Case type is required")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Case type is required")
    .isLength({ max: LEAD_CASE_TYPE_MAX_LENGTH })
    .withMessage(`Case type cannot exceed ${LEAD_CASE_TYPE_MAX_LENGTH} characters`);

// Shared by create (where the model enforces what's required) and update. Sending
// null or "" for an optional field clears it.
const fieldRules: ValidationChain[] = [
  body("phone")
    .optional({ values: "falsy" })
    .customSanitizer(normalizePhone)
    .matches(PHONE_REGEX)
    .withMessage("Please enter a valid phone number"),
  body("email").optional({ values: "falsy" }).trim().isEmail().withMessage("Please enter a valid email address"),
  body("status").optional().isIn(LEAD_STATUSES).withMessage(`status ${oneOf(LEAD_STATUSES)}`),
  body("consultationAt").optional({ values: "falsy" }).isISO8601().withMessage("consultationAt must be a valid date"),
  text("lostReason", "Reason", LEAD_LOST_REASON_MAX_LENGTH),
  text("notes", "Notes", LEAD_NOTES_MAX_LENGTH),
  text("internalNotes", "Internal notes", LEAD_NOTES_MAX_LENGTH),
];

export const createLeadRules: ValidationChain[] = [
  body("client").isMongoId().withMessage("A valid client is required"),
  body("fullName")
    .isString()
    .withMessage("Name is required")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ max: LEAD_NAME_MAX_LENGTH })
    .withMessage(`Name cannot exceed ${LEAD_NAME_MAX_LENGTH} characters`),
  caseTypeRule(body("caseType")),
  body("source").isIn(LEAD_SOURCES).withMessage(`source ${oneOf(LEAD_SOURCES)}`),
  body("receivedAt").optional().isISO8601().withMessage("receivedAt must be a valid date"),
  ...fieldRules,
];

export const updateLeadRules: ValidationChain[] = [
  body("client").not().exists().withMessage("A lead can't be moved to another client"),
  body("fullName")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("Name cannot be empty")
    .isLength({ max: LEAD_NAME_MAX_LENGTH })
    .withMessage(`Name cannot exceed ${LEAD_NAME_MAX_LENGTH} characters`),
  caseTypeRule(body("caseType").optional()),
  body("source").optional().isIn(LEAD_SOURCES).withMessage(`source ${oneOf(LEAD_SOURCES)}`),
  body("receivedAt").optional().isISO8601().withMessage("receivedAt must be a valid date"),
  ...fieldRules,
];

const filters: ValidationChain[] = [
  query("status").optional().isIn(LEAD_STATUSES).withMessage(`status ${oneOf(LEAD_STATUSES)}`),
  query("channel").optional().isIn(LEAD_CHANNELS).withMessage(`channel ${oneOf(LEAD_CHANNELS)}`),
  query("caseType").optional().isString().trim().isLength({ max: LEAD_CASE_TYPE_MAX_LENGTH }),
  query("from").optional().isISO8601().withMessage("from must be a valid date"),
  query("to").optional().isISO8601().withMessage("to must be a valid date"),
  query("q").optional().isString().trim().isLength({ max: 100 }),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

export const listLeadsRules: ValidationChain[] = [
  query("client").optional().isMongoId().withMessage("client must be a valid id"),
  query("source").optional().isIn(LEAD_SOURCES).withMessage(`source ${oneOf(LEAD_SOURCES)}`),
  ...filters,
];

export const listMyLeadsRules: ValidationChain[] = [...filters];
