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
 * Revokes every token rotated from this one, down the chain (replacedByTokenHash) — one
 * sign-in's line of tokens, leaving the user's other sign-ins (other browsers, devices) alone.
 */
export const revokeRefreshTokenChain = async (tokenHash: string) => {
  let next: string | undefined = tokenHash;
  // A chain is one sign-in's rotations; the cap only guards against a malformed loop.
  for (let hops = 0; next && hops < 10_000; hops += 1) {
    const token: { replacedByTokenHash?: string } | null = await RefreshToken.findOneAndUpdate(
      { tokenHash: next },
      { $set: { revokedAt: new Date() } },
      { projection: { replacedByTokenHash: 1 } }
    ).lean();
    next = token?.replacedByTokenHash;
  }
};

/**
 * Kills every live session for this user — for when an account's access must end everywhere.
 */
export const revokeAllRefreshTokensForUser = async (userId: string) => {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: { $exists: false } },
    { revokedAt: new Date() }
  );
};
