"""Spreadsheet export of a report's tables: CSV (pt-BR: `;` separator, UTF-8 BOM, CRLF) and a minimal stdlib XLSX.

Every cell that could be read as a formula by a spreadsheet is neutralised (OWASP CSV injection).
"""

import csv
import io
import zipfile
from typing import Any
from xml.sax.saxutils import escape

_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"


def safe_cell(value: Any) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_START) else text


def sheet_rows(report: dict[str, Any]) -> list[list[str]]:
    """One flat grid: for each table, a title line, the head, the rows and a blank line."""
    out: list[list[str]] = []
    for s in report["sections"]:
        table = s.get("table")
        if not table:
            continue
        out += [[s["title"]], table["head"], *table["rows"], []]
    return [[safe_cell(c) for c in row] for row in out]


def to_csv(rows: list[list[str]]) -> bytes:
    buf = io.StringIO(newline="")
    csv.writer(buf, delimiter=";", lineterminator="\r\n").writerows(rows)
    return b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")


def _col(i: int) -> str:
    name = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        name = chr(65 + r) + name
    return name


def _cell(n: int, j: int, text: str) -> str:
    return f'<c r="{_col(j)}{n}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def _rels(kind: str, target: str) -> str:
    return f'<Relationships xmlns="{_PKG}"><Relationship Id="rId1" Type="{_REL}/{kind}" Target="{target}"/></Relationships>'


def to_xlsx(rows: list[list[str]]) -> bytes:
    body = "".join(
        f'<row r="{n}">' + "".join(_cell(n, j, c) for j, c in enumerate(row)) + "</row>" for n, row in enumerate(rows, 1)
    )
    ct = "application/vnd.openxmlformats-officedocument.spreadsheetml"
    parts = {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f'<Override PartName="/xl/workbook.xml" ContentType="{ct}.sheet.main+xml"/>'
        f'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="{ct}.worksheet+xml"/></Types>',
        "_rels/.rels": _rels("officeDocument", "xl/workbook.xml"),
        "xl/workbook.xml": f'<workbook xmlns="{_NS}" xmlns:r="{_REL}">'
        '<sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": _rels("worksheet", "worksheets/sheet1.xml"),
        "xl/worksheets/sheet1.xml": f'<worksheet xmlns="{_NS}"><sheetData>{body}</sheetData></worksheet>',
    }
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, xml in parts.items():
            z.writestr(name, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + xml)
    return out.getvalue()
