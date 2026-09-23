import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** 32-byte bearer token (base64url), its SHA-256 verifier and an AES-256-GCM ciphertext. */
export function generateInvite() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), ciphertext: encryptToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function key(): Buffer | null {
  const raw = process.env.CROWDPLAN_INVITE_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export function encryptToken(token: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptToken(ciphertext: string | null | undefined): string | null {
  const k = key();
  if (!k || !ciphertext) return null;
  const [v, iv, tag, data] = ciphertext.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function appOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

/** The bearer token lives in the fragment so it never reaches servers, logs or referrers. */
export function inviteUrl(code: string, token: string): string {
  return `${appOrigin()}/p/${code}#t=${token}`;
}
