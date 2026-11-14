"""Imposto Seletivo (#104): the same cases as src/engine/__tests__/selective-tax.test.ts."""

from dataclasses import replace
from decimal import Decimal

from app.engine.real_engine import RealEngine
from app.engine.result import NotApplicable, Ok
from app.engine.selective_tax import selective_categories, selective_tax
from app.engine.types import CompanyProfile


def test_subject_company_gets_the_notice_with_source() -> None:
    r = selective_tax("2027-03", ["1113502", "4635402"])
    assert isinstance(r, Ok)
    assert r.value.categories == ["bebidas_alcoolicas"]
    assert r.value.source == "LC 214/2025, art. 409, §1º"
    assert r.value.requires_validation
    assert "bebidas alcoólicas" in r.value.message


def test_every_other_company_is_not_applicable() -> None:
    for cnaes in (["4711302"], ["6201501", "7020400"], [], None):
        assert isinstance(selective_tax("2027-03", cnaes), NotApplicable)
    other = selective_tax("2027-03", ["4711302"])
    assert isinstance(other, NotApplicable) and "não está na lista" in other.reason


def test_categories_follow_the_law_order() -> None:
    assert selective_categories(["2910701"]) == ["veiculos"]
    assert selective_categories(["9200301"]) == ["prognosticos"]
    assert selective_categories(["1122401", "1113502"]) == ["bebidas_alcoolicas", "bebidas_acucaradas"]
    assert selective_categories(["1121600"]) == []


def test_same_text_as_the_typescript_engine() -> None:
    r = selective_tax("2026-06", ["1113502"])
    assert isinstance(r, Ok)
    assert r.value.message == (
        "Atenção: pela atividade da empresa (bebidas alcoólicas), ela está sujeita ao Imposto Seletivo "
        "(LC 214/2025, art. 409, §1º). O Imposto Seletivo só começa a ser cobrado em 2027. "
        "As alíquotas dependem de lei ordinária que o motor ainda não tem conferida: não calculamos um valor. "
        "Confirme com um contador."
    )


def test_real_engine_adds_the_notice_and_keeps_the_total() -> None:
    engine = RealEngine("2027-03")
    shop = CompanyProfile(
        id="c", name="Teste", regime="presumido", activity="comercio", monthly_revenue=Decimal(100000), uf="SP", cnaes=["4711302"]
    )
    plain = engine.diagnose(shop)
    brewery = engine.diagnose(replace(shop, cnaes=["1113502"]))
    assert isinstance(plain, Ok) and isinstance(brewery, Ok)
    assert brewery.value.monthly_total == plain.value.monthly_total
    assert "Imposto Seletivo" in brewery.value.assumptions[-1]
    assert not any("Imposto Seletivo" in a for a in plain.value.assumptions)
