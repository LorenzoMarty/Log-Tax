import { initHistory, reduce, type Action } from "@/dashboard/reducer";
import { sampleDashboard } from "@/dashboard/fixtures";
import type { Dashboard } from "@/dashboard/types";
import { seedCompany, seedPerson, type CompanyProfile, type PersonProfile } from "@/engine";
import type { Agent, Alert, ChatStore, Memory } from "./types";

export interface StoreState {
  company: CompanyProfile;
  person: PersonProfile;
  dashboard: Dashboard;
  alerts: Alert[];
  agents: Agent[];
  memories: Memory[];
}

export type MemoryStore = ChatStore & { snapshot(): StoreState & { removedMemoryIds: string[] } };

/**
 * Working copy of one workspace's state for the duration of a chat turn. Defaults to the demo
 * company and sample dashboard (tests); `handleChat` seeds it from the database and saves it back.
 */
export function createMemoryStore(init: Partial<StoreState> = {}): MemoryStore {
  let company = { ...(init.company ?? seedCompany) };
  let person = { ...(init.person ?? seedPerson) };
  let history = initHistory(init.dashboard ?? sampleDashboard);
  const alerts = [...(init.alerts ?? [])];
  const agents = [...(init.agents ?? [])];
  let memories = [...(init.memories ?? [])];
  const removedMemoryIds: string[] = [];
  // Ids that are not UUIDs mark rows the database has not seen yet.
  let n = 0;

  return {
    getCompany: () => company,
    saveCompany(patch) {
      company = { ...company, ...patch };
      return company;
    },
    getPerson: () => person,
    savePerson(patch) {
      person = { ...person, ...patch };
      return person;
    },
    getDashboard: () => history.present,
    dispatch(action: Action) {
      history = reduce(history, action);
      return history.present;
    },
    addAlert(rule) {
      const alert = { id: `new-alert-${++n}`, rule, active: true };
      alerts.push(alert);
      return alert;
    },
    listAlerts: () => alerts,
    addAgent(agent) {
      const created = { id: `new-agent-${++n}`, ...agent };
      agents.push(created);
      return created;
    },
    updateAgent(id, patch) {
      const agent = agents.find((a) => a.id === id);
      return agent && Object.assign(agent, patch);
    },
    listAgents: () => agents,
    listMemories: () => memories,
    addMemory(text) {
      const m = { id: `new-memory-${++n}`, text };
      memories.push(m);
      return m;
    },
    removeMemory(id) {
      const had = memories.some((m) => m.id === id);
      memories = memories.filter((m) => m.id !== id);
      if (had) removedMemoryIds.push(id);
      return had;
    },
    snapshot: () => ({ company, person, dashboard: history.present, alerts, agents, memories, removedMemoryIds }),
  };
}
