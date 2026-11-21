/** The display name a person may set (#157): trimmed, one line, 1 to 80 characters. Returns null when it is not acceptable. */
export function cleanDisplayName(raw: unknown): string | null {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= 80 ? name : null;
}
