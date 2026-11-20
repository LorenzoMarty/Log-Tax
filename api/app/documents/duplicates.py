"""What identifies a document twice over: the exact bytes, and for an NF-e its 44-digit access key (#164)."""

import hashlib
import re
from dataclasses import dataclass

# The key is in <chNFe> (protocol) and in the Id attribute of <infNFe> ("NFe" + 44 digits); either is enough.
_NFE_KEY = (re.compile(r"<chNFe>\s*(\d{44})\s*</chNFe>"), re.compile(r'<infNFe[^>]*\bId="NFe(\d{44})"'))


@dataclass(frozen=True)
class Fingerprint:
    content_hash: str
    nfe_key: str | None


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def nfe_access_key(text: str | None) -> str | None:
    """The NF-e access key read from the XML, or None. The same invoice re-sent under another name keeps its key."""
    if not text:
        return None
    for pattern in _NFE_KEY:
        match = pattern.search(text)
        if match:
            return match.group(1)
    return None


def fingerprint_document(data: bytes, text: str | None) -> Fingerprint:
    return Fingerprint(sha256_hex(data), nfe_access_key(text))
