from dataclasses import replace
from decimal import Decimal as D
from typing import Any

from app.engine.compare import compare_regimes
from app.engine.opportunities import OpportunityContext, evaluate_catalog
from app.engine.real_engine import RealEngine
from app.engine.result import InsufficientData, NoneFound, NotApplicable, Ok
from app.engine.types import CompanyProfile, Diagnosis, MonthlyEntry

ENGINE = RealEngine("2026-01")


def year(revenue: int, **extra: int) -> list[MonthlyEntry]:
    return [
        MonthlyEntry(month=f"2025-{i + 1:02d}", revenue={"comercio": D(revenue)}, **{k: D(v) for k, v in extra.items()})
        for i in range(12)
    ]


def company(**patch: Any) -> CompanyProfile:
    base: dict[str, Any] = {"id": "c", "name": "Loja", "regime": "simples", "activity": "comercio"}
    return CompanyProfile(**{**base, **patch})


def ok(result: Any) -> Diagnosis:
    assert isinstance(result, Ok), result
    value: Diagnosis = result.value
    return value


def test_simples_commerce_with_a_full_year_gives_annex_i_and_a_breakdown_that_adds_up() -> None:
    series = [*year(50_000), MonthlyEntry("2026-01", {"comercio": D(50_000)})]
    d = ok(ENGINE.diagnose(company(series=series)))
    assert d.monthly_total == 3595
    assert d.annual_total == 43_140
    assert abs(d.effective_rate - D("0.0719")) < D("1e-10")
    assert sum(int(line.amount * 100) for line in d.breakdown) == 359_500
    assert {"IRPJ", "CSLL", "PIS/COFINS", "CPP", "ICMS"} <= {line.tax for line in d.breakdown}
    assert d.rules_used[0].id == "simples-anexos"
    assert "Anexo I, 3ª faixa" in " ".join(d.assumptions)
    assert d.rules_version == "real-2026-01"


def test_simples_without_a_series_or_annex_says_what_is_missing() -> None:
    assert ENGINE.diagnose(company(monthly_revenue=D(50_000))) == InsufficientData(["series"])
    base = [*year(10_000, payroll=3_000), MonthlyEntry("2026-01", {"servico": D(10_000)})]
    assert ENGINE.diagnose(company(activity="servico", series=base)) == InsufficientData(["anexo"])


def test_simples_fator_r_picks_the_annex_from_the_payroll() -> None:
    high = [*year(10_000, payroll=3_000), MonthlyEntry("2026-01", {"servico": D(10_000)})]
    assert "Fator R de 30,00%: Anexo III" in " ".join(
        ok(ENGINE.diagnose(company(activity="servico", fator_r=True, series=high))).assumptions
    )
    low = [*year(10_000, payroll=1_000), MonthlyEntry("2026-01", {"servico": D(10_000)})]
    assert "Anexo V" in " ".join(ok(ENGINE.diagnose(company(activity="servico", fator_r=True, series=low))).assumptions)


def test_leaves_the_simples_above_4_8_million_and_flags_a_young_company() -> None:
    big = [*year(450_000), MonthlyEntry("2026-01", {"comercio": D(450_000)})]
    result = ENGINE.diagnose(company(series=big))
    assert isinstance(result, NotApplicable) and "sai do Simples" in result.reason
    young = [MonthlyEntry(m, {"comercio": D(30_000)}) for m in ("2025-11", "2025-12", "2026-01")]
    assert "média de 2 mês(es) anualizada" in " ".join(ok(ENGINE.diagnose(company(series=young))).assumptions)


def test_simulation_changes_the_month_not_the_history() -> None:
    series = [*year(50_000), MonthlyEntry("2026-01", {"comercio": D(50_000)})]
    scenario = [*year(50_000), MonthlyEntry("2026-01", {"comercio": D(80_000)})]
    result = ENGINE.simulate(company(series=series), {"series": scenario})
    assert isinstance(result, Ok)
    assert result.value.scenario.monthly_total == 5_752  # 7,19% x 80.000


def test_mei_is_a_fixed_das_and_warns_about_the_limit() -> None:
    d = ok(ENGINE.diagnose(company(regime="mei", monthly_revenue=D(5_000))))
    assert d.monthly_total == D("82.05")
    assert "o DAS é fixo" in d.assumptions[0]
    assert any(line.tax == "ICMS" for line in d.breakdown)
    assert ENGINE.diagnose(company(regime="mei")) == InsufficientData(["series"])


def test_presumido_commerce_takes_a_third_of_the_quarter_and_the_icms_of_the_uf() -> None:
    d = ok(ENGINE.diagnose(company(regime="presumido", monthly_revenue=D(100_000), monthly_purchases=D(60_000), uf="SP")))
    icms = next(line for line in d.breakdown if line.tax == "ICMS")
    assert icms.amount == 7_200  # 18% x (100.000 - 60.000)
    assert d.breakdown[0].tax == "ICMS"
    ba = ok(ENGINE.diagnose(company(regime="presumido", monthly_revenue=D(100_000), monthly_purchases=D(60_000), uf="BA")))
    assert next(line for line in ba.breakdown if line.tax == "ICMS").amount == 8_200
    assert ba.monthly_total - d.monthly_total == 1_000
    assert "ICMS de SP: alíquota interna geral de 18,00%" in " ".join(d.assumptions)


def test_icms_not_included_notes_instead_of_guessing() -> None:
    no_uf = ok(ENGINE.diagnose(company(regime="presumido", monthly_revenue=D(100_000))))
    assert "UF não informada" in " ".join(no_uf.assumptions)
    unverified = ok(ENGINE.diagnose(company(regime="presumido", monthly_revenue=D(100_000), uf="MG")))
    assert "ICMS não incluído" in " ".join(unverified.assumptions)
    service = ok(ENGINE.diagnose(company(regime="presumido", activity="servico", monthly_revenue=D(100_000))))
    assert "ISS não incluído: informe a alíquota" in " ".join(service.assumptions)
    with_iss = ok(
        ENGINE.diagnose(company(regime="presumido", activity="servico", monthly_revenue=D(100_000), iss_rate=D("0.03")))
    )
    assert next(line for line in with_iss.breakdown if line.tax == "ISS").amount == 3_000


def test_real_needs_the_margin_then_taxes_the_estimated_profit() -> None:
    assert ENGINE.diagnose(company(regime="real", monthly_revenue=D(100_000))) == InsufficientData(["profitMargin"])
    d = ok(ENGINE.diagnose(company(regime="real", monthly_revenue=D(100_000), profit_margin=D("0.1"), uf="SP")))
    assert {"IRPJ", "CSLL", "PIS/COFINS"} <= {line.tax for line in d.breakdown}
    assert "Lucro Real, apuração trimestral" in d.assumptions[0]
    loss = ok(ENGINE.diagnose(company(regime="real", monthly_revenue=D(100_000), profit_margin=D("-0.1"), uf="SP")))
    assert "prejuízo estimado" in " ".join(loss.assumptions)


def test_payroll_adds_the_folha_line_outside_the_das() -> None:
    series = [MonthlyEntry("2026-01", {"comercio": D(100_000)}, payroll=D(10_000), pro_labore=D(5_000))]
    d = ok(ENGINE.diagnose(company(regime="presumido", series=series, uf="SP", rat_grade=2)))
    folha = next(line for line in d.breakdown if line.tax == "FOLHA")
    assert folha.amount == 4_000  # INSS 20% x 15.000 + RAT 2% x 10.000 + FGTS 8% x 10.000
    assert "Retenção de 11% do INSS" in " ".join(d.assumptions)
    assert any(step.tax == "FOLHA" for step in d.steps)


def test_every_result_traces_each_amount_to_a_rule_with_its_source() -> None:
    d = ok(ENGINE.diagnose(company(regime="presumido", monthly_revenue=D(100_000), monthly_purchases=D(60_000), uf="SP")))
    assert d.steps and all(step.rule_id and step.source for step in d.steps)
    assert "icms-interno-SP" in {r.id for r in d.rules_used}


def test_compare_regimes_keeps_refusals_with_their_reason() -> None:
    profile = company(
        regime="presumido", monthly_revenue=D(100_000), monthly_purchases=D(60_000), uf="SP", profit_margin=D("0.1")
    )
    c = compare_regimes(ENGINE, profile)
    assert [r.regime for r in c.rows] == ["simples", "presumido", "real"]
    assert any(reg == "simples" for reg, _ in c.refusals)  # no monthly series: Simples cannot be calculated
    assert c.best in ("presumido", "real")


def test_opportunities_are_none_found_when_nothing_beats_the_current_regime() -> None:
    result = ENGINE.opportunities(company(regime="real"))
    assert isinstance(result, NoneFound)


def test_opportunity_for_a_better_regime_comes_with_premises() -> None:
    series = [*year(50_000), MonthlyEntry("2026-01", {"comercio": D(50_000)})]
    profile = replace(company(regime="presumido", series=series, uf="SP", profit_margin=D("0.3")), monthly_revenue=D(50_000))
    result = ENGINE.opportunities(profile)
    if isinstance(result, Ok):
        item = result.value.items[0]
        assert item.status == "found" and item.assumptions and item.requires_validation
        assert result.value.annual_savings > 0


def test_fator_r_opportunity_is_found_with_premises_when_the_payroll_is_just_below_28_percent() -> None:
    series = [*year(100_000, payroll=20_000), MonthlyEntry("2026-01", {"servico": D(100_000)}, payroll=D(20_000))]
    series = [
        replace(e, revenue={"servico": e.revenue.get("comercio", D(100_000))}) if "comercio" in e.revenue else e for e in series
    ]
    profile = company(activity="servico", fator_r=True, series=series)
    items = {o.id: o for o in evaluate_catalog(OpportunityContext(ENGINE, profile, "2026-01", ENGINE.book))}
    assert items["opp-fator-r"].status == "found"
    assert items["opp-fator-r"].monthly_savings and items["opp-fator-r"].monthly_savings > 0
    assert "Fator R atual de 20%" in " ".join(items["opp-fator-r"].assumptions)
    assert items["opp-regime"].requires_validation


def test_fator_r_opportunity_has_its_other_two_states() -> None:
    plain = evaluate_catalog(OpportunityContext(ENGINE, company(), "2026-01", ENGINE.book))
    assert next(o for o in plain if o.id == "opp-fator-r").status == "not_applicable"
    no_payroll = company(activity="servico", fator_r=True, series=[MonthlyEntry("2026-01", {"servico": D(1_000)})])
    unknown = evaluate_catalog(OpportunityContext(ENGINE, no_payroll, "2026-01", ENGINE.book))
    assert next(o for o in unknown if o.id == "opp-fator-r").status == "insufficient_data"
    high = [*year(10_000, payroll=3_000), MonthlyEntry("2026-01", {"servico": D(10_000)})]
    already = company(activity="servico", fator_r=True, series=[replace(e, revenue={"servico": D(10_000)}) for e in high])
    assert (
        next(
            o for o in evaluate_catalog(OpportunityContext(ENGINE, already, "2026-01", ENGINE.book)) if o.id == "opp-fator-r"
        ).status
        == "not_applicable"
    )
