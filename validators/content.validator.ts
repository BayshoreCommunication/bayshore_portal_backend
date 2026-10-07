import { body, param, query, type Meta, type ValidationChain } from "express-validator";
import {
  CONTENT_BATCH_TYPES,
  CONTENT_CAPTION_MAX_LENGTH,
  CONTENT_COMMENT_MAX_LENGTH,
  CONTENT_CREATE_STATUSES,
  CONTENT_CTAS,
  CONTENT_EVENT_NAME_MAX_LENGTH,
  CONTENT_HEADLINE_MAX_LENGTH,
  CONTENT_REVISION_NOTE_MAX_LENGTH,
  CONTENT_SENT_REASON_MAX_LENGTH,
  CONTENT_STATUSES,
  CONTENT_SUBJECT_MAX_LENGTH,
  CONTENT_TITLE_MAX_LENGTH,
  CONTENT_TYPES,
  CONTENT_URL_MAX_LENGTH,
} from "../models/content.model";

export const contentIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid content id")];

// Sent as multipart form fields (alongside files) or as plain JSON — express-validator
// reads req.body either way, once multer (which runs first on these routes) has parsed it.
const toBool = (value: unknown) => value === true || value === "true";

// The batch type, whether sent as batchType or (older callers) isIndividual.
const batchTypeOf = (req: Meta["req"]) =>
  req.body.batchType ?? (req.body.isIndividual !== undefined ? (toBool(req.body.isIndividual) ? "individual" : "monthly") : undefined);

// ── Which batch ──────────────────────────────────────────────────────────────

const batchRules = (required: boolean): ValidationChain[] => [
  required
    ? body("batchMonth").isString().trim().notEmpty().withMessage("Batch month is required")
    : body("batchMonth").optional().isString().trim().notEmpty(),
  body("batchType")
    .optional()
    .isIn(CONTENT_BATCH_TYPES)
    .withMessage(`batchType must be one of: ${CONTENT_BATCH_TYPES.join(", ")}`),
  body("isIndividual").optional().customSanitizer(toBool).isBoolean().withMessage("isIndividual must be true or false"),
  body("weekStart")
    .if((_value, { req }) => batchTypeOf(req) === "weekly")
    .isISO8601()
    .withMessage("Weekly content needs weekStart (the Monday, YYYY-MM-DD)"),
  body("eventName")
    .if((_value, { req }) => batchTypeOf(req) === "event")
    .notEmpty()
    .withMessage("Event content needs an event name")
    .bail()
    .isString()
    .trim()
    .isLength({ max: CONTENT_EVENT_NAME_MAX_LENGTH })
    .withMessage(`Event name cannot exceed ${CONTENT_EVENT_NAME_MAX_LENGTH} characters`),
  body("eventDate")
    .if((_value, { req }) => batchTypeOf(req) === "event")
    .isISO8601()
    .withMessage("Event content needs an event date (YYYY-MM-DD)"),
  body("sentReason")
    .if((_value, { req }) => batchTypeOf(req) === "individual")
    .notEmpty()
    .withMessage("A reason is required for content sent outside the regular batch")
    .bail()
    .isString()
    .trim()
    .isLength({ max: CONTENT_SENT_REASON_MAX_LENGTH })
    .withMessage(`Reason cannot exceed ${CONTENT_SENT_REASON_MAX_LENGTH} characters`),
];

// ── One piece's own fields ───────────────────────────────────────────────────

const titleRule = (field: string) =>
  body(field)
    .isString()
    .withMessage("Title is required")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: CONTENT_TITLE_MAX_LENGTH })
    .withMessage(`Title cannot exceed ${CONTENT_TITLE_MAX_LENGTH} characters`);

// Which of these apply depends on `type` — the model checks that once the record exists.
const detailRules: ValidationChain[] = [
  body("caption")
    .optional()
    .isString()
    .isLength({ max: CONTENT_CAPTION_MAX_LENGTH })
    .withMessage(`Caption cannot exceed ${CONTENT_CAPTION_MAX_LENGTH} characters`),
  body("link").optional({ checkFalsy: true }).isString().trim().isLength({ max: CONTENT_URL_MAX_LENGTH }),
  body("pageName").optional().isString().trim().isLength({ max: 120 }),
  body("pageUrl").optional({ checkFalsy: true }).isString().trim().isLength({ max: CONTENT_URL_MAX_LENGTH }),
  body("subject").optional().isString().trim().isLength({ max: CONTENT_SUBJECT_MAX_LENGTH }),
  body("headline").optional().isString().trim().isLength({ max: CONTENT_HEADLINE_MAX_LENGTH }),
  body("cta")
    .optional({ checkFalsy: true })
    .isIn(CONTENT_CTAS)
    .withMessage(`cta must be one of: ${CONTENT_CTAS.join(", ")}`),
  // Older fields, still accepted.
  body("imageAlt").optional().isString().trim().isLength({ max: 300 }),
  body("videoUrl").optional({ checkFalsy: true }).isString().trim().isLength({ max: CONTENT_URL_MAX_LENGTH }),
  body("docName").optional().isString().trim().isLength({ max: 200 }),
  body("docTitle").optional().isString().trim().isLength({ max: CONTENT_TITLE_MAX_LENGTH }),
  body("docUrl").optional({ checkFalsy: true }).isString().trim().isLength({ max: CONTENT_URL_MAX_LENGTH }),
  // Sent as a JSON array (application/json) or a comma-separated / JSON string (multipart).
  body("tags").optional(),
];

const createStatusRule = body("status")
  .optional()
  .isIn(CONTENT_CREATE_STATUSES)
  .withMessage(`A new piece starts as one of: ${CONTENT_CREATE_STATUSES.join(", ")}`);

export const createContentRules: ValidationChain[] = [
  body("client").isMongoId().withMessage("A valid client is required"),
  body("type").isIn(CONTENT_TYPES).withMessage(`type must be one of: ${CONTENT_TYPES.join(", ")}`),
  titleRule("title"),
  createStatusRule,
  ...batchRules(true),
  ...detailRules,
];

// Several pieces at once: shared batch fields in the body, each piece's own fields
// in `pieces` (a JSON array — a string when sent as multipart).
export const CONTENT_BATCH_MAX_PIECES = 10;

export const createContentBatchRules: ValidationChain[] = [
  body("client").isMongoId().withMessage("A valid client is required"),
  createStatusRule,
  ...batchRules(true),
  body("pieces")
    .customSanitizer((value) => {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    })
    .isArray({ min: 1, max: CONTENT_BATCH_MAX_PIECES })
    .withMessage(`pieces must be a list of 1–${CONTENT_BATCH_MAX_PIECES} pieces`),
  body("pieces.*").isObject().withMessage("Each piece must be an object"),
  body("pieces.*.type").isIn(CONTENT_TYPES).withMessage(`Each piece's type must be one of: ${CONTENT_TYPES.join(", ")}`),
  titleRule("pieces.*.title"),
  body("pieces.*.caption").optional().isString().isLength({ max: CONTENT_CAPTION_MAX_LENGTH }),
  body("pieces.*.link").optional({ checkFalsy: true }).isString().trim().isLength({ max: CONTENT_URL_MAX_LENGTH }),
  body("pieces.*.pageName").optional().isString().trim().isLength({ max: 120 }),
  body("pieces.*.pageUrl").optional({ checkFalsy: true }).isString().trim().isLength({ max: CONTENT_URL_MAX_LENGTH }),
  body("pieces.*.subject").optional().isString().trim().isLength({ max: CONTENT_SUBJECT_MAX_LENGTH }),
  body("pieces.*.headline").optional().isString().trim().isLength({ max: CONTENT_HEADLINE_MAX_LENGTH }),
  body("pieces.*.cta").optional({ checkFalsy: true }).isIn(CONTENT_CTAS),
];

export const updateContentRules: ValidationChain[] = [
  body("title").optional().isString().trim().notEmpty().isLength({ max: CONTENT_TITLE_MAX_LENGTH }),
  ...batchRules(false),
  ...detailRules,
  // URLs of existing files to drop — a JSON array, or a JSON / comma-separated string.
  body("removeFiles").optional(),
  // URLs of existing files to leave in the piece when new files replace the rest (after a revision).
  body("keepFiles").optional(),
];

// What a client may change on a piece sent to them: its caption and tags.
export const CONTENT_MAX_TAGS = 20;
export const CONTENT_TAG_MAX_LENGTH = 50;

export const updateMyContentRules: ValidationChain[] = [
  body("caption")
    .optional()
    .isString()
    .isLength({ max: CONTENT_CAPTION_MAX_LENGTH })
    .withMessage(`Caption cannot exceed ${CONTENT_CAPTION_MAX_LENGTH} characters`),
  body("tags").optional().isArray({ max: CONTENT_MAX_TAGS }).withMessage(`Add at most ${CONTENT_MAX_TAGS} tags`),
  body("tags.*")
    .isString()
    .trim()
    .isLength({ min: 1, max: CONTENT_TAG_MAX_LENGTH })
    .withMessage(`Each tag must be 1–${CONTENT_TAG_MAX_LENGTH} characters`),
];

export const changeStatusRules: ValidationChain[] = [
  body("status").isIn(CONTENT_STATUSES).withMessage(`status must be one of: ${CONTENT_STATUSES.join(", ")}`),
  // What changed, for the client — kept when a revised piece is sent back for approval.
  body("note")
    .optional()
    .customSanitizer((value) => (typeof value === "string" ? value.trim() : ""))
    .isLength({ max: CONTENT_REVISION_NOTE_MAX_LENGTH })
    .withMessage(`Note cannot exceed ${CONTENT_REVISION_NOTE_MAX_LENGTH} characters`),
];

// A note the client may leave with their approval.
export const approveMyContentRules: ValidationChain[] = [
  body("comment")
    .optional()
    .customSanitizer((value) => (typeof value === "string" ? value.trim() : ""))
    .isLength({ max: CONTENT_COMMENT_MAX_LENGTH })
    .withMessage(`Comment cannot exceed ${CONTENT_COMMENT_MAX_LENGTH} characters`),
];

// Text, attached files (multipart, parsed before this runs), or both.
const commentFileCount = (req: Meta["req"]) => ((req.files as Record<string, unknown[]> | undefined)?.files ?? []).length;

export const commentRules: ValidationChain[] = [
  body("text")
    .customSanitizer((value) => (typeof value === "string" ? value.trim() : ""))
    .custom((text: string, { req }) => {
      if (!text && !commentFileCount(req)) throw new Error("Write a comment or attach a file");
      return true;
    })
    .isLength({ max: CONTENT_COMMENT_MAX_LENGTH })
    .withMessage(`Comment cannot exceed ${CONTENT_COMMENT_MAX_LENGTH} characters`),
  // From the client's portal: "message" keeps the piece where it is; "revision" (the default) asks for changes.
  // From the team: "revision" makes it their feedback on the revision under way.
  body("kind").optional().isIn(["message", "revision"]).withMessage("kind must be message or revision"),
  // The team only, with kind "revision": also send the revised piece back for approval.
  body("resubmit").optional().isBoolean().withMessage("resubmit must be true or false"),
];

const paging: ValidationChain[] = [
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

// One row per group of pieces saved together, instead of one per piece.
const groupedQuery = query("grouped").optional().isBoolean().withMessage("grouped must be true or false");

const batchTypeQuery = query("batchType")
  .optional()
  .isIn(CONTENT_BATCH_TYPES)
  .withMessage(`batchType must be one of: ${CONTENT_BATCH_TYPES.join(", ")}`);

export const listContentRules: ValidationChain[] = [
  query("client").optional().isMongoId().withMessage("client must be a valid id"),
  query("type").optional().isIn(CONTENT_TYPES).withMessage(`type must be one of: ${CONTENT_TYPES.join(", ")}`),
  query("status").optional().isIn(CONTENT_STATUSES).withMessage(`status must be one of: ${CONTENT_STATUSES.join(", ")}`),
  query("batchMonth").optional().isString().trim(),
  batchTypeQuery,
  query("individual").optional().isBoolean().withMessage("individual must be true or false"),
  query("q").optional().isString().trim().isLength({ max: 100 }),
  groupedQuery,
  ...paging,
];

export const listMyContentRules: ValidationChain[] = [
  query("batchMonth").optional().isString().trim(),
  batchTypeQuery,
  query("individual").optional().isBoolean().withMessage("individual must be true or false"),
  groupedQuery,
  ...paging,
];
