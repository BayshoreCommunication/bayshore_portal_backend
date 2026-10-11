import { body, param, query, type ValidationChain } from "express-validator";
import { CLIENT_NOTES_MAX_LENGTH, CLIENT_PORTAL_MENUS, CLIENT_STATUSES } from "../models/client.model";
import { PHONE_REGEX } from "../models/user.model";
import { normalizePhone } from "../utils/phone";

export const clientIdRule: ValidationChain[] = [
  param("id").isMongoId().withMessage("Invalid client id"),
];

// Shared by create (required) and update (optional).
const optionalFields: ValidationChain[] = [
  body("serviceTypes.*")
    .isString()
    .trim()
    .notEmpty()
    .isLength({ max: 60 })
    .withMessage("Each service type must be 1 to 60 characters"),
  body("phone")
    .optional({ checkFalsy: true })
    .customSanitizer(normalizePhone)
    .matches(PHONE_REGEX)
    .withMessage("Please enter a valid phone number"),
  body("address").optional().isString().withMessage("Address must be text").trim(),
  body("status")
    .optional()
    .isIn(CLIENT_STATUSES)
    .withMessage(`Status must be one of: ${CLIENT_STATUSES.join(", ")}`),
  body("notes")
    .optional()
    .isString()
    .withMessage("Notes must be text")
    .isLength({ max: CLIENT_NOTES_MAX_LENGTH })
    .withMessage(`Notes cannot exceed ${CLIENT_NOTES_MAX_LENGTH} characters`),
  body("accountManager")
    .optional({ nullable: true, checkFalsy: true })
    .isMongoId()
    .withMessage("accountManager must be a valid user id"),
  // What is inside is checked by the client model itself (its lengths, numbers and dates).
  body("details").optional().isObject().withMessage("details must be an object"),
  body("portalMenus").optional().isArray().withMessage("portalMenus must be a list of portal pages"),
  body("portalMenus.*")
    .isIn([...CLIENT_PORTAL_MENUS])
    .withMessage(`portalMenus can only hold: ${CLIENT_PORTAL_MENUS.join(", ")}`),
  body("team").optional().isArray().withMessage("team must be a list of user ids"),
  body("team.*").isMongoId().withMessage("team must only contain valid user ids"),
];

export const createClientRules: ValidationChain[] = [
  body("contactName").trim().notEmpty().withMessage("Client name is required"),
  body("companyName").trim().notEmpty().withMessage("Company name is required"),
  body("email").trim().isEmail().withMessage("A valid email address is required"),
  body("serviceTypes").isArray({ min: 1 }).withMessage("Select at least one service type"),
  body("startDate").isISO8601().withMessage("Start date must be a valid date"),
  // Only for a client who gets a portal login: without one, no login is made.
  body("password")
    .optional({ checkFalsy: true })
    .isString()
    .isLength({ min: 8, max: 72 })
    .withMessage("The portal password must be between 8 and 72 characters"),
  ...optionalFields,
];

export const updateClientRules: ValidationChain[] = [
  body("contactName").optional().trim().notEmpty().withMessage("Client name cannot be empty"),
  body("companyName").optional().trim().notEmpty().withMessage("Company name cannot be empty"),
  body("email").optional().trim().isEmail().withMessage("Please enter a valid email address"),
  body("serviceTypes").optional().isArray({ min: 1 }).withMessage("Select at least one service type"),
  body("startDate").optional().isISO8601().withMessage("Start date must be a valid date"),
  ...optionalFields,
];

export const listClientsRules: ValidationChain[] = [
  query("q").optional().isString().trim().isLength({ max: 100 }),
  query("status")
    .optional()
    .isIn(CLIENT_STATUSES)
    .withMessage(`Status must be one of: ${CLIENT_STATUSES.join(", ")}`),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];
