import type { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "../utils/requestContext";

// Opens a per-request context (IP, user agent) that the audit log reads later,
// so models don't need to be handed `req` to know who is doing what.
export const requestContext = (req: Request, _res: Response, next: NextFunction) => {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();

  runWithRequestContext(
    { ip: forwardedIp || req.ip, userAgent: req.get("user-agent") ?? undefined },
    next
  );
};
