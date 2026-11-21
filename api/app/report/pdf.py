"""The report as a PDF, written by hand (no dependency): Helvetica text, wrapped and paginated. Tables become `a | b | c` lines.

Same data as the printable page (`build_report`), so an issued report reads the same on every device.
"""

import hashlib
import json
import textwrap
from typing import Any

_PAGE_W, _PAGE_H, _MARGIN, _LEADING = 595, 842, 50, 14
_LINES_PER_PAGE = (_PAGE_H - 2 * _MARGIN) // _LEADING
_WIDTH = 92  # characters per line at 10pt Helvetica (average glyph ~0.5em, so this stays inside the margins)


def sections_hash(report: dict[str, Any]) -> str:
    """Fingerprint of the content (not of the PDF bytes), so equal reports are recognisable in the history."""
    return hashlib.sha256(json.dumps(report["sections"], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _lines(report: dict[str, Any]) -> list[tuple[str, bool]]:
    """(text, bold) lines in reading order."""
    out: list[tuple[str, bool]] = [(report["title"], True), (report["subtitle"], False), ("", False)]

    def add(text: str, bold: bool = False, indent: str = "") -> None:
        wrapped = textwrap.wrap(text, _WIDTH, initial_indent=indent, subsequent_indent=" " * len(indent)) or [""]
        out.extend((line, bold) for line in wrapped)

    for s in report["sections"]:
        add(s["title"], True)
        if s.get("seal"):
            add(s["seal"]["text"])
        for p in s.get("paragraphs", []):
            add(p)
        for item in s.get("items", []):
            add(item, indent="- ")
        if table := s.get("table"):
            add(" | ".join(table["head"]), True)
            for row in table["rows"]:
                add(" | ".join(row))
        out.append(("", False))
    add(report["disclaimer"])
    return out


def _escape(text: str) -> bytes:
    data = text.encode("cp1252", errors="replace")
    return data.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def to_pdf(report: dict[str, Any]) -> bytes:
    lines = _lines(report)
    pages = [lines[i : i + _LINES_PER_PAGE] for i in range(0, len(lines), _LINES_PER_PAGE)]
    # Objects: 1 catalog, 2 pages, 3 regular font, 4 bold font, then (page, content) pairs.
    first = 5
    kids = " ".join(f"{first + 2 * i} 0 R" for i in range(len(pages)))
    objs: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]
    for i, page in enumerate(pages):
        body = b"BT %d TL %d %d Td\n" % (_LEADING, _MARGIN, _PAGE_H - _MARGIN)
        for text, bold in page:
            body += b"/F%d 10 Tf (" % (2 if bold else 1) + _escape(text) + b") '\n"
        body += b"ET"
        content = first + 2 * i + 1
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {_PAGE_W} {_PAGE_H}] /Contents {content} 0 R "
            "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>".encode()
        )
        objs.append(b"<< /Length %d >>\nstream\n" % len(body) + body + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % n + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)
    return bytes(out)
