"""Documents (#309): reading, real file type, malware, quota, duplicates, consent, signed download and hostile XML."""

import hashlib
import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.crypto import is_encrypted
from app.db.client import user_db
from app.documents.checks import quota_bytes, scan_bytes, signature_matches
from app.documents.classify import classify_document, format_extracted
from app.documents.duplicates import fingerprint_document, nfe_access_key, sha256_hex
from app.documents.storage import StoredExtraction, open_stored, resolve_mime, safe_file_name, to_stored
from tests.conftest import USER
from tests.fake_db import FakeDb

KEY = "35200114200166000187550010000000046000000047"
NFE = f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe{KEY}" versao="4.00">
<ide><nNF>4</nNF><dhEmi>2026-03-15T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>14200166000187</CNPJ><xNome>Emitente</xNome></emit>
<dest><CNPJ>11222333000181</CNPJ></dest>
<total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>{KEY}</chNFe></infProt></protNFe></nfeProc>"""
CNPJ_EMIT = "14200166000187"


# ---- classify ----
def test_an_nfe_is_read_for_real_with_the_emitter_not_the_recipient() -> None:
    c = classify_document("qualquer.xml", "application/xml", NFE)
    assert (c.type, c.confidence, c.missing) == ("nota_fiscal", "alta", [])
    assert c.extracted == {"numero": "4", "emitente_cnpj": CNPJ_EMIT, "valor_total": "1500.00", "emissao": "2026-03-15"}
    assert format_extracted(c.extracted) == [
        ("Número", "4"), ("CNPJ do emitente", "14.200.166/0001-87"), ("Valor total", "R$ 1.500,00"), ("Emissão", "15/03/2026"),
    ]  # fmt: skip


def test_fields_that_cannot_be_read_are_reported_never_invented() -> None:
    c = classify_document(
        "x.xml", "application/xml", "<NFe><infNFe><ide><nNF>12</nNF></ide><total><vNF>abc</vNF></total></infNFe></NFe>"
    )
    assert c.extracted == {"numero": "12"} and c.missing == ["emitente_cnpj", "valor_total", "emissao"]
    assert format_extracted({}) == []


@pytest.mark.parametrize(
    ("name", "mime", "expected"),
    [("Informe de Rendimentos 2025.pdf", "application/pdf", "informe_rendimentos"), ("danfe-123.pdf", "application/pdf", "nota_fiscal"),
     ("IRPF_2025.txt", "text/plain", "declaracao"), ("Consulta médica.png", "image/png", "comprovante_despesa"), ("foto.jpg", "image/jpeg", "outro")],
)  # fmt: skip
def test_everything_else_is_typed_by_name_with_low_confidence_and_an_honest_note(name: str, mime: str, expected: str) -> None:
    c = classify_document(name, mime)
    assert c.type == expected and c.confidence == "baixa" and c.extracted == {} and "ilustrativa" in c.notes[-1]
    assert (
        "Não reconheci" if mime == "text/plain" else "Não consegui ler" if mime == "application/pdf" else "PDF e imagem"
    ) in c.notes[0]


def test_readable_files_that_are_not_an_nfe_say_so() -> None:
    c = classify_document("nota.xml", "application/xml", "<outra><coisa/></outra>")
    assert c.type == "nota_fiscal" and c.confidence == "baixa" and "Não reconheci" in c.notes[0]
    assert classify_document("a.xml", "application/xml", "<<<nao e xml").notes[0].startswith("Não reconheci")


def test_the_xml_reader_refuses_external_entities_and_expansion_bombs(tmp_path: Any) -> None:
    secret = tmp_path / "segredo.txt"
    secret.write_text("SEGREDO-DO-SERVIDOR", encoding="utf-8")
    xxe = f'<?xml version="1.0"?><!DOCTYPE nfe [<!ENTITY x SYSTEM "{secret.as_uri()}">]><NFe><infNFe><ide><nNF>&x;</nNF></ide></infNFe></NFe>'
    bomb = '<?xml version="1.0"?><!DOCTYPE b [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><NFe><x>&b;</x></NFe>'
    remote = '<?xml version="1.0"?><!DOCTYPE n [<!ENTITY y SYSTEM "http://127.0.0.1:9/x">]><nfeProc><NFe>&y;</NFe></nfeProc>'
    for hostile in (xxe, bomb, remote):
        c = classify_document("nota.xml", "application/xml", hostile)
        assert c.confidence == "baixa" and c.extracted == {} and "SEGREDO" not in json.dumps(c.__dict__)


# ---- checks ----
@pytest.mark.parametrize(
    ("data", "mime", "ok"),
    [(b"%PDF-1.7 ...", "application/pdf", True), (b"junk" * 10 + b"%PDF-1.4", "application/pdf", True), (b"MZ\x90\x00", "application/pdf", False),
     (b"\x89PNG\r\n\x1a\n....", "image/png", True), (b"GIF89a", "image/png", False), (b"\xff\xd8\xff\xe0", "image/jpeg", True),
     (b"<?xml version='1.0'?><a/>", "application/xml", True), (b"\xef\xbb\xbf  <nfeProc/>", "text/xml", False), (b"<a/>\x00", "application/xml", False),
     ("olá mundo".encode(), "text/plain", True), (b"MZ\x90\x00 binary", "text/plain", False), (b"\x7fELF....", "text/plain", False), (b"a\x00b", "text/plain", False),
     (b"anything", "application/zip", False)],
)  # fmt: skip
def test_the_real_file_type_is_checked_never_the_name_or_the_declared_type(data: bytes, mime: str, ok: bool) -> None:
    assert signature_matches(data, mime) is ok


async def test_malware_scan_catches_eicar_and_asks_the_scanner_when_there_is_one() -> None:
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    assert await scan_bytes(eicar, Settings()) == "infected" and await scan_bytes(b"ok", Settings()) == "unscanned"
    answers = {"infected": {"infected": True}, "clean": {"infected": False}}
    for body, expected in (("infected", "infected"), ("clean", "clean")):
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r, b=body: httpx.Response(200, json=answers[b])))
        assert await scan_bytes(b"x", Settings(virus_scan_url="https://scan.test/"), client) == expected
    down = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    assert await scan_bytes(b"x", Settings(virus_scan_url="https://scan.test/"), down) == "unscanned"
    broken = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="not json")))
    assert await scan_bytes(b"x", Settings(virus_scan_url="https://scan.test/"), broken) == "unscanned"

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    assert (
        await scan_bytes(
            b"x", Settings(virus_scan_url="https://scan.test/"), httpx.AsyncClient(transport=httpx.MockTransport(refuse))
        )
        == "unscanned"
    )


def test_quota_defaults_to_100_mb_and_can_be_overridden() -> None:
    assert quota_bytes(Settings()) == 100 * 1024 * 1024 and quota_bytes(Settings(document_quota_bytes=2048)) == 2048


# ---- storage and fingerprints ----
def test_mime_resolution_and_safe_names() -> None:
    assert resolve_mime("a.pdf", "application/pdf") == "application/pdf" and resolve_mime("nota.XML", "") == "application/xml"
    assert resolve_mime("a.jpg", "application/octet-stream") == "image/jpeg" and resolve_mime("a.exe", "") is None
    assert resolve_mime("a.pdf", "application/zip") is None and resolve_mime("semextensao", "") is None
    assert safe_file_name("../../etc/passwd") == "passwd" and safe_file_name("Relatório de Março.pdf") == "Relatorio_de_Marco.pdf"
    assert (
        safe_file_name("...") == "arquivo" and safe_file_name("") == "arquivo" and len(safe_file_name("a" * 300 + ".pdf")) == 100
    )


def test_identifiers_are_sealed_before_storage_and_open_on_the_way_back() -> None:
    settings = Settings()
    stored = to_stored({"numero": "4", "emitente_cnpj": CNPJ_EMIT}, [], ["n"], "alta", settings)
    assert (
        isinstance(stored, StoredExtraction) and is_encrypted(stored.fields["emitente_cnpj"]) and stored.fields["numero"] == "4"
    )
    assert CNPJ_EMIT not in json.dumps(stored.as_json())
    opened = open_stored(stored.as_json(), settings)
    assert opened is not None and opened["fields"]["emitente_cnpj"] == CNPJ_EMIT and open_stored(None, settings) is None


def test_the_same_bytes_or_the_same_nfe_key_identify_a_document_twice() -> None:
    assert sha256_hex(b"abc").startswith("ba7816bf") == (hashlib.sha256(b"abc").hexdigest()[:8] == "ba7816bf")
    assert (
        nfe_access_key(NFE) == KEY
        and nfe_access_key(f'<infNFe Id="NFe{KEY}">') == KEY
        and nfe_access_key("<a/>") is None
        and nfe_access_key(None) is None
    )
    a, b = fingerprint_document(NFE.encode(), NFE), fingerprint_document(NFE.replace("\n", " ").encode(), NFE.replace("\n", " "))
    assert a.content_hash != b.content_hash and a.nfe_key == b.nfe_key == KEY


# ---- the HTTP routes ----
@pytest.fixture
def db(signed_in: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeDb]:
    monkeypatch.setenv("DOCUMENT_QUOTA_BYTES", "5000")
    get_settings.cache_clear()
    fake = FakeDb(USER)
    fake.rpcs.update(
        {
            "rate_limit_hit": lambda a: 0,
            "has_consent": lambda a: False,
            "record_consent": lambda a: None,
            "audit_record": lambda a: None,
        }
    )

    async def fake_user_db() -> AsyncIterator[FakeDb]:
        yield fake

    signed_in.app.dependency_overrides[user_db] = fake_user_db  # type: ignore[attr-defined]
    yield fake


def workspace(db: FakeDb) -> str:
    return str(db.seed("workspaces", name="Empresa", kind="empresa", profile=None, owner_id=USER)["id"])


def upload(
    client: TestClient, ws: str, name: str = "nota.xml", content: bytes = NFE.encode(), mime: str = "application/xml", **form: str
) -> Any:
    data = {"workspaceId": ws, "consent": "on", **form}
    return client.post("/v1/documents", data=data, files={"file": (name, content, mime)})


def test_the_upload_needs_a_signed_in_user(anonymous: TestClient) -> None:
    assert anonymous.post("/v1/documents").status_code == 401
    assert anonymous.get(f"/v1/documents/{USER}/download").status_code == 401


def test_a_nota_fiscal_is_stored_classified_encrypted_and_audited(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    r = upload(signed_in, ws)
    assert r.status_code == 201 and r.json()["type"] == "nota_fiscal"
    [doc] = db.tables["documents"]
    assert doc["storage_path"] == f"{ws}/{doc['id']}/nota.xml" and f"documents/{doc['storage_path']}" in db.storage
    assert doc["content_hash"] == sha256_hex(NFE.encode()) and doc["nfe_key"] == KEY and doc["size_bytes"] == len(NFE.encode())
    assert is_encrypted(doc["extracted"]["fields"]["emitente_cnpj"]) and CNPJ_EMIT not in json.dumps(doc["extracted"])
    assert doc["doc_type"] == "nota_fiscal" and doc["consented_at"]
    text = doc["search_text"]  # searchable; the NF-e key stays, a bare CNPJ never does
    assert "[cnpj]" in text and f" {CNPJ_EMIT} " not in text and "<" not in text
    assert ("record_consent", {"p_purpose": "documents", "p_version": "2026-11", "p_action": "granted"}) in db.rpc_calls
    assert any(c[0] == "audit_record" and c[1]["p_action"] == "document_uploaded" for c in db.rpc_calls)


def test_consent_is_required_unless_it_was_already_granted(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    no = signed_in.post("/v1/documents", data={"workspaceId": ws}, files={"file": ("a.txt", b"oi", "text/plain")})
    assert (
        no.status_code == 400
        and no.json()["error"]["code"] == "consent_required"
        and not db.tables.get("documents")
        and not db.storage
    )
    db.rpcs["has_consent"] = lambda a: True
    again = signed_in.post("/v1/documents", data={"workspaceId": ws}, files={"file": ("a.txt", b"oi", "text/plain")})
    assert again.status_code == 201 and not [
        c for c in db.rpc_calls if c[0] == "record_consent"
    ]  # already granted: not recorded twice


@pytest.mark.parametrize(
    ("name", "content", "mime", "status", "code"),
    [("a.exe", b"MZ", "application/octet-stream", 415, "unsupported_type"), ("fake.pdf", b"MZ\x90\x00", "application/pdf", 415, "content_mismatch"),
     ("virus.txt", b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "text/plain", 422, "infected"),
     ("vazio.txt", b"", "text/plain", 400, "no_file")],
)  # fmt: skip
def test_hostile_or_unsupported_files_are_refused_before_anything_is_stored(
    signed_in: TestClient, db: FakeDb, name: str, content: bytes, mime: str, status: int, code: str
) -> None:
    r = upload(signed_in, workspace(db), name, content, mime)
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert not db.storage and not db.tables.get("documents")


def test_a_file_over_10_mb_is_refused_and_the_workspace_quota_is_enforced(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    big = upload(signed_in, ws, "g.txt", b"a" * (10 * 1024 * 1024 + 1), "text/plain")
    assert big.status_code == 413 and big.json()["error"]["code"] == "file_too_large"
    db.seed("documents", workspace_id=ws, size_bytes=4000, name="antigo.pdf")
    full = upload(signed_in, ws, "b.txt", b"b" * 2000, "text/plain")
    assert (
        full.status_code == 413
        and full.json()["error"]["code"] == "quota_exceeded"
        and "limite de 0 MB" in full.json()["error"]["message"]
    )
    assert upload(signed_in, ws, "c.txt", b"c" * 500, "text/plain").status_code == 201


def test_a_second_copy_is_refused_by_bytes_and_by_nfe_key_and_leaves_no_orphan_file(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    assert upload(signed_in, ws).status_code == 201
    same = upload(signed_in, ws, "outro-nome.xml")
    assert same.status_code == 409 and "nota.xml" in same.json()["error"]["message"] and len(db.storage) == 1
    reexported = upload(signed_in, ws, "re.xml", NFE.replace("\n", " ").encode())  # different bytes, same invoice
    assert reexported.status_code == 409 and reexported.json()["error"]["code"] == "duplicate_document" and len(db.storage) == 1
    other = workspace(db)
    assert upload(signed_in, other).status_code == 201  # the same file in another workspace is not a duplicate


def test_someone_who_may_not_write_is_refused_and_never_learns_about_duplicates(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    assert upload(signed_in, ws).status_code == 201
    db.can_write = False
    r = upload(signed_in, ws)
    assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden"  # not 409: the storage policy answers first


def test_a_failed_insert_removes_the_file_and_a_race_is_reported_as_a_duplicate(
    signed_in: TestClient, db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.errors import DbError

    ws = workspace(db)
    for status, expected in ((500, 500), (409, 409)):

        async def boom(*a: Any, status: int = status, **k: Any) -> Any:
            raise DbError(status, "x")

        monkeypatch.setattr(db, "insert", boom)
        r = upload(signed_in, ws, f"n{status}.txt", f"conteudo {status}".encode(), "text/plain")
        assert r.status_code == expected and not db.storage


def test_invalid_forms_are_refused(signed_in: TestClient, db: FakeDb) -> None:
    assert (
        signed_in.post("/v1/documents", data={"workspaceId": "nope"}, files={"file": ("a.txt", b"x", "text/plain")}).status_code
        == 422
    )
    assert signed_in.post("/v1/documents", data={"workspaceId": workspace(db)}).status_code == 422


def test_the_rate_limit_applies(signed_in: TestClient, db: FakeDb) -> None:
    db.rpcs["rate_limit_hit"] = lambda a: 12
    r = upload(signed_in, workspace(db))
    assert r.status_code == 429 and r.headers["retry-after"] == "12" and not db.storage


def test_the_download_is_a_fresh_short_lived_signed_url(signed_in: TestClient, db: FakeDb) -> None:
    ws = workspace(db)
    doc_id = upload(signed_in, ws).json()["id"]
    r = signed_in.get(f"/v1/documents/{doc_id}/download", follow_redirects=False)
    assert (
        r.status_code == 302
        and r.headers["location"].startswith("https://storage.test/sign/documents/")
        and "exp=60" in r.headers["location"]
    )
    assert "download=nota.xml" in r.headers["location"]
    ghost = signed_in.get("/v1/documents/6f1d9a4e-6c1c-4b57-9d62-3a4c1f0a9b11/download", follow_redirects=False)
    assert ghost.status_code == 404
    db.storage.clear()  # the policy refuses (or the file is gone): the same answer, no detail
    assert signed_in.get(f"/v1/documents/{doc_id}/download", follow_redirects=False).status_code == 404
    assert signed_in.get("/v1/documents/not-a-uuid/download").status_code == 422


def test_inline_download_drops_the_attachment_name_for_the_browser_viewer(signed_in: TestClient, db: FakeDb) -> None:
    doc_id = upload(signed_in, workspace(db)).json()["id"]
    r = signed_in.get(f"/v1/documents/{doc_id}/download?inline=true", follow_redirects=False)
    assert r.status_code == 302 and "download=" not in r.headers["location"]


def test_a_pdf_is_read_through_its_text_layer_and_low_confidence_fields_are_stored_for_confirmation(
    signed_in: TestClient, db: FakeDb
) -> None:
    from tests.test_extract import make_pdf

    lines = ["Documento de Arrecadacao do Simples Nacional - DAS", "CNPJ: 11.222.333/0001-82", "Periodo de Apuracao: 03/2026",
             "Data de Vencimento: 20/04/2026", "Valor Total do Documento: 1.234,56"]  # fmt: skip
    r = upload(signed_in, workspace(db), name="guia.pdf", content=make_pdf(lines), mime="application/pdf")
    assert r.status_code == 201 and r.json()["type"] == "das"
    stored = db.tables["documents"][0]["extracted"]
    assert stored["fields"]["valor_total"] == "1234.56" and stored["toConfirm"] == ["cnpj"]
    assert stored["fieldConfidence"]["valor_total"] == "alta" and is_encrypted(stored["fields"]["cnpj"])


def test_a_scanned_pdf_without_text_is_kept_and_says_it_could_not_be_read(signed_in: TestClient, db: FakeDb) -> None:
    from tests.test_extract import make_pdf

    r = upload(signed_in, workspace(db), name="nota.pdf", content=make_pdf(["x"]), mime="application/pdf")
    assert r.status_code == 201
    stored = db.tables["documents"][0]["extracted"]
    assert stored["fields"] == {} and "Não consegui ler o texto" in stored["notes"][0] and "fieldConfidence" not in stored
