import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { User } from "../models/user.model";
import type { TokenPayload } from "../utils/generateToken";
import { asyncHandler } from "./asyncHandler";
import { setContextActor } from "../utils/requestContext";
import { clientMaySignIn } from "../utils/clientLogin";

export const optionalAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return next();

    try {
      const payload = jwt.verify(header.slice(7), env.jwtSecret) as TokenPayload;
      const user = await User.findById(payload.id);
      // A client login counts only while its client is being onboarded or is active.
      if (user && user.status === "active" && (await clientMaySignIn(user))) {
        req.user = user;
        setContextActor(user);
      }
    } catch {
      // Public visitor messaging remains available when an optional token is invalid.
    }
    next();
  }
);
