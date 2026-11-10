/** A short, human name for a browser user agent: "Chrome em Windows". Falls back to "Dispositivo desconhecido". */
export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Dispositivo desconhecido";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : undefined;
  const os = /Windows/.test(userAgent) ? "Windows" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad|iOS/.test(userAgent) ? "iOS" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : undefined;
  if (browser && os) return `${browser} em ${os}`;
  return browser ?? os ?? "Dispositivo desconhecido";
}
