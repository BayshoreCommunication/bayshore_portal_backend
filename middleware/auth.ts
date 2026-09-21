import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { User, STATUS_BLOCK_MESSAGES, type UserRole } from "../models/user.model";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "./asyncHandler";
import type { TokenPayload } from "../utils/generateToken";
import { setContextActor } from "../utils/requestContext";

export const protect = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new ApiError(401, "Not authenticated");
    }

    const token = header.split(" ")[1];

    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, env.jwtSecret) as TokenPayload;
    } catch {
      throw new ApiError(401, "Invalid or expired token");
    }

    const user = await User.findById(payload.id);
    if (!user) {
      throw new ApiError(401, "User no longer exists");
    }
    if (user.status !== "active") {
      throw new ApiError(403, STATUS_BLOCK_MESSAGES[user.status]);
    }

    req.user = user;
    setContextActor(user);
    next();
  }
);

export const authorize =
  (...roles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new ApiError(403, "You do not have permission to perform this action")
      );
    }
    next();
  };
