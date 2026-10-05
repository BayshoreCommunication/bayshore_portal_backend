import { body, param, query, type ValidationChain } from "express-validator";

export const notificationIdRule: ValidationChain[] = [param("id").isMongoId().withMessage("Invalid notification id")];

// With no `ids`, everything unread is marked; with them, only those.
export const markNotificationsReadRules: ValidationChain[] = [
  body("ids").optional().isArray({ min: 1, max: 100 }).withMessage("ids must be a list of 1–100 notification ids"),
  body("ids.*").isMongoId().withMessage("Each id must be a valid notification id"),
];

export const listNotificationsRules: ValidationChain[] = [
  query("unread").optional().isBoolean().withMessage("unread must be true or false"),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];
