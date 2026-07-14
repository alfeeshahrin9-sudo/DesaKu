"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  issueAdminSession,
  safeEqual,
} from "@/lib/admin-auth";

export type UnlockState = { error: string } | null;

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Per-instance throttle on passcode guessing. In-memory, so a serverless
 * deployment with several warm instances raises the effective ceiling — it
 * slows a brute force rather than stopping one. The real fix is Supabase Auth.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();

function throttle(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.firstAt > LOCKOUT_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

export async function unlockAdmin(
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const passcode = String(formData.get("passcode") ?? "");
  const expected = process.env.ADMIN_PASSCODE;

  if (!expected) {
    return { error: "ADMIN_PASSCODE is not set on the server." };
  }

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (!throttle(ip)) {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }

  if (!safeEqual(passcode, expected)) {
    return { error: "That passcode didn't match. Try again." };
  }

  let session: string;
  try {
    session = issueAdminSession();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not start a session." };
  }

  attempts.delete(ip);

  const store = await cookies();
  store.set(ADMIN_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE,
  });

  redirect("/admin");
}

export async function lockAdmin() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  redirect("/admin");
}