"""Runs the evaluation cases against a model with the real tools and the real engine, and judges each one (port of `eval/run.ts`).

    poetry run python -m app.chat.eval.run              # the model of OPENAI_MODEL (or the default); needs OPENAI_API_KEY
    poetry run python -m app.chat.eval.run --scripted   # the deterministic stand-in (no key, no network)

The report lands in `eval-reports/<model>.json`, so changing OPENAI_MODEL gives a report you can compare with
`compare_reports`. Exit code 1 when the pass rate is under the minimum (EVAL_MIN_PASS_RATE, default 80%).
"""

import asyncio
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

from app.chat.eval.cases import EVAL_CASES, EvalCase
from app.chat.eval.citations import check_citations, sources_in
from app.chat.openai_llm import DEFAULT_MODEL, create_openai_llm
from app.chat.orchestrator import run_turn
from app.chat.scripted_llm import scripted_llm
from app.chat.store import MemoryStore, Scope, ToolContext
from app.chat.tools import ToolRegistry
from app.chat.types import LlmClient
from app.engine.real_engine import RealEngine
from app.engine.seed import seed_company
from app.engine.types import DISCLAIMER

ENGINE_TOOLS_THAT_NEED_THE_NOTICE = ("get_tax_diagnosis", "run_simulation", "list_opportunities")
_AMOUNT = re.compile(r"R\$\s?(\d[\d.]*(?:,\d+)?)")
_NUMBER = re.compile(r"(\d[\d.]*(?:,\d+)?)(\s*(mil\b|milh))?")
_ANY_NUMBER = re.compile(r"-?\d+(?:\.\d+)?")


@dataclass
class EvalResult:
    id: str
    passed: bool
    failures: list[str]
    tools: list[str]


@dataclass
class EvalReport:
    model: str
    total: int
    passed: int
    pass_rate: float
    results: list[EvalResult] = field(default_factory=list)


def min_pass_rate(env: dict[str, str] | None = None) -> float:
    """Minimum share of cases that must pass (EVAL_MIN_PASS_RATE overrides it)."""
    raw = (os.environ if env is None else env).get("EVAL_MIN_PASS_RATE", "")
    try:
        value = float(raw)
    except ValueError:
        return 0.8
    return value if 0 < value <= 1 else 0.8


def _canon(number: Decimal) -> str:
    return format(number.normalize(), "f")


def normalize(amount: str) -> str:
    """'R$ 42.800,50' -> '42800.5': the comparable form of an amount."""
    try:
        return _canon(Decimal(amount.replace(".", "").replace(",", ".")))
    except InvalidOperation:
        return amount


def amounts_in(text: str) -> list[str]:
    return [normalize(m.group(1)) for m in _AMOUNT.finditer(text)]


def numbers_in(text: str) -> set[str]:
    """Every number written in a message or tool result in normalized form; '500 mil' also counts as 500000."""
    out: set[str] = set()
    for m in _NUMBER.finditer(text):
        n = normalize(m.group(1))
        out.add(n)
        if m.group(3):
            out.add(_canon(Decimal(n) * (1_000_000 if m.group(3).startswith("milh") else 1_000)))
    return out


async def run_eval(llm: LlmClient, cases: list[EvalCase], model: str) -> EvalReport:
    results: list[EvalResult] = []
    for case in cases:
        store = MemoryStore(company=seed_company())
        tools = ToolRegistry(ToolContext(Scope("eval", "Minha Empresa", "empresa"), store, RealEngine()))
        failures: list[str] = []
        used: list[str] = []
        try:
            r = await run_turn(
                llm=llm, tools=tools, history=list(case.history), user_message=case.user, workspace_name="Minha Empresa"
            )
            used = [e.name for e in r.events]
            if case.expect_tools and not any(t in used for t in case.expect_tools):
                failures.append(f"esperava uma ferramenta entre {', '.join(case.expect_tools)}; usou [{', '.join(used)}]")
            failures += [f"usou a ferramenta proibida {t}" for t in case.forbid_tools if t in used]
            failures += [f"resposta não casa com {p.pattern}" for p in case.reply_matches if not p.search(r.text)]
            failures += [f"resposta casa com o padrão proibido {p.pattern}" for p in case.reply_forbids if p.search(r.text)]
            ran_engine = any(e.outcome["status"] == "ok" and e.name in ENGINE_TOOLS_THAT_NEED_THE_NOTICE for e in r.events)
            if ran_engine and DISCLAIMER not in r.text:
                failures.append("faltou o aviso de estimativa")
            if case.cites_only_engine_sources:
                engine_sources = [s for e in r.events if e.name == "explain_result" for s in sources_in(e.outcome)]
                failures += check_citations(r.text, engine_sources, case.user)
            if case.no_invented_numbers:
                outcomes = " ".join(json.dumps(e.outcome, ensure_ascii=False) for e in r.events)
                known = numbers_in(case.user + outcomes)
                from_tools = {_canon(Decimal(m.group())) for m in _ANY_NUMBER.finditer(outcomes)}
                failures += [
                    f"valor R$ {a} não vem de ferramenta nem do usuário"
                    for a in amounts_in(r.text.replace(DISCLAIMER, ""))
                    if a not in known and a not in from_tools
                ]
        except Exception as exc:
            failures.append(f"erro: {exc}")
        results.append(EvalResult(case.id, not failures, failures, used))
    passed = sum(1 for r in results if r.passed)
    return EvalReport(model, len(results), passed, passed / len(results) if results else 0.0, results)


def compare_reports(a: EvalReport, b: EvalReport) -> list[str]:
    """Side-by-side of two runs (e.g. two models): which cases changed."""
    before_rate, after_rate = f"{a.pass_rate * 100:.0f}%", f"{b.pass_rate * 100:.0f}%"
    lines = [f"{a.model}: {a.passed}/{a.total} ({before_rate})  ->  {b.model}: {b.passed}/{b.total} ({after_rate})"]
    for r in b.results:
        before = next((x for x in a.results if x.id == r.id), None)
        if before and before.passed != r.passed:
            lines.append(
                f"{'corrigiu' if r.passed else 'regrediu'}: {r.id}" + ("" if r.passed else f" ({'; '.join(r.failures)})")
            )
    return lines


def write_report(report: EvalReport, directory: Path = Path("eval-reports")) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{re.sub(r'[^A-Za-z0-9_.-]', '_', report.model)}.json"
    path.write_text(json.dumps(asdict(report), indent=2, ensure_ascii=False), encoding="utf-8")
    return path


async def main(argv: list[str]) -> int:
    scripted = "--scripted" in argv
    model = "scripted" if scripted else os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL
    llm: LlmClient = scripted_llm if scripted else create_openai_llm(os.environ.get("OPENAI_API_KEY", ""), model)
    report = await run_eval(llm, EVAL_CASES, model)
    path = write_report(report)
    for r in report.results:
        print(f"{'ok  ' if r.passed else 'FAIL'} {r.id}" + ("" if r.passed else f": {'; '.join(r.failures)}"))
    print(f"{report.passed}/{report.total} ({report.pass_rate * 100:.0f}%), minimum {min_pass_rate() * 100:.0f}%. Report: {path}")
    return 0 if report.pass_rate >= min_pass_rate() else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
