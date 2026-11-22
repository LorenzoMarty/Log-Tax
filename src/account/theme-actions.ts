"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseTheme, THEME_COOKIE } from "./theme";

/** Remembers the theme choice for a year. Example: submitting "dark" makes the workspace dark. */
export async function saveTheme(formData: FormData) {
  const theme = parseTheme(formData.get("theme"));
  (await cookies()).set(THEME_COOKIE, theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/workspace/conta?ok=tema-salvo");
}
