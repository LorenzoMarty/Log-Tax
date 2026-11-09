import { initHistory, reduce, type Action } from "@/dashboard/reducer";
import { sampleDashboard } from "@/dashboard/fixtures";
import type { Dashboard } from "@/dashboard/types";
import { seedCompany, type CompanyProfile } from "@/engine";
import type { Agent, Alert, ChatStore } from "./types";

export interface StoreState {
  company: CompanyProfile;
  dashboard: Dashboard;
  alerts: Alert[];
  agents: Agent[];
}

export type MemoryStore = ChatStore & { snapshot(): StoreState };

/**
 * Working copy of one workspace's state for the duration of a chat turn. Defaults to the demo
 * company and sample dashboard (tests); `handleChat` seeds it from the database and saves it back.
 */
export function createMemoryStore(init: Partial<StoreState> = {}): MemoryStore {
  let company = { ...(init.company ?? seedCompany) };
  let history = initHistory(init.dashboard ?? sampleDashboard);
  const alerts = [...(init.alerts ?? [])];
  const agents = [...(init.agents ?? [])];
  // Ids that are not UUIDs mark rows the database has not seen yet.
  let n = 0;

  return {
    getCompany: () => company,
    saveCompany(patch) {
      company = { ...company, ...patch };
      return company;
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
    snapshot: () => ({ company, dashboard: history.present, alerts, agents }),
  };
}
