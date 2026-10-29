import { body, header, param, query, type ValidationChain } from "express-validator";
import { ONBOARDING_STATUSES, ONBOARDING_UPLOAD_KINDS } from "../models/client.model";
import { PHONE_REGEX } from "../models/user.model";
import {
  ONBOARDING_COMMENT_ITEM_LABEL_MAX_LENGTH,
  ONBOARDING_COMMENT_ITEM_MAX_LENGTH,
  ONBOARDING_COMMENT_MAX_LENGTH,
  ONBOARDING_COMMENT_STEPS,
} from "../models/onboardingComment.model";
import { normalizePhone } from "../utils/phone";

// The parts of a client's onboarding answers, as they are named on the client record
// (client.onboarding). The first three are asked in the steps a client goes through right after
// signing up (client-portal: ClientSignup); the rest are the onboarding form's own.
export const ONBOARDING_SECTIONS = ["business", "goals", "kickoffCall", "website", "domain", "hosting", "cms", "email", "logo", "google", "social", "media"] as const;

// The header that carries the key handed out when onboarding is started.
export const ONBOARDING_KEY_HEADER = "x-onboarding-key";

export const onboardingIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid onboarding id")];

export const onboardingKeyRule: ValidationChain[] = [
  header(ONBOARDING_KEY_HEADER).isLength({ min: 32, max: 128 }).withMessage("Your onboarding key is missing — it was given to you when you started"),
];

// The form's answers come under `answers`, apart from who is answering — the form has an
// "email" section of its own (their business email), which is not the contact's email.
// What is inside each section is checked by the client model itself (its enums and lengths).
export const answerRules: ValidationChain[] = [
  body("answers").optional().isObject().withMessage("answers must be an object"),
  ...ONBOARDING_SECTIONS.map((section) => body(`answers.${section}`).optional().isObject().withMessage(`answers.${section} must be an object`)),
  body("submit").optional().isBoolean().withMessage("submit must be true or false").toBoolean(),
];

const phoneRule = body("phone")
  .optional({ checkFalsy: true })
  .customSanitizer(normalizePhone)
  .matches(PHONE_REGEX)
  .withMessage("Please enter a valid phone number");

const name = (field: "contactName" | "companyName", label: string) => body(field).isString().withMessage(`${label} must be text`).trim().notEmpty().withMessage(`${label} is required`).isLength({ max: 150 });

export const startOnboardingRules: ValidationChain[] = [
  name("contactName", "Your name"),
  name("companyName", "Company name"),
  body("email").isEmail().withMessage("Please enter a valid email address").trim(),
  phoneRule,
  ...answerRules,
];

export const updateOnboardingRules: ValidationChain[] = [
  name("contactName", "Your name").optional(),
  name("companyName", "Company name").optional(),
  // The email is what the record is known by; changing it is for the team.
  body("email").not().exists().withMessage("The email can't be changed here — ask your BayShore team"),
  phoneRule,
  ...answerRules,
];

// Which kind of photos or videos an upload is for — or the logo — and, to take one back, which file.
export const onboardingMediaKindRule: ValidationChain[] = [
  param("kind").isIn([...ONBOARDING_UPLOAD_KINDS]).withMessage(`kind must be one of: ${ONBOARDING_UPLOAD_KINDS.join(", ")}`),
];
export const removeOnboardingMediaRules: ValidationChain[] = [body("url").isString().withMessage("url is required").trim().notEmpty().withMessage("url is required")];

// The team's list of onboardings waiting to be taken on.
export const listOnboardingRequestsRules: ValidationChain[] = [
  query("status").optional().isIn(ONBOARDING_STATUSES).withMessage(`status must be one of: ${ONBOARDING_STATUSES.join(", ")}`),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

// ── Comments on the onboarding form ──────────────────────────────────────────

const commentTextRule = body("text")
  .optional()
  .isString()
  .withMessage("text must be text")
  .trim()
  .isLength({ max: ONBOARDING_COMMENT_MAX_LENGTH })
  .withMessage(`A comment cannot exceed ${ONBOARDING_COMMENT_MAX_LENGTH} characters`);

export const addOnboardingCommentRules: ValidationChain[] = [
  body("step").isIn(ONBOARDING_COMMENT_STEPS).withMessage(`step must be one of: ${ONBOARDING_COMMENT_STEPS.join(", ")}`),
  body("item").optional().isString().trim().isLength({ max: ONBOARDING_COMMENT_ITEM_MAX_LENGTH }).withMessage("Invalid item"),
  body("itemLabel").optional().isString().trim().isLength({ max: ONBOARDING_COMMENT_ITEM_LABEL_MAX_LENGTH }).withMessage("Invalid item name"),
  commentTextRule,
];

export const onboardingCommentsClientRule: ValidationChain[] = [param("clientId").isMongoId().withMessage("Invalid client id")];

export const replyOnboardingCommentRules: ValidationChain[] = [
  ...onboardingCommentsClientRule,
  param("commentId").isMongoId().withMessage("Invalid comment id"),
  commentTextRule,
];
