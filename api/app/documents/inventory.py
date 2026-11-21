"""Documents an inventory typically needs (#185), ticked from the names of the files in the workspace.

An expected list kept as data, conservative: it is the usual set, not the exact one for a given court or notary.
`keys` are accent-free fragments searched in the file name.
"""

import unicodedata

INVENTORY_DOCS: list[tuple[str, tuple[str, ...]]] = [
    ("Certidão de óbito", ("obito",)),
    ("Documentos pessoais do falecido (RG e CPF)", ("rg", "cpf", "identidade")),
    ("Certidão de casamento ou nascimento do falecido", ("casamento", "nascimento")),
    ("Documentos pessoais dos herdeiros", ("herdeiro",)),
    ("Certidão de matrícula atualizada dos imóveis", ("matricula", "imovel", "escritura")),
    ("Documento dos veículos (CRLV)", ("crlv", "veiculo", "renavam")),
    ("Extratos bancários e de investimentos na data do óbito", ("extrato", "investimento")),
    ("Última declaração de IRPF do falecido", ("irpf", "declaracao")),
    ("Certidões negativas de débitos", ("certidao negativa", "cnd")),
    ("Testamento ou certidão de inexistência de testamento", ("testamento",)),
]


def _plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


def inventory_checklist(file_names: list[str]) -> list[dict[str, object]]:
    names = [_plain(n) for n in file_names]
    return [{"label": label, "done": any(k in n for n in names for k in keys)} for label, keys in INVENTORY_DOCS]
