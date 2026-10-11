import type { Request, Response } from "express";
import mongoose from "mongoose";
import ms from "ms";
import { User, EMAIL_REGEX, STATUS_BLOCK_MESSAGES, type IUser } from "../models/user.model";
import { Client } from "../models/client.model";
import { RefreshToken } from "../models/refreshToken.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { generateToken } from "../utils/generateToken";
import {
  hashToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokensForUser,
} from "../utils/refreshToken";
import { env } from "../config/env";
import { logAudit } from "../utils/audit";

const failedLogin = (identifier: string, reason: string, user?: IUser) =>
  logAudit({
    action: "login_failed",
    resource: "User",
    resourceId: user?._id,
    actor: null,
    summary: `Failed sign-in for "${identifier.slice(0, 100)}" (${reason})`,
    details: { identifier: identifier.slice(0, 100), reason },
  });

const authenticateUser = async (
  identifier: string,
  password: string
): Promise<IUser> => {
  const query = EMAIL_REGEX.test(identifier)
    ? { email: String(identifier).toLowerCase() }
    : { phone: identifier };

  const user = await User.findOne(query).select("+password");
  if (!user) {
    await failedLogin(identifier, "unknown_account");
    throw new ApiError(401, "Invalid credentials");
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    await failedLogin(identifier, "wrong_password", user);
    throw new ApiError(401, "Invalid credentials");
  }

  return user;
};

const assertActive = async (user: IUser) => {
  if (user.status !== "active") {
    await failedLogin(user.email ?? user.phone ?? String(user._id), `account_${user.status}`, user);
    throw new ApiError(403, STATUS_BLOCK_MESSAGES[user.status]);
  }
};

const logSignin = (user: IUser, portal: "company" | "client") =>
  logAudit({
    action: "login",
    resource: "User",
    resourceId: user._id,
    actor: { id: String(user._id), name: user.fullName, role: user.role },
    summary: `${user.fullName} signed in (${portal} portal)`,
    details: { portal },
  });

/**
 * Issues a short-lived access token plus a long-lived, rotatable refresh
 * token for a freshly authenticated user (signin/client signin).
 */
const issueAuthTokens = async (user: IUser) => {
  const accessToken = generateToken({ id: String(user._id), role: user.role });
  const accessTokenExpiresAt = new Date(Date.now() + ms(env.jwtExpiresIn as ms.StringValue));
  const { token: refreshToken, expiresAt: refreshTokenExpiresAt } = await issueRefreshToken(
    String(user._id)
  );

  return { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt };
};

// Any role can sign in here (used by the company portal).
export const signin = asyncHandler(async (req: Request, res: Response) => {
  const { identifier, password } = req.body;
  const user = await authenticateUser(String(identifier).trim(), password);
  await assertActive(user);

  const tokens = await issueAuthTokens(user);
  await logSignin(user, "company");

  return ApiResponse(res, 200, "Signin successful", { user, ...tokens });
});

// Client-only sign in (used by the client portal). Other roles get the same
// generic error as a wrong password so the endpoint doesn't reveal account types.
export const clientSignin = asyncHandler(async (req: Request, res: Response) => {
  const { identifier, password } = req.body;
  const user = await authenticateUser(String(identifier).trim(), password);

  if (user.role !== "client") {
    await failedLogin(String(identifier).trim(), "not_a_client", user);
    throw new ApiError(401, "Invalid credentials");
  }
  await assertActive(user);

  const tokens = await issueAuthTokens(user);
  await logSignin(user, "client");

  return ApiResponse(res, 200, "Client signin successful", { user, ...tokens });
});

// A new client makes their own account (used by the client portal's front page). Open to
// anyone — there is nobody signed in to ask. The client record and its login are created
// together, as when the team adds a client (client.controller.ts → createClient), and both are
// active, so the new client can sign in straight away. It does not sign them in.
export const clientSignup = asyncHandler(async (req: Request, res: Response) => {
  const { fullName, phone, password } = req.body;
  const email = String(req.body.email).toLowerCase();

  if ((await Client.exists({ email })) || (await User.exists({ email }))) {
    throw new ApiError(409, "This email already has a BayShore account. Log in instead, or use a different email.");
  }
  if (await User.exists({ phone })) {
    throw new ApiError(409, "This phone number already has a BayShore account. Log in instead, or use a different number.");
  }

  const clientId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  const client = new Client({
    _id: clientId,
    contactName: fullName,
    // The business isn't asked for when signing up: their own name stands in for it until
    // they, or the team, fill it in.
    companyName: fullName,
    email,
    phone,
    // Chosen by the team when they take the client on.
    serviceTypes: [],
    startDate: new Date(),
    status: "active",
    user: userId,
  });
  const user = new User({
    _id: userId,
    fullName,
    companyName: fullName,
    email,
    phone,
    role: "client",
    status: "active",
    client: clientId,
    password,
  });

  // Validate both first so a bad request never leaves half a client behind.
  await client.validate();
  await user.validate();

  await user.save();
  try {
    await client.save();
  } catch (error) {
    await user.deleteOne();
    throw error;
  }

  return ApiResponse(res, 201, "Account created successfully", { user });
});

export const refreshAccessToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new ApiError(401, "Refresh token is required");
  }

  const presentedHash = hashToken(refreshToken);
  const stored = await RefreshToken.findOne({ tokenHash: presentedHash });

  if (!stored) {
    throw new ApiError(401, "Invalid refresh token");
  }

  if (stored.revokedAt) {
    // This token was already rotated away once — reusing it now is a sign it
    // may have leaked, so kill every other live session for this user too.
    await revokeAllRefreshTokensForUser(String(stored.user));
    await logAudit({
      action: "token_reuse_detected",
      resource: "User",
      resourceId: stored.user,
      actor: null,
      summary: "A refresh token that was already used was presented again; all sessions were revoked",
    });
    throw new ApiError(401, "Refresh token has already been used. Please sign in again");
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    throw new ApiError(401, "Refresh token has expired. Please sign in again");
  }

  const user = await User.findById(stored.user);
  if (!user || user.status !== "active") {
    throw new ApiError(401, "Account is no longer active");
  }

  const accessToken = generateToken({ id: String(user._id), role: user.role });
  const accessTokenExpiresAt = new Date(Date.now() + ms(env.jwtExpiresIn as ms.StringValue));
  const { token: newRefreshToken, expiresAt: refreshTokenExpiresAt } = await rotateRefreshToken(
    String(user._id),
    presentedHash
  );

  return ApiResponse(res, 200, "Token refreshed", {
    user,
    accessToken,
    accessTokenExpiresAt,
    refreshToken: newRefreshToken,
    refreshTokenExpiresAt,
  });
});

export const signout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (typeof refreshToken === "string" && refreshToken) {
    const stored = await RefreshToken.findOneAndUpdate(
      { tokenHash: hashToken(refreshToken), revokedAt: { $exists: false } },
      { revokedAt: new Date() }
    );

    const user = stored && (await User.findById(stored.user));
    if (user) {
      await logAudit({
        action: "logout",
        resource: "User",
        resourceId: user._id,
        actor: { id: String(user._id), name: user.fullName, role: user.role },
        summary: `${user.fullName} signed out`,
      });
    }
  }

  return ApiResponse(res, 200, "Signed out");
});
