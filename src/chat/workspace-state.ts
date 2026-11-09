import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dashboard } from "@/dashboard/types";
import { seedCompany, type CompanyProfile } from "@/engine";
import type { StoreState } from "./memory-store";
import type { Alert, Msg } from "./types";

export interface DisplayMessage {
  role: "user" | "assistant";
  text: string;
}

export interface WorkspaceState extends StoreState {
  workspaceName: string;
  kind: "empresa" | "pessoal";
  dashboardRowId?: string;
  history: Msg[];
  messages: DisplayMessage[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ok = <T extends { error: { message: string } | null }>(res: T, what: string): T => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
};

const emptyDashboard = (workspaceId: string): Dashboard => ({
  id: workspaceId,
  name: "Painel tributário",
  theme: "light",
  density: "comfortable",
  widgets: [],
  version: 1,
});

/** Reads everything the chat needs through the caller's session, so RLS decides what is visible. */
export async function loadWorkspaceState(sb: SupabaseClient, workspaceId: string): Promise<WorkspaceState | null> {
  const { data: ws } = await sb.from("workspaces").select("id, name, kind, profile").eq("id", workspaceId).maybeSingle();
  if (!ws) return null;

  const [dash, alerts, agents, conv] = await Promise.all([
    sb.from("dashboards").select("id, data").eq("workspace_id", workspaceId).order("created_at").limit(1).maybeSingle(),
    sb.from("alerts").select("id, rule, active").eq("workspace_id", workspaceId).order("created_at"),
    sb.from("agents").select("id, name, objective, config").eq("workspace_id", workspaceId).order("created_at"),
    sb.from("conversations").select("history, messages").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  for (const [res, what] of [[dash, "dashboards"], [alerts, "alerts"], [agents, "agents"], [conv, "conversations"]] as const) ok(res, what);

  const company: CompanyProfile =
    ws.profile ?? (ws.kind === "empresa" ? seedCompany : { id: ws.id, name: ws.name, regime: "presumido", activity: "comercio" });

  return {
    workspaceName: ws.name,
    kind: ws.kind,
    company,
    dashboard: dash.data?.data ?? emptyDashboard(workspaceId),
    dashboardRowId: dash.data?.id,
    alerts: (alerts.data ?? []) as Alert[],
    agents: (agents.data ?? []).map((a) => ({ id: a.id, name: a.name, objective: a.objective, tools: a.config?.tools ?? [] })),
    history: conv.data?.history ?? [],
    messages: conv.data?.messages ?? [],
  };
}

export async function saveWorkspaceState(
  sb: SupabaseClient,
  workspaceId: string,
  s: StoreState & { dashboardRowId?: string; history: Msg[]; messages: DisplayMessage[] },
) {
  ok(await sb.from("workspaces").update({ profile: s.company }).eq("id", workspaceId), "workspaces");

  const dashRow = { workspace_id: workspaceId, name: s.dashboard.name, data: s.dashboard, version: s.dashboard.version, updated_at: new Date().toISOString() };
  ok(
    s.dashboardRowId
      ? await sb.from("dashboards").update(dashRow).eq("id", s.dashboardRowId)
      : await sb.from("dashboards").insert(dashRow),
    "dashboards",
  );

  const newAlerts = s.alerts.filter((a) => !UUID.test(a.id)).map((a) => ({ workspace_id: workspaceId, rule: a.rule, active: a.active }));
  if (newAlerts.length) ok(await sb.from("alerts").insert(newAlerts), "alerts");

  for (const a of s.agents) {
    const row = { name: a.name, objective: a.objective, config: { tools: a.tools } };
    ok(
      UUID.test(a.id)
        ? await sb.from("agents").update(row).eq("id", a.id)
        : await sb.from("agents").insert({ ...row, workspace_id: workspaceId }),
      "agents",
    );
  }

  ok(
    await sb.from("conversations").upsert({ workspace_id: workspaceId, history: s.history, messages: s.messages, updated_at: new Date().toISOString() }),
    "conversations",
  );
}
