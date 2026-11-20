"""SPED EFD (#173): an EFD ICMS/IPI or EFD Contribuições text file becomes monthly revenue and purchases.

Only the `0000` (whose CNPJ must be the company's) and `C100` (NF-e / NF-e consumer) records are read. IND_OPER 1 = issued by the
company (a sale), 0 = received (a purchase). The 44-digit access key is the record key, the same one `nfe_imports` uses, so a
document already counted from an NF-e batch is not counted again. Cancelled / denied documents (COD_SIT 02-05) are left out.
The reader is plain text: no eval, no XML; capped on bytes and on lines; encoding is UTF-8 with a latin-1 fallback.
ponytail: ECF (no per-document records) is not read; it would feed credit opportunities, which this does not.
"""

from decimal import Decimal, InvalidOperation

from app.core.br_ids import normalize_cnpj
from app.documents.nfe_batch import MAX_TOTAL_BYTES, BatchError, BatchResult, Invoice

MAX_LINES = 2_000_000
_CANCELLED = {"02", "03", "04", "05"}
_NOT_SPED = "Não parece um arquivo SPED EFD (falta o registro 0000)."


def _text(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("latin-1")  # SPED files are often ISO-8859-1; latin-1 never fails


def _month(value: str) -> str:
    """`ddmmyyyy` to `yyyy-mm`, or '' when it is not a date."""
    if len(value) != 8 or not value.isdigit() or not 1 <= int(value[2:4]) <= 12:
        return ""
    return f"{value[4:]}-{value[2:4]}"


def parse_sped(data: bytes, company_cnpj: str, already_imported: set[str] | None = None) -> BatchResult:
    if len(data) > MAX_TOTAL_BYTES:
        raise BatchError("O arquivo passa do limite. Envie em partes.")
    lines = _text(data).splitlines()
    if len(lines) > MAX_LINES:
        raise BatchError("O arquivo SPED tem linhas demais. Envie em partes.")
    done = already_imported or set()
    result = BatchResult()
    seen: set[str] = set()
    owner_ok = False
    for line in lines:
        f = line.split("|")
        if len(f) < 3 or f[1] not in {"0000", "C100"}:
            continue
        if f[1] == "0000":
            # the CNPJ sits at a different column in EFD ICMS/IPI and EFD Contribuições: look at the header's fields
            owner_ok = company_cnpj in {normalize_cnpj(x) for x in f[2:12]}
            if not owner_ok:
                raise BatchError("O CNPJ do arquivo SPED não é o da empresa deste espaço.")
            continue
        if not owner_ok:
            raise BatchError(_NOT_SPED)
        if len(f) < 13:
            result.unreadable.append("C100")
            continue
        key, month = "".join(c for c in f[9] if c.isdigit()), _month(f[10])
        try:
            amount = Decimal(f[12].replace(",", "."))
        except InvalidOperation:
            amount = Decimal(-1)
        if f[2] not in {"0", "1"} or len(key) != 44 or not month or amount < 0:
            result.unreadable.append(key or "C100")
            continue
        if f[6] in _CANCELLED:
            result.cancelled += 1
        elif key in seen or key in done:
            result.duplicates += 1
        else:
            seen.add(key)
            result.invoices.append(Invoice(key, "sale" if f[2] == "1" else "purchase", month, amount))
    if not owner_ok:
        raise BatchError(_NOT_SPED)
    return result
