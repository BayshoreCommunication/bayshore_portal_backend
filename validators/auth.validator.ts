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

export const refreshTokenRules: ValidationChain[] = [
  body("refreshToken")
    .isString()
    .notEmpty()
    .withMessage("Refresh token is required"),
];
