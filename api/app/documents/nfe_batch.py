"""NF-e in batch (#163): a ZIP of XML becomes monthly revenue and purchases, without counting an invoice twice.

For each invoice of the company: issued by it = a sale (revenue, in the company's activity); received by it = a purchase. Each
invoice counts once (its 44-digit access key), cancelled ones are left out (cancellation event, or a protocol with a cancelled
status), and invoices that belong to neither side are ignored. Nothing here writes: the caller shows the proposal first and only
a confirmed import changes the profile (#160). The reader is hardened like the single-file one (`defusedxml`: no DTD, no
entities) and bounded against ZIP bombs: entry count, bytes per file and in total are capped on the bytes actually read.
"""

import io
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from xml.etree.ElementTree import Element

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeET

from app.core.br_ids import normalize_cnpj

MAX_ENTRIES = 5000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024
# Protocol statuses and event types that mean "this invoice no longer exists" (cancelled / denied).
_CANCELLED_STATUS = {"101", "151", "155", "301", "302", "303"}
_CANCEL_EVENT = "110111"
_REGISTERED_EVENT = {"135", "136", "155"}


class BatchError(ValueError):
    """The archive itself is not acceptable (not a ZIP, too many entries, too big). The message is safe to show."""


@dataclass(frozen=True)
class Invoice:
    key: str
    kind: str
    month: str
    amount: Decimal


@dataclass
class BatchResult:
    invoices: list[Invoice] = field(default_factory=list)
    duplicates: int = 0
    cancelled: int = 0
    ignored: int = 0
    unreadable: list[str] = field(default_factory=list)
    """Names of the entries that could not be read as an NF-e or an event (never their content)."""

    def months(self) -> dict[str, dict[str, Decimal]]:
        """Totals per competence: `{"2026-03": {"sales": Decimal, "purchases": Decimal}}`, oldest first."""
        totals: dict[str, dict[str, Decimal]] = defaultdict(lambda: {"sales": Decimal(0), "purchases": Decimal(0)})
        for i in self.invoices:
            totals[i.month]["sales" if i.kind == "sale" else "purchases"] += i.amount
        return dict(sorted(totals.items()))


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find(root: Element, name: str, parent: str | None = None) -> str | None:
    scope = root if parent is None else next((e for e in root.iter() if _local(e.tag) == parent), None)
    if scope is None:
        return None
    node = next((e for e in scope.iter() if _local(e.tag) == name), None)
    return (node.text or "").strip() if node is not None and node.text else None


def _digits(value: str | None) -> str:
    return "".join(c for c in (value or "") if c.isdigit())


def _entries(data: bytes) -> list[tuple[str, bytes]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise BatchError("O arquivo não é um ZIP válido.") from exc
    infos = [i for i in archive.infolist() if not i.is_dir() and i.filename.lower().endswith(".xml")]
    if len(infos) > MAX_ENTRIES:
        raise BatchError(f"O ZIP tem mais de {MAX_ENTRIES} arquivos XML. Envie em partes.")
    out: list[tuple[str, bytes]] = []
    total = 0
    for info in infos:
        with archive.open(info) as handle:
            content = handle.read(MAX_FILE_BYTES + 1)  # bounded on what is really read, not on what the header claims
        if len(content) > MAX_FILE_BYTES:
            raise BatchError("Um dos arquivos do ZIP é grande demais para uma NF-e.")
        total += len(content)
        if total > MAX_TOTAL_BYTES:
            raise BatchError("O ZIP descompactado passa do limite. Envie em partes.")
        out.append((info.filename.rsplit("/", 1)[-1], content))
    return out


def _read(root: Element, company_cnpj: str) -> tuple[str, Invoice | None, str | None]:
    """What one document is: ('nfe', invoice or None, cancelled key), ('event', None, cancelled key) or ('other', None, None)."""
    kind = _local(root.tag)
    if kind in {"procEventoNFe", "evento", "retEvento"}:
        cancels = _find(root, "tpEvento") == _CANCEL_EVENT and (_find(root, "cStat") in _REGISTERED_EVENT or kind == "evento")
        key = _digits(_find(root, "chNFe"))
        return "event", None, key if cancels and len(key) == 44 else None
    if kind not in {"nfeProc", "NFe"}:
        return "other", None, None
    key = _digits(_find(root, "chNFe"))
    if len(key) != 44:
        info = next((e for e in root.iter() if _local(e.tag) == "infNFe"), None)
        key = _digits(info.get("Id") if info is not None else None)
    month = (_find(root, "dhEmi") or _find(root, "dEmi") or "")[:7]
    value = _find(root, "vNF")
    try:
        amount = Decimal(value or "")
    except ArithmeticError:
        return "nfe", None, None
    if len(key) != 44 or len(month) != 7 or amount < 0:
        return "nfe", None, None
    emitted, received = (normalize_cnpj(_find(root, "CNPJ", side) or "") for side in ("emit", "dest"))
    side = "sale" if emitted == company_cnpj else "purchase" if received == company_cnpj else "none"
    cancelled = key if _find(root, "cStat") in _CANCELLED_STATUS else None  # cancelled by its own protocol
    return "nfe", Invoice(key, side, month, amount), cancelled


def parse_batch(data: bytes, company_cnpj: str, already_imported: set[str] | None = None) -> BatchResult:
    """Reads the archive. `already_imported` holds the access keys counted in an earlier import."""
    done = already_imported or set()
    parsed: list[Invoice] = []
    cancelled_keys: set[str] = set()
    result = BatchResult()
    seen: set[str] = set()
    for name, content in _entries(data):
        try:
            root = SafeET.fromstring(content.decode("utf-8-sig", errors="replace"))
        except (DefusedXmlException, SafeET.ParseError, ValueError):
            result.unreadable.append(name)
            continue
        kind, invoice, cancelled = _read(root, company_cnpj)
        if cancelled:
            cancelled_keys.add(cancelled)
        if kind == "other" or (kind == "nfe" and invoice is None):
            result.unreadable.append(name)
        elif invoice is not None:
            if invoice.key in seen:
                result.duplicates += 1
            else:
                seen.add(invoice.key)
                parsed.append(invoice)
    for invoice in parsed:
        if invoice.key in cancelled_keys:
            result.cancelled += 1
        elif invoice.key in done:
            result.duplicates += 1
        elif invoice.kind == "none":
            result.ignored += 1
        else:
            result.invoices.append(invoice)
    return result
