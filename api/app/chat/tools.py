# ruff: noqa: E501  (tool descriptions are prompts for the model: long on purpose and kept as in the TypeScript version)
"""The assistant's tools: its whole surface of action (port of `src/chat/tools.ts`).

The security model must survive intact:
- a tool only runs if it is offered to this workspace kind and to this agent (`allowed_tools`);
- arguments are untrusted JSON, validated by a strict pydantic model before anything runs;
- a destructive tool never runs without an approval key the *user* granted out-of-band;
- once external content (a document, a comment) is in the conversation, every tool that writes needs that approval too.
"""

import json
import re
import unicodedata
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, is_dataclass, replace
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, ValidationError, create_model, model_validator
from pydantic.alias_generators import to_camel
from pydantic_core import to_jsonable_python

from app.chat.dashboard import Widget, validate_widget
from app.chat.store import Kind, Scope, ToolContext
from app.chat.types import ToolOutcome, ToolSpec
from app.core.br_ids import only_digits
from app.engine.calendar import upcoming_deadlines
from app.engine.company_schema import CompanyFields, apply_fields, inconsistencies, merge_series
from app.engine.history import tax_history
from app.engine.reform_impact import reform_impact
from app.engine.result import EngineResult, InsufficientData, NoneFound, NotApplicable, Ok
from app.engine.split_payment import split_payment_impact

MAX_WORKSPACES = 10
MAX_MEMORIES = 30
_MONTH = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


class ToolError(Exception):
    """A problem the model can read and act on (bad value, not found)."""


class RefusalError(Exception):
    """The tool will not do this, whatever the arguments."""


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel)


class _NonEmpty(BaseModel):
    @model_validator(mode="after")
    def _at_least_one(self) -> "_NonEmpty":
        if not self.model_fields_set:
            raise ValueError("informe ao menos um campo")
        return self


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    run: Callable[[ToolContext, Any], Awaitable[Any]]
    destructive: bool = False
    read_only: bool = False
    """Changes nothing. Every other tool writes, and writes need the user's approval once external content is in the conversation."""
    engine: bool = False
    """Uses the tax engine: the reply must carry the estimate disclaimer."""
    kinds: tuple[Kind, ...] | None = None
    """Workspace kinds where the tool applies; None = all."""


TOOLS: list[Tool] = []


def _tool(
    name: str, description: str, args: type[BaseModel], **flags: Any
) -> Callable[[Callable[[ToolContext, Any], Awaitable[Any]]], Callable[[ToolContext, Any], Awaitable[Any]]]:
    def register(run: Callable[[ToolContext, Any], Awaitable[Any]]) -> Callable[[ToolContext, Any], Awaitable[Any]]:
        TOOLS.append(Tool(name, description, args, run, **flags))
        return run

    return register


# ---- wire format ----
def wire(value: Any) -> Any:
    """Engine results and models as plain JSON: camelCase keys, money as exact decimal strings."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    if is_dataclass(value) and not isinstance(value, type):
        dumped = TypeAdapter(type(value)).dump_python(value, mode="json", by_alias=True)
        if hasattr(type(value), "__pydantic_config__"):
            return dumped
        return {to_camel(k): v for k, v in dumped.items()}  # plain dataclasses (profiles) are camelCase on the wire too
    if isinstance(value, dict):
        return {k: wire(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [wire(v) for v in value]
    return to_jsonable_python(value)


def _env(result: EngineResult[Any]) -> dict[str, Any]:
    if isinstance(result, Ok):
        return {"status": "ok", "value": wire(result.value)}
    if isinstance(result, InsufficientData):
        return {"status": "insufficient_data", "missing": result.missing}
    if isinstance(result, NotApplicable):
        return {"status": "not_applicable", "reason": result.reason}
    assert isinstance(result, NoneFound)
    return {"status": "none_found"}


def _stable(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def approval_key(name: str, args: BaseModel) -> str:
    """Key the user's approval is bound to: tool name + exact arguments."""
    return f"{name}:{_stable(args.model_dump(mode='json', by_alias=True, exclude_unset=True))}"


def _need[T](value: T | None, message: str) -> T:
    if value is None:
        raise ToolError(message)
    return value


def _brl(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    reais, centavos = divmod(abs(cents), 100)
    return f"{sign}R$ {reais:,}".replace(",", ".") + f",{centavos:02d}"


def _money0(value: Decimal | int) -> str:
    return f"R$ {int(Decimal(value).quantize(Decimal(1), ROUND_HALF_UP)):,}".replace(",", ".")


def _pct1(rate: Decimal) -> str:
    return f"{(rate * 100).quantize(Decimal('0.1'), ROUND_HALF_UP)}%"


def cash_impact_widget(cents: int, float_days: int, assumptions: list[str]) -> dict[str, Any]:
    """The split payment cash block (#106): signed working-capital change plus the assumptions behind it."""
    effect = (
        f"libera caixa ({float_days} dias a menos financiando o imposto)"
        if cents >= 0
        else f"consome caixa ({-float_days} dias de prazo perdidos)"
    )
    return {
        "id": "split-payment-caixa",
        "kind": "kpi",
        "title": "Impacto no caixa (split payment)",
        "size": "md",
        "value": f"{'+' if cents >= 0 else '-'}{_brl(abs(cents))}",
        "caption": f"Estimativa: {effect}. Premissas: {' '.join(assumptions)}",
    }


# ---- argument models ----
class NoArgs(_Args):
    pass


_SCENARIO_FIELDS = (
    "regime", "activity", "monthly_revenue", "employees", "monthly_purchases", "profit_margin", "uf", "anexo",
    "fator_r", "iss_rate", "substituicao_tributaria", "rat_grade", "fap", "terceiros_rate", "mei_activity",
)  # fmt: skip
# What a scenario may change: the fields that drive the calculation. Identity data (CNPJ, name, series) is not simulated.
ScenarioChanges = create_model(  # type: ignore[call-overload]
    "ScenarioChanges",
    __base__=_Args,
    **{k: (CompanyFields.model_fields[k].annotation, CompanyFields.model_fields[k]) for k in _SCENARIO_FIELDS},
)


class Scenario(_Args):
    name: str = Field(min_length=1, max_length=60)
    changes: ScenarioChanges


class RunSimulationArgs(_Args):
    monthly_revenue: float | None = Field(default=None, ge=0)
    scenarios: list[Scenario] | None = Field(default=None, min_length=1, max_length=3)
    save: bool | None = None


class DeadlinesArgs(_Args):
    horizon_days: int | None = Field(default=None, ge=1, le=365)


class HistoryArgs(_Args):
    to: _MONTH
    months: int | None = Field(default=None, ge=1, le=24)
    compare_with: _MONTH | None = None


class ReformArgs(_Args):
    category: (
        Literal[
            "geral",
            "saude",
            "educacao",
            "medicamentos",
            "dispositivos_medicos",
            "acessibilidade",
            "cesta_basica",
            "profissional_liberal",
        ]
        | None
    ) = None
    cbs_reference_rate: float | None = Field(default=None, ge=0, le=1)
    ibs_reference_rate: float | None = Field(default=None, ge=0, le=1)


class CashArgs(_Args):
    monthly_tax: float = Field(ge=0)
    receive_days: int = Field(ge=0, le=365)
    tax_due_days: int = Field(ge=0, le=365)


class RememberArgs(_Args):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class IdArgs(_Args):
    id: str = Field(min_length=1)


class CreateWorkspaceArgs(_Args):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    kind: Kind


class RenameWorkspaceArgs(_Args):
    id: uuid.UUID
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class RemoveWorkspaceArgs(_Args):
    id: uuid.UUID


class ExplainArgs(_Args):
    subject: Literal["diagnosis", "opportunity", "ir"]
    opportunity_id: str | None = None


class SaveCompanyArgs(CompanyFields, _NonEmpty):
    pass


class SavePersonArgs(_Args, _NonEmpty):
    annual_gross_income: float | None = Field(default=None, ge=0)
    inss_paid: float | None = Field(default=None, ge=0)
    dependents: int | None = Field(default=None, ge=0, le=50)
    health_expenses: float | None = Field(default=None, ge=0)
    education_expenses: float | None = Field(default=None, ge=0)
    private_pension: float | None = Field(default=None, ge=0)
    tax_withheld: float | None = Field(default=None, ge=0)


class AddWidgetArgs(_Args):
    widget: Widget
    index: int | None = Field(default=None, ge=0)


class UpdateWidgetArgs(_Args):
    id: str
    patch: dict[str, Any]


class ReorderArgs(_Args):
    id: str
    to_index: int = Field(ge=0)


class StyleArgs(_Args):
    theme: Literal["light", "dark"] | None = None
    density: Literal["comfortable", "compact"] | None = None


class AlertArgs(_Args):
    metric: Literal["monthlyTotal", "effectiveRate", "annualSavings", "daysToDeadline"]
    operator: Literal["gt", "lt", "within"]
    threshold: float

    @model_validator(mode="after")
    def _operator_fits_the_metric(self) -> "AlertArgs":
        if (self.metric == "daysToDeadline") != (self.operator == "within"):
            raise ValueError("daysToDeadline usa o operador within, e within só serve para daysToDeadline")
        if self.metric == "daysToDeadline" and not 0 <= self.threshold <= 60:
            raise ValueError("o prazo vai de 0 a 60 dias")
        return self


class CreateAgentArgs(_Args):
    name: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    tools: list[str]


class AgentPatch(_Args):
    name: str | None = Field(default=None, min_length=1)
    objective: str | None = Field(default=None, min_length=1)
    tools: list[str] | None = None


class UpdateAgentArgs(_Args):
    id: str
    patch: AgentPatch


# ---- engine tools ----
@_tool(
    "get_tax_diagnosis",
    "Calcula quanto a empresa paga de imposto por mês e por ano, e para onde vai.",
    NoArgs,
    read_only=True,
    kinds=("empresa",),
    engine=True,
)
async def _get_tax_diagnosis(ctx: ToolContext, a: NoArgs) -> Any:
    return _env(ctx.engine.diagnose(await ctx.store.get_company()))


def _slug(name: str) -> str:
    plain = unicodedata.normalize("NFD", name.lower())
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", plain))


@_tool(
    "run_simulation",
    "Simula mudanças na empresa e compara com o cenário atual. Aceita `monthlyRevenue` (um cenário) ou `scenarios` (até 3, nomeados, cada um com `changes`: regime, faturamento, funcionários, compras, margem, UF, atividade, anexo...). Com `save: true`, guarda cada cenário como bloco no painel.",
    RunSimulationArgs,
    read_only=True, kinds=("empresa",), engine=True,
)  # fmt: skip
async def _run_simulation(ctx: ToolContext, a: RunSimulationArgs) -> Any:
    company = await ctx.store.get_company()
    if a.scenarios is None:
        overrides = {"monthly_revenue": _cents_exact(a.monthly_revenue)} if a.monthly_revenue is not None else {}
        return _env(ctx.engine.simulate(company, overrides))
    current = ctx.engine.diagnose(company)
    if not isinstance(current, Ok):
        return _env(current)
    c = current.value
    out: list[dict[str, Any]] = []
    for sc in a.scenarios:
        changes = {k: getattr(sc.changes, k) for k in sc.changes.model_fields_set}
        result = ctx.engine.diagnose(replace(company, **changes))
        if isinstance(result, InsufficientData):
            raise ToolError(f'Cenário "{sc.name}": faltam dados: {", ".join(result.missing)}.')
        if isinstance(result, NotApplicable):
            raise ToolError(f'Cenário "{sc.name}": {result.reason}')
        if not isinstance(result, Ok):
            raise ToolError(f'Cenário "{sc.name}": sem resultado.')
        r = result.value
        delta_monthly, delta_annual = r.monthly_total - c.monthly_total, r.annual_total - c.annual_total
        if a.save:
            ids = {w["id"] for w in (await ctx.store.get_dashboard())["widgets"]}
            base = f"scenario-{_slug(sc.name)}"
            widget_id, i = base, 2
            while widget_id in ids:
                widget_id, i = f"{base}-{i}", i + 1
            premises = _stable(sc.changes.model_dump(mode="json", by_alias=True, exclude_unset=True))
            await ctx.store.dispatch(
                {
                    "type": "add",
                    "widget": {
                        "id": widget_id, "kind": "compare", "title": f"Cenário: {sc.name}", "size": "md", "labels": ["Atual", sc.name],
                        "rows": [
                            {"label": "Tributos/mês", "today": _money0(c.monthly_total), "potential": _money0(r.monthly_total)},
                            {"label": "Tributos/ano", "today": _money0(c.annual_total), "potential": _money0(r.annual_total)},
                            {"label": "Alíquota efetiva", "today": _pct1(c.effective_rate), "potential": _pct1(r.effective_rate)},
                        ],
                        "summary": f"{'Economia' if delta_annual <= 0 else 'Custo extra'} estimada de {_money0(abs(delta_annual))}/ano. Premissas: {premises}. Estimativa, não substitui contador.",
                    },
                }
            )  # fmt: skip
        out.append(
            {
                "name": sc.name,
                "changes": json.loads(_stable(sc.changes.model_dump(mode="json", by_alias=True, exclude_unset=True))),
                "result": wire(r), "deltaMonthly": wire(delta_monthly), "deltaAnnual": wire(delta_annual),
            }
        )  # fmt: skip
    return {"status": "ok", "value": {"current": wire(c), "scenarios": out}}


@_tool(
    "list_opportunities",
    "Lista oportunidades legais de economia tributária, com premissas e dados que faltam.",
    NoArgs,
    read_only=True,
    kinds=("empresa",),
    engine=True,
)
async def _list_opportunities(ctx: ToolContext, a: NoArgs) -> Any:
    return _env(ctx.engine.opportunities(await ctx.store.get_company()))


@_tool(
    "get_deadlines",
    "Lista os próximos vencimentos de obrigações da empresa (DAS, DCTFWeb, declarações anuais), com fonte e o que ainda não é coberto.",
    DeadlinesArgs, read_only=True, kinds=("empresa",),
)  # fmt: skip
async def _get_deadlines(ctx: ToolContext, a: DeadlinesArgs) -> Any:
    company = await ctx.store.get_company()
    return wire(upcoming_deadlines(company.regime, date.today().isoformat(), a.horizon_days or 60))


@_tool(
    "get_tax_history",
    "Imposto mês a mês (até 24 meses) usando a regra vigente em cada mês, e comparação entre dois meses (ex.: mesmo mês do ano passado). Só usa meses com dados gravados; sem histórico responde que faltam dados, nunca estima.",
    HistoryArgs, read_only=True, kinds=("empresa",), engine=True,
)  # fmt: skip
async def _get_tax_history(ctx: ToolContext, a: HistoryArgs) -> Any:
    return wire(tax_history(await ctx.store.get_company(), a.to, a.months or 12, a.compare_with))


def _dec(value: float | None) -> Decimal | None:
    """A rate the model wrote as a JSON number, as an exact decimal (never a binary float)."""
    return None if value is None else Decimal(str(value))


def _cents_exact(value: float) -> Decimal:
    return Decimal(f"{value:.2f}")


@_tool(
    "get_reform_impact",
    "Como a Reforma Tributária (IBS/CBS) muda a carga anual da empresa, ano a ano de 2026 a 2033, comparada à atual. Precisa da categoria da operação e das alíquotas de referência de CBS e IBS (informadas pelo usuário; não invente). Sem esses dados responde o que falta.",
    ReformArgs, read_only=True, kinds=("empresa",), engine=True,
)  # fmt: skip
async def _get_reform_impact(ctx: ToolContext, a: ReformArgs) -> Any:
    company = await ctx.store.get_company()
    result = reform_impact(
        ctx.engine.book, company, lambda: ctx.engine.diagnose(company),
        category=a.category, cbs_reference_rate=_dec(a.cbs_reference_rate), ibs_reference_rate=_dec(a.ibs_reference_rate),
    )  # fmt: skip
    return _env(result)


@_tool(
    "add_cash_impact_block",
    'Cria no painel o bloco "Impacto no caixa" do split payment (IBS/CBS retidos quando o cliente paga), com as premissas. Precisa do IBS+CBS mensal (use get_reform_impact ou o valor do usuário), do prazo médio de recebimento e do prazo atual de recolhimento, em dias. Não invente esses números.',
    CashArgs, kinds=("empresa",), engine=True,
)  # fmt: skip
async def _add_cash_impact_block(ctx: ToolContext, a: CashArgs) -> Any:
    r = split_payment_impact(monthly_tax=_cents_exact(a.monthly_tax), receive_days=a.receive_days, tax_due_days=a.tax_due_days)
    if not isinstance(r, Ok):
        return _env(r)
    widget = cash_impact_widget(r.value.working_capital_cents, r.value.float_days, r.value.assumptions)
    await ctx.store.dispatch({"type": "remove", "id": widget["id"]})
    await ctx.store.dispatch({"type": "add", "widget": widget})
    return _env(r)


@_tool(
    "explain_result",
    "Explica de onde veio um resultado: o passo a passo do cálculo (steps, cada um com a regra e a fonte), regras usadas, premissas e se precisa de validação. Ao citar lei ou fonte, use somente as que vierem aqui.",
    ExplainArgs, read_only=True, engine=True,
)  # fmt: skip
async def _explain_result(ctx: ToolContext, a: ExplainArgs) -> Any:
    changelog = ctx.engine.rules().changelog()
    if a.subject == "ir":
        d: EngineResult[Any] = ctx.engine.diagnose_person(await ctx.store.get_person())
        rules = [e for e in changelog if e.id.startswith("irpf")]
    elif a.subject == "diagnosis":
        d = ctx.engine.diagnose(await ctx.store.get_company())
        rules = [e for e in changelog if not e.id.startswith("irpf")]
    else:
        found = ctx.engine.opportunities(await ctx.store.get_company())
        item = next((i for i in found.value.items if i.id == a.opportunity_id), None) if isinstance(found, Ok) else None
        return {"rule": wire(_need(item, "Oportunidade não encontrada."))}
    ok = d.value if isinstance(d, Ok) else None
    return {"rules": wire(rules), "assumptions": ok.assumptions if ok else [], "steps": wire(getattr(ok, "steps", None) or [])}


@_tool(
    "get_ir_diagnosis",
    "Calcula o Imposto de Renda anual da pessoa física nos modelos simplificado e completo, qual compensa mais e a restituição ou o imposto a pagar.",
    NoArgs,
    read_only=True,
    kinds=("pessoal",),
    engine=True,
)
async def _get_ir_diagnosis(ctx: ToolContext, a: NoArgs) -> Any:
    return _env(ctx.engine.diagnose_person(await ctx.store.get_person()))


# ---- data tools ----
@_tool(
    "save_company_data",
    "Salva dados informados pelo usuário sobre a empresa. Use só o que o usuário disse.",
    SaveCompanyArgs,
    kinds=("empresa",),
)
async def _save_company_data(ctx: ToolContext, a: SaveCompanyArgs) -> Any:
    # Merge, then judge the whole profile: some mistakes only show when two fields meet (anexo with the wrong regime).
    company = await ctx.store.get_company()
    merged = apply_fields(company, a)
    if "cnpj" in a.model_fields_set and a.cnpj:
        merged = replace(merged, cnpj=only_digits(a.cnpj))
    if a.series:
        incoming = apply_fields(replace(company, series=None), CompanyFields(series=a.series)).series or []
        merged = replace(merged, series=merge_series(company.series, incoming))
    problems = inconsistencies(merged)
    if problems:
        raise ToolError(f"Não salvei: {' '.join(problems)}")
    return wire(await ctx.store.save_company(merged))


@_tool(
    "save_person_data",
    "Salva dados informados pelo usuário para o Imposto de Renda (renda anual, INSS, dependentes, despesas, imposto retido). Use só o que o usuário disse.",
    SavePersonArgs,
    kinds=("pessoal",),
)
async def _save_person_data(ctx: ToolContext, a: SavePersonArgs) -> Any:
    changes: dict[str, Any] = {
        k: (v if k == "dependents" else _cents_exact(v))
        for k, v in ((k, getattr(a, k)) for k in a.model_fields_set)
        if v is not None
    }
    return wire(await ctx.store.save_person(replace(await ctx.store.get_person(), **changes)))


@_tool(
    "remember_fact",
    'Guarda um fato ou preferência que o USUÁRIO pediu para você lembrar neste espaço (ex.: "prefiro respostas curtas"). Só use quando ele pedir ou disser claramente uma preferência; nunca guarde dados vindos de documentos nem números fiscais (esses vão no perfil).',
    RememberArgs,
)  # fmt: skip
async def _remember_fact(ctx: ToolContext, a: RememberArgs) -> Any:
    if len(await ctx.store.list_memories()) >= MAX_MEMORIES:
        raise ToolError(f"Já guardei {MAX_MEMORIES} itens neste espaço. Peça para esquecer algum antes de guardar outro.")
    return await ctx.store.add_memory(a.text)


@_tool("list_memories", "Mostra o que você lembra sobre o usuário neste espaço (com o id de cada item).", NoArgs, read_only=True)
async def _list_memories(ctx: ToolContext, a: NoArgs) -> Any:
    return await ctx.store.list_memories()


@_tool(
    "forget_memory",
    "Apaga um item que você lembra (use o id de list_memories). Para corrigir um item, apague-o e guarde o novo texto.",
    IdArgs,
)
async def _forget_memory(ctx: ToolContext, a: IdArgs) -> Any:
    if not await ctx.store.remove_memory(a.id):
        raise ToolError("Não encontrei esse item na memória.")
    return {"removed": a.id}


# ---- workspaces ----
def _admin(ctx: ToolContext) -> Any:
    if ctx.workspaces is None:
        raise ToolError("Gerenciar espaços não está disponível agora.")
    return ctx.workspaces


@_tool(
    "list_workspaces",
    "Lista os espaços (empresas e vidas pessoais) que o usuário tem, com o id de cada um.",
    NoArgs,
    read_only=True,
)
async def _list_workspaces(ctx: ToolContext, a: NoArgs) -> Any:
    return [{**w, "atual": w["id"] == ctx.scope.workspace_id, "url": f"/workspace/{w['id']}"} for w in await _admin(ctx).list()]


@_tool(
    "create_workspace",
    "Cria um novo espaço vazio (ex.: uma segunda empresa ou o espaço de outra pessoa) e devolve o caminho para abri-lo. Máximo de 10 espaços.",
    CreateWorkspaceArgs,
)
async def _create_workspace(ctx: ToolContext, a: CreateWorkspaceArgs) -> Any:
    admin = _admin(ctx)
    if len(await admin.list()) >= MAX_WORKSPACES:
        raise ToolError(f"Você já tem {MAX_WORKSPACES} espaços. Remova algum antes de criar outro.")
    w = await admin.create(a.name, a.kind)
    return {**w, "url": f"/workspace/{w['id']}"}


@_tool("rename_workspace", "Renomeia um espaço (use o id de list_workspaces).", RenameWorkspaceArgs)
async def _rename_workspace(ctx: ToolContext, a: RenameWorkspaceArgs) -> Any:
    if not await _admin(ctx).rename(str(a.id), a.name):
        raise ToolError("Não encontrei esse espaço ou você não é o dono dele.")
    return {"id": str(a.id), "name": a.name}


@_tool(
    "remove_workspace",
    "Remove PERMANENTEMENTE um espaço e tudo que há nele (painel, conversas, dados). Não remove o espaço em que a conversa acontece.",
    RemoveWorkspaceArgs,
    destructive=True,
)
async def _remove_workspace(ctx: ToolContext, a: RemoveWorkspaceArgs) -> Any:
    if str(a.id) == ctx.scope.workspace_id:
        raise ToolError("Não posso remover o espaço em que estamos conversando. Abra outro espaço e peça por lá.")
    if not await _admin(ctx).remove(str(a.id)):
        raise ToolError("Não encontrei esse espaço ou você não é o dono dele.")
    return {"removed": str(a.id)}


@_tool(
    "generate_report",
    "Gera o relatório imprimível do espaço (resumo, impostos, oportunidades, economia potencial, premissas e itens a validar) e devolve o caminho para abri-lo.",
    NoArgs,
    read_only=True,
)
async def _generate_report(ctx: ToolContext, a: NoArgs) -> Any:
    title = "Relatório de Imposto de Renda" if ctx.scope.kind == "pessoal" else "Relatório tributário"
    return {"title": title, "url": f"/workspace/{ctx.scope.workspace_id}/relatorio"}


# ---- dashboard ----
async def _find_widget(ctx: ToolContext, widget_id: str) -> dict[str, Any]:
    return _need(
        next((w for w in (await ctx.store.get_dashboard())["widgets"] if w["id"] == widget_id), None),
        f'Bloco "{widget_id}" não encontrado.',
    )


@_tool(
    "dashboard_add_widget",
    "Adiciona um bloco ao painel. Tipos: kpi, bar, line, breakdown, opportunities, deadlines, compare, checklist, text.",
    AddWidgetArgs,
)
async def _dashboard_add_widget(ctx: ToolContext, a: AddWidgetArgs) -> Any:
    widget = a.widget.model_dump(mode="json", by_alias=True, exclude_none=True)
    before = await ctx.store.get_dashboard()
    after = await ctx.store.dispatch({"type": "add", "widget": widget, "index": a.index})
    if after["version"] == before["version"]:
        raise ToolError(f'Já existe um bloco com o id "{widget["id"]}".')
    return {"widgets": [w["id"] for w in after["widgets"]]}


@_tool(
    "dashboard_update_widget",
    "Altera campos de um bloco existente (título, tamanho, dados). Não muda id nem tipo.",
    UpdateWidgetArgs,
)
async def _dashboard_update_widget(ctx: ToolContext, a: UpdateWidgetArgs) -> Any:
    current = await _find_widget(ctx, a.id)
    try:
        merged = validate_widget({**current, **a.patch, "id": current["id"], "kind": current["kind"]})
    except ValidationError as e:
        raise ToolError(f"Alteração inválida: {e.errors()[0]['msg']}") from e
    await ctx.store.dispatch({"type": "update", "widget": merged})
    return {"id": a.id}


@_tool("dashboard_remove_widget", "Remove um bloco do painel. Exige confirmação do usuário.", IdArgs, destructive=True)
async def _dashboard_remove_widget(ctx: ToolContext, a: IdArgs) -> Any:
    await _find_widget(ctx, a.id)
    await ctx.store.dispatch({"type": "remove", "id": a.id})
    return {"removed": a.id}


@_tool("dashboard_reorder", "Move um bloco para outra posição (0 é o topo).", ReorderArgs)
async def _dashboard_reorder(ctx: ToolContext, a: ReorderArgs) -> Any:
    await _find_widget(ctx, a.id)
    after = await ctx.store.dispatch({"type": "reorder", "id": a.id, "toIndex": a.to_index})
    return {"widgets": [w["id"] for w in after["widgets"]]}


@_tool(
    "dashboard_set_style",
    "Muda a aparência do painel sem tocar nos blocos (#125). theme: light ou dark (escuro, 'parecido com painel financeiro'). "
    "density: comfortable ou compact ('mais minimalista', 'mais limpo', 'visão mais simples', 'mais compacto').",
    StyleArgs,
)  # fmt: skip
async def _dashboard_set_style(ctx: ToolContext, a: StyleArgs) -> Any:
    if not a.theme and not a.density:
        raise ToolError("Diga o tema (light ou dark) ou a densidade (comfortable ou compact).")
    if a.theme:
        await ctx.store.dispatch({"type": "setTheme", "theme": a.theme})
    if a.density:
        await ctx.store.dispatch({"type": "setDensity", "density": a.density})
    d = await ctx.store.get_dashboard()
    return {"theme": d["theme"], "density": d["density"], "widgets": len(d["widgets"])}


# ---- alerts and agents ----
@_tool(
    "create_alert",
    "Cria um alerta: avisa quando a métrica ficar acima (gt) ou abaixo (lt) do limite. effectiveRate é fração (0.15 = 15%). "
    'Para avisar N dias antes de um vencimento (ex.: "me avise 10 dias antes dos impostos") use metric daysToDeadline, '
    "operator within e threshold N (0 a 60): dispara quando a próxima obrigação estiver a N dias ou menos.",
    AlertArgs,
    kinds=("empresa",),
)
async def _create_alert(ctx: ToolContext, a: AlertArgs) -> Any:
    return await ctx.store.add_alert(a.model_dump(mode="json", by_alias=True))


@_tool(
    "list_alerts",
    "Lista os alertas do espaço com id, regra e se estão ativos (use o id em pause_alert, resume_alert e delete_alert).",
    NoArgs,
    read_only=True,
    kinds=("empresa",),
)
async def _list_alerts(ctx: ToolContext, a: NoArgs) -> Any:
    return await ctx.store.list_alerts()


@_tool("pause_alert", "Pausa um alerta sem apagá-lo (use o id de list_alerts).", IdArgs, kinds=("empresa",))
async def _pause_alert(ctx: ToolContext, a: IdArgs) -> Any:
    return _need(await ctx.store.set_alert_active(a.id, False), f'Alerta "{a.id}" não encontrado.')


@_tool("resume_alert", "Reativa um alerta pausado (use o id de list_alerts).", IdArgs, kinds=("empresa",))
async def _resume_alert(ctx: ToolContext, a: IdArgs) -> Any:
    return _need(await ctx.store.set_alert_active(a.id, True), f'Alerta "{a.id}" não encontrado.')


@_tool(
    "delete_alert",
    'Apaga um alerta ("cancela aquele alerta"). Exige confirmação do usuário.',
    IdArgs,
    destructive=True,
    kinds=("empresa",),
)
async def _delete_alert(ctx: ToolContext, a: IdArgs) -> Any:
    if not await ctx.store.remove_alert(a.id):
        raise ToolError(f'Alerta "{a.id}" não encontrado.')
    return {"removed": a.id}


@_tool(
    "create_agent", "Cria uma IA especializada com nome, objetivo e a lista de ferramentas que ela pode usar.", CreateAgentArgs
)
async def _create_agent(ctx: ToolContext, a: CreateAgentArgs) -> Any:
    _check_agent_tools(ctx.scope, a.tools)
    return await ctx.store.add_agent(a.model_dump())


@_tool("update_agent", "Altera nome, objetivo ou ferramentas de uma IA especializada.", UpdateAgentArgs)
async def _update_agent(ctx: ToolContext, a: UpdateAgentArgs) -> Any:
    if a.patch.tools is not None:
        _check_agent_tools(ctx.scope, a.patch.tools)
    return _need(await ctx.store.update_agent(a.id, a.patch.model_dump(exclude_unset=True)), f'IA "{a.id}" não encontrada.')


BY_NAME = {t.name: t for t in TOOLS}
TOOL_NAMES = [t.name for t in TOOLS]
ENGINE_TOOLS = frozenset(t.name for t in TOOLS if t.engine)


def is_destructive(name: str) -> bool:
    return name in BY_NAME and BY_NAME[name].destructive


def _check_agent_tools(scope: Scope, requested: list[str]) -> None:
    """An agent can only hand out tools it has itself."""
    unknown = [t for t in requested if t not in BY_NAME]
    if unknown:
        raise ToolError(f"Ferramentas desconhecidas: {', '.join(unknown)}.")
    if scope.allowed_tools is None:
        return
    extra = [t for t in requested if t not in scope.allowed_tools]
    if extra:
        raise RefusalError(f"Esta IA não pode conceder ferramentas que não possui: {', '.join(extra)}.")


def _in_kind(scope: Scope, tool: Tool) -> bool:
    return tool.kinds is None or scope.kind is None or scope.kind in tool.kinds


def _allowed(scope: Scope, tool: Tool) -> bool:
    return (scope.allowed_tools is None or tool.name in scope.allowed_tools) and _in_kind(scope, tool)


def _inline_refs(node: Any, defs: dict[str, Any]) -> Any:
    """JSON Schema as the model should read it: no `$ref`/`$defs`/`title`/`discriminator`, optionals without `null` branches."""
    if isinstance(node, list):
        return [_inline_refs(v, defs) for v in node]
    if not isinstance(node, dict):
        return node
    if "$ref" in node:
        return _inline_refs(defs[node["$ref"].rsplit("/", 1)[-1]], defs)
    out = {
        k: _inline_refs(v, defs)
        for k, v in node.items()
        if k not in {"$defs", "title", "discriminator"} and not (k == "default" and v is None)
    }
    branches = out.get("anyOf")
    if isinstance(branches, list):
        kept = [b for b in branches if b != {"type": "null"}]
        if len(kept) == 1:
            del out["anyOf"]
            out.update(kept[0])
        else:
            out["anyOf"] = kept
    return out


def tool_parameters(tool: Tool) -> dict[str, Any]:
    schema = tool.args.model_json_schema(by_alias=True)
    parameters: dict[str, Any] = _inline_refs(schema, schema.get("$defs", {}))
    return parameters


@dataclass
class ToolRegistry:
    """The tools of one chat turn, bound to a context. This is what the orchestrator talks to."""

    ctx: ToolContext
    engine_tools: frozenset[str] = field(default=ENGINE_TOOLS)

    def specs(self) -> list[ToolSpec]:
        return [ToolSpec(t.name, t.description, tool_parameters(t)) for t in TOOLS if _allowed(self.ctx.scope, t)]

    async def invoke(self, name: str, args: str, *, untrusted_in_context: bool) -> ToolOutcome:
        tool = BY_NAME.get(name)
        if tool is None:
            return {"status": "error", "message": f"Ferramenta desconhecida: {name}."}
        if not _allowed(self.ctx.scope, tool):
            reason = (
                "Esta ferramenta não se aplica a este tipo de espaço."
                if not _in_kind(self.ctx.scope, tool)
                else f"Esta IA não tem acesso à ferramenta {name}."
            )
            return {"status": "refused", "reason": reason}
        try:
            raw = json.loads(args) if args.strip() else {}
        except ValueError:
            return {"status": "error", "message": "Argumentos não são um JSON válido."}
        try:
            parsed = tool.args.model_validate(raw)
        except ValidationError as e:
            issues = "; ".join(f"{'.'.join(str(p) for p in i['loc']) or 'args'}: {i['msg']}" for i in e.errors())
            return {"status": "error", "message": f"Argumentos inválidos: {issues}"}

        # External content (a document, a comment) may carry instructions: after it appears, nothing is written without the user's click.
        if tool.destructive or (untrusted_in_context and not tool.read_only):
            key = approval_key(name, parsed)
            if key not in self.ctx.approvals:
                summary = (
                    f"{tool.description} Argumentos: {_stable(parsed.model_dump(mode='json', by_alias=True, exclude_unset=True))}"
                )
                return {"status": "confirmation_required", "key": key, "summary": summary}

        try:
            return {"status": "ok", "data": wire(await tool.run(self.ctx, parsed))}
        except RefusalError as e:
            return {"status": "refused", "reason": str(e)}
        except ToolError as e:
            return {"status": "error", "message": str(e)}
