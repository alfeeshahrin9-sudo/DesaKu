import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Session gate for the MVP admin area. The shared passcode mints a short-lived
 * cookie holding `<expiry>.<hmac>`, keyed by ADMIN_SESSION_SECRET so a client
 * cannot forge it. A plain sentinel value would not do: httpOnly stops scripts
 * from reading a cookie, but nothing stops a client from sending an arbitrary
 * Cookie header.
 *
 * This is still not real auth — role-based Supabase Auth replaces it in a
 * later pass (see profiles.role).
 */
export const ADMIN_COOKIE = "desaku_admin";

export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

function sessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ADMIN_SESSION_SECRET must be set to a random string of at least 16 " +
        "characters (see .env.example).",
    );
  }
  return secret;
}

function sign(expiresAt: number): string {
  return createHmac("sha256", sessionSecret())
    .update(String(expiresAt))
    .digest("hex");
}

/** Constant-time compare. Returns false for unequal lengths without leaking timing. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Mints the cookie value for a fresh admin session. */
export function issueAdminSession(): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE;
  return `${expiresAt}.${sign(expiresAt)}`;
}

export async function isAdminAuthed(): Promise<boolean> {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!raw) return false;

  const [expiresAtRaw, signature] = raw.split(".");
  if (!expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isInteger(expiresAt)) return false;
  if (expiresAt <= Math.floor(Date.now() / 1000)) return false;

  try {
    return safeEqual(signature, sign(expiresAt));
  } catch {
    // Secret missing or misconfigured — fail closed rather than granting access.
    return false;
  }
}