/**
 * Until the admin panel exists (#201), a short allow-list of emails (ADMIN_EMAILS, comma separated) may open admin pages.
 * An empty list means nobody.
 */
export function isAdmin(email: string | undefined, list = process.env.ADMIN_EMAILS ?? ""): boolean {
  if (!email) return false;
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
