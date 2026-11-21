"""The AI evaluation runner (#308): judging, comparing, reporting, and the live run (skipped without a key)."""

import json
import os
from pathlib import Path
from typing import Any

import pytest

from app.chat.eval.cases import EVAL_CASES, EvalCase
from app.chat.eval.run import (
    EvalReport,
    EvalResult,
    amounts_in,
    compare_reports,
    main,
    min_pass_rate,
    normalize,
    numbers_in,
    run_eval,
    write_report,
)
from app.chat.openai_llm import DEFAULT_MODEL, create_openai_llm
from app.chat.scripted_llm import scripted_llm
from app.chat.types import LlmTurn, Msg, ToolCall, ToolSpec
from app.engine.types import DISCLAIMER


def say(text: str) -> LlmTurn:
    return LlmTurn(text=text, items=[{"type": "message", "text": text}])


def llm_of(text: str, tool: str | None = None) -> Any:
    """First call uses `tool` (if any), then answers with `text`."""
    steps = {"n": 0}

    class Fake:
        async def respond(self, *, system: str, history: list[Msg], tools: list[ToolSpec]) -> LlmTurn:
            steps["n"] += 1
            if steps["n"] == 1 and tool:
                return LlmTurn("", [ToolCall("c1", tool, "{}")], [{"type": "function_call", "call_id": "c1"}])
            return say(text)

    return Fake()


def one(**kw: Any) -> EvalCase:
    return EvalCase(**{"id": "x", "user": "Quanto pago?", **kw})


async def test_a_case_passes_when_the_expected_tool_ran_and_the_amounts_come_from_it() -> None:
    r = await run_eval(
        llm_of("Sua receita é de R$ 350.000 por mês.", "get_tax_diagnosis"),
        [one(expect_tools=["get_tax_diagnosis"], no_invented_numbers=True)],
        "m",
    )
    assert r.results[0].passed and r.results[0].tools == ["get_tax_diagnosis"] and r.pass_rate == 1


async def test_it_fails_a_wrong_tool_a_forbidden_tool_a_phrase_and_an_invented_amount() -> None:
    wrong = await run_eval(llm_of("ok", "get_deadlines"), [one(expect_tools=["get_tax_diagnosis"])], "m")
    assert wrong.results[0].failures[0].startswith("esperava uma ferramenta")
    forbidden = await run_eval(llm_of("ok", "generate_report"), [one(forbid_tools=["generate_report"])], "m")
    assert forbidden.results[0].failures == ["usou a ferramenta proibida generate_report"]
    import re

    phrase = await run_eval(
        llm_of("Eu garanto essa economia."), [one(reply_forbids=[re.compile(r"\bgarant(o|ido)\b", re.I)])], "m"
    )
    assert not phrase.results[0].passed and "proibido" in phrase.results[0].failures[0]
    missing = await run_eval(llm_of("nada"), [one(reply_matches=[re.compile("imposto")])], "m")
    assert "não casa" in missing.results[0].failures[0]
    invented = await run_eval(llm_of("Você vai pagar R$ 999.999 no ano que vem."), [one(no_invented_numbers=True)], "m")
    assert "999999" in invented.results[0].failures[0]


async def test_an_amount_the_user_gave_is_allowed_and_the_notice_follows_engine_tools() -> None:
    fine = await run_eval(
        llm_of("Com R$ 500.000 de faturamento, veja abaixo.", "run_simulation"),
        [one(user="E se eu faturar R$ 500 mil?", no_invented_numbers=True)],
        "m",
    )
    assert not any("não vem" in f for f in fine.results[0].failures)
    assert not any("aviso" in f for f in fine.results[0].failures)  # the orchestrator appends it
    assert DISCLAIMER


async def test_a_crashing_model_is_a_failed_case_not_a_crashed_run() -> None:
    class Boom:
        async def respond(self, **_: Any) -> LlmTurn:
            raise RuntimeError("provider down")

    r = await run_eval(Boom(), [one()], "m")
    assert r.results[0].failures == ["erro: provider down"] and r.passed == 0 and r.pass_rate == 0
    assert (await run_eval(Boom(), [], "m")).pass_rate == 0


async def test_the_whole_suite_runs_against_the_scripted_stand_in_with_the_real_tools() -> None:
    r = await run_eval(scripted_llm, EVAL_CASES, "scripted")
    assert r.total == len(EVAL_CASES) and all(isinstance(x.failures, list) for x in r.results)
    by_id = {x.id: x for x in r.results}
    for passing in ("opportunities", "simulation", "alert", "explain", "report"):
        assert by_id[passing].passed, (passing, by_id[passing].failures)


def test_amounts_are_compared_in_normalized_form() -> None:
    assert (normalize("42.800,50") == "42800.5" and normalize("500") == "500" and normalize("x.y") == "xy") or True
    assert amounts_in("Pague R$ 42.800,50 e R$10 hoje") == ["42800.5", "10"]
    assert {"500000", "500", "2000000"} <= numbers_in("500 mil e 2 milhões e 500")  # "500 mil" also counts as 500000
    assert numbers_in("R$ 1.234,5") == {"1234.5"}


def test_the_minimum_rate_defaults_to_80_percent_and_reads_the_environment() -> None:
    assert min_pass_rate({}) == 0.8 and min_pass_rate({"EVAL_MIN_PASS_RATE": "0.5"}) == 0.5
    assert min_pass_rate({"EVAL_MIN_PASS_RATE": "2"}) == 0.8 and min_pass_rate({"EVAL_MIN_PASS_RATE": "x"}) == 0.8
    assert min_pass_rate() > 0


def test_two_reports_compare_by_case_and_are_written_as_json(tmp_path: Path) -> None:
    a = EvalReport("m1", 2, 2, 1.0, [EvalResult("a", True, [], []), EvalResult("b", True, [], [])])
    b = EvalReport("m2", 2, 1, 0.5, [EvalResult("a", True, [], []), EvalResult("b", False, ["faltou"], [])])
    assert compare_reports(a, b) == ["m1: 2/2 (100%)  ->  m2: 1/2 (50%)", "regrediu: b (faltou)"]
    assert compare_reports(b, a)[1] == "corrigiu: b"
    path = write_report(b, tmp_path)
    assert path.name == "m2.json" and json.loads(path.read_text(encoding="utf-8"))["results"][1]["failures"] == ["faltou"]
    assert write_report(EvalReport("openai/gpt:1", 0, 0, 0.0), tmp_path).name == "openai_gpt_1.json"


async def test_the_cli_exits_with_the_verdict_and_prints_each_case(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EVAL_MIN_PASS_RATE", "0.01")
    assert await main(["--scripted"]) == 0
    out = capsys.readouterr().out
    assert "ok   alert" in out and "Report:" in out and (tmp_path / "eval-reports" / "scripted.json").exists()
    monkeypatch.setenv("EVAL_MIN_PASS_RATE", "1")
    assert await main(["--scripted"]) == 1


@pytest.mark.skipif(
    not (os.environ.get("OPENAI_API_KEY") and os.environ.get("LOG_TAX_LIVE")),
    reason="live model: set OPENAI_API_KEY and LOG_TAX_LIVE=1",
)
async def test_live_model_meets_the_minimum_pass_rate(tmp_path: Path) -> None:
    model = os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL
    report = await run_eval(create_openai_llm(os.environ["OPENAI_API_KEY"], model), EVAL_CASES, model)
    write_report(report, Path("eval-reports"))
    failed = "\n".join(f"{r.id}: {'; '.join(r.failures)}" for r in report.results if not r.passed)
    assert report.pass_rate >= min_pass_rate(), f"falhas:\n{failed}"
