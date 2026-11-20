"""Text of a PDF's text layer (#141), bounded and never guessed.

A scanned PDF has no text layer: the answer is `None` and the caller says "não consegui ler", never a made-up value. Only the
text layer is read here (no OCR). Page count and characters are capped so a hostile file cannot exhaust memory or time.
"""

import io
import logging

from pypdf import PdfReader
from pypdf.errors import PyPdfError

log = logging.getLogger(__name__)
MAX_PAGES = 30
MAX_CHARS = 200_000
MIN_CHARS = 20  # below this the "text" is page numbers or noise, not a document


def pdf_text(data: bytes) -> str | None:
    """The text of the first pages, or None when the PDF is encrypted, broken or has no readable text layer."""
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            return None
        parts: list[str] = []
        size = 0
        for page in reader.pages[:MAX_PAGES]:
            chunk = page.extract_text() or ""
            parts.append(chunk)
            size += len(chunk)
            if size >= MAX_CHARS:
                break
    except (PyPdfError, ValueError, KeyError, RecursionError, OSError):
        log.warning("pdf_unreadable")
        return None
    text = "\n".join(parts)[:MAX_CHARS]
    return text if len(text.strip()) >= MIN_CHARS else None
