"""Documents organized by type and period (#161): grouping rules and the read-only route."""

from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient

from app.db.client import user_db
from app.documents.organize import DocRow, Group, group_documents, period_of
from tests.conftest import USER
from tests.fake_db import FakeDb


def row(i: str, t: str | None, p: str | None, at: str = "2026-01-01T00:00:00Z") -> DocRow:
    return DocRow(i, f"{i}.pdf", t, p, at)


def test_mixed_documents_are_grouped_by_type_and_period() -> None:
    rows = [row("a", "das", "2026-03"), row("b", "das", "2026-03"), row("c", "das", "2026-02"), row("d", "holerite", "2026-03")]
    assert group_documents(rows) == [
        Group("das", "2026-03", ("a", "b")),
        Group("holerite", "2026-03", ("d",)),
        Group("das", "2026-02", ("c",)),
    ]


def test_no_type_becomes_outro_and_no_period_goes_last() -> None:
    got = group_documents([row("x", None, None), row("y", "das", "2025-12"), row("z", "darf", None)])
    assert got == [Group("das", "2025-12", ("y",)), Group("darf", None, ("z",)), Group("outro", None, ("x",))]
    assert group_documents([]) == []


def test_ids_inside_a_group_follow_upload_time_then_id() -> None:
    rows = [
        row("b", "das", "2026-03", "2026-02-01"),
        row("a", "das", "2026-03", "2026-02-01"),
        row("c", "das", "2026-03", "2026-01-01"),
    ]
    assert group_documents(rows)[0].ids == ("c", "a", "b")


@pytest.mark.parametrize(
    ("extracted", "expected"),
    [
        ({"fields": {"competencia": "2026-03"}}, "2026-03"),
        ({"fields": {"emissao": "2026-04-20"}}, "2026-04"),
        ({"fields": {"competencia": "2026-13", "emissao": "2026-05-01"}}, "2026-05"),
        ({"fields": {"valor_total": "10.00"}}, None),
        ({}, None),
        (None, None),
    ],
)
def test_the_period_comes_from_the_document_never_from_the_upload(extracted: dict | None, expected: str | None) -> None:  # type: ignore[type-arg]
    assert period_of(extracted) == expected


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[FakeDb]:
    fake = FakeDb(USER)

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def test_the_route_groups_the_workspace_documents_and_404s_for_others(signed_in: TestClient, db: FakeDb) -> None:
    ws = str(db.seed("workspaces", name="E", kind="empresa", profile=None, owner_id=USER)["id"])
    db.seed(
        "documents",
        workspace_id=ws,
        name="guia.pdf",
        doc_type="das",
        extracted={"fields": {"competencia": "2026-03"}},
        created_at="2026-04-01",
    )
    db.seed("documents", workspace_id=ws, name="foto.jpg", doc_type=None, extracted={}, created_at="2026-04-02")
    body = signed_in.get(f"/v1/workspaces/{ws}/documents/organized").json()
    assert body["total"] == 2
    assert [(g["type"], g["label"], g["period"], len(g["documents"])) for g in body["groups"]] == [
        ("das", "DAS (Simples Nacional)", "2026-03", 1),
        ("outro", "Outro", None, 1),
    ]
    assert signed_in.get("/v1/workspaces/00000000-0000-4000-8000-000000000000/documents/organized").status_code == 404
