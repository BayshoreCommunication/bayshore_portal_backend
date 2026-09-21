import { body, type ValidationChain } from "express-validator";
import { normalizePhone } from "../utils/phone";
import { PHONE_REGEX, USER_ROLES, USER_STATUSES, USER_THEMES } from "../models/user.model";

export const createStaffRules: ValidationChain[] = [
  body("fullName").trim().notEmpty().withMessage("Full name is required"),
  body("companyName").optional({ checkFalsy: true }).trim(),
  body("designation").optional({ checkFalsy: true }).trim(),
  body("department").optional({ checkFalsy: true }).trim(),
  body("responsibilities").optional({ checkFalsy: true }).trim(),
  body("address").optional({ checkFalsy: true }).isString().trim(),
  body("email")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("Please enter a valid email address"),
  body("phone")
    .optional({ checkFalsy: true })
    .customSanitizer(normalizePhone)
    .matches(PHONE_REGEX)
    .withMessage("Please enter a valid phone number"),
  body("avatar")
    .optional({ checkFalsy: true })
    .isURL()
    .withMessage("Avatar must be a valid URL"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("role")
    .isIn(USER_ROLES)
    .withMessage(`Role must be one of: ${USER_ROLES.join(", ")}`),
  body("status")
    .optional()
    .isIn(USER_STATUSES)
    .withMessage(`Status must be one of: ${USER_STATUSES.join(", ")}`),
  body("muted").optional().isBoolean().withMessage("muted must be a boolean").toBoolean(),
  body().custom((_value, { req }) => {
    if (!req.body.email && !req.body.phone) {
      throw new Error("Either email or phone is required");
    }
    return true;
  }),
];

export const updateStaffRules: ValidationChain[] = [
  body("fullName").optional().trim().notEmpty().withMessage("Full name cannot be empty"),
  body("companyName").optional({ checkFalsy: true }).trim(),
  body("designation").optional({ checkFalsy: true }).trim(),
  body("department").optional({ checkFalsy: true }).trim(),
  body("responsibilities").optional({ checkFalsy: true }).trim(),
  body("address").optional({ checkFalsy: true }).isString().trim(),
  body("email")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("Please enter a valid email address"),
  body("phone")
    .optional({ checkFalsy: true })
    .customSanitizer(normalizePhone)
    .matches(PHONE_REGEX)
    .withMessage("Please enter a valid phone number"),
  body("role")
    .optional()
    .isIn(USER_ROLES)
    .withMessage(`Role must be one of: ${USER_ROLES.join(", ")}`),
  body("status")
    .optional()
    .isIn(USER_STATUSES)
    .withMessage(`Status must be one of: ${USER_STATUSES.join(", ")}`),
  body("muted").optional().isBoolean().withMessage("muted must be a boolean").toBoolean(),
];

export const updateMeRules: ValidationChain[] = [
  body("fullName").optional().trim().notEmpty().withMessage("Full name cannot be empty"),
  body("companyName").optional({ checkFalsy: true }).trim(),
  body("designation").optional({ checkFalsy: true }).trim(),
  body("department").optional({ checkFalsy: true }).trim(),
  body("responsibilities").optional({ checkFalsy: true }).trim(),
  body("address").optional({ checkFalsy: true }).isString().trim(),
  body("theme")
    .optional()
    .isIn(USER_THEMES)
    .withMessage(`Theme must be one of: ${USER_THEMES.join(", ")}`),
  body("email")
    .optional({ checkFalsy: true })
    .isEmail()
    .withMessage("Please enter a valid email address"),
  body("phone")
    .optional({ checkFalsy: true })
    .customSanitizer(normalizePhone)
    .matches(PHONE_REGEX)
    .withMessage("Please enter a valid phone number"),
];

export const changePasswordRules: ValidationChain[] = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters"),
];
