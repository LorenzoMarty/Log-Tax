import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AssetsPanel } from "@/assets/assets-panel";
import { AlertManager } from "@/alerts/alert-manager";
import { NoticesBar, type NoticeRow } from "@/alerts/notices-bar";
import { AlertBar } from "@/alerts/alert-bar";
import { alertStatuses } from "@/alerts/evaluate";
import { ChatPanel } from "@/chat/chat-panel";
import { loadWorkspaceState } from "@/chat/workspace-state";
import { EditableDashboard } from "@/dashboard/editable-dashboard";
import { DashboardView } from "@/dashboard/dashboard-view";
import type { DashboardPage } from "@/dashboard/page-tabs";
import type { Dashboard } from "@/dashboard/types";
import { VersionHistory } from "@/dashboard/version-history";
import { DocumentsPanel, type DocumentRow } from "@/documents/documents-panel";
import { openStored } from "@/documents/storage";
import { InventoryPanel } from "@/inventory/inventory-panel";
import type { AssetRow, EstateRow, HeirRow } from "@/inventory/summary";
import { mockEngine } from "@/engine";
import { createClient } from "@/lib/supabase/server";
import { Icon, Logo } from "@/ui/log";
import { leaveWorkspace } from "@/sharing/actions";
import { Comments, type CommentRow } from "@/sharing/comments";
import { MESSAGES } from "@/sharing/messages";
import { ROLE_LABEL } from "@/sharing/schema";
import { ActivityPanel, type ActivityRow } from "@/sharing/activity-panel";
import { SharePanel, type InviteRow, type MemberRow } from "@/sharing/share-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata = { title: "Espaço" };

export default async function WorkspaceChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ia?: string; msg?: string; pergunta?: string }>;
}) {
  const { id } = await params;
  const { ia, msg, pergunta } = await searchParams;
  if (!UUID.test(id) || (ia && !UUID.test(ia))) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadWorkspaceState(supabase, id, ia);
  if (!state) notFound();
  const isOwner = state.role === "owner";
  if (!isOwner && ia) notFound(); // specialised agents are conversations: owner only

  // The pages of the dashboard (#123): the first is the main one; a specialised AI has its own single panel.
  const { data: pageRows } = ia ? { data: [] } : await supabase.from("dashboards").select("id, data").eq("workspace_id", id).is("agent_id", null).order("created_at");
  const pages: DashboardPage[] = (pageRows ?? []).filter((r) => r.data).map((r) => ({ id: r.id, name: (r.data as Dashboard).name, dashboard: r.data as Dashboard }));

  const { data: documents } = await supabase
    .from("documents")
    .select("id, name, doc_type, extracted, size_bytes, mime_type, created_at")
    .eq("workspace_id", id)
    .order("created_at", { ascending: false });
  const [{ data: estate }, { data: heirs }, { data: assets }] =
    state.kind === "pessoal"
      ? await Promise.all([
          supabase.from("estates").select("deceased_name, died_at, uf").eq("workspace_id", id).maybeSingle(),
          supabase.from("heirs").select("id, name, relationship, share").eq("workspace_id", id).order("created_at"),
          supabase.from("assets").select("id, kind, description, value").eq("workspace_id", id).order("created_at"),
        ])
      : [{ data: null }, { data: [] }, { data: [] }];
  const inventoryPanel = estate && (
    <InventoryPanel
      estate={estate as EstateRow}
      heirs={(heirs ?? []) as HeirRow[]}
      assets={(assets ?? []) as AssetRow[]}
      fileNames={(documents ?? []).map((d) => d.name)}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
  const { data: comments } = await supabase
    .from("comments")
    .select("id, author_id, author_email, widget_id, body, created_at, parent_id, resolved_at")
    .eq("workspace_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  const { data: notices } = isOwner
    ? await supabase.from("alert_events").select("id, text, current_text, created_at, read_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(50)
    : { data: [] };
  const [{ data: members }, { data: invites }, { data: activity }] = isOwner
    ? await Promise.all([
        supabase.from("workspace_members").select("user_id, email, role").eq("workspace_id", id).order("role", { ascending: false }),
        supabase.from("workspace_invites").select("id, email, role").eq("workspace_id", id).order("created_at"),
        supabase.from("audit_log").select("id, actor_email, action, target, created_at").eq("workspace_id", id).order("created_at", { ascending: false }).limit(30),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const alerts = state.kind === "pessoal" ? [] : alertStatuses(mockEngine, state.company, state.alerts);
  const notice = msg ? MESSAGES[msg] : undefined;
  const documentsPanel = <DocumentsPanel workspaceId={id} documents={((documents ?? []) as DocumentRow[]).map((d) => ({ ...d, extracted: openStored(d.extracted) }))} canEdit={isOwner} />;
  const assetsPanel = state.kind === "pessoal" ? <AssetsPanel assets={(assets ?? []) as AssetRow[]} /> : null;
  const commentsPanel = (
    <Comments
      workspaceId={id}
      comments={(comments ?? []) as CommentRow[]}
      canComment={state.role !== "reader"}
      isOwner={isOwner}
      userId={user.id}
      widgets={state.dashboard.widgets.map((w) => ({ id: w.id, title: w.title }))}
    />
  );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Logo height={28} symbolOnly />
          <h1 className="lg-heading-1">
            {state.workspaceName}
            {state.agent && <span className="font-normal text-ink-muted"> · {state.agent.name}</span>}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && state.agent && (
            <Link href={`/workspace/${id}/ia/${state.agent.id}`} className="lg-btn lg-btn-ghost lg-btn-sm">
              Editar esta IA
            </Link>
          )}
          <Link href="/workspace" className="lg-btn lg-btn-ghost lg-btn-sm">
            <Icon name="chevronLeft" />
            Todos os espaços
          </Link>
        </div>
      </header>

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${notice.ok ? "bg-brand-tint text-brand-ink" : "bg-danger-tint text-danger-ink"}`}>
          {notice.text}
        </p>
      )}

      {isOwner ? (
        <>
          <NoticesBar workspaceId={id} notices={(notices ?? []) as NoticeRow[]} />
          <ChatPanel
            key={ia ?? "geral"}
            workspaceId={id}
            agentId={state.agent?.id}
            initialAgents={state.agents}
            initialMessages={state.messages}
            initialDashboard={state.dashboard}
            initialPages={pages}
            initialAlerts={alerts}
            workspaceKind={state.kind}
            initialPrompt={pergunta?.slice(0, 1000)}
          />
          {state.kind !== "pessoal" && <AlertManager workspaceId={id} alerts={state.alerts} />}
          <SharePanel workspaceId={id} defaultOpen={Boolean(notice)} members={(members ?? []) as MemberRow[]} invites={(invites ?? []) as InviteRow[]} />
          {assetsPanel}
          {inventoryPanel}
          {documentsPanel}
          {commentsPanel}
          <ActivityPanel events={(activity ?? []) as ActivityRow[]} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line px-4 py-3 text-sm">
            <p data-testid="shared-banner">
              Compartilhado com você · <strong>{ROLE_LABEL[state.role]}</strong>. Você vê o painel, os alertas e os comentários; só o dono conversa com a IA.
            </p>
            <form action={leaveWorkspace.bind(null, id)}>
              <button type="submit" className="rounded-lg border border-line px-3 py-1.5">
                Sair deste espaço
              </button>
            </form>
          </div>
          <AlertBar alerts={alerts} />
          {state.role === "editor" ? (
            <EditableDashboard workspaceId={id} initial={state.dashboard} />
          ) : (
            <>
              <VersionHistory workspaceId={id} dashboard={state.dashboard} readOnly />
              <DashboardView dashboard={state.dashboard} />
            </>
          )}
          {assetsPanel}
          {inventoryPanel}
          {documentsPanel}
          {commentsPanel}
        </>
      )}
    </main>
  );
}
