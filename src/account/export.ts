import type { SupabaseClient, User } from "@supabase/supabase-js";
import { BUCKET, openStored, type StoredExtraction } from "@/documents/storage";

/** How long a document download link in the export stays valid. */
export const LINK_SECONDS = 3600;

type Row = Record<string, unknown>;
const rows = (r: { data: Row[] | null }) => r.data ?? [];

/**
 * Everything the signed-in person owns, plus what they wrote or were given access to.
 * Reads run with the caller's own session, so the database (RLS) is what keeps other people's data out.
 */
export async function buildExport(sb: SupabaseClient, user: Pick<User, "id" | "email" | "created_at">) {
  const owned = rows(await sb.from("workspaces").select("*").eq("owner_id", user.id).order("created_at"));
  const ids = owned.map((w) => w.id as string);
  const inOwned = (table: string, columns = "*") => sb.from(table).select(columns).in("workspace_id", ids);

  const [dashboards, alerts, agents, conversations, agentConversations, documents, members, invitesSent, comments, shared, audit] = await Promise.all([
    inOwned("dashboards"),
    inOwned("alerts"),
    inOwned("agents"),
    inOwned("conversations"),
    inOwned("agent_conversations"),
    inOwned("documents"),
    inOwned("workspace_members", "workspace_id, user_id, email, role"),
    sb.from("workspace_invites").select("*").eq("invited_by", user.id),
    sb.from("comments").select("*").eq("author_id", user.id),
    sb.from("workspace_members").select("workspace_id, role").eq("user_id", user.id).neq("role", "owner"),
    inOwned("audit_log", "actor_email, workspace_id, action, target, created_at"),
  ]);

  const docRows = rows(documents as { data: Row[] | null });
  const paths = docRows.map((d) => d.storage_path as string | null).filter((p): p is string => Boolean(p));
  const signed = paths.length ? (await sb.storage.from(BUCKET).createSignedUrls(paths, LINK_SECONDS)).data ?? [] : [];
  const urlOf = new Map(signed.map((s) => [s.path, s.signedUrl]));

  return {
    exported_at: new Date().toISOString(),
    notice: `Cópia dos dados da sua conta no Log Tax. Os links de download dos documentos valem ${LINK_SECONDS / 60} minutos: gere uma nova exportação para renovar.`,
    profile: { id: user.id, email: user.email, created_at: user.created_at },
    workspaces: owned,
    dashboards: rows(dashboards as { data: Row[] | null }),
    alerts: rows(alerts as { data: Row[] | null }),
    agents: rows(agents as { data: Row[] | null }),
    conversations: rows(conversations as { data: Row[] | null }),
    agent_conversations: rows(agentConversations as { data: Row[] | null }),
    documents: docRows.map((d) => ({ ...d, extracted: openStored(d.extracted as StoredExtraction | null), download_url: urlOf.get(d.storage_path as string) ?? null })),
    members_of_my_workspaces: rows(members as { data: Row[] | null }),
    invites_sent: rows(invitesSent),
    comments_written: rows(comments),
    spaces_shared_with_me: rows(shared),
    activity_in_my_workspaces: rows(audit as { data: Row[] | null }),
  };
}
