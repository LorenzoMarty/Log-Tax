import { z } from "zod";
import type { Widget } from "@/dashboard/types";
import type { ToolContext, ToolOutcome, ToolSpec, Scope } from "./types";
import { onlyDigits } from "@/lib/br-ids";
import { widgetSchema } from "./widget-schema";
import { companyFieldsSchema, inconsistencies, mergeSeries } from "@/engine/company-schema";

class ToolError extends Error {}
class Refusal extends Error {}

interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  destructive?: boolean;
  /** Changes nothing. Every other tool writes, and writes need the user's approval once external content is in the conversation. */
  readOnly?: boolean;
  /** Uses the tax engine: the reply must carry the estimate disclaimer. */
  engine?: boolean;
  /** Workspace kinds where the tool applies; undefined = all. */
  kinds?: ("empresa" | "pessoal")[];
  run(ctx: ToolContext, args: z.infer<S>): unknown;
}
const defineTool = <S extends z.ZodType>(t: Tool<S>) => t as unknown as Tool;

const company = companyFieldsSchema;

const person = z.strictObject({
  name: z.string().min(1),
  annualGrossIncome: z.number().min(0),
  inssPaid: z.number().min(0),
  dependents: z.int().min(0),
  healthExpenses: z.number().min(0),
  educationExpenses: z.number().min(0),
  privatePension: z.number().min(0),
  taxWithheld: z.number().min(0),
});

const none = z.strictObject({});
const alertRule = z.strictObject({
  metric: z.enum(["monthlyTotal", "effectiveRate", "annualSavings"]),
  operator: z.enum(["gt", "lt"]),
  threshold: z.number(),
});

const need = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new ToolError(message);
  return value;
};

const TOOLS: Tool[] = [
  defineTool({
    name: "get_tax_diagnosis",
    readOnly: true,
    kinds: ["empresa"],
    description: "Calcula quanto a empresa paga de imposto por mês e por ano, e para onde vai.",
    schema: none,
    engine: true,
    run: (ctx) => ctx.engine.diagnose(ctx.store.getCompany()),
  }),
  defineTool({
    name: "run_simulation",
    readOnly: true,
    kinds: ["empresa"],
    description: "Simula um novo faturamento mensal e compara com o cenário atual.",
    schema: z.strictObject({ monthlyRevenue: z.number().min(0) }),
    engine: true,
    run: (ctx, a) => ctx.engine.simulate(ctx.store.getCompany(), { monthlyRevenue: a.monthlyRevenue }),
  }),
  defineTool({
    name: "list_opportunities",
    readOnly: true,
    kinds: ["empresa"],
    description: "Lista oportunidades legais de economia tributária, com premissas e dados que faltam.",
    schema: none,
    engine: true,
    run: (ctx) => ctx.engine.opportunities(ctx.store.getCompany()),
  }),
  defineTool({
    name: "explain_result",
    readOnly: true,
    description: "Explica de onde veio um resultado: regras usadas, fontes, premissas e se precisa de validação.",
    schema: z.strictObject({ subject: z.enum(["diagnosis", "opportunity", "ir"]), opportunityId: z.string().optional() }),
    engine: true,
    run(ctx, a) {
      const rules = ctx.engine.rules();
      if (a.subject === "ir") {
        const d = ctx.engine.diagnosePerson(ctx.store.getPerson());
        return { rules: rules.filter((r) => r.category === "person"), assumptions: d.status === "ok" ? d.value.assumptions : [] };
      }
      if (a.subject === "diagnosis") {
        const d = ctx.engine.diagnose(ctx.store.getCompany());
        return { rules: rules.filter((r) => r.category === "tax"), assumptions: d.status === "ok" ? d.value.assumptions : [] };
      }
      const rule = need(rules.find((r) => r.id === a.opportunityId && r.category === "opportunity"), "Oportunidade não encontrada.");
      return { rule };
    },
  }),
  defineTool({
    name: "generate_report",
    readOnly: true,
    description: "Gera o relatório imprimível do espaço (resumo, impostos, oportunidades, economia potencial, premissas e itens a validar) e devolve o caminho para abri-lo.",
    schema: none,
    run: (ctx) => ({
      title: ctx.scope.kind === "pessoal" ? "Relatório de Imposto de Renda" : "Relatório tributário",
      url: `/workspace/${ctx.scope.workspaceId}/relatorio`,
    }),
  }),
  defineTool({
    name: "save_company_data",
    kinds: ["empresa"],
    description: "Salva dados informados pelo usuário sobre a empresa. Use só o que o usuário disse.",
    schema: company.partial().refine((v) => Object.keys(v).length > 0, "informe ao menos um campo"),
    run(ctx, a) {
      // Merge, then judge the whole profile: some mistakes only show when two fields meet (anexo with the wrong regime).
      if (a.cnpj) a = { ...a, cnpj: onlyDigits(a.cnpj) };
      const merged = { ...ctx.store.getCompany(), ...a, ...(a.series ? { series: mergeSeries(ctx.store.getCompany().series, a.series) } : {}) };
      const problems = inconsistencies(merged);
      if (problems.length) throw new ToolError(`Não salvei: ${problems.join(" ")}`);
      return ctx.store.saveCompany({ ...a, ...(a.series ? { series: merged.series } : {}) });
    },
  }),
  defineTool({
    name: "get_ir_diagnosis",
    readOnly: true,
    kinds: ["pessoal"],
    description: "Calcula o Imposto de Renda anual da pessoa física nos modelos simplificado e completo, qual compensa mais e a restituição ou o imposto a pagar.",
    schema: none,
    engine: true,
    run: (ctx) => ctx.engine.diagnosePerson(ctx.store.getPerson()),
  }),
  defineTool({
    name: "save_person_data",
    kinds: ["pessoal"],
    description: "Salva dados informados pelo usuário para o Imposto de Renda (renda anual, INSS, dependentes, despesas, imposto retido). Use só o que o usuário disse.",
    schema: person.partial().refine((v) => Object.keys(v).length > 0, "informe ao menos um campo"),
    run: (ctx, a) => ctx.store.savePerson(a),
  }),
  defineTool({
    name: "dashboard_add_widget",
    description: "Adiciona um bloco ao painel. Tipos: kpi, bar, line, breakdown, opportunities, deadlines, compare, checklist, text.",
    schema: z.strictObject({ widget: widgetSchema, index: z.int().min(0).optional() }),
    run(ctx, a) {
      const before = ctx.store.getDashboard();
      const after = ctx.store.dispatch({ type: "add", widget: a.widget as Widget, index: a.index });
      if (after === before) throw new ToolError(`Já existe um bloco com o id "${a.widget.id}".`);
      return { widgets: after.widgets.map((w) => w.id) };
    },
  }),
  defineTool({
    name: "dashboard_update_widget",
    description: "Altera campos de um bloco existente (título, tamanho, dados). Não muda id nem tipo.",
    schema: z.strictObject({ id: z.string(), patch: z.record(z.string(), z.unknown()) }),
    run(ctx, a) {
      const current = need(ctx.store.getDashboard().widgets.find((w) => w.id === a.id), `Bloco "${a.id}" não encontrado.`);
      const merged = widgetSchema.safeParse({ ...current, ...a.patch, id: current.id, kind: current.kind });
      if (!merged.success) throw new ToolError(`Alteração inválida: ${merged.error.issues[0]?.message}`);
      ctx.store.dispatch({ type: "update", id: a.id, patch: merged.data as Widget });
      return { id: a.id };
    },
  }),
  defineTool({
    name: "dashboard_remove_widget",
    description: "Remove um bloco do painel. Exige confirmação do usuário.",
    schema: z.strictObject({ id: z.string() }),
    destructive: true,
    run(ctx, a) {
      need(ctx.store.getDashboard().widgets.find((w) => w.id === a.id), `Bloco "${a.id}" não encontrado.`);
      ctx.store.dispatch({ type: "remove", id: a.id });
      return { removed: a.id };
    },
  }),
  defineTool({
    name: "dashboard_reorder",
    description: "Move um bloco para outra posição (0 é o topo).",
    schema: z.strictObject({ id: z.string(), toIndex: z.int().min(0) }),
    run(ctx, a) {
      need(ctx.store.getDashboard().widgets.find((w) => w.id === a.id), `Bloco "${a.id}" não encontrado.`);
      const after = ctx.store.dispatch({ type: "reorder", id: a.id, toIndex: a.toIndex });
      return { widgets: after.widgets.map((w) => w.id) };
    },
  }),
  defineTool({
    name: "create_alert",
    kinds: ["empresa"],
    description: "Cria um alerta: avisa quando a métrica ficar acima (gt) ou abaixo (lt) do limite. effectiveRate é fração (0.15 = 15%).",
    schema: alertRule,
    run: (ctx, a) => ctx.store.addAlert(a),
  }),
  defineTool({
    name: "create_agent",
    description: "Cria uma IA especializada com nome, objetivo e a lista de ferramentas que ela pode usar.",
    schema: z.strictObject({ name: z.string().min(1), objective: z.string().min(1), tools: z.array(z.string()) }),
    run(ctx, a) {
      checkAgentTools(ctx.scope, a.tools);
      return ctx.store.addAgent(a);
    },
  }),
  defineTool({
    name: "update_agent",
    description: "Altera nome, objetivo ou ferramentas de uma IA especializada.",
    schema: z.strictObject({
      id: z.string(),
      patch: z.strictObject({ name: z.string().min(1), objective: z.string().min(1), tools: z.array(z.string()) }).partial(),
    }),
    run(ctx, a) {
      if (a.patch.tools) checkAgentTools(ctx.scope, a.patch.tools);
      return need(ctx.store.updateAgent(a.id, a.patch), `IA "${a.id}" não encontrada.`);
    },
  }),
];

export const isDestructive = (name: string) => byName.get(name)?.destructive === true;
export const TOOL_NAMES = TOOLS.map((t) => t.name);
const byName = new Map(TOOLS.map((t) => [t.name, t]));
export const ENGINE_TOOLS = new Set(TOOLS.filter((t) => t.engine).map((t) => t.name));

/** An agent can only hand out tools it has itself. */
function checkAgentTools(scope: Scope, requested: string[]) {
  const unknown = requested.filter((t) => !byName.has(t));
  if (unknown.length) throw new ToolError(`Ferramentas desconhecidas: ${unknown.join(", ")}.`);
  if (!scope.allowedTools) return;
  const extra = requested.filter((t) => !scope.allowedTools!.includes(t));
  if (extra.length) throw new Refusal(`Esta IA não pode conceder ferramentas que não possui: ${extra.join(", ")}.`);
}

const inKind = (scope: Scope, t: Tool) => !t.kinds || !scope.kind || t.kinds.includes(scope.kind);
const allowed = (scope: Scope, name: string) =>
  (!scope.allowedTools || scope.allowedTools.includes(name)) && inKind(scope, byName.get(name)!);

export function toolSpecs(scope: Scope): ToolSpec[] {
  return TOOLS.filter((t) => allowed(scope, t.name)).map((t) => {
    const { $schema, ...parameters } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    void $schema;
    return { name: t.name, description: t.description, parameters };
  });
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

/** Key the user's approval is bound to: tool name + exact arguments. */
export const approvalKey = (name: string, args: unknown) => `${name}:${stable(args)}`;

export async function invokeTool(ctx: ToolContext, name: string, rawArgs: string): Promise<ToolOutcome> {
  const tool = byName.get(name);
  if (!tool) return { status: "error", message: `Ferramenta desconhecida: ${name}.` };
  if (!allowed(ctx.scope, name)) {
    const wrongKind = !inKind(ctx.scope, tool);
    return { status: "refused", reason: wrongKind ? "Esta ferramenta não se aplica a este tipo de espaço." : `Esta IA não tem acesso à ferramenta ${name}.` };
  }

  let json: unknown;
  try {
    json = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { status: "error", message: "Argumentos não são um JSON válido." };
  }
  const parsed = tool.schema.safeParse(json);
  if (!parsed.success) {
    return { status: "error", message: `Argumentos inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}` };
  }

  // External content (a document, a comment) may carry instructions: after it appears, nothing is written without the user's click.
  if (tool.destructive || (ctx.untrustedInContext && !tool.readOnly)) {
    const key = approvalKey(name, parsed.data);
    if (!ctx.approvals.has(key)) {
      return { status: "confirmation_required", key, summary: `${tool.description} Argumentos: ${stable(parsed.data)}` };
    }
  }

  try {
    return { status: "ok", data: await tool.run(ctx, parsed.data) };
  } catch (e) {
    if (e instanceof Refusal) return { status: "refused", reason: e.message };
    if (e instanceof ToolError) return { status: "error", message: e.message };
    throw e;
  }
}
