"""Content checks that do not trust the file name or the browser's declared type (#75): signature, malware, quota."""

import httpx

from app.core.config import Settings

DEFAULT_QUOTA_BYTES = 100 * 1024 * 1024
_EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
_MZ, _ELF = b"MZ", b"\x7fELF"


def quota_bytes(settings: Settings) -> int:
    """Total stored bytes allowed per workspace (DOCUMENT_QUOTA_BYTES overrides it, e.g. in e2e)."""
    return settings.document_quota_bytes if settings.document_quota_bytes > 0 else DEFAULT_QUOTA_BYTES


def _looks_like_xml(head: bytes) -> bool:
    text = head[:256].decode("latin-1").lstrip("\ufeff \t\r\n")
    return text.startswith("<?xml") or (text[:1] == "<" and text[1:2].isalpha())


def signature_matches(data: bytes, mime: str) -> bool:
    """True when the first bytes really are what `mime` claims. A renamed executable fails every branch."""
    no_nul = b"\x00" not in data[:8192]
    match mime:
        case "application/pdf":
            return b"%PDF-" in data[:1024]  # PDF allows a little junk before the header
        case "image/png":
            return data.startswith(b"\x89PNG\r\n\x1a\n")
        case "image/jpeg":
            return data.startswith(b"\xff\xd8\xff")
        case "application/xml" | "text/xml":
            return _looks_like_xml(data) and no_nul
        case "text/plain":
            return no_nul and not data.startswith(_MZ) and not data.startswith(_ELF)
        case _:
            return False


async def scan_bytes(data: bytes, settings: Settings, client: httpx.AsyncClient | None = None) -> str:
    """'clean', 'infected' or 'unscanned'. Always catches the EICAR test file; with VIRUS_SCAN_URL it also asks a scanner.

    The scanner answers `{"infected": boolean}` (e.g. a ClamAV REST wrapper). Without one the result is 'unscanned'.
    """
    if _EICAR in data.decode("latin-1"):
        return "infected"
    if not settings.virus_scan_url:
        return "unscanned"
    try:
        async with client or httpx.AsyncClient(timeout=20) as http:
            res = await http.post(settings.virus_scan_url, content=data, headers={"Content-Type": "application/octet-stream"})
        if res.status_code >= 400:
            return "unscanned"
        return "infected" if res.json().get("infected") else "clean"
    except (httpx.HTTPError, ValueError):
        return "unscanned"
