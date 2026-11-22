"""Document data feeding the engine (#160): the AI proposes, only a confirmed use changes the profile, the origin is recorded."""

import json
from decimal import Decimal
from typing import Any

import pytest

from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import BY_NAME, ToolRegistry, approval_key
from app.documents.apply import NotUsableError, propose
from app.documents.search import DbDocumentSearch
from app.engine.real_engine import RealEngine
from app.engine.result import Ok
from app.engine.types import CompanyProfile, MonthlyEntry
from tests.fake_db import FakeDb

CNPJ = "11222333000181"
WS = "ws-1"
NFE = {"numero": "10", "emitente_cnpj": CNPJ, "valor_total": "1500.00", "emissao": "2026-03-10"}
USE = {"month": "2026-03", "kind": "comercio", "amount": "1500.00"}


def simples() -> CompanyProfile:
    return CompanyProfile(
        id="c1", name="Demo", cnpj=CNPJ, regime="simples", anexo="I", activity="comercio", uf="SP", employees=1,
        monthly_revenue=Decimal(10000), series=[MonthlyEntry("2026-02", {"comercio": Decimal(10000)}), MonthlyEntry("2026-03", {"comercio": Decimal(10000)})],
    )  # fmt: skip


def seed_doc(db: FakeDb, fields: dict[str, str] | None = None, doc_type: str = "nota_fiscal") -> str:
    extracted = {"fields": fields or NFE, "missing": [], "notes": [], "confidence": "alta"}
    return str(db.seed("documents", workspace_id=WS, name="nf.xml", doc_type=doc_type, extracted=extracted)["id"])


def registry(db: FakeDb, store: MemoryStore, approvals: frozenset[str] = frozenset()) -> ToolRegistry:
    ctx = ToolContext(Scope(WS, "A", "empresa"), store, RealEngine("2026-03"), approvals, documents=DbDocumentSearch(db, WS))  # type: ignore[arg-type]
    return ToolRegistry(ctx)


async def call(reg: ToolRegistry, name: str, args: dict[str, Any]) -> Any:
    return await reg.invoke(name, json.dumps(args), untrusted_in_context=False)


def approval(doc: str, values: dict[str, str]) -> str:
    return approval_key("use_document_data", BY_NAME["use_document_data"].args.model_validate({"id": doc, **values}))


def test_an_nfe_issued_by_the_company_proposes_revenue_in_its_month() -> None:
    p = propose("nota_fiscal", NFE, [], CNPJ)
    assert (p.month, p.kind, p.amount) == ("2026-03", "comercio", Decimal("1500.00")) and p.to_confirm == []


@pytest.mark.parametrize(
    ("doc_type", "fields", "cnpj"),
    [
        ("nota_fiscal", {**NFE, "emitente_cnpj": "00000000000191"}, CNPJ),  # issued by someone else: not our revenue
        ("nota_fiscal", NFE, None),  # without the company CNPJ the direction is unknown
        ("nota_fiscal", {k: v for k, v in NFE.items() if k != "valor_total"}, CNPJ),
        ("das", {"valor_total": "10.00"}, CNPJ),  # a type that does not feed revenue
    ],
)
def test_what_cannot_be_told_is_refused_not_guessed(doc_type: str, fields: dict[str, str], cnpj: str | None) -> None:
    with pytest.raises(NotUsableError):
        propose(doc_type, fields, [], cnpj)


async def test_proposing_changes_nothing() -> None:
    db = FakeDb()
    doc = seed_doc(db)
    store = MemoryStore(simples())
    out = await call(registry(db, store), "propose_document_data", {"id": doc})
    assert out["status"] == "ok" and out["data"]["proposal"]["amount"] == "1500.00"
    assert store.company == simples() and "applied" not in db.tables["documents"][0]["extracted"]


async def test_without_the_users_confirmation_nothing_changes() -> None:
    db = FakeDb()
    doc = seed_doc(db)
    store = MemoryStore(simples())
    out = await call(registry(db, store), "use_document_data", {"id": doc, **USE})
    assert out["status"] == "confirmation_required"
    assert store.company == simples() and "applied" not in db.tables["documents"][0]["extracted"]


async def test_confirmed_use_changes_the_diagnosis_and_records_the_origin_once() -> None:
    db = FakeDb()
    doc = seed_doc(db)
    store = MemoryStore(simples())
    engine = RealEngine("2026-03")
    before = engine.diagnose(store.company)
    reg = registry(db, store, frozenset({approval(doc, USE)}))
    out = await call(reg, "use_document_data", {"id": doc, **USE})
    assert out["status"] == "ok"
    assert store.company.series[1] == MonthlyEntry("2026-03", {"comercio": Decimal("11500.00")})
    after = engine.diagnose(store.company)
    assert isinstance(before, Ok) and isinstance(after, Ok) and after.value.monthly_total != before.value.monthly_total
    applied = db.tables["documents"][0]["extracted"]["applied"]
    assert applied["month"] == "2026-03" and applied["amount"] == "1500.00" and applied["at"]
    again = await call(reg, "use_document_data", {"id": doc, **USE})
    assert again["status"] == "error" and store.company.series[1].revenue["comercio"] == Decimal("11500.00")  # never twice


async def test_the_model_cannot_change_the_values_the_user_confirmed() -> None:
    db = FakeDb()
    doc = seed_doc(db)
    store = MemoryStore(simples())
    forged = {**USE, "amount": "999999.00"}
    out = await call(registry(db, store, frozenset({approval(doc, forged)})), "use_document_data", {"id": doc, **forged})
    assert out["status"] == "error" and store.company == simples()


async def test_a_document_of_another_workspace_is_not_used() -> None:
    db = FakeDb()
    other = str(db.seed("documents", workspace_id="ws-2", name="x", doc_type="nota_fiscal", extracted={"fields": NFE})["id"])
    store = MemoryStore(simples())
    out = await call(registry(db, store), "propose_document_data", {"id": other})
    assert out["status"] == "error" and store.company == simples()
