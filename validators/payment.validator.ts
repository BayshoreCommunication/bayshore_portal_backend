import { query, type ValidationChain } from "express-validator";
import { SERVICE_ORDER_STATUSES } from "../models/serviceOrder.model";

export const listPaymentsRules: ValidationChain[] = [
  query("client").optional().isMongoId().withMessage("client must be a valid id"),
  query("status").optional().isIn(SERVICE_ORDER_STATUSES).withMessage(`status must be one of: ${SERVICE_ORDER_STATUSES.join(", ")}`),
  query("from").optional().isISO8601().withMessage("from must be a valid date"),
  query("to").optional().isISO8601().withMessage("to must be a valid date"),
  query("q").optional().isString().trim().isLength({ max: 100 }),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];
