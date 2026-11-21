const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The mailto link of the support channel (#158), or null when none is configured or the value is not an email.
 * Reads `NEXT_PUBLIC_SUPPORT_EMAIL` (the literal reference is what lets Next inline it in client code).
 * Example: with `NEXT_PUBLIC_SUPPORT_EMAIL=ajuda@exemplo.com` -> `{ email: "ajuda@exemplo.com", href: "mailto:ajuda@exemplo.com?subject=Ajuda%20com%20o%20Log%20Tax" }`.
 */
export function supportContact(email: string | undefined = process.env.NEXT_PUBLIC_SUPPORT_EMAIL): { email: string; href: string } | null {
  const value = email?.trim();
  if (!value || !EMAIL.test(value)) return null;
  return { email: value, href: `mailto:${value}?subject=${encodeURIComponent("Ajuda com o Log Tax")}` };
}
