import { z } from "zod";
import { DISCLAIMER } from "@/engine";
import type { Widget } from "@/dashboard/types";
import type { ToolContext, ToolOutcome, ToolSpec, Scope } from "./types";
import { widgetSchema } from "./widget-schema";

class ToolError extends Error {}
class Refusal extends Error {}

interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  destructive?: boolean;
  /** Uses the tax engine: the reply must carry the estimate disclaimer. */
  engine?: boolean;
  run(ctx: ToolContext, args: z.infer<S>): unknown;
}
const defineTool = <S extends z.ZodType>(t: Tool<S>) => t as unknown as Tool;

const company = z.strictObject({
  name: z.string().min(1),
  regime: z.enum(["presumido", "real", "simples"]),
  activity: z.enum(["comercio", "servico"]),
  monthlyRevenue: z.number().min(0),
  employees: z.int().min(0),
  uf: z.string().length(2),
  monthlyPurchases: z.number().min(0),
  profitMargin: z.number().min(0).max(1).describe("fração, 0.08 = 8%"),
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
    description: "Calcula quanto a empresa paga de imposto por mês e por ano, e para onde vai.",
    schema: none,
    engine: true,
    run: (ctx) => ctx.engine.diagnose(ctx.store.getCompany()),
  }),
  defineTool({
    name: "run_simulation",
    description: "Simula um novo faturamento mensal e compara com o cenário atual.",
    schema: z.strictObject({ monthlyRevenue: z.number().min(0) }),
    engine: true,
    run: (ctx, a) => ctx.engine.simulate(ctx.store.getCompany(), { monthlyRevenue: a.monthlyRevenue }),
  }),
  defineTool({
    name: "list_opportunities",
    description: "Lista oportunidades legais de economia tributária, com premissas e dados que faltam.",
    schema: none,
    engine: true,
    run: (ctx) => ctx.engine.opportunities(ctx.store.getCompany()),
  }),
  defineTool({
    name: "explain_result",
    description: "Explica de onde veio um resultado: regras usadas, fontes, premissas e se precisa de validação.",
    schema: z.strictObject({ subject: z.enum(["diagnosis", "opportunity"]), opportunityId: z.string().optional() }),
    engine: true,
    run(ctx, a) {
      const rules = ctx.engine.rules();
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
    description: "Reúne diagnóstico, oportunidades e premissas num relatório.",
    schema: none,
    engine: true,
    run(ctx) {
      const c = ctx.store.getCompany();
      return {
        title: `Relatório tributário — ${c.name}`,
        diagnosis: ctx.engine.diagnose(c),
        opportunities: ctx.engine.opportunities(c),
        disclaimer: DISCLAIMER,
      };
    },
  }),
  defineTool({
    name: "save_company_data",
    description: "Salva dados informados pelo usuário sobre a empresa. Use só o que o usuário disse.",
    schema: company.partial().refine((v) => Object.keys(v).length > 0, "informe ao menos um campo"),
    run: (ctx, a) => ctx.store.saveCompany(a),
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

const allowed = (scope: Scope, name: string) => !scope.allowedTools || scope.allowedTools.includes(name);

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
  if (!allowed(ctx.scope, name)) return { status: "refused", reason: `Esta IA não tem acesso à ferramenta ${name}.` };

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

  if (tool.destructive) {
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
