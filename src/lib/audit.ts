import type { SupabaseClient } from "@supabase/supabase-js";

/** Every event the trail records. Account events (login, export, deletion) have no workspace. */
export type AuditAction =
  | "login"
  | "invite_sent"
  | "invite_revoked"
  | "invite_accepted"
  | "member_removed"
  | "member_left"
  | "document_uploaded"
  | "document_deleted"
  | "destructive_action"
  | "data_exported"
  | "account_deleted"
  | "mfa_enabled"
  | "mfa_disabled"
  | "mfa_recovery_used";

export const AUDIT_LABEL: Record<AuditAction, string> = {
  login: "Entrou no Log Tax",
  invite_sent: "Convidou alguém",
  invite_revoked: "Cancelou um convite",
  invite_accepted: "Aceitou um convite",
  member_removed: "Removeu um acesso",
  member_left: "Saiu do espaço",
  document_uploaded: "Enviou um documento",
  document_deleted: "Apagou um documento",
  destructive_action: "Confirmou uma ação destrutiva na conversa",
  data_exported: "Exportou os dados",
  account_deleted: "Excluiu a conta",
  mfa_enabled: "Ativou a verificação em duas etapas",
  mfa_disabled: "Desativou a verificação em duas etapas",
  mfa_recovery_used: "Usou um código de recuperação",
};

/**
 * Appends one event to the audit trail as the signed-in caller (the database stamps the actor).
 * Example: `await audit(sb, workspaceId, "invite_sent", "ana@example.com")`.
 */
export async function audit(sb: SupabaseClient, workspaceId: string | null, action: AuditAction, target?: string): Promise<void> {
  const { error } = await sb.rpc("audit_record", { p_workspace: workspaceId, p_action: action, p_target: target ?? null });
  // ponytail: a failed write is logged, not fatal, so an audit outage does not block the user's action.
  if (error) console.error("audit failed:", action, error.message);
}
