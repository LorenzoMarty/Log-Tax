"""Service provider comparison: self-employed vs MEI vs Simples. Expected values worked by hand from the published tables."""

from decimal import Decimal as D
from typing import Any

from fastapi.testclient import TestClient

from app.engine.prestador import PrestadorComparison, PrestadorInput, compare_prestador, monthly_ir_cents
from app.engine.result import InsufficientData, NotApplicable, Ok
from app.engine.rules_data import default_rulebook

BOOK = default_rulebook()


def run(revenue: str, **patch: Any) -> PrestadorComparison:
    base: dict[str, Any] = {"monthly_revenue": D(revenue), "fator_r": True}
    result = compare_prestador(BOOK, "2026-11", PrestadorInput(**{**base, **patch}))
    assert isinstance(result, Ok)
    return result.value


def totals(c: PrestadorComparison) -> dict[str, D]:
    return {o.option: o.monthly_total for o in c.options}


def test_low_revenue_the_reducer_zeroes_the_carne_leao_and_the_mei_wins() -> None:
    # R$ 4.000: INSS 20% = 800; base 3.200 -> 15% - 394,16 = 85,84, fully cut by the R$ 312,89 reducer
    c = run("4000")
    assert totals(c) == {"pessoa_fisica": D("800"), "mei": D("86.05"), "simples": D("363.20")}
    assert c.best == "mei"


def test_above_the_reducer_the_carne_leao_pays_the_full_table() -> None:
    # R$ 8.000: INSS 1.600; base 6.400 -> 27,5% - 908,73 = 851,27; no reducer above R$ 7.350
    c = run("8000")
    pf, mei, simples = c.options
    assert pf.monthly_total == D("2451.27") and [line.amount for line in pf.breakdown] == [D("1600"), D("851.27")]
    assert mei.eligible is False and "limite" in mei.assumptions[1]  # R$ 96.000 a year: over the MEI limit
    # Fator R at exactly 28%: Anexo III, 1st band 6% of 8.000 = 480; pro-labore 2.240 -> INSS 246,40; IR 0
    assert [line.amount for line in simples.breakdown] == [D("480"), D("246.40")]
    assert c.best == "simples"


def test_simplified_inss_plan_and_dependents() -> None:
    c = run("4000", inss_plan="simplificado", dependents=1)
    assert c.options[0].breakdown[0].amount == D("178.31")  # 11% of the R$ 1.621 minimum wage
    assert c.options[0].monthly_total == D("178.31")


def test_expenses_reduce_the_net_not_the_taxes_of_mei() -> None:
    c = run("4000", deductible_expenses=D("1000"))
    mei = c.options[1]
    assert mei.net_monthly == D("2913.95") and mei.monthly_total == D("86.05")


def test_annex_iv_adds_the_employer_inss_on_the_pro_labore() -> None:
    c = run("8000", fator_r=False, annex="IV", pro_labore=D("2000"))
    simples = c.options[2]
    assert [line.tax for line in simples.breakdown] == ["DAS", "INSS", "CPP"]
    assert simples.breakdown[2].amount == D("400")  # 20% of R$ 2.000


def test_reducer_phase_out_between_five_and_seven_thousand_three_hundred_fifty() -> None:
    table = BOOK.require("irpf-tabela-mensal", "2026-11").data
    # income R$ 6.000: reduction 978,62 - 0,133145 x 6.000 = 179,75; tax on base 5.000 = 466,27
    assert monthly_ir_cents(table, 600_000, 500_000) == 46_627 - 17_975
    assert monthly_ir_cents(table, 735_000, 600_000) == 74_127  # at R$ 7.350 the reducer is down to zero: full table


def test_before_2026_there_is_no_reducer_data_and_the_answer_says_so() -> None:
    r = compare_prestador(BOOK, "2025-11", PrestadorInput(D("4000"), fator_r=True))
    assert isinstance(r, NotApplicable)


def test_missing_annex_and_over_simples_limit() -> None:
    assert compare_prestador(BOOK, "2026-11", PrestadorInput(D("4000"))) == InsufficientData(["anexo"])
    c = run("400001")
    assert c.options[2].eligible is False and c.best == "pessoa_fisica"


def test_route(signed_in: TestClient, anonymous: TestClient) -> None:
    assert anonymous.post("/v1/engine/prestador", json={}).status_code == 401
    r = signed_in.post("/v1/engine/prestador", json={"competence": "2026-11", "monthlyRevenue": "4000", "fatorR": True})
    assert r.status_code == 200
    value = r.json()["value"]
    assert value["best"] == "mei" and value["options"][0]["monthlyTotal"] == "800"
    assert value["rulesUsed"] and value["disclaimer"]
    bad = signed_in.post("/v1/engine/prestador", json={"monthlyRevenue": "-1"})
    assert bad.status_code == 422
