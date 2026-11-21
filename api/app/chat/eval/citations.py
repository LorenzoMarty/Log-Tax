"""Deterministic check that the AI cites only sources that came from the engine (#97, #114).

`explain_result` returns `steps` and `rules`, each with a `source` string written by whoever curated the rule (for
example "LC 123/2006 com a redação da LC 155/2016, art. 18 e Anexos I a V: https://..."). The reply may name a law or
an article only if the same law or article appears in a source returned in the same turn, or in the user's message.

Everything here is a pure function: no network, no model. It judges references, never wording.

Where each pattern comes from (the forms used in Brazilian legal citation, and in the rules data of `app/engine`):

- Lei Complementar: "LC 123/2006", "Lei Complementar nº 155, de 2016" (Constituição, art. 59, II; rules `simples-*`, `reforma-*`).
- Lei: "Lei 9.249/1995", "Lei nº 9.249, de 26 de dezembro de 1995", "Leis 10.637/2002 e 10.833/2003" (Lei Complementar
  95/1998 art. 10 sets the "número/ano" form; the plural list is how the IRPJ/PIS rules cite several laws at once).
- Decreto and Decreto-Lei ("Decreto 9.580/2018", "Decreto-Lei 5.452/1943"), Emenda Constitucional ("EC 132/2023"),
  Medida Provisória ("MP 1.303/2025").
- Receita Federal acts: "IN RFB 2.005/2021" (Instrução Normativa), "Resolução CGSN 140/2018" (Simples Nacional),
  "Portaria Interministerial MPS/MF nº 13/2026" (INSS teto), "Convênio ICMS 142/2018" (CONFAZ).
- Articles: "art. 18", "arts. 15 e 20", "arts. 343 a 348", "art. 18-A", "artigo 52, I". A range "a" is expanded.

References are normalized to "<kind> <number>/<year>" with thousands dots removed, so "Lei nº 9.249, de 1995" and
"Lei 9.249/1995" are the same. Articles are compared as a set of numbers, regardless of which law they belong to.

Limits: only references that look like the patterns above are seen; a source named in free text ("Receita Federal")
or an article tied to the wrong law is not caught; a number after "art. 5 e" that is not an article may be read as one.
"""

import re
from typing import Any

_NUM = r"\d{1,3}(?:\.\d{3})+|\d+"
_YEAR = r"(?:/|\s*,\s*de\s+(?:\d{1,2}\s+de\s+[A-Za-zçÇ]+\s+de\s+)?|\s+de\s+)(?P<year>\d{4})"
_PREFIX = r"(?:n[ºo°]\.?\s*)?"
# (kind label, regex for the words that introduce the number)
_KINDS: list[tuple[str, str]] = [
    ("lc", r"(?:LC|Lei\s+Complementar)"),
    ("decreto-lei", r"(?:Decreto-Lei|DL)"),
    ("decreto", r"Decreto"),
    ("ec", r"(?:EC|Emenda\s+Constitucional)"),
    ("mp", r"(?:MP|Medida\s+Provis[óo]ria)"),
    ("lei", r"Leis?"),
    ("in", r"(?:IN|Instru[çc][ãa]o\s+Normativa)(?:\s+(?:RFB|SRF|SRFB))?"),
    ("res", r"(?:Resolu[çc][ãa]o|Res\.)(?:\s+(?:CGSN|CGIBS|CMN))?"),
    ("portaria", r"Portaria[^\d]{0,60}?"),
    ("convenio", r"Conv[êe]nio(?:\s+(?:ICMS|CONFAZ))?"),
]
_REF = re.compile(
    r"\b(?P<kind>"
    + "|".join(f"(?P<k{i}>{rx})" for i, (_, rx) in enumerate(_KINDS))
    + r")\s*"
    + _PREFIX
    + rf"(?P<num>{_NUM}){_YEAR}"
)
_MORE = re.compile(rf"\s*(?:,|e)\s*{_PREFIX}(?P<num>{_NUM}){_YEAR}")
_ARTICLE_LIST = re.compile(
    r"\bart(?:s|igos?)?\.?\s*(?P<first>\d+(?:-[A-Z])?)(?P<rest>(?:\s*(?:,|e|a|ao)\s*\d{1,4}(?:-[A-Z])?(?![\d/.]))*)",
    re.IGNORECASE,
)
_ARTICLE_TOKEN = re.compile(r"(,|e|a|ao)\s*(\d+(?:-[A-Z])?)", re.IGNORECASE)


def _key(kind: str, number: str, year: str) -> str:
    return f"{kind} {number.replace('.', '')}/{year}"


def cited_references(text: str) -> set[str]:
    """Normalized laws/acts named in `text`, e.g. {'lc 123/2006', 'lei 9249/1995'}."""
    out: set[str] = set()
    for m in _REF.finditer(text):
        kind = next(label for i, (label, _) in enumerate(_KINDS) if m.group(f"k{i}"))
        out.add(_key(kind, m.group("num"), m.group("year")))
        pos = m.end()
        while more := _MORE.match(text, pos):  # "Leis 10.637/2002 e 10.833/2003"
            out.add(_key(kind, more.group("num"), more.group("year")))
            pos = more.end()
    return out


def cited_articles(text: str) -> set[str]:
    """Article numbers named in `text` ('arts. 343 a 348' is expanded to 343..348; '18-A' stays as is)."""
    out: set[str] = set()
    for m in _ARTICLE_LIST.finditer(text):
        last = m.group("first")
        out.add(last)
        for sep, number in _ARTICLE_TOKEN.findall(m.group("rest")):
            if sep.lower() in ("a", "ao") and last.isdigit() and number.isdigit() and 0 < int(number) - int(last) <= 1000:
                out.update(str(n) for n in range(int(last), int(number) + 1))
            out.add(number)
            last = number
    return out


def sources_in(outcome: Any) -> list[str]:
    """Every `source` string at any depth of a tool outcome (`rules[*].source`, `steps[*].source`, `rule.source`)."""
    found: list[str] = []
    if isinstance(outcome, dict):
        for key, value in outcome.items():
            if key == "source" and isinstance(value, str):
                found.append(value)
            else:
                found += sources_in(value)
    elif isinstance(outcome, list):
        for item in outcome:
            found += sources_in(item)
    return found


def check_citations(reply: str, engine_sources: list[str], user_text: str = "") -> list[str]:
    """Failures for every law or article the reply names that is in neither `engine_sources` nor the user's message."""
    allowed_text = " ".join([*engine_sources, user_text])
    known_refs, known_articles = cited_references(allowed_text), cited_articles(allowed_text)
    failures = [f"cita a fonte {ref}, que não veio do motor" for ref in sorted(cited_references(reply) - known_refs)]
    failures += [
        f"cita o art. {art}, que não veio do motor"
        for art in sorted(cited_articles(reply) - known_articles, key=lambda a: (int(a.split("-")[0]), a))
    ]
    return failures
