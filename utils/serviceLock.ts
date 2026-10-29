import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import type { IUser } from "../models/user.model";
import { env } from "../config/env";
import { ApiError } from "./ApiError";

// Services in the company portal — and a client's passwords — open only with a security code (env
// SERVICE_ACCESS_CODES): by role, or for one person by their email. The right code gets a pass for
// a while, sent back on every such request (header X-Services-Unlock). Changing someone's code
// ends their pass.

export const SERVICE_UNLOCK_HEADER = "x-services-unlock";
// How long a pass lasts.
export const SERVICE_UNLOCK_TTL_MS = 8 * 60 * 60 * 1000;
// Wrong codes in a row before a person must wait, and how long.
const MAX_TRIES = 5;
const WAIT_MS = 15 * 60 * 1000;

// "Locked" — the portal shows the code form when it sees this.
export const SERVICES_LOCKED = 423;

const codeFor = (user: IUser) => (user.email ? env.serviceAccessCodes.get(user.email.toLowerCase()) : undefined) ?? env.serviceAccessCodes.get(user.role);

export const canUnlockServices = (user: IUser) => Boolean(codeFor(user));

const digest = (text: string) => crypto.createHash("sha256").update(text).digest();
const signOf = (payload: string, code: string) => crypto.createHmac("sha256", `${env.jwtSecret}:services:${code}`).update(payload).digest("base64url");

const same = (a: Buffer, b: Buffer) => a.length === b.length && crypto.timingSafeEqual(a, b);

// Wrong codes so far, by person.
const tries = new Map<string, { count: number; until?: number }>();

// The code they typed: a pass if it is right.
export const unlockServices = (user: IUser, typed: string) => {
  const code = codeFor(user);
  if (!code) throw new ApiError(403, "You don't have access to this");

  const id = String(user._id);
  const record = tries.get(id);
  if (record?.until && record.until > Date.now()) {
    const minutes = Math.ceil((record.until - Date.now()) / 60_000);
    throw new ApiError(429, `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }

  if (!same(digest(typed), digest(code))) {
    const count = (record?.until ? 0 : (record?.count ?? 0)) + 1;
    tries.set(id, count >= MAX_TRIES ? { count, until: Date.now() + WAIT_MS } : { count });
    throw new ApiError(401, count >= MAX_TRIES ? "Too many wrong codes. Try again in 15 minutes." : "That code isn't right");
  }

  tries.delete(id);
  const expiresAt = Date.now() + SERVICE_UNLOCK_TTL_MS;
  const payload = `${id}.${expiresAt}`;
  return { token: `${payload}.${signOf(payload, code)}`, expiresAt: new Date(expiresAt).toISOString() };
};

export const passIsGood = (user: IUser, token: unknown) => {
  const code = codeFor(user);
  if (!code || typeof token !== "string") return false;
  const [id, expiresAt, signature] = token.split(".");
  if (!id || !expiresAt || !signature || id !== String(user._id) || !(Number(expiresAt) > Date.now())) return false;
  return same(Buffer.from(signature), Buffer.from(signOf(`${id}.${expiresAt}`, code)));
};

// Whether Services itself asks for the code. Off for now: Services opens as before, and only the
// password routes ask (company-portal: lib/servicesPass.ts → SERVICES_NEED_CODE, kept in step).
export const SERVICES_NEED_CODE = false;

// On the team's services routes: the code, when Services asks for it.
export const requireServicesCode = (req: Request, res: Response, next: NextFunction) => (SERVICES_NEED_CODE ? requireServicesUnlocked(req, res, next) : next());

// On the password routes (and the services routes, when on), after protect: no good pass, no answer.
export const requireServicesUnlocked = (req: Request, _res: Response, next: NextFunction) => {
  if (!passIsGood(req.user!, req.headers[SERVICE_UNLOCK_HEADER])) {
    return next(new ApiError(SERVICES_LOCKED, canUnlockServices(req.user!) ? "Enter your security code" : "You don't have access to this"));
  }
  next();
};
