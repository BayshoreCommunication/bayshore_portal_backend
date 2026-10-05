import { body, param, type ValidationChain } from "express-validator";
import {
  SERVICE_DESCRIPTION_MAX_LENGTH,
  SERVICE_MAX_SUB_SERVICES,
  SERVICE_PLANS,
  SERVICE_TITLE_MAX_LENGTH,
  SUB_SERVICE_MAX_PRICE,
  SUB_SERVICE_NAME_MAX_LENGTH,
} from "../models/service.model";

export const serviceIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid service id")];
export const serviceClientIdRule: ValidationChain[] = [param("clientId").isMongoId().withMessage("Invalid client id")];

const titleRule = (chain: ValidationChain) =>
  chain
    .isString()
    .withMessage("Service name is required")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Service name is required")
    .isLength({ max: SERVICE_TITLE_MAX_LENGTH })
    .withMessage(`Service name cannot exceed ${SERVICE_TITLE_MAX_LENGTH} characters`);

const subServicesRule = (chain: ValidationChain) =>
  chain
    .isArray({ min: 1, max: SERVICE_MAX_SUB_SERVICES })
    .withMessage(`Add between 1 and ${SERVICE_MAX_SUB_SERVICES} sub-services`);

// Shared by create and update. When editing, a sub-service sent with its `_id` is
// the same one renamed or re-priced; one without is new; one left out is removed.
const detailRules: ValidationChain[] = [
  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .trim()
    .isLength({ max: SERVICE_DESCRIPTION_MAX_LENGTH })
    .withMessage(`Description cannot exceed ${SERVICE_DESCRIPTION_MAX_LENGTH} characters`),
  body("plan").optional().isIn(SERVICE_PLANS).withMessage(`plan must be one of: ${SERVICE_PLANS.join(", ")}`),
  body("color")
    .optional({ values: "falsy" })
    .matches(/^#[0-9a-fA-F]{6}$/)
    .withMessage("Color must be a hex color like #c8973a"),
  body("subServices.*._id").optional().isMongoId().withMessage("A sub-service id is not valid"),
  body("subServices.*.name")
    .isString()
    .withMessage("Every sub-service needs a name")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Every sub-service needs a name")
    .isLength({ max: SUB_SERVICE_NAME_MAX_LENGTH })
    .withMessage(`A sub-service name cannot exceed ${SUB_SERVICE_NAME_MAX_LENGTH} characters`),
  body("subServices.*.price")
    .isInt({ min: 0, max: SUB_SERVICE_MAX_PRICE })
    .withMessage(`Each price must be a whole number of dollars, from 0 to ${SUB_SERVICE_MAX_PRICE}`)
    .toInt(),
];

export const createServiceRules: ValidationChain[] = [titleRule(body("title")), subServicesRule(body("subServices")), ...detailRules];

export const updateServiceRules: ValidationChain[] = [
  titleRule(body("title").optional()),
  subServicesRule(body("subServices").optional()),
  ...detailRules,
];

const serviceEntryRules: ValidationChain[] = [
  body("services.*.service").isMongoId().withMessage("Each entry needs a valid service id"),
  body("services.*.subServices").isArray({ min: 1 }).withMessage("Each service needs at least one sub-service"),
  body("services.*.subServices.*").isMongoId().withMessage("A sub-service id is not valid"),
];

// The whole set of services a client takes. An empty list removes them all.
export const setClientServicesRules: ValidationChain[] = [
  body("services").isArray({ max: 100 }).withMessage("services must be a list"),
  ...serviceEntryRules,
];

// A Stripe Checkout session id, as it comes back in the return URL.
export const serviceOrderSessionRule: ValidationChain[] = [
  param("sessionId").matches(/^cs_[A-Za-z0-9_]{10,200}$/).withMessage("Invalid session id"),
];

// What a client chooses to pay for from their portal — at least one service.
export const addMyServicesRules: ValidationChain[] = [
  body("services").isArray({ min: 1, max: 100 }).withMessage("Choose at least one service to add"),
  ...serviceEntryRules,
];
