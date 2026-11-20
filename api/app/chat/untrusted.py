"""Marker that a block of text came from outside the conversation (a document, a comment): data, never instructions."""

import re

UNTRUSTED_TAG = "dados_externos"
MAX_CHARS = 6000
_OUR_TAG = re.compile(rf"</?\s*{UNTRUSTED_TAG}[^>]*>", re.IGNORECASE)


def wrap_untrusted(source: str, text: str) -> str:
    """Wraps third-party text before it reaches the model.

    Any tag of ours inside the text is defused so the content cannot close the block early and pose as the user or the system.
    """
    safe = _OUR_TAG.sub("[tag removida]", text)[:MAX_CHARS]
    clean_source = re.sub(r'["<>]', "", source)
    return f'<{UNTRUSTED_TAG} fonte="{clean_source}">\n{safe}\n</{UNTRUSTED_TAG}>'


def has_untrusted(text: str) -> bool:
    """True when the text carries a wrapped external block, i.e. the conversation has seen untrusted content."""
    return f"<{UNTRUSTED_TAG}" in text
