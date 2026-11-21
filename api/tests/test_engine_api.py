from decimal import Decimal as D

from fastapi.testclient import TestClient

SERIES_2025 = [{"month": f"2025-{m:02d}", "revenue": {"comercio": "50000"}} for m in range(1, 13)]
SIMPLES = {
    "regime": "simples",
    "activity": "comercio",
    "series": [*SERIES_2025, {"month": "2026-01", "revenue": {"comercio": "50000"}}],
}
PRESUMIDO = {"regime": "presumido", "activity": "comercio", "monthlyRevenue": "100000", "monthlyPurchases": "60000", "uf": "SP"}
ROUTES = [
    "diagnose",
    "simulate",
    "opportunities",
    "person",
    "history",
    "deadlines",
    "reform-impact",
    "prestador",
    "itcmd",
    "asset-sale",
    "asset-carrying-tax",
]


def test_every_engine_route_needs_a_signed_in_user(anonymous: TestClient) -> None:
    for route in ROUTES:
        assert anonymous.post(f"/v1/engine/{route}", json={}).status_code == 401, route
    assert anonymous.get("/v1/engine/rules").status_code == 401


def test_diagnose_returns_camel_case_money_as_exact_decimals_and_the_calculation_memory(signed_in: TestClient) -> None:
    r = signed_in.post("/v1/engine/diagnose", json={"competence": "2026-01", "company": SIMPLES})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    value = body["value"]
    assert isinstance(value["monthlyTotal"], str)  # exact decimal string, never a float
    assert D(value["monthlyTotal"]) == 3595 and D(value["annualTotal"]) == 43_140
    assert value["rulesVersion"] == "real-2026-01"
    assert value["rulesUsed"][0]["id"] == "simples-anexos" and value["rulesUsed"][0]["requiresValidation"] is True
    assert value["steps"][0]["ruleId"] and value["steps"][0]["source"]
    assert {line["tax"] for line in value["breakdown"]} >= {"IRPJ", "CSLL", "PIS/COFINS", "CPP", "ICMS"}


def test_missing_data_and_not_applicable_are_answers_not_errors(signed_in: TestClient) -> None:
    r = signed_in.post(
        "/v1/engine/diagnose", json={"competence": "2026-01", "company": {"regime": "simples", "activity": "comercio"}}
    )
    assert r.status_code == 200 and r.json() == {"status": "insufficient_data", "missing": ["series"]}
    old = signed_in.post("/v1/engine/diagnose", json={"competence": "2010-06", "company": PRESUMIDO})
    assert old.json()["status"] == "not_applicable" and "2010-06" in old.json()["reason"]


def test_invalid_input_is_a_422_in_portuguese_with_the_request_id(signed_in: TestClient) -> None:
    for bad in (
        {"competence": "2026-13", "company": PRESUMIDO},
        {"company": {**PRESUMIDO, "uf": "XX"}},
        {"company": {**PRESUMIDO, "issRate": "0.5"}},
        {"company": {"activity": "comercio"}},
        {"company": PRESUMIDO, "surprise": 1},
    ):
        r = signed_in.post("/v1/engine/diagnose", json=bad)
        assert r.status_code == 422, bad
        assert r.json()["error"]["code"] == "invalid_request"
        assert r.json()["error"]["request_id"]


def test_simulate_compares_today_with_the_scenario(signed_in: TestClient) -> None:
    overrides = {"series": [*SERIES_2025, {"month": "2026-01", "revenue": {"comercio": "80000"}}]}
    r = signed_in.post("/v1/engine/simulate", json={"competence": "2026-01", "company": SIMPLES, "overrides": overrides})
    assert r.status_code == 200
    value = r.json()["value"]
    assert D(value["current"]["monthlyTotal"]) == 3595 and D(value["scenario"]["monthlyTotal"]) == 5752


def test_opportunities_and_person(signed_in: TestClient) -> None:
    opp = signed_in.post("/v1/engine/opportunities", json={"competence": "2026-01", "company": PRESUMIDO})
    assert opp.status_code == 200 and opp.json()["status"] in ("ok", "none_found")
    person = signed_in.post(
        "/v1/engine/person",
        json={
            "competence": "2025-06",
            "person": {"annualGrossIncome": "180000", "inssPaid": "11000", "dependents": 2, "taxWithheld": "31500"},
        },
    )
    assert person.status_code == 200
    value = person.json()["value"]
    assert value["best"] in ("completa", "simplificada") and D(value["simplified"]["deductions"]) == D("16754.34")
    assert (
        signed_in.post("/v1/engine/person", json={"competence": "2026-03", "person": {"annualGrossIncome": "1000"}}).json()[
            "status"
        ]
        == "not_applicable"
    )


def test_history_and_deadlines(signed_in: TestClient) -> None:
    h = signed_in.post("/v1/engine/history", json={"company": SIMPLES, "to": "2026-01", "months": 2, "compareWith": "2025-01"})
    assert h.status_code == 200
    body = h.json()
    assert [p["status"] for p in body["points"]] == ["missing", "ok"] or body["points"][0]["month"] == "2025-12"
    assert body["comparison"] is None or body["comparison"]["fromMonth"] == "2025-01"
    d = signed_in.post("/v1/engine/deadlines", json={"regime": "simples", "from": "2026-11-01", "horizonDays": 40})
    das = next(x for x in d.json()["deadlines"] if x["id"] == "das")
    assert das["date"] == "2026-11-23" and "notCovered" in d.json() and d.json()["holidayScope"] == "nacional"


def test_reform_impact_asks_for_inputs_then_answers_year_by_year(signed_in: TestClient) -> None:
    ask = signed_in.post("/v1/engine/reform-impact", json={"competence": "2026-03", "company": PRESUMIDO})
    assert ask.json()["status"] == "insufficient_data" and "cbsReferenceRate" in ask.json()["missing"]
    full = signed_in.post(
        "/v1/engine/reform-impact",
        json={
            "competence": "2026-03",
            "company": PRESUMIDO,
            "category": "geral",
            "cbsReferenceRate": "0.088",
            "ibsReferenceRate": "0.177",
        },
    )
    value = full.json()["value"]
    assert [y["year"] for y in value["years"]] == list(range(2026, 2034))
    assert value["assumptions"]


def test_rules_lists_every_version_with_source_and_what_has_lapsed(signed_in: TestClient) -> None:
    r = signed_in.get("/v1/engine/rules", params={"today": "2026-11"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["changelog"]) == 33 and all(e["source"] for e in body["changelog"])
    assert sorted(x["id"] for x in body["lapsed"]) == ["irpf-anual-deducoes", "irpf-tabela-anual"]
    assert signed_in.get("/v1/engine/rules", params={"today": "bad"}).status_code == 422
    assert signed_in.get("/v1/engine/rules").status_code == 200


def test_the_openapi_contract_describes_the_engine_routes(signed_in: TestClient) -> None:
    spec = signed_in.get("/openapi.json").json()
    for route in ROUTES:
        assert f"/v1/engine/{route}" in spec["paths"]
    assert "/v1/engine/rules" in spec["paths"]


def test_asset_sale_and_carrying_tax_routes(signed_in: TestClient) -> None:
    sale = {"competence": "2026-11", "kind": "imovel", "saleValue": "500000", "costBasis": "300000"}
    ok = signed_in.post("/v1/engine/asset-sale", json=sale).json()
    assert ok["status"] == "ok" and ok["value"]["tax"] == "30000.00" and ok["value"]["assumptions"]
    ask = signed_in.post("/v1/engine/asset-sale", json={**sale, "costBasis": None}).json()
    assert ask == {"status": "insufficient_data", "missing": ["costBasis"]}
    assert signed_in.post("/v1/engine/asset-carrying-tax", json={"tax": "ipva"}).json()["status"] == "insufficient_data"
    got = signed_in.post("/v1/engine/asset-carrying-tax", json={"tax": "ipva", "annualAmount": "2400"}).json()
    assert got["value"]["monthly"] == "200.00"
