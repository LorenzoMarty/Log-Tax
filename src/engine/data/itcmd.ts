import type { RuleVersion } from "../rulebook";

export interface ItcmdRates {
  /** Flat rate by UF on the tax base, for inheritance (causa mortis) and for donation. UFs absent here have no verified table. */
  byUf: Record<string, { heranca: number; doacao: number }>;
}

/**
 * ITCMD (state tax on inheritance and donation). Only the UFs whose rate was checked in the official legislation are listed;
 * any other UF is answered "table not validated" by the engine, never with a guessed rate. Exemption floors, progressive
 * UFs, deadlines and late fines are not modelled yet.
 */
export const ITCMD_RULES: RuleVersion<ItcmdRates>[] = [
  {
    id: "itcmd-aliquotas",
    name: "ITCMD: alíquotas por UF (SP e MG)",
    jurisdiction: "Estadual",
    validFrom: "2008-03",
    source: "SP: Lei 10.705/2000 art. 16, 4% sobre a base de cálculo (https://www.al.sp.gov.br/repositorio/legislacao/lei/2000/lei-10705-28.12.2000.html; https://portal.fazenda.sp.gov.br/servicos/itcmd/Paginas/declaracao-e-calculo.aspx). MG: Lei 14.941/2003 art. 10, 5%, alíquota única desde 28/03/2008 (https://www.almg.gov.br/legislacao-mineira/texto/LEI/14941/2003/?cons=1; https://www.fazenda.mg.gov.br/empresas/impostos/itcd/informacoes.html)",
    confidence: "medium",
    requiresValidation: true,
    notes: "Alíquotas conferidas por resumo de busca nos sites oficiais, não pelo texto integral das leis: confirme com um contador. A vigência de SP é anterior a 2008; usa-se 2008-03 (início da alíquota única de MG) para as duas UFs. Isenções (ex.: doação até 2.500 UFESP em SP), prazo e multa por atraso não estão modelados. PL 409/2025 (SP) propõe alíquotas progressivas e não foi considerado.",
    data: { byUf: { SP: { heranca: 0.04, doacao: 0.04 }, MG: { heranca: 0.05, doacao: 0.05 } } },
  },
];
