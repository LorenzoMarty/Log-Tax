/** Content checks that do not trust the file name or the browser's declared type (#75). */

/** Total stored bytes allowed per workspace (DOCUMENT_QUOTA_BYTES overrides it, e.g. in e2e). */
export const quotaBytes = () => Number(process.env.DOCUMENT_QUOTA_BYTES) || 100 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, n: number) => new TextDecoder("latin1").decode(b.slice(0, n));

/** True when the first bytes really are what `mime` claims. A renamed executable fails every branch. */
export function signatureMatches(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case "application/pdf":
      return ascii(bytes, 1024).includes("%PDF-"); // PDF allows a little junk before the header
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "application/xml":
    case "text/xml":
      return /^\uFEFF?\s*<(\?xml|[A-Za-z])/.test(ascii(bytes, 256)) && !bytes.slice(0, 8192).includes(0);
    case "text/plain":
      return !bytes.slice(0, 8192).includes(0) && !startsWith(bytes, [0x4d, 0x5a]) && !startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]); // no NUL, not MZ/ELF
    default:
      return false;
  }
}

export type ScanResult = "clean" | "infected" | "unscanned";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/**
 * Malware check. Always catches the EICAR test file; with VIRUS_SCAN_URL set it also posts the bytes to a scanner
 * that answers `{ "infected": boolean }` (e.g. a ClamAV REST wrapper). Without a scanner the result is "unscanned".
 */
export async function scanBytes(bytes: Uint8Array, fetcher: typeof fetch = fetch, url = process.env.VIRUS_SCAN_URL): Promise<ScanResult> {
  if (ascii(bytes, bytes.length).includes(EICAR)) return "infected";
  if (!url) return "unscanned";
  try {
    const res = await fetcher(url, { method: "POST", body: bytes as BodyInit, headers: { "Content-Type": "application/octet-stream" } });
    if (!res.ok) return "unscanned";
    return ((await res.json()) as { infected?: boolean }).infected ? "infected" : "clean";
  } catch {
    return "unscanned";
  }
}
