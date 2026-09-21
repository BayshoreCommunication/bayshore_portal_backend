import { query, type ValidationChain } from "express-validator";
import { AUDIT_ACTIONS } from "../models/auditLog.model";

export const listAuditLogsRules: ValidationChain[] = [
  query("actor").optional().isMongoId().withMessage("actor must be a valid id"),
  query("client").optional().isMongoId().withMessage("client must be a valid id"),
  query("resource").optional().isString().trim().isLength({ min: 1, max: 50 }),
  query("resourceId").optional().isMongoId().withMessage("resourceId must be a valid id"),
  query("action")
    .optional()
    .isIn(AUDIT_ACTIONS)
    .withMessage(`Action must be one of: ${AUDIT_ACTIONS.join(", ")}`),
  query("from").optional().isISO8601().withMessage("from must be an ISO date"),
  query("to").optional().isISO8601().withMessage("to must be an ISO date"),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];
