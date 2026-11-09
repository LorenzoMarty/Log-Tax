import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dashboard } from "@/dashboard/types";
import { seedCompany, seedPerson, type CompanyProfile, type PersonProfile } from "@/engine";
import type { StoreState } from "./memory-store";
import type { Agent, Alert, Msg } from "./types";

export interface DisplayMessage {
  role: "user" | "assistant";
  text: string;
}

export interface WorkspaceState extends StoreState {
  workspaceName: string;
  kind: "empresa" | "pessoal";
  dashboardRowId?: string;
  /** Set when the state was loaded for a conversation with one specialised agent. */
  agent?: Agent;
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

/**
 * Reads everything the chat needs through the caller's session, so RLS decides what is visible.
 * With `agentId`, the conversation is that agent's own; null if the agent is not in this workspace.
 */
export async function loadWorkspaceState(sb: SupabaseClient, workspaceId: string, agentId?: string): Promise<WorkspaceState | null> {
  const { data: ws } = await sb.from("workspaces").select("id, name, kind, profile").eq("id", workspaceId).maybeSingle();
  if (!ws) return null;

  const conversation = agentId
    ? sb.from("agent_conversations").select("history, messages").eq("agent_id", agentId).eq("workspace_id", workspaceId).maybeSingle()
    : sb.from("conversations").select("history, messages").eq("workspace_id", workspaceId).maybeSingle();
  const [dash, alerts, agents, conv] = await Promise.all([
    sb.from("dashboards").select("id, data").eq("workspace_id", workspaceId).order("created_at").limit(1).maybeSingle(),
    sb.from("alerts").select("id, rule, active").eq("workspace_id", workspaceId).order("created_at"),
    sb.from("agents").select("id, name, objective, config").eq("workspace_id", workspaceId).order("created_at"),
    conversation,
  ]);
  for (const [res, what] of [[dash, "dashboards"], [alerts, "alerts"], [agents, "agents"], [conv, "conversations"]] as const) ok(res, what);

  const agentList: Agent[] = (agents.data ?? []).map((a) => ({ id: a.id, name: a.name, objective: a.objective, tools: a.config?.tools ?? [] }));
  const agent = agentId ? agentList.find((a) => a.id === agentId) : undefined;
  if (agentId && !agent) return null;

  const company: CompanyProfile =
    ws.kind === "empresa" ? (ws.profile ?? seedCompany) : { id: ws.id, name: ws.name, regime: "presumido", activity: "comercio" };
  const person: PersonProfile = ws.kind === "pessoal" ? (ws.profile ?? seedPerson) : seedPerson;

  return {
    workspaceName: ws.name,
    kind: ws.kind,
    company,
    person,
    dashboard: dash.data?.data ?? emptyDashboard(workspaceId),
    dashboardRowId: dash.data?.id,
    alerts: (alerts.data ?? []) as Alert[],
    agents: agentList,
    agent,
    history: conv.data?.history ?? [],
    messages: conv.data?.messages ?? [],
  };
}

/** Saves the turn. Returns the agents as persisted, so brand-new ones come back with their real ids. */
export async function saveWorkspaceState(
  sb: SupabaseClient,
  workspaceId: string,
  s: StoreState & { kind: WorkspaceState["kind"]; dashboardRowId?: string; agentId?: string; history: Msg[]; messages: DisplayMessage[] },
): Promise<Agent[]> {
  ok(await sb.from("workspaces").update({ profile: s.kind === "pessoal" ? s.person : s.company }).eq("id", workspaceId), "workspaces");

  const dashRow = { workspace_id: workspaceId, name: s.dashboard.name, data: s.dashboard, version: s.dashboard.version, updated_at: new Date().toISOString() };
  ok(
    s.dashboardRowId
      ? await sb.from("dashboards").update(dashRow).eq("id", s.dashboardRowId)
      : await sb.from("dashboards").insert(dashRow),
    "dashboards",
  );

  const newAlerts = s.alerts.filter((a) => !UUID.test(a.id)).map((a) => ({ workspace_id: workspaceId, rule: a.rule, active: a.active }));
  if (newAlerts.length) ok(await sb.from("alerts").insert(newAlerts), "alerts");

  const saved: Agent[] = [];
  for (const a of s.agents) {
    const row = { name: a.name, objective: a.objective, config: { tools: a.tools } };
    if (UUID.test(a.id)) {
      ok(await sb.from("agents").update(row).eq("id", a.id), "agents");
      saved.push(a);
    } else {
      const { data } = ok(await sb.from("agents").insert({ ...row, workspace_id: workspaceId }).select("id").single(), "agents");
      saved.push({ ...a, id: data!.id });
    }
  }

  const convRow = { workspace_id: workspaceId, history: s.history, messages: s.messages, updated_at: new Date().toISOString() };
  ok(
    s.agentId
      ? await sb.from("agent_conversations").upsert({ ...convRow, agent_id: s.agentId })
      : await sb.from("conversations").upsert(convRow),
    "conversations",
  );
  return saved;
}
