# ruff: noqa: E501  (the glossary text is long on purpose and must stay byte-identical to the TypeScript one)
"""Glossary of tax terms (#115): each one is explained in plain language, with no monetary example, injected into the system prompt.

Keep it byte-identical to `src/chat/glossary.ts` (the golden cases compare the prompts built from both).
"""

GLOSSARY: tuple[tuple[str, str], ...] = (
    (
        "Fator R",
        "a proporção entre o que a empresa gasta com folha de pagamento (salários e pró-labore) e o que fatura; decide se serviços do Simples Nacional pagam o imposto mais leve ou o mais pesado",
    ),
    (
        "RBT12",
        "a receita bruta total dos últimos 12 meses, ou seja, tudo o que a empresa faturou nesse período; o Simples Nacional usa esse total para achar a faixa e a alíquota",
    ),
    ("DAS", "o boleto único mensal do Simples Nacional, que reúne vários impostos numa guia só"),
    (
        "DCTFWeb",
        "a declaração mensal em que a empresa informa à Receita as contribuições sobre a folha de pagamento e outras retenções",
    ),
    (
        "IBS",
        "Imposto sobre Bens e Serviços da reforma tributária, que vai substituir o ICMS e o ISS (impostos de estados e municípios)",
    ),
    (
        "CBS",
        "Contribuição sobre Bens e Serviços da reforma tributária, que vai substituir o PIS e a Cofins (contribuições federais)",
    ),
    (
        "presunção",
        "no Lucro Presumido, a Receita presume que uma parte fixa do faturamento é lucro e cobra imposto sobre essa parte, sem olhar o lucro real da empresa",
    ),
    ("base de cálculo", "o valor sobre o qual a alíquota é aplicada para chegar ao imposto"),
    (
        "alíquota efetiva",
        "a fatia do faturamento que realmente vai para impostos, depois de todos os descontos e faixas; é o percentual real, não o da tabela",
    ),
    ("regime tributário", "a forma como a empresa é tributada (MEI, Simples Nacional, Lucro Presumido ou Lucro Real)"),
    ("pró-labore", "a remuneração mensal que o sócio recebe pelo trabalho na empresa, como se fosse o salário dele"),
    ("DARF", "a guia usada para pagar tributos federais"),
)
