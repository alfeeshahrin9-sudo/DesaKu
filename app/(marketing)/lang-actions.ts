"use server";

import { cookies } from "next/headers";
import { LANGS, type Lang } from "@/lib/i18n";

export async function setLang(lang: Lang) {
  // A Server Action is reachable by direct POST, so the argument is untrusted
  // however it is typed.
  if (!LANGS.includes(lang)) return;

  (await cookies()).set("desaku_lang", lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}