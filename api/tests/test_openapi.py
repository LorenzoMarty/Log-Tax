import json

from scripts.export_openapi import TARGET, render


def test_the_committed_openapi_contract_is_up_to_date() -> None:
    """The TypeScript client is generated from `openapi.json`: changing a route without exporting it must fail here."""
    assert TARGET.read_text(encoding="utf-8").replace("\r\n", "\n") == render()


def test_the_contract_has_the_pieces_the_front_end_needs() -> None:
    spec = json.loads(render())
    assert spec["info"]["title"] == "Log Tax API"
    assert "/v1/engine/diagnose" in spec["paths"] and "/v1/me" in spec["paths"] and "/v1/vitals" in spec["paths"]
    diagnose = spec["paths"]["/v1/engine/diagnose"]["post"]
    assert diagnose["tags"] == ["engine"] and diagnose["responses"]["200"]
    schemas = spec["components"]["schemas"]
    assert "Diagnosis" in schemas and "monthlyTotal" in schemas["Diagnosis"]["properties"]  # camelCase on the wire
