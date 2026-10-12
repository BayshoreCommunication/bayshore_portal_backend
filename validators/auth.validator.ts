import { body, type ValidationChain } from "express-validator";
import { EMAIL_REGEX, PHONE_REGEX } from "../models/user.model";
import { normalizePhone } from "../utils/phone";

export const signinRules: ValidationChain[] = [
  body("identifier")
    .trim()
    // An email stays as typed; anything else is treated as a phone number.
    .customSanitizer((value: string) => (EMAIL_REGEX.test(value) ? value : normalizePhone(value)))
    .notEmpty()
    .withMessage("Email or phone is required")
    .custom((value: string) => {
      if (EMAIL_REGEX.test(value) || PHONE_REGEX.test(value)) return true;
      throw new Error("Enter a valid email address or phone number");
    }),
  body("password")
    .isString()
    .notEmpty()
    .withMessage("Password is required"),
];

// A new client's own account: who they are, and the password they chose.
export const clientSignupRules: ValidationChain[] = [
  body("fullName")
    .isString()
    .withMessage("Your name must be text")
    .trim()
    .notEmpty()
    .withMessage("Your name is required")
    .isLength({ max: 150 })
    .withMessage("Your name is too long"),
  body("email").trim().isEmail().withMessage("Please enter a valid email address"),
  body("phone")
    .customSanitizer(normalizePhone)
    .matches(PHONE_REGEX)
    .withMessage("Please enter a valid phone number"),
  body("password")
    .isString()
    .withMessage("Password is required")
    .isLength({ min: 8, max: 128 })
    .withMessage("Password must be at least 8 characters")
    .matches(/\d/)
    .withMessage("Password must include a number"),
  body("termsAccepted").optional().isBoolean().withMessage("termsAccepted must be true or false").toBoolean(),
];

export const refreshTokenRules: ValidationChain[] = [
  body("refreshToken")
    .isString()
    .notEmpty()
    .withMessage("Refresh token is required"),
];
