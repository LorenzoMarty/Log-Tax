export const THEME_COOKIE = "lt-theme";
export type ThemeChoice = "auto" | "light" | "dark";

/** The theme a person picked for their workspace (#157). Anything unknown means "follow the system". */
export function parseTheme(raw: unknown): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "auto";
}
