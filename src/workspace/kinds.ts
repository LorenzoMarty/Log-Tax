/**
 * The ONE registry of workspace kinds (#177), mirror of `api/app/chat/kinds.py` and of the `workspaces_kind_check` constraint.
 * `base` says whose tools, state and report the kind reuses: new kinds start as "pessoal" and narrow the tools they show.
 */
export type BaseKind = "empresa" | "pessoal";

export interface KindSpec {
  label: string;
  /** Name given to a space of this kind when none is typed. */
  defaultName: string;
  base: BaseKind;
  /** Prompt addendum for the assistant. */
  prompt: string;
  /** Narrows the kind-restricted tools of `base` to these; tools for every kind are always kept. undefined = all of the base. */
  onlyTools?: readonly string[];
  reportTitle: string;
}

const PERSON_SPACE =
  "Este espaço é de pessoa física (Imposto de Renda). Use get_ir_diagnosis para calcular e comparar a declaração simplificada e a completa, e save_person_data para registrar o que o usuário informar (renda, INSS, dependentes, despesas, imposto retido). As ferramentas de empresa não estão disponíveis aqui.";
const ASSETS = [
  "add_asset",
  "list_assets",
  "update_asset",
  "remove_asset",
  "simulate_asset_sale",
  "asset_carrying_tax",
  "build_patrimony_panel",
];
const INVENTORY = [
  "set_estate",
  "add_heir",
  "update_heir",
  "remove_heir",
  "get_inventory",
  "get_inventory_deadlines",
  "get_inventory_checklist",
  "simulate_partilha",
];
const IR_TITLE = "Relatório de Imposto de Renda";

export const SPACE_KINDS = {
  empresa: {
    label: "Empresa",
    defaultName: "Minha Empresa",
    base: "empresa",
    prompt: "",
    reportTitle: "Relatório tributário",
  },
  pessoal: {
    label: "Pessoal",
    defaultName: "Vida Pessoal",
    base: "pessoal",
    prompt: PERSON_SPACE,
    reportTitle: IR_TITLE,
  },
  prestador: {
    label: "Prestador de serviço",
    defaultName: "Prestador de Serviço",
    base: "pessoal",
    prompt: `${PERSON_SPACE} Este espaço é de um prestador de serviço (autônomo): use compare_prestador para comparar pessoa física, MEI e Simples Nacional.`,
    onlyTools: ["get_ir_diagnosis", "save_person_data", "compare_prestador"],
    reportTitle: IR_TITLE,
  },
  patrimonio: {
    label: "Patrimônio",
    defaultName: "Meu Patrimônio",
    base: "pessoal",
    prompt: `${PERSON_SPACE} Este espaço é para o patrimônio: bens e dívidas (add_asset, list_assets), venda de bem e custo de manter.`,
    onlyTools: [
      ...ASSETS,
      "get_ir_diagnosis",
      "save_person_data",
      "preview_ir_bens",
      "confirm_ir_bens",
    ],
    reportTitle: IR_TITLE,
  },
  inventario: {
    label: "Inventário",
    defaultName: "Inventário",
    base: "pessoal",
    prompt: `${PERSON_SPACE} Este espaço é de um inventário: use set_estate, add_heir e get_inventory, e simulate_partilha para a partilha.`,
    onlyTools: [...ASSETS, ...INVENTORY],
    reportTitle: IR_TITLE,
  },
} as const satisfies Record<string, KindSpec>;

export type SpaceKind = keyof typeof SPACE_KINDS;
export const SPACE_KIND_LIST = Object.keys(SPACE_KINDS) as [
  SpaceKind,
  ...SpaceKind[],
];

export const isSpaceKind = (k: unknown): k is SpaceKind =>
  typeof k === "string" && k in SPACE_KINDS;
/** Unknown kinds behave as a company, like before the registry. */
export const specOf = (k?: string | null): KindSpec =>
  SPACE_KINDS[isSpaceKind(k) ? k : "empresa"];
export const baseOf = (k?: string | null): BaseKind => specOf(k).base;
export const isPersonal = (k?: string | null): boolean =>
  baseOf(k) === "pessoal";

/** Whether a tool declared for `toolKinds` (undefined = every kind) is shown in a space of `kind`. */
export function kindAllows(
  kind: string | undefined,
  toolName: string,
  toolKinds?: readonly BaseKind[],
): boolean {
  if (!toolKinds || !kind) return true;
  const spec = specOf(kind);
  if (!toolKinds.includes(spec.base)) return false;
  return !spec.onlyTools || spec.onlyTools.includes(toolName);
}
