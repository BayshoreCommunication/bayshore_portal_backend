import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { UserRole } from "../models/user.model";

export interface TokenPayload {
  id: string;
  role: UserRole;
}

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
};
