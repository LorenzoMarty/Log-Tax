import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";

/** The steps of the journey (PRD §30), in funnel order. An event carries no value and no text: only the step. */
export const FUNNEL = ["signed_in", "workspace_created", "first_diagnosis", "opportunities_viewed", "simulated", "alert_created", "agent_created"] as const;
export type ProductEvent = (typeof FUNNEL)[number];

export const FUNNEL_LABEL: Record<ProductEvent, string> = {
  signed_in: "Entrou",
  workspace_created: "Criou um espaço",
  first_diagnosis: "Viu o primeiro diagnóstico",
  opportunities_viewed: "Viu oportunidades",
  simulated: "Simulou um cenário",
  alert_created: "Criou um alerta",
  agent_created: "Criou uma IA",
};

/** Which successful tool means which funnel step. */
export const EVENT_OF_TOOL: Record<string, ProductEvent> = {
  get_tax_diagnosis: "first_diagnosis",
  get_ir_diagnosis: "first_diagnosis",
  list_opportunities: "opportunities_viewed",
  run_simulation: "simulated",
  create_alert: "alert_created",
  create_agent: "agent_created",
  create_workspace: "workspace_created",
};

/** Records a step. The database drops it unless the person opted in, so callers never check consent. */
export async function track(sb: SupabaseClient, event: ProductEvent): Promise<void> {
  const { error } = await sb.rpc("track_event", { p_event: event });
  if (error) log("warn", "track_failed", { event, error: { message: error.message } });
}
