import type { Agent } from "@/chat/types";

type AgentRow = { id: string; name: string; objective: string; config?: { tools?: string[]; documents?: string[] | null } | null };

/** The agent as the app sees it. `documents`: null = every document of the space, a list = only those (#134). */
export function agentFromRow(a: AgentRow): Agent {
  return { id: a.id, name: a.name, objective: a.objective, tools: a.config?.tools ?? [], documents: a.config?.documents ?? null };
}

/** What goes in `agents.config`. The document permission is carried over, never dropped: losing it would reopen every document. */
export function agentConfig(a: Pick<Agent, "tools" | "documents">) {
  return a.documents == null ? { tools: a.tools } : { tools: a.tools, documents: a.documents };
}
