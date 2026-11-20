"""Structured extraction by type and PDF text (#141, #142): a sample of each type, confidence per field, never a guess."""

import pytest

from app.documents.classify import classify_document, format_extracted
from app.documents.extract import detect_type, extract_structured
from app.documents.pdf_text import pdf_text

CNPJ = "11.222.333/0001-81"  # valid check digits
SAMPLES: dict[str, tuple[str, dict[str, str]]] = {
    "das": (
        f"Documento de Arrecadação do Simples Nacional - DAS\nCNPJ: {CNPJ}\nPeríodo de Apuração: 03/2026\n"
        "Data de Vencimento: 20/04/2026\nValor Total do Documento: 1.234,56",
        {"cnpj": "11222333000181", "competencia": "2026-03", "vencimento": "2026-04-20", "valor_total": "1234.56"},
    ),
    "darf": (
        f"Documento de Arrecadação de Receitas Federais DARF\nCNPJ {CNPJ}\nPeríodo de Apuração: 31/03/2026\n"
        "Código da Receita: 2089\nData de Vencimento 30/04/2026\nValor Total: 980,00",
        {
            "cnpj": "11222333000181",
            "codigo_receita": "2089",
            "periodo_apuracao": "2026-03-31",
            "vencimento": "2026-04-30",
            "valor_total": "980.00",
        },
    ),
    "informe_rendimentos": (
        f"Comprovante de Rendimentos Pagos e de Imposto sobre a Renda Retido na Fonte\nCNPJ: {CNPJ}\nAno-calendário: 2025\n"
        "Total dos rendimentos (inclusive férias): 85.000,00\nImposto sobre a renda retido na fonte: 6.120,45",
        {
            "fonte_cnpj": "11222333000181",
            "ano_calendario": "2025",
            "rendimentos_tributaveis": "85000.00",
            "imposto_retido": "6120.45",
        },
    ),
    "holerite": (
        "Recibo de Pagamento de Salário\nCompetência: 02/2026\nTotal de Proventos 5.000,00\nTotal de Descontos 900,10\nLíquido a Receber 4.099,90",
        {"competencia": "2026-02", "proventos": "5000.00", "descontos": "900.10", "liquido": "4099.90"},
    ),
    "nfse": (
        f"Nota Fiscal de Serviços Eletrônica - NFS-e\nNúmero da Nota: 1234\nPrestador de Serviços\nCNPJ: {CNPJ}\n"
        "Data de Emissão: 05/03/2026\nValor dos Serviços: 2.500,00",
        {"numero": "1234", "prestador_cnpj": "11222333000181", "emissao": "2026-03-05", "valor_servicos": "2500.00"},
    ),
    "cte": (
        "DACTE - Conhecimento de Transporte Eletrônico CT-e\nChave de Acesso\n3520 0114 2001 6600 0187 5700 1000 0000 0460 0000 0047\n"
        "Data de Emissão: 10/03/2026\nValor Total da Prestação: 700,00",
        {"chave": "35200114200166000187570010000000046000000047", "emissao": "2026-03-10", "valor_prestacao": "700.00"},
    ),
    "extrato": (
        "Extrato de conta corrente\nSaldo anterior 100,00\nLançamentos do período\nSaldo final: 1.050,75",
        {"saldo_final": "1050.75"},
    ),
}


@pytest.mark.parametrize("doc_type", SAMPLES)
def test_each_type_is_recognised_and_its_fields_read_with_high_confidence(doc_type: str) -> None:
    text, expected = SAMPLES[doc_type]
    got = extract_structured(text)
    assert got is not None and got.type == doc_type
    assert {k: v for k, v in got.fields.items() if k in expected} == expected
    assert all(got.confidence[k] == "alta" for k in expected) and set(expected) <= set(got.fields)


def test_a_field_not_in_the_text_is_missing_never_invented() -> None:
    got = extract_structured("Documento de Arrecadação do Simples Nacional - DAS\nCNPJ: 11.222.333/0001-81")
    assert got is not None and got.type == "das"
    assert got.missing == ["competencia", "vencimento", "valor_total"] and "valor_total" not in got.fields


def test_low_confidence_fields_are_flagged_for_confirmation() -> None:
    bad_cnpj = SAMPLES["das"][0].replace(CNPJ, "11.222.333/0001-82")  # wrong check digit
    got = extract_structured(bad_cnpj)
    assert got is not None and got.confidence["cnpj"] == "baixa" and got.to_confirm == ["cnpj"]
    two_totals = SAMPLES["das"][0].replace("Data de Vencimento", "Valor Total do Documento: 9,99\nData de Vencimento")
    ambiguous = extract_structured(two_totals)
    assert ambiguous is not None and ambiguous.confidence["valor_total"] == "baixa"


def test_text_that_is_not_a_known_document_is_not_classified() -> None:
    assert extract_structured("Lista de compras: pão, leite") is None
    assert detect_type("simples") is None  # one weak marker is not enough


def test_classification_carries_confidence_and_asks_to_confirm() -> None:
    c = classify_document("guia.pdf", "application/pdf", SAMPLES["das"][0].replace(CNPJ, "11.222.333/0001-82"))
    assert (
        c.type == "das" and c.confidence == "baixa" and c.to_confirm == ["cnpj"] and "Confirme antes de usar: cnpj" in c.notes[-1]
    )
    sure = classify_document("guia.pdf", "application/pdf", SAMPLES["das"][0])
    assert (
        sure.confidence == "alta" and sure.to_confirm == [] and ("Valor total", "R$ 1.234,56") in format_extracted(sure.extracted)
    )


# ---- PDF text layer ----
def make_pdf(lines: list[str]) -> bytes:
    stream = "BT /F1 12 Tf 50 750 Td 14 TL " + " ".join(f"({line}) Tj T*" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = "%PDF-1.4\n", []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    return out.encode("latin-1")


def test_a_pdf_guia_gives_its_fields_through_the_text_layer() -> None:
    lines = ["Documento de Arrecadacao do Simples Nacional - DAS", "CNPJ: 11.222.333/0001-81", "Periodo de Apuracao: 03/2026",
             "Data de Vencimento: 20/04/2026", "Valor Total do Documento: 1.234,56"]  # fmt: skip
    text = pdf_text(make_pdf(lines))
    assert text is not None
    c = classify_document("guia.pdf", "application/pdf", text)
    assert c.type == "das" and c.extracted["valor_total"] == "1234.56" and c.confidence == "alta"


@pytest.mark.parametrize("data", [b"", b"not a pdf", b"%PDF-1.4\n%%EOF", make_pdf(["x"])])
def test_an_unreadable_or_empty_pdf_is_none_and_says_it_could_not_read(data: bytes) -> None:
    assert pdf_text(data) is None
    c = classify_document("foto-da-nota.pdf", "application/pdf", None)
    assert c.extracted == {} and "Não consegui ler o texto deste PDF" in c.notes[0]
