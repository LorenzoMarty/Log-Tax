"""More triggers for alerts by event (#144): member joined, regime changed, new opportunity, missing document."""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from app.chat import state as chat_state
from app.chat.tools import AlertArgs
from app.core.config import Settings
from app.engine.opportunities import Opportunity, OpportunitySet
from app.engine.result import Ok
from app.engine.types import CompanyProfile
from app.tasks import event_alerts
from app.tasks.event_alerts import evaluate_scheduled_events, record_event_notices
from tests.fake_db import FakeDb

WS = "ws-1"
COMPANY = {
    "id": "c",
    "name": "Loja",
    "regime": "presumido",
    "activity": "comercio",
    "monthlyRevenue": 350000,
    "employees": 8,
    "uf": "SP",
    "monthlyPurchases": 180000,
    "profitMargin": 0.08,
}
NONE = {"new_opportunity": 0, "missing_document": 0}


def test_the_other_event_rules_have_their_own_shapes() -> None:
    for event in ("member_joined", "regime_changed", "new_opportunity"):
        assert AlertArgs.model_validate({"event": event}).model_dump(by_alias=True, exclude_none=True) == {"event": event}
    ok = AlertArgs.model_validate({"event": "missing_document", "daysBefore": 5})
    assert ok.model_dump(by_alias=True, exclude_none=True) == {"event": "missing_document", "daysBefore": 5}
    for bad, message in [
        ({"event": "missing_document"}, "daysBefore é obrigatório"),
        ({"event": "member_joined", "daysBefore": 5}, "daysBefore é obrigatório"),
        ({"event": "missing_document", "daysBefore": 90}, "0 a 60"),
        ({"event": "regime_changed", "docType": "das"}, "só vale para o evento document_uploaded"),
        ({"daysBefore": 3, "metric": "monthlyTotal", "operator": "gt", "threshold": 1}, "só valem para alertas por evento"),
        ({"event": "other"}, "Input should be"),
    ]:
        with pytest.raises(ValueError, match=message):
            AlertArgs.model_validate(bad)


async def test_member_joined_writes_one_notice_per_invite() -> None:
    db = FakeDb()
    a = db.seed("alerts", workspace_id=WS, rule={"event": "member_joined"}, active=True, fired=False)
    db.seed("alerts", workspace_id=WS, rule={"event": "regime_changed"}, active=True, fired=False)
    for _ in range(2):
        await record_event_notices(db, WS, "member_joined", "invite-1", "Um novo membro entrou no espaço.")  # type: ignore[arg-type]
    assert [e["alert_id"] for e in db.tables["alert_events"]] == [a["id"]]


async def test_a_regime_change_on_save_notifies_and_the_same_regime_does_not(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, str]] = []

    async def spy(settings: Any, ws: str, event: str, key: str, text: str, doc_type: Any = None) -> None:
        sent.append((event, text))

    monkeypatch.setattr(chat_state, "notify_event", spy)
    db = FakeDb()
    db.rpcs["my_role"] = lambda a: "owner"
    ws = str(db.seed("workspaces", name="L", kind="empresa", profile=COMPANY, owner_id="u")["id"])
    state = await chat_state.load_workspace_state(db, ws, Settings())  # type: ignore[arg-type]
    assert state is not None
    await chat_state.save_workspace_state(db, ws, state, [], [], Settings())  # type: ignore[arg-type]
    assert sent == []
    await state.store.save_company(CompanyProfile(**{**state.store.company.__dict__, "regime": "simples"}))
    await chat_state.save_workspace_state(db, ws, state, [], [], Settings())  # type: ignore[arg-type]
    assert sent == [("regime_changed", "O regime tributário mudou de Lucro Presumido para Simples Nacional.")]


async def test_scheduled_events_notify_new_opportunities_and_missing_documents_once(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeEngine:
        def opportunities(self, company: CompanyProfile) -> Ok[OpportunitySet]:
            item = Opportunity("opp-regime", "Revisão de regime", "found", "regime-comparison")
            return Ok(OpportunitySet([item], Decimal(1200)))

    monkeypatch.setattr(event_alerts, "RealEngine", FakeEngine)
    db = FakeDb()
    ws = str(db.seed("workspaces", name="Loja", kind="empresa", profile=COMPANY, owner_id="u")["id"])
    db.seed("alerts", workspace_id=ws, rule={"event": "new_opportunity"}, active=True, fired=False)
    db.seed("alerts", workspace_id=ws, rule={"event": "missing_document", "daysBefore": 60}, active=True, fired=False)
    db.seed("alerts", workspace_id=ws, rule={"event": "member_joined"}, active=True, fired=False)
    day = date(2026, 3, 10)
    first = await evaluate_scheduled_events(db, Settings(), day)  # type: ignore[arg-type]
    assert first["new_opportunity"] >= 1 and first["missing_document"] >= 1
    texts = [e["text"] for e in db.tables["alert_events"]]
    assert any(t.startswith("Nova oportunidade:") for t in texts)
    assert any(t.startswith("Documento faltando:") for t in texts)
    assert await evaluate_scheduled_events(db, Settings(), day) == NONE  # type: ignore[arg-type]
    # a deadline farther away than daysBefore stays quiet
    db.tables["alert_events"].clear()
    db.tables["alerts"][1]["rule"]["daysBefore"] = 0
    assert (await evaluate_scheduled_events(db, Settings(), day))["missing_document"] == 0  # type: ignore[arg-type]
