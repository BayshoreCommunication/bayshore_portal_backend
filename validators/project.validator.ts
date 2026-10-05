import { body, param, query, type ValidationChain } from "express-validator";
import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
} from "../models/project.model";

export const projectIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid project id")];

const oneOf = (values: readonly string[]) => `must be one of: ${values.join(", ")}`;

const nameRule = (chain: ValidationChain) =>
  chain
    .isString()
    .withMessage("Project name is required")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Project name is required")
    .isLength({ max: PROJECT_NAME_MAX_LENGTH })
    .withMessage(`Project name cannot exceed ${PROJECT_NAME_MAX_LENGTH} characters`);

const statusRule = body("status").optional().isIn(PROJECT_STATUSES).withMessage(`status ${oneOf(PROJECT_STATUSES)}`);
// Clients see the status but only the team sets it.
const noStatusRule = body("status").not().exists().withMessage("Only the BayShore team can change a project's status");

// The fields either side can set. These arrive as form fields next to the files,
// so everything is text; an empty targetDate clears it.
const detailRules: ValidationChain[] = [
  body("description")
    .optional()
    .isString()
    .withMessage("Description must be text")
    .trim()
    .isLength({ max: PROJECT_DESCRIPTION_MAX_LENGTH })
    .withMessage(`Description cannot exceed ${PROJECT_DESCRIPTION_MAX_LENGTH} characters`),
  body("targetDate").optional({ values: "falsy" }).isISO8601().withMessage("targetDate must be a valid date"),
  body("priority").optional().isIn(PROJECT_PRIORITIES).withMessage(`priority ${oneOf(PROJECT_PRIORITIES)}`),
];

export const createProjectRules: ValidationChain[] = [
  body("client").isMongoId().withMessage("A valid client is required"),
  nameRule(body("name")),
  ...detailRules,
  statusRule,
];

export const updateProjectRules: ValidationChain[] = [
  body("client").not().exists().withMessage("A project can't be moved to another client"),
  nameRule(body("name").optional()),
  ...detailRules,
  statusRule,
];

export const createMyProjectRules: ValidationChain[] = [nameRule(body("name")), ...detailRules, noStatusRule];

export const updateMyProjectRules: ValidationChain[] = [nameRule(body("name").optional()), ...detailRules, noStatusRule];

const filters: ValidationChain[] = [
  query("status").optional().isIn(PROJECT_STATUSES).withMessage(`status ${oneOf(PROJECT_STATUSES)}`),
  query("priority").optional().isIn(PROJECT_PRIORITIES).withMessage(`priority ${oneOf(PROJECT_PRIORITIES)}`),
  query("q").optional().isString().trim().isLength({ max: 100 }),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

export const listProjectsRules: ValidationChain[] = [
  query("client").optional().isMongoId().withMessage("client must be a valid id"),
  ...filters,
];

export const listMyProjectsRules: ValidationChain[] = [...filters];
