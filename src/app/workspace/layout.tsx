import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/account/theme";

/** Applies the person's theme choice (#157) to every workspace screen; "auto" keeps the system preference. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div data-theme={theme === "auto" ? undefined : theme} className="min-h-screen bg-surface text-ink">
      {children}
    </div>
  );
}
