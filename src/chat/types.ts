import type { Action } from "@/dashboard/reducer";
import type { Dashboard } from "@/dashboard/types";
import type { CompanyProfile, PersonProfile, TaxEngine } from "@/engine";

// ---- LLM boundary (provider-agnostic) ----
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string produced by the model. Untrusted: always validated before use. */
  args: string;
}

export type Msg =
  | { role: "user" | "assistant"; content: string }
  /** Provider-native output items, replayed verbatim on the next call. */
  | { role: "llm"; items: unknown[] }
  | { role: "tool_result"; callId: string; output: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmTurn {
  /** Tokens the provider billed for this call, when it reports them. */
  usage?: { input: number; output: number };
  text: string;
  calls: ToolCall[];
  items: unknown[];
}

export interface LlmClient {
  /** `signal` aborts the provider call (the user pressed stop or left). */
  respond(req: { system: string; history: Msg[]; tools: ToolSpec[]; signal?: AbortSignal }): Promise<LlmTurn>;
}

// ---- Scope and state ----
export interface Scope {
  workspaceId: string;
  workspaceName?: string;
  kind?: "empresa" | "pessoal";
  agentId?: string;
  /** Undefined = every tool. An agent only ever gets the tools it was created with. */
  allowedTools?: readonly string[];
}

export interface AlertRule {
  metric: "monthlyTotal" | "effectiveRate" | "annualSavings";
  operator: "gt" | "lt";
  threshold: number;
}
export interface Alert {
  id: string;
  rule: AlertRule;
  active: boolean;
}
export interface Agent {
  id: string;
  name: string;
  objective: string;
  tools: string[];
}

/** A short fact or preference the user asked the assistant to remember in this workspace. */
export interface Memory {
  id: string;
  text: string;
}

/** Everything the tools may touch. Already bound to one workspace: tool args never name one. */
export interface ChatStore {
  getCompany(): CompanyProfile;
  saveCompany(patch: Partial<CompanyProfile>): CompanyProfile;
  getPerson(): PersonProfile;
  savePerson(patch: Partial<PersonProfile>): PersonProfile;
  getDashboard(): Dashboard;
  dispatch(action: Action): Dashboard;
  addAlert(rule: AlertRule): Alert;
  listAlerts(): Alert[];
  addAgent(agent: Omit<Agent, "id">): Agent;
  updateAgent(id: string, patch: Partial<Omit<Agent, "id">>): Agent | undefined;
  listAgents(): Agent[];
  listMemories(): Memory[];
  addMemory(text: string): Memory;
  removeMemory(id: string): boolean;
}

export interface ToolContext {
  scope: Scope;
  store: ChatStore;
  engine: TaxEngine;
  /** Approval keys the *user* granted out-of-band (see approvalKey). The model cannot add to this. */
  approvals: ReadonlySet<string>;
  /** External content (see untrusted.ts) is in the conversation: writing tools need approval. Set by the orchestrator. */
  untrustedInContext?: boolean;
}

export type ToolOutcome =
  | { status: "ok"; data: unknown }
  | { status: "error"; message: string }
  | { status: "refused"; reason: string }
  | { status: "confirmation_required"; key: string; summary: string };
