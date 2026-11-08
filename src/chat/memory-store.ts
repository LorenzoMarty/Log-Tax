import { initHistory, reduce, type Action } from "@/dashboard/reducer";
import { sampleDashboard } from "@/dashboard/fixtures";
import type { Dashboard } from "@/dashboard/types";
import { seedCompany } from "@/engine";
import type { Agent, Alert, ChatStore } from "./types";

/** In-memory store seeded with the demo company and dashboard. The Supabase store replaces it in the journey ticket. */
export function createMemoryStore(dashboard: Dashboard = sampleDashboard): ChatStore {
  let company = { ...seedCompany };
  let history = initHistory(dashboard);
  const alerts: Alert[] = [];
  const agents: Agent[] = [];

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
      const alert = { id: `al${alerts.length + 1}`, rule, active: true };
      alerts.push(alert);
      return alert;
    },
    listAlerts: () => alerts,
    addAgent(agent) {
      const created = { id: `ag${agents.length + 1}`, ...agent };
      agents.push(created);
      return created;
    },
    updateAgent(id, patch) {
      const agent = agents.find((a) => a.id === id);
      return agent && Object.assign(agent, patch);
    },
    listAgents: () => agents,
  };
}
