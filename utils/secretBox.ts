import crypto from "crypto";
import { env } from "../config/env";

// A secret a client hands us — the password of an account we are to work on — is never stored
// as it was typed. It is sealed with AES-256-GCM, so the database on its own doesn't give it
// away; only a server holding the key can open it again.
//
// The key comes from CREDENTIALS_KEY when that is set, and otherwise from the JWT secret. Set
// a key of its own in production — and keep it: without the key that sealed something, it
// can't be opened.

const VERSION = "v1";

const key = () =>
  crypto
    .createHash("sha256")
    .update(`${process.env.CREDENTIALS_KEY || env.jwtSecret}:onboarding-credentials`)
    .digest();

// "v1.<iv>.<tag>.<sealed text>", each part base64.
export const seal = (text: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
};

// The text that was sealed. Throws when it was sealed with another key, or isn't ours at all.
export const unseal = (sealed: string): string => {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("Not a sealed value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
};
