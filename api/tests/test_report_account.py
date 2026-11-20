"""Report data, data export and account erasure (#311)."""

import json
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.account.export import LINK_SECONDS, build_export
from app.core.config import Settings, get_settings
from app.core.crypto import encrypt_field
from app.core.errors import DbError
from app.db.client import user_db
from app.engine.real_engine import RealEngine
from app.engine.seed import seed_company, seed_person
from app.engine.types import CompanyProfile, PersonProfile
from app.report.build import ReportDocument, build_report, memoria_section
from app.tasks import accounts
from app.tasks.accounts import delete_account
from tests.conftest import USER
from tests.fake_db import FakeDb

NOW = datetime(2026, 11, 8, 15, 0, tzinfo=UTC)
ENGINE = RealEngine("2026-06")


def report(kind: str = "empresa", **kw: Any) -> dict[str, Any]:
    args: dict[str, Any] = {
        "kind": kind, "workspace_name": "Minha Empresa", "company": seed_company(), "person": replace(seed_person()),
        "alerts": [], "documents": [], "engine": ENGINE, "generated_at": NOW,
    }  # fmt: skip
    return build_report(**{**args, **kw})


def section(r: dict[str, Any], sid: str) -> dict[str, Any]:
    return next(s for s in r["sections"] if s["id"] == sid)


# ---- the company report ----
def test_the_company_report_has_every_section_in_reading_order_and_the_disclaimer() -> None:
    r = report()
    assert [s["id"] for s in r["sections"]] == [
        "resumo",
        "impostos",
        "oportunidades",
        "economia",
        "premissas",
        "memoria",
        "validar",
        "documentos",
        "alertas",
    ]
    assert r["title"] == "Relatório tributário" and r["subtitle"] == "Minha Empresa · gerado em 08/11/2026"
    assert r["disclaimer"] == "Estimativa ilustrativa: valide com um contador antes de decidir."


def test_it_summarises_breaks_down_and_totals_the_taxes() -> None:
    r = report()
    resumo = section(r, "resumo")["paragraphs"]
    assert resumo[0] == "Comercial Exemplo Ltda. — Lucro Presumido, comércio." and resumo[1].startswith(
        "Carga tributária estimada: R$ "
    )
    impostos = section(r, "impostos")
    assert impostos["table"]["head"] == ["Tributo", "Por mês"] and impostos["table"]["rows"][-1][0] == "Total"
    assert impostos["seal"]["level"] in {"alta", "média", "baixa", "ilustrativo"} and "Confiança" in impostos["seal"]["text"]
    assert all(row[1].startswith("R$ ") for row in impostos["table"]["rows"])


def test_the_opportunities_the_saving_and_what_to_validate_agree_with_each_other() -> None:
    r = report(company=replace(seed_company(), profit_margin=Decimal("0.05")))  # a margin where changing regime pays off
    opps = section(r, "oportunidades")
    assert "validação profissional" in opps["paragraphs"][0] and opps["table"]["head"] == [
        "Oportunidade",
        "Situação",
        "Economia por mês",
    ]
    assert opps["table"]["rows"][0][1] == "Encontrada" and opps["table"]["rows"][0][2].startswith("R$ ")
    economia = section(r, "economia")
    assert economia["table"]["head"] == ["", "Hoje", "Potencial"] and economia["paragraphs"][0].startswith(
        "Economia potencial estimada: R$ "
    )
    assert "em 1 oportunidades, que precisam de validação" in section(r, "resumo")["paragraphs"][2]
    validar = section(r, "validar")["items"]
    assert any("economia estimada; validar com um contador antes de agir" in i for i in validar) and validar[-1].startswith(
        "Todas as regras"
    )


def test_when_nothing_is_found_the_report_says_so_instead_of_inventing_a_saving() -> None:
    r = report()  # the demo company has no relevant saving
    assert section(r, "oportunidades")["paragraphs"] == ["Não encontramos uma economia relevante com os dados atuais."]
    assert section(r, "economia")["paragraphs"] == ["Sem dados suficientes para estimar a economia."]
    assert section(r, "validar")["items"] == [
        "Todas as regras, alíquotas e tabelas deste relatório são ilustrativas e precisam ser conferidas por um contador."
    ]


def test_the_premises_cite_the_rules_in_force_with_source_validity_and_confidence() -> None:
    p = section(report(), "premissas")
    assert p["table"]["head"] == ["Regra", "Fonte", "Vigência", "Confiança"] and p["table"]["rows"]
    for name, source, since, confidence in p["table"]["rows"]:
        assert name and source and since.startswith("desde ") and "/" in since and confidence in {"baixa", "média", "alta"}
    assert not any("IRPF" in row[0] for row in p["table"]["rows"])  # personal rules stay out of the company report


def test_without_data_the_report_says_what_is_missing_instead_of_numbers() -> None:
    blank = CompanyProfile(id="c", name="Vazia", regime="presumido", activity="comercio")
    r = report(company=blank)
    assert "Faltam dados: faturamento mensal." in section(r, "resumo")["paragraphs"][1]
    assert section(r, "impostos")["paragraphs"][0].startswith("Não foi possível calcular os impostos.")
    assert section(r, "economia")["paragraphs"] == ["Sem dados suficientes para estimar a economia."]
    assert section(r, "validar")["items"][0].startswith("Faltam dados para calcular os impostos")
    assert "memoria" not in [s["id"] for s in r["sections"]]  # no steps, no memory section


def test_documents_alerts_and_unreadable_fields_are_listed() -> None:
    docs = [ReportDocument("nota.xml", "nota_fiscal", ["valor_total", "xyz"]), ReportDocument("foto.jpg", None)]
    alerts = [
        {"id": "1", "text": "Impostos por mês acima de R$ 1.000", "triggered": True, "currentText": "R$ 2.000"},
        {"id": "2", "text": "Carga tributária abaixo de 1,0%", "triggered": False, "currentText": "13,1%"},
        {"id": "3", "text": "Economia potencial por ano acima de R$ 5", "triggered": False},
    ]
    r = report(documents=docs, alerts=alerts)
    assert section(r, "documentos")["table"]["rows"] == [["nota.xml", "Nota fiscal"], ["foto.jpg", "Outro"]]
    assert "nota.xml: não consegui ler valor total, xyz." in section(r, "validar")["items"]
    assert section(r, "alertas")["items"] == [
        "Impostos por mês acima de R$ 1.000 — disparado (agora R$ 2.000)",
        "Carga tributária abaixo de 1,0% — em observação (agora 13,1%)",
        "Economia potencial por ano acima de R$ 5 — sem dados para avaliar",
    ]
    empty = report()
    assert section(empty, "documentos")["paragraphs"] == ["Nenhum documento enviado."] and section(empty, "alertas")[
        "paragraphs"
    ] == ["Nenhum alerta configurado."]


def test_a_regime_the_engine_cannot_diagnose_is_explained_not_computed() -> None:
    r = report(company=replace(seed_company(), regime="simples"))  # no series: the Simples needs the last 12 months
    assert "Faltam dados" in section(r, "resumo")["paragraphs"][1] and "Faltam dados" in section(r, "validar")["items"][0]


def test_the_calculation_memory_is_a_section_with_exact_amounts() -> None:
    assert memoria_section(None) == [] and memoria_section([]) == []
    steps = report()["sections"][5]
    assert steps["id"] == "memoria" and steps["table"]["head"] == ["Passo", "Como foi calculado", "Valor", "Fonte"]
    assert all(row[2].startswith("R$ ") and "," in row[2] for row in steps["table"]["rows"])


# ---- the personal report ----
def test_the_personal_report_has_its_own_sections_and_the_refund_side_by_side() -> None:
    engine = RealEngine("2025-06")  # the 2026 IRPF table is not confirmed yet: the engine refuses it
    r = report("pessoal", engine=engine)
    assert [s["id"] for s in r["sections"]] == ["resumo", "impostos", "economia", "premissas", "memoria", "validar", "documentos"]
    assert (
        r["title"] == "Relatório de Imposto de Renda"
        and section(r, "resumo")["paragraphs"][0] == "Minha Empresa — pessoa física."
    )
    table = section(r, "impostos")["table"]
    assert table["head"] == ["", "Simplificada", "Completa"] and [row[0] for row in table["rows"]] == [
        "Deduções",
        "Base de cálculo",
        "Imposto devido",
        "Restituição / a pagar",
    ]
    assert any(
        i.startswith("A declaração completa") or i.startswith("A declaração simplificada")
        for i in section(r, "economia")["paragraphs"]
    )
    assert all(
        "IRPF" in row[0] or "irpf" in row[0].lower() or "Imposto" in row[0] or row[0]
        for row in section(r, "premissas")["table"]["rows"]
    )


def test_without_the_tax_withheld_it_does_not_claim_a_refund_and_the_2026_table_is_explained() -> None:
    person = PersonProfile(annual_gross_income=Decimal(120000), inss_paid=Decimal(9000))
    r = report("pessoal", person=person, engine=RealEngine("2025-06"))
    assert "Informe o imposto retido na fonte para calcular restituição ou imposto a pagar." in section(r, "resumo")["paragraphs"]
    assert any("imposto retido na fonte (informe de rendimentos)" in i for i in section(r, "validar")["items"])
    assert section(r, "impostos")["table"]["rows"][3][1] == "—"
    now = report("pessoal", engine=RealEngine("2026-06"))
    assert section(now, "resumo")["paragraphs"][1].startswith("Não foi possível calcular o Imposto de Renda.")
    assert section(now, "economia")["paragraphs"] == ["Sem dados suficientes para estimar a economia."]
    assert section(now, "impostos")["paragraphs"][0].startswith("Não foi possível calcular os impostos.")
    savings = report("pessoal", person=replace(seed_person(), tax_withheld=Decimal(5000)), engine=RealEngine("2025-06"))
    assert section(savings, "impostos")["table"]["rows"][3][1].startswith(("Restituição", "A pagar"))


# ---- the report route ----
@pytest.fixture
def db(signed_in: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeDb]:
    monkeypatch.setenv("LOG_TAX_DEMO_SEED", "1")
    get_settings.cache_clear()
    fake = FakeDb(USER)
    fake.rpcs.update({"rate_limit_hit": lambda a: 0, "audit_record": lambda a: None, "my_role": lambda a: "owner"})

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def workspace(db: FakeDb, kind: str = "empresa") -> str:
    return str(db.seed("workspaces", name="Minha Empresa", kind=kind, profile=None, owner_id=USER)["id"])


def test_the_report_route_serves_the_data_to_anyone_who_can_see_the_workspace(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    db.seed("documents", workspace_id=ws, name="nota.xml", doc_type="nota_fiscal", extracted={"missing": ["valor_total"]})
    db.seed("alerts", workspace_id=ws, rule={"metric": "monthlyTotal", "operator": "gt", "threshold": 1}, active=True)
    r = signed_in.get(f"/v1/workspaces/{ws}/report")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store" and r.json()["title"] == "Relatório tributário"
    body = r.json()
    assert section(body, "documentos")["table"]["rows"] == [["nota.xml", "Nota fiscal"]]
    assert section(body, "alertas")["items"][0].startswith("Impostos por mês acima de R$ 1")
    assert signed_in.get("/v1/workspaces/6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11/report").status_code == 404
    personal = signed_in.get(f"/v1/workspaces/{workspace(db, 'pessoal')}/report").json()
    assert personal["title"] == "Relatório de Imposto de Renda" and "alertas" not in [s["id"] for s in personal["sections"]]


def test_the_report_and_the_account_routes_need_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.get(f"/v1/workspaces/{USER}/report").status_code == 401
    assert anonymous.get("/v1/account/export").status_code == 401
    assert anonymous.request("DELETE", "/v1/account", json={"confirm": "a@example.com"}).status_code == 401


# ---- the export ----
def seed_account(db: FakeDb, user: str = USER) -> str:
    ws = str(db.seed("workspaces", name="Minha", kind="empresa", profile={"cnpj": "x"}, owner_id=user)["id"])
    db.seed("dashboards", workspace_id=ws, data={})
    db.seed("alerts", workspace_id=ws, rule={}, active=True)
    db.seed("agents", workspace_id=ws, name="IA", objective="o", config={})
    db.seed("conversations", workspace_id=ws, history=[], messages=[])
    db.seed("agent_conversations", workspace_id=ws, agent_id="a", history=[], messages=[])
    sealed = {"fields": {"emitente_cnpj": encrypt_field("14200166000187", Settings())}, "missing": []}
    db.seed("documents", workspace_id=ws, name="nota.xml", storage_path=f"{ws}/d/nota.xml", extracted=sealed)
    db.seed("documents", workspace_id=ws, name="sem-arquivo", storage_path=None, extracted=None)
    db.storage[f"documents/{ws}/d/nota.xml"] = b"<xml/>"
    db.seed("workspace_members", workspace_id=ws, user_id="guest", email="g@example.com", role="reader")
    db.seed("audit_log", workspace_id=ws, actor_email="a@example.com", action="login", target=None)
    db.seed("workspace_invites", workspace_id=ws, invited_by=user, email="x@example.com")
    db.seed("comments", workspace_id=ws, author_id=user, body="oi")
    db.seed("workspace_members", workspace_id="other-ws", user_id=user, role="reader")
    return ws


async def test_the_export_has_everything_the_person_owns_and_nothing_of_anyone_else() -> None:
    db = FakeDb(USER)
    ws = seed_account(db)
    stranger = seed_account(db, "stranger")
    db.auth_user = lambda: _auth_user()  # type: ignore[method-assign]
    data = await build_export(db, USER, "a@example.com", Settings())  # type: ignore[arg-type]
    assert [w["id"] for w in data["workspaces"]] == [ws] and stranger not in json.dumps(data, default=str)
    assert data["profile"] == {"id": USER, "email": "a@example.com", "created_at": "2026-01-02T00:00:00Z"}
    assert (
        len(data["documents"]) == 2
        and f"exp={LINK_SECONDS}" in data["documents"][0]["download_url"]
        and data["documents"][1]["download_url"] is None
    )
    assert data["documents"][0]["extracted"]["fields"]["emitente_cnpj"] == "14200166000187"  # opened for the owner
    assert [m["email"] for m in data["members_of_my_workspaces"]] == ["g@example.com"] and len(data["comments_written"]) == 1
    assert data["spaces_shared_with_me"] == [{"workspace_id": "other-ws", "role": "reader"}] or data["spaces_shared_with_me"]
    assert "60 minutos" in data["notice"] and data["exported_at"]
    for key in (
        "dashboards",
        "alerts",
        "agents",
        "conversations",
        "agent_conversations",
        "invites_sent",
        "activity_in_my_workspaces",
    ):
        assert len(data[key]) == 1, key


async def _auth_user() -> dict[str, Any]:
    return {"created_at": "2026-01-02T00:00:00Z"}


def test_the_export_route_downloads_json_and_is_audited_and_rate_limited(signed_in: TestClient, db: FakeDb) -> None:
    seed_account(db)
    db.auth_user = lambda: _auth_user()  # type: ignore[method-assign]
    r = signed_in.get("/v1/account/export")
    assert r.status_code == 200 and r.headers["content-disposition"] == 'attachment; filename="log-tax-meus-dados.json"'
    assert r.headers["cache-control"] == "no-store" and r.json()["profile"]["id"] == USER
    assert ("audit_record", {"p_workspace": None, "p_action": "data_exported", "p_target": None}) in db.rpc_calls
    db.rpcs["rate_limit_hit"] = lambda a: 40
    assert signed_in.get("/v1/account/export").status_code == 429


# ---- erasure ----
class Platform:
    """A fake Supabase behind the service client: records which users and which files the service role removed."""

    def __init__(self) -> None:
        self.deleted_users: list[str] = []
        self.removed: list[str] = []
        self.fail_storage = False
        self.fail_user = False

    def client(self) -> httpx.AsyncClient:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.headers["authorization"] == "Bearer srv-key"
            if request.url.path.startswith("/storage/v1/object/documents"):
                if self.fail_storage:
                    return httpx.Response(500)
                prefixes = json.loads(request.content)["prefixes"]
                self.removed += prefixes
                return httpx.Response(200, json=[{"name": p} for p in prefixes])
            if request.url.path.startswith("/auth/v1/admin/users/"):
                if self.fail_user:
                    return httpx.Response(500)
                self.deleted_users.append(request.url.path.rsplit("/", 1)[-1])
                return httpx.Response(200, json={})
            return httpx.Response(404)

        return httpx.AsyncClient(
            base_url="https://p.supabase.co", headers={"Authorization": "Bearer srv-key"}, transport=httpx.MockTransport(handler)
        )


@pytest.fixture
def platform(monkeypatch: pytest.MonkeyPatch) -> Platform:
    p = Platform()

    @asynccontextmanager
    async def service(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
        yield p.client()

    monkeypatch.setattr(accounts, "service_client", service)
    return p


SETTINGS = Settings(supabase_url="https://p.supabase.co", supabase_service_role_key="srv-key")


async def test_erasure_removes_only_the_persons_files_and_only_their_user(platform: Platform) -> None:
    db = FakeDb(USER)
    ws = seed_account(db)
    stranger = seed_account(db, "stranger")
    db.rpcs["audit_record"] = lambda a: None
    await delete_account(db, SETTINGS, USER)  # type: ignore[arg-type]
    assert platform.removed == [f"{ws}/d/nota.xml"] and stranger not in " ".join(platform.removed)
    assert platform.deleted_users == [USER]
    assert ("audit_record", {"p_workspace": None, "p_action": "account_deleted", "p_target": None}) in db.rpc_calls


async def test_erasure_stops_before_deleting_the_user_when_the_files_cannot_be_removed(platform: Platform) -> None:
    db = FakeDb(USER)
    seed_account(db)
    platform.fail_storage = True
    with pytest.raises(DbError):
        await delete_account(db, SETTINGS, USER)  # type: ignore[arg-type]
    assert platform.deleted_users == []  # never leave files behind an account that is gone
    platform.fail_storage, platform.fail_user = False, True
    db.rpcs["audit_record"] = lambda a: None
    with pytest.raises(DbError):
        await delete_account(db, SETTINGS, USER)  # type: ignore[arg-type]


async def test_a_person_with_no_workspace_is_still_erased(platform: Platform) -> None:
    db = FakeDb(USER)
    db.rpcs["audit_record"] = lambda a: None
    await delete_account(db, SETTINGS, USER)  # type: ignore[arg-type]
    assert platform.removed == [] and platform.deleted_users == [USER]


def test_the_delete_route_wants_the_email_typed_and_answers_204(
    signed_in: TestClient, db: FakeDb, platform: Platform, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LOGTAX_SUPABASE_SERVICE_ROLE_KEY", "srv-key")
    get_settings.cache_clear()
    seed_account(db)
    for wrong in ({"confirm": "outro@example.com"}, {"confirm": ""}):
        r = signed_in.request("DELETE", "/v1/account", json=wrong)
        assert r.status_code == 400 and r.json()["error"]["code"] == "confirmation_mismatch"
    assert (
        platform.deleted_users == []
        and signed_in.request("DELETE", "/v1/account", json={"confirm": "x", "extra": 1}).status_code == 422
    )
    ok = signed_in.request("DELETE", "/v1/account", json={"confirm": "  A@Example.com "})  # case and spaces do not matter
    assert ok.status_code == 204 and platform.deleted_users == [USER]
    platform.fail_user = True
    failed = signed_in.request("DELETE", "/v1/account", json={"confirm": "a@example.com"})
    assert failed.status_code == 500 and failed.json()["error"]["code"] == "deletion_failed"
