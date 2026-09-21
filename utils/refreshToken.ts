import crypto from "crypto";
import ms from "ms";
import { env } from "../config/env";
import { RefreshToken } from "../models/refreshToken.model";

export const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

const generateOpaqueToken = (): string => crypto.randomBytes(48).toString("hex");

export const issueRefreshToken = async (userId: string) => {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + ms(env.refreshTokenExpiresIn as ms.StringValue));

  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, expiresAt };
};

/**
 * Rotates a refresh token: the presented token is marked revoked (linked to its
 * replacement for audit purposes) and a brand new one is issued in its place.
 */
export const rotateRefreshToken = async (userId: string, presentedTokenHash: string) => {
  const { token, expiresAt } = await issueRefreshToken(userId);

  await RefreshToken.updateOne(
    { tokenHash: presentedTokenHash },
    { revokedAt: new Date(), replacedByTokenHash: hashToken(token) }
  );

  return { token, expiresAt };
};

/**
 * If a refresh token that was already rotated away gets presented again, that's
 * a signal it may have been stolen — kill every other live session for this user.
 */
export const revokeAllRefreshTokensForUser = async (userId: string) => {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
};
