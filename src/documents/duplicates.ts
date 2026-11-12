/** What identifies a document twice over: the exact bytes, and for an NF-e its 44-digit access key (#164). */
export type DocumentFingerprint = { contentHash: string; nfeKey: string | null };

// The key is in <chNFe> (protocol) and in the Id attribute of <infNFe> ("NFe" + 44 digits); either is enough.
const NFE_KEY = [/<chNFe>\s*(\d{44})\s*<\/chNFe>/, /<infNFe[^>]*\bId="NFe(\d{44})"/];

/**
 * SHA-256 of the file, hex encoded. Example: `await sha256Hex(new TextEncoder().encode("abc"))` starts with "ba7816bf".
 */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The NF-e access key read from the XML, or null. The same invoice sent again under another file name
 * (or re-exported with different whitespace) keeps its key. Example: `nfeAccessKey('<chNFe>3526…</chNFe>')`.
 */
export function nfeAccessKey(text: string | undefined): string | null {
  if (!text) return null;
  for (const pattern of NFE_KEY) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}

/** Example: `await fingerprintDocument(bytes, xmlText)` → `{ contentHash: "…", nfeKey: "3526…" }`. */
export async function fingerprintDocument(bytes: Uint8Array<ArrayBuffer>, text: string | undefined): Promise<DocumentFingerprint> {
  return { contentHash: await sha256Hex(bytes), nfeKey: nfeAccessKey(text) };
}
