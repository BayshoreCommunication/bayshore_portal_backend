import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { User } from "../models/user.model";
import type { TokenPayload } from "../utils/generateToken";
import { asyncHandler } from "./asyncHandler";
import { setContextActor } from "../utils/requestContext";

export const optionalAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return next();

    try {
      const payload = jwt.verify(header.slice(7), env.jwtSecret) as TokenPayload;
      const user = await User.findById(payload.id);
      if (user && user.status === "active") {
        req.user = user;
        setContextActor(user);
      }
    } catch {
      // Public visitor messaging remains available when an optional token is invalid.
    }
    next();
  }
);
