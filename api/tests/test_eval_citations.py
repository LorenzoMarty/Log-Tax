"""The citation verifier of the AI evaluation (#97, #114): the AI may cite only the sources the engine returned."""

from typing import Any

from app.chat.eval.cases import EVAL_CASES, EvalCase
from app.chat.eval.citations import check_citations, cited_articles, cited_references, sources_in
from app.chat.eval.run import run_eval
from app.chat.types import LlmTurn, Msg, ToolCall, ToolSpec

ENGINE_SOURCES = [
    "LC 123/2006 com a redação da LC 155/2016, art. 18 e Anexos I a V: https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp155.htm",
    "Lei 9.249/1995 (art. 3, 15 e 20), Lei 9.430/1996, Lei 7.689/1988 art. 3: https://www.planalto.gov.br/ccivil_03/leis/l9249.htm",
    "LC 214/2025 (transição, arts. 343 a 348 e 359 a 361)",
    "Leis 10.637/2002 e 10.833/2003; Resolução CGSN 140/2018, art. 109; IN RFB 2.005/2021",
    "INSS, teto (Portaria Interministerial MPS/MF nº 13/2026)",
]


def test_it_extracts_the_legal_references_written_in_the_usual_ways() -> None:
    assert cited_references("Pela LC 123/2006 e pela Lei Complementar nº 155, de 2016.") == {"lc 123/2006", "lc 155/2016"}
    assert cited_references("Lei nº 9.249, de 26 de dezembro de 1995") == {"lei 9249/1995"}
    assert cited_references("Leis 10.637/2002 e 10.833/2003") == {"lei 10637/2002", "lei 10833/2003"}
    assert cited_references("Resolução CGSN 140/2018 e IN RFB 2.005/2021") == {"res 140/2018", "in 2005/2021"}
    assert cited_references("Portaria Interministerial MPS/MF nº 13/2026") == {"portaria 13/2026"}
    assert cited_references("Decreto-Lei 5.452/1943, Decreto 9.580/2018, EC 132/2023") == {
        "decreto-lei 5452/1943",
        "decreto 9580/2018",
        "ec 132/2023",
    }
    assert cited_references("Sem lei alguma: 12/2024 é só uma data e R$ 100/2024 também.") == set()


def test_it_extracts_the_articles_with_lists_ranges_and_suffixes() -> None:
    assert cited_articles("art. 18-A") == {"18-A"}
    assert cited_articles("arts. 15 e 20, e o art. 3") == {"15", "20", "3"}
    assert cited_articles("arts. 343 a 348 e 359 a 361") == {str(n) for n in (*range(343, 349), *range(359, 362))}
    assert cited_articles("artigo 52, I") == {"52"}
    assert cited_articles("nenhum artigo aqui, só 12 itens") == set()


def test_a_reply_that_cites_only_what_the_engine_returned_passes() -> None:
    reply = "Segundo a LC 123/2006 (art. 18) e a Lei nº 9.249, de 1995, art. 15, o cálculo segue o Anexo da regra."
    assert check_citations(reply, ENGINE_SOURCES) == []
    assert check_citations("Calculei com as regras do motor, sem citar lei.", []) == []


def test_a_reply_that_cites_an_invented_law_or_article_fails_naming_each_one() -> None:
    failures = check_citations("Conforme a Lei 8.666/1993 e a LC 123/2006, art. 99.", ENGINE_SOURCES)
    assert failures == [
        "cita a fonte lei 8666/1993, que não veio do motor",
        "cita o art. 99, que não veio do motor",
    ]


def test_with_no_source_from_the_engine_any_citation_fails() -> None:
    assert check_citations("Veja a LC 123/2006.", []) == ["cita a fonte lc 123/2006, que não veio do motor"]


def test_a_source_the_user_wrote_may_be_repeated() -> None:
    assert check_citations("Sim, a LC 224/2025 se aplica.", [], user_text="E a LC 224/2025?") == []


def test_sources_are_collected_from_any_depth_of_the_tool_outcome() -> None:
    outcome: Any = {"status": "ok", "data": {"rules": [{"source": "A"}], "steps": [{"x": {"source": "B"}}, {"source": 3}]}}
    assert sources_in(outcome) == ["A", "B"]
    assert sources_in({"status": "error", "message": "falhou"}) == []


def say(text: str) -> LlmTurn:
    return LlmTurn(text=text, items=[{"type": "message", "text": text}])


def llm_of(text: str, tool: str | None = "explain_result") -> Any:
    """Scripted model: calls `tool` (explain_result by default) once, then answers `text`. No network."""
    steps = {"n": 0}

    class Fake:
        async def respond(self, *, system: str, history: list[Msg], tools: list[ToolSpec]) -> LlmTurn:
            steps["n"] += 1
            if steps["n"] == 1 and tool:
                return LlmTurn(
                    "", [ToolCall("c1", tool, '{"subject": "diagnosis"}')], [{"type": "function_call", "call_id": "c1"}]
                )
            return say(text)

    return Fake()


def citation_case() -> EvalCase:
    return next(c for c in EVAL_CASES if c.id == "explain-cites-engine-source")


async def test_the_suite_has_a_case_that_runs_the_verifier_on_explain_result() -> None:
    case = citation_case()
    assert case.cites_only_engine_sources and case.expect_tools == ["explain_result"]


async def test_scenario_cites_only_the_engine_source_passes() -> None:
    reply = "O cálculo segue a LC 123/2006, art. 18, com a alíquota da faixa."
    report = await run_eval(llm_of(reply), [citation_case()], "scripted")
    assert report.results[0].passed, report.results[0].failures


async def test_scenario_cites_an_invented_source_fails() -> None:
    reply = "O cálculo segue a Lei 8.666/1993, art. 99, com a alíquota da faixa."
    report = await run_eval(llm_of(reply), [citation_case()], "scripted")
    failures = report.results[0].failures
    assert not report.results[0].passed
    assert "cita a fonte lei 8666/1993, que não veio do motor" in failures and "cita o art. 99, que não veio do motor" in failures


async def test_scenario_cites_a_law_without_calling_explain_result_fails() -> None:
    report = await run_eval(llm_of("Pela LC 123/2006 você paga menos.", tool=None), [citation_case()], "scripted")
    assert not report.results[0].passed
    assert any("não veio do motor" in f for f in report.results[0].failures)
