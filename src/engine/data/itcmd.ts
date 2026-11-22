import type { RuleVersion } from "../rulebook";

export interface ItcmdRates {
  /** Flat rate by UF on the tax base, for inheritance (causa mortis) and for donation. UFs absent here have no verified table. */
  byUf: Record<string, { heranca: number; doacao: number; prazoHerancaDias?: number; multaMora?: { porDia: number; ateDia: number; ate60Dias: number; apos60Dias: number } }>;
}

/**
 * ITCMD (state tax on inheritance and donation). Only the UFs whose rate was checked in the official legislation are listed;
 * any other UF is answered "table not validated" by the engine, never with a guessed rate. Exemption floors, progressive
 * UFs and the late fine of UFs other than MG are not modelled yet (MG: deadline and fine, docs/fontes-legais.md).
 */
export const ITCMD_RULES: RuleVersion<ItcmdRates>[] = [
  {
    id: "itcmd-aliquotas",
    name: "ITCMD: alíquotas por UF (SP e MG)",
    jurisdiction: "Estadual",
    validFrom: "2008-03",
    source: "SP: Lei 10.705/2000 art. 16, 4% sobre a base de cálculo (https://www.al.sp.gov.br/repositorio/legislacao/lei/2000/lei-10705-28.12.2000.html; https://portal.fazenda.sp.gov.br/servicos/itcmd/Paginas/declaracao-e-calculo.aspx). MG: Lei 14.941/2003 art. 10 (5%, desde 28/03/2008), art. 13, I (180 dias) e art. 22, I (multa de mora), texto lido em https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/leis/l14941_2003.html (atualizada até a Lei 25.618/2025; baixado com curl em 2026-11-21; docs/fontes-legais.md)",
    confidence: "medium",
    requiresValidation: true,
    notes: "MG: alíquota, prazo e multa de mora lidos no texto da lei publicado pela SEF/MG (docs/fontes-legais.md). SP: alíquota conferida por resumo de busca nos sites oficiais, não pelo texto integral da lei (a SEF/SP não pôde ser baixada): confirme com um contador. A vigência de SP é anterior a 2008; usa-se 2008-03 (início da alíquota única de MG) para as duas UFs. Isenções (ex.: doação até 2.500 UFESP em SP; imóveis e valores isentos em MG), descontos por pagamento antecipado e multa por atraso fora de MG não estão modelados. PL 409/2025 (SP) propõe alíquotas progressivas e não foi considerado.",
    data: {
      byUf: {
        SP: { heranca: 0.04, doacao: 0.04 },
        MG: { heranca: 0.05, doacao: 0.05, prazoHerancaDias: 180, multaMora: { porDia: 0.0015, ateDia: 30, ate60Dias: 0.09, apos60Dias: 0.12 } },
      },
    },
  },
];
