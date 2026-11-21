"""LLM boundary (#304): OpenAI client over a fake transport, the scripted stand-in, the factory and the NDJSON stream lines."""

import json
import os
from typing import Any

import httpx
import pytest

from app.chat.llm_factory import get_llm
from app.chat.openai_llm import DEFAULT_MODEL, LlmError, OpenAiLlm, create_openai_llm
from app.chat.orchestrator import run_turn
from app.chat.progress import NDJSON, done_line, error_line, tool_line, tool_progress_label
from app.chat.scripted_llm import ScriptedLlm, money, pct, revenue_from, scripted_llm, style_from
from app.chat.types import Msg, ToolOutcome, ToolSpec
from app.core.config import Settings

TOOLS = [ToolSpec("get_tax_diagnosis", "d", {"type": "object", "properties": {}})]
CPF, CNPJ = "529.982.247-25", "11.222.333/0001-81"
KEY = "35200114200166000187550010000000046000000047"


def llm_over(handler: Any, retry_delay: float = 0) -> OpenAiLlm:
    client = httpx.AsyncClient(base_url="https://api.test/v1", transport=httpx.MockTransport(handler))
    return OpenAiLlm(client, "test-model", retry_delay=retry_delay)


def ok(output: list[Any], **extra: Any) -> httpx.Response:
    return httpx.Response(200, json={"output": output, **extra})


async def test_request_shape_store_false_and_usage() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        msg = {"type": "message", "content": [{"type": "output_text", "text": "oi"}]}
        return ok([msg], usage={"input_tokens": 11, "output_tokens": 3})

    turn = await llm_over(handler).respond(system="SYS", history=[{"role": "user", "content": "olá"}], tools=TOOLS)
    body = json.loads(seen[0].content)
    assert seen[0].url.path == "/v1/responses"
    assert body["store"] is False and "previous_response_id" not in body
    assert body["model"] == "test-model" and body["instructions"] == "SYS"
    assert body["input"] == [{"role": "user", "content": "olá"}]
    assert body["tools"] == [
        {"type": "function", "name": "get_tax_diagnosis", "description": "d", "parameters": TOOLS[0].parameters, "strict": False}
    ]
    assert (turn.text, turn.calls) == ("oi", [])
    assert turn.usage is not None and (turn.usage.input, turn.usage.output) == (11, 3)


async def test_function_calls_become_tool_calls_and_items_are_replayed_without_output_only_fields() -> None:
    call = {
        "type": "function_call",
        "call_id": "c1",
        "name": "get_tax_diagnosis",
        "arguments": "{}",
        "id": "fc_1",
        "created_by": "x",
    }
    reply = {"type": "message", "content": [{"type": "output_text", "text": "a", "parsed": 1}], "created_by": "y"}
    bodies: list[dict[str, Any]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(req.content))
        return ok([call]) if len(bodies) == 1 else ok([], output_text="fim")

    llm = llm_over(handler)
    first = await llm.respond(system="s", history=[], tools=TOOLS)
    assert [(c.id, c.name, c.args) for c in first.calls] == [("c1", "get_tax_diagnosis", "{}")]
    history: list[Msg] = [
        {"role": "user", "content": "quanto pago?"},
        {"role": "llm", "items": [call, reply]},
        {"role": "tool_result", "callId": "c1", "output": '{"ok":true}'},
    ]
    assert (await llm.respond(system="s", history=history, tools=TOOLS)).text == "fim"
    sent = bodies[1]["input"]
    assert "created_by" not in sent[1] and "parsed_arguments" not in sent[1]
    assert sent[2] == {"type": "message", "content": [{"type": "output_text", "text": "a"}]}
    assert sent[3] == {"type": "function_call_output", "call_id": "c1", "output": '{"ok":true}'}


async def test_no_personal_identifier_leaves_in_full() -> None:
    bodies: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        bodies.append(req.content.decode())
        return ok([])

    history: list[Msg] = [
        {"role": "user", "content": f"Meu CPF é {CPF} e a conta corrente 98765-4"},
        {"role": "assistant", "content": f"Anotei o CNPJ {CNPJ}"},
        {"role": "tool_result", "callId": "c1", "output": json.dumps({"cnpj": "11222333000181", "chave": KEY})},
    ]
    await llm_over(handler).respond(system=f"Empresa CNPJ {CNPJ}", history=history, tools=TOOLS)
    sent = bodies[0]
    for secret in (CPF, "52998224725", "11222333000181", CNPJ, KEY, "98765-4"):
        assert secret not in sent
    assert "***.***.***-25" in sent and "**.***.***/****-81" in sent and "chave NF-e" in sent


async def test_retries_transient_failures_then_succeeds() -> None:
    codes = iter([429, 503])
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        code = next(codes, 200)
        return (
            ok([], output_text="ok") if code == 200 else httpx.Response(code, headers={"retry-after": "0"}, text="user data here")
        )

    assert (await llm_over(handler).respond(system="s", history=[], tools=[])).text == "ok"
    assert len(calls) == 3


async def test_gives_up_after_two_retries_without_leaking_the_body() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text=f"echo {CPF}")

    with pytest.raises(LlmError) as err:
        await llm_over(handler).respond(system="s", history=[], tools=[])
    assert err.value.status == 500 and CPF not in str(err.value)


async def test_client_errors_are_not_retried() -> None:
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(401, text="bad key")

    with pytest.raises(LlmError, match="401"):
        await llm_over(handler).respond(system="s", history=[], tools=[])
    assert len(calls) == 1


async def test_timeouts_are_retried_and_then_reported() -> None:
    calls: list[int] = []

    def handler(_: httpx.Request) -> httpx.Response:
        calls.append(1)
        raise httpx.ReadTimeout("slow")

    with pytest.raises(LlmError, match="ReadTimeout"):
        await llm_over(handler).respond(system="s", history=[], tools=[])
    assert len(calls) == 3


async def test_retry_after_header_is_honoured_and_junk_falls_back_to_backoff() -> None:
    codes = iter([429, 429])

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(next(codes, 200), headers={"retry-after": "soon"}, json={"output": []})

    assert (await llm_over(handler).respond(system="s", history=[], tools=[])).items == []


def test_create_openai_llm_needs_a_key_and_defaults_the_model() -> None:
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        create_openai_llm("")
    assert create_openai_llm("sk-test")._model == DEFAULT_MODEL
    assert create_openai_llm("sk-test", "m")._model == "m"


@pytest.mark.skipif(
    not (os.environ.get("OPENAI_API_KEY") and os.environ.get("LOG_TAX_LIVE")),
    reason="live OpenAI test: set OPENAI_API_KEY and LOG_TAX_LIVE=1",
)
async def test_live_round_trip() -> None:
    turn = await create_openai_llm(os.environ["OPENAI_API_KEY"], os.environ.get("OPENAI_MODEL", "")).respond(
        system="Responda em uma palavra.", history=[{"role": "user", "content": "Diga oi"}], tools=[]
    )
    assert turn.text


# ---- factory ----
def test_factory_gives_the_scripted_llm_outside_production_only() -> None:
    assert get_llm(Settings(llm="scripted", environment="development")) is scripted_llm
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        get_llm(Settings(llm="scripted", environment="production", openai_api_key=""))
    assert isinstance(get_llm(Settings(llm="scripted", environment="production", openai_api_key="sk-x")), OpenAiLlm)
    assert isinstance(get_llm(Settings(openai_api_key="sk-x")), OpenAiLlm)


# ---- progress ----
def test_progress_labels_and_ndjson_lines() -> None:
    assert tool_progress_label("get_tax_diagnosis") == "calculando o diagnóstico…"
    assert tool_progress_label("whatever_tool") == "consultando seus dados…"
    assert NDJSON == "application/x-ndjson"
    assert tool_line("run_simulation") == b'{"type":"tool","name":"run_simulation"}\n'
    assert json.loads(done_line({"text": "ok"})) == {"type": "done", "reply": {"text": "ok"}}
    assert json.loads(error_line("falhou")) == {"type": "error", "error": "falhou"}


# ---- scripted ----
def test_scripted_helpers_match_the_typescript_formatting() -> None:
    assert money(1234.5) == "R$ 1.235" and money(-2.5) == "R$ -2" and money("500000") == "R$ 500.000" and money(12) == "R$ 12"
    assert pct("0.131") == "13,1%" and pct(0.0625) == "6,3%"
    assert (
        revenue_from("e se faturar R$ 500 mil?") == 500000
        and revenue_from("600000") == 600000
        and revenue_from("sem número") is None
    )
    assert revenue_from("R$ 500.000") == 500000
    assert style_from("deixa escuro e mais limpo") == {"theme": "dark", "density": "compact"}
    assert style_from("modo dia, mais espaçado") == {"theme": "light", "density": "comfortable"}
    assert style_from("oi") == {}


class Canned:
    """Tool registry stand-in returning the camelCase JSON the real tools return."""

    engine_tools = frozenset({"get_tax_diagnosis", "run_simulation", "list_opportunities"})

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data
        self.names: list[str] = []
        self.args: list[dict[str, Any]] = []

    def specs(self) -> list[ToolSpec]:
        return []

    async def invoke(self, name: str, args: str, *, untrusted_in_context: bool) -> ToolOutcome:
        self.names.append(name)
        self.args.append(json.loads(args))
        if name == "dashboard_remove_widget":
            return {"status": "confirmation_required", "key": "k", "summary": "remove"}
        if name == "dashboard_update_widget" and name in self.data.get("fail", []):
            return {"status": "error", "message": "no such block"}
        return {"status": "ok", "data": self.data.get(name, {})}


def value(v: Any) -> dict[str, Any]:
    return {"status": "ok", "value": v}


DIAG = {"monthlyTotal": 42800, "annualTotal": 513600, "effectiveRate": 0.131, "breakdown": [{"label": "DAS", "amount": 42800}]}
SIM = {
    "current": {"monthlyRevenue": 300000, "monthlyTotal": 42800, "effectiveRate": 0.131},
    "scenario": {"monthlyRevenue": 500000, "monthlyTotal": 80000, "effectiveRate": 0.16},
}
IR = {
    "best": "completa",
    "annualSavings": 1200,
    "simplified": {"model": "simplificada", "deductions": 1000, "taxableBase": 9000, "tax": 500, "balance": -100},
    "complete": {"model": "completa", "deductions": 3000, "taxableBase": 7000, "tax": 300, "balance": 200},
}


async def turn(text: str, data: dict[str, Any], history: list[Msg] | None = None) -> tuple[str, Canned]:
    tools = Canned(data)
    r = await run_turn(llm=ScriptedLlm(), tools=tools, history=history or [], user_message=text)
    return r.text, tools


async def test_scripted_company_journey_builds_the_dashboard_and_answers() -> None:
    text, tools = await turn("Empresa", {"get_tax_diagnosis": value(DIAG)})
    assert tools.names == ["get_tax_diagnosis", "dashboard_add_widget", "dashboard_add_widget"]
    assert tools.args[1]["widget"]["value"] == "R$ 42.800/mês" and tools.args[1]["widget"]["caption"] == "13,1% do faturamento"
    assert "R$ 42.800 por mês (13,1% do faturamento)" in text


async def test_scripted_asset_tracking_adds_the_asset_and_asks_for_the_missing_value() -> None:
    text, tools = await turn("quero acompanhar esse apartamento", {"add_asset": value({"id": "a1"})})
    assert tools.names == ["add_asset"]
    assert tools.args[0] == {"kind": "imovel", "description": "Apartamento", "value": 0}
    assert "Qual é o valor" in text
    text, tools = await turn("quero acompanhar meu carro de R$ 40 mil", {"add_asset": value({"id": "a2"})})
    assert tools.args[0] == {"kind": "veiculo", "description": "Veículo", "value": 40000}
    assert "Qual é o valor" not in text


async def test_scripted_company_journey_without_a_diagnosis_apologises() -> None:
    text, tools = await turn("Empresa", {"get_tax_diagnosis": {"status": "insufficient_data"}})
    assert tools.names == ["get_tax_diagnosis"] and "Não consegui calcular" in text


async def test_scripted_simulation_rewrites_the_block_or_creates_it_when_missing() -> None:
    text, tools = await turn("e se eu faturar R$ 500 mil?", {"run_simulation": value(SIM)})
    assert tools.args[0] == {"monthlyRevenue": 500000}
    assert tools.names == ["run_simulation", "dashboard_update_widget"]  # the block exists: just rewritten
    assert "R$ 500.000 por mês" in text
    assert tools.args[1]["patch"]["summary"] == "Carga de 13,1% para 16,0%"
    _, first = await turn("simule R$ 500 mil", {"run_simulation": value(SIM), "fail": ["dashboard_update_widget"]})
    assert first.names == ["run_simulation", "dashboard_update_widget", "dashboard_add_widget"]  # first ask: create it
    assert first.args[2]["widget"]["id"] == "simulacao"


async def test_scripted_simulation_without_a_result_asks_for_data() -> None:
    text, tools = await turn("simula", {"run_simulation": {"status": "insufficient_data"}})
    assert tools.names == ["run_simulation"] and "preciso saber o faturamento" in text


async def test_scripted_opportunities_and_explanations() -> None:
    opp = value(
        {"annualSavings": 12000, "items": [{"status": "found", "title": "Fator R", "monthlySavings": 1000}, {"status": "none"}]}
    )
    text, tools = await turn("como pagar menos imposto?", {"list_opportunities": opp, "get_tax_diagnosis": value(DIAG)})
    assert tools.names == ["list_opportunities", "get_tax_diagnosis", "dashboard_add_widget", "dashboard_add_widget"]
    assert tools.args[3]["widget"]["summary"] == "R$ 12.000/ano de economia potencial" and "Encontrei 1 oportunidades" in text
    why, _ = await turn("por que pago isso?", {"explain_result": {"assumptions": ["a.", "b."]}})
    assert why == "Cheguei nesse valor com estas premissas: a. b."


async def test_scripted_income_tax_flow_and_dependents() -> None:
    text, tools = await turn("quero fazer meu imposto de renda", {"get_ir_diagnosis": value(IR)})
    assert tools.names == ["get_ir_diagnosis", "dashboard_add_widget", "dashboard_add_widget"]
    assert "Pelo modelo completa" in text and "Restituição R$ 200" in text and "economiza R$ 1.200 por ano" in text
    again, tools2 = await turn("agora tenho 2 dependentes", {"get_ir_diagnosis": value(IR)})
    assert tools2.names == ["save_person_data", "get_ir_diagnosis", "dashboard_update_widget", "dashboard_update_widget"]
    assert tools2.args[0] == {"dependents": 2} and again.startswith("Atualizei para 2 dependentes")
    needs, _ = await turn("vale a pena a completa?", {"get_ir_diagnosis": {"status": "insufficient_data"}})
    assert "renda bruta" in needs
    which, _ = await turn(
        "completa ou simplificada?", {"get_ir_diagnosis": value({**IR, "annualSavings": 0, "best": "simplificada"})}
    )
    assert "A declaração simplificada é a mais vantajosa" in which and "não compensa" in which


async def test_scripted_removal_asks_for_confirmation_and_alerts_read_the_threshold() -> None:
    text, tools = await turn("tira o painel de carga", {})
    assert tools.names == ["dashboard_remove_widget"] and "Você confirma?" in text
    alert, tools2 = await turn("me avise quando passar de R$ 50 mil", {})
    assert tools2.args[0] == {"metric": "monthlyTotal", "operator": "gt", "threshold": 50000} and "acima de R$ 50.000" in alert
    low, tools3 = await turn("avise se ficar abaixo de 20000", {})
    assert tools3.args[0]["operator"] == "lt" and "abaixo de R$ 20.000" in low


async def test_scripted_misc_plans() -> None:
    style, tools = await turn("deixe o painel escuro", {})
    assert tools.args[0] == {"theme": "dark"} and "mudei a aparência" in style
    report, _ = await turn("gere um relatório", {"generate_report": {"url": "/r/1"}})
    assert "/r/1" in report
    agent, tools = await turn("crie uma IA para mim", {})
    assert tools.args[0]["name"] == "IA da Empresa" and "Minhas IAs" in agent
    saved, tools = await turn("meu faturamento mensal passou a ser 700 mil", {})
    assert tools.args[0] == {"monthlyRevenue": 700000} and "Atualizei o faturamento" in saved
    fallback, tools = await turn("bom dia", {})
    assert tools.names == [] and fallback.startswith("Entendi.")
    assert "Empresa ou Pessoal" in (await turn("quero organizar tudo", {}))[0]


async def test_scripted_update_agent_reads_the_agent_id_from_the_system_prompt() -> None:
    llm, tools = ScriptedLlm(), Canned({})
    r = await run_turn(
        llm=llm,
        tools=tools,
        history=[],
        user_message="mude o objetivo para cuidar do caixa",
        system="IAs: - id=a1 | IA 1 | objetivo: x",
    )
    assert tools.args[0] == {"id": "a1", "patch": {"objective": "cuidar do caixa"}} and "atualizei o objetivo" in r.text
    none, tools2 = await turn("troque o objetivo para algo", {})  # no agent in the default system prompt
    assert tools2.names == [] and "Não encontrei essa IA" in none


async def test_scripted_inventory_agent_uses_the_template() -> None:
    text, tools = await turn("Crie uma IA para o inventário do meu pai", {"create_agent_from_template": {"id": "a1"}})
    assert tools.names == ["create_agent_from_template"] and tools.args[0] == {"templateId": "inventario"}
    assert 'Criei a "IA do Inventário"' in text


async def test_scripted_inventory_journey_calls_the_estate_asset_and_heir_tools() -> None:
    _, tools = await turn("Abrir o espólio de João Silva, falecido em 15/10/2026, em sp", {})
    assert tools.names == ["set_estate"]
    assert tools.args[0] == {"deceasedName": "João Silva", "diedAt": "2026-10-15", "uf": "SP"}
    _, tools = await turn("Cadastrar imóvel Apartamento no centro de R$ 400 mil", {})
    assert tools.args[0] == {"kind": "imovel", "description": "Apartamento no centro", "value": 400000}
    _, tools = await turn("Cadastrar herdeira Ana Silva, filha, 50%", {})
    assert tools.args[0] == {"name": "Ana Silva", "relationship": "filha", "share": 50.0}
    heirs = [{"name": "Ana", "share": "50.00", "amount": "240000.00"}]
    inv = {"netEstate": "480000.00", "assets": [{}, {}], "heirs": heirs, "pendencias": []}
    text, tools = await turn("Mostrar o resumo do inventário", {"get_inventory": inv})
    assert tools.names == ["get_inventory"] and "R$ 480.000" in text and "Ana 50% (R$ 240.000)" in text


async def test_scripted_agent_with_its_own_panel_gets_the_dashboard_tools() -> None:
    text, tools = await turn("crie uma IA com painel próprio", {})
    assert tools.args[0]["tools"] == ["dashboard_add_widget", "dashboard_update_widget"] and "painel próprio" in text


async def test_scripted_cancel_alert_lists_then_deletes_the_first_and_confirm_repeats_it() -> None:
    class Alerts(Canned):
        async def invoke(self, name: str, args: str, *, untrusted_in_context: bool) -> ToolOutcome:
            if name == "delete_alert":
                self.names.append(name)
                self.args.append(json.loads(args))
                return {"status": "confirmation_required", "key": "k", "summary": "apagar"}
            return await super().invoke(name, args, untrusted_in_context=untrusted_in_context)

    tools = Alerts({"list_alerts": [{"id": "a1", "rule": {}, "active": True}]})
    r = await run_turn(llm=ScriptedLlm(), tools=tools, history=[], user_message="cancela aquele alerta")
    assert tools.names == ["list_alerts", "delete_alert"] and tools.args[1] == {"id": "a1"}
    assert "Você confirma" in r.text
    again = Alerts({"list_alerts": [{"id": "a1", "rule": {}, "active": True}]})
    await run_turn(llm=ScriptedLlm(), tools=again, history=r.history, user_message="Sim, pode confirmar.")
    assert again.names == ["list_alerts", "delete_alert"]
