import { cookies } from "next/headers";
import { LANGS, type Lang } from "@/lib/i18n";

export async function getLang(): Promise<Lang> {
  const val = (await cookies()).get("desaku_lang")?.value;
  return LANGS.includes(val as Lang) ? (val as Lang) : "en";
}