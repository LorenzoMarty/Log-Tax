/** Marker that a block of text came from outside the conversation (a document, a comment): data, never instructions. */
export const UNTRUSTED_TAG = "dados_externos";
const MAX_CHARS = 6000;

/**
 * Wraps third-party text before it reaches the model. Any tag of ours inside the text is defused so the content
 * cannot close the block early and pose as the user or the system.
 * Example: `wrapUntrusted("documento informe.pdf", text)`.
 */
export function wrapUntrusted(source: string, text: string): string {
  const safe = text.replace(new RegExp(`</?\s*${UNTRUSTED_TAG}[^>]*>`, "gi"), "[tag removida]").slice(0, MAX_CHARS);
  return `<${UNTRUSTED_TAG} fonte="${source.replace(/["<>]/g, "")}">\n${safe}\n</${UNTRUSTED_TAG}>`;
}

/** True when the text carries a wrapped external block, i.e. the conversation has seen untrusted content. */
export const hasUntrusted = (text: string) => text.includes(`<${UNTRUSTED_TAG}`);
