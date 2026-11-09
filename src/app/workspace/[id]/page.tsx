import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertBar } from "@/alerts/alert-bar";
import { alertStatuses } from "@/alerts/evaluate";
import { ChatPanel } from "@/chat/chat-panel";
import { loadWorkspaceState } from "@/chat/workspace-state";
import { DashboardView } from "@/dashboard/dashboard-view";
import { DocumentsPanel, type DocumentRow } from "@/documents/documents-panel";
import { mockEngine } from "@/engine";
import { createClient } from "@/lib/supabase/server";
import { Icon, Logo } from "@/ui/log";
import { leaveWorkspace } from "@/sharing/actions";
import { Comments, type CommentRow } from "@/sharing/comments";
import { MESSAGES } from "@/sharing/messages";
import { ROLE_LABEL } from "@/sharing/schema";
import { SharePanel, type InviteRow, type MemberRow } from "@/sharing/share-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WorkspaceChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ia?: string; msg?: string }>;
}) {
  const { id } = await params;
  const { ia, msg } = await searchParams;
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

  const { data: documents } = await supabase
    .from("documents")
    .select("id, name, doc_type, extracted, size_bytes, created_at")
    .eq("workspace_id", id)
    .order("created_at", { ascending: false });
  const { data: comments } = await supabase
    .from("comments")
    .select("id, author_id, author_email, widget_id, body, created_at")
    .eq("workspace_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  const [{ data: members }, { data: invites }] = isOwner
    ? await Promise.all([
        supabase.from("workspace_members").select("user_id, email, role").eq("workspace_id", id).order("role", { ascending: false }),
        supabase.from("workspace_invites").select("id, email, role").eq("workspace_id", id).order("created_at"),
      ])
    : [{ data: [] }, { data: [] }];

  const alerts = state.kind === "pessoal" ? [] : alertStatuses(mockEngine, state.company, state.alerts);
  const notice = msg ? MESSAGES[msg] : undefined;
  const documentsPanel = <DocumentsPanel workspaceId={id} documents={(documents ?? []) as DocumentRow[]} canEdit={isOwner} />;
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
        <Link href="/workspace" className="lg-btn lg-btn-ghost lg-btn-sm">
          <Icon name="chevronLeft" />
          Todos os espaços
        </Link>
      </header>

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${notice.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`}>
          {notice.text}
        </p>
      )}

      {isOwner ? (
        <>
          <ChatPanel
            key={ia ?? "geral"}
            workspaceId={id}
            agentId={state.agent?.id}
            initialAgents={state.agents}
            initialMessages={state.messages}
            initialDashboard={state.dashboard}
            initialAlerts={alerts}
          />
          <SharePanel workspaceId={id} defaultOpen={Boolean(notice)} members={(members ?? []) as MemberRow[]} invites={(invites ?? []) as InviteRow[]} />
          {documentsPanel}
          {commentsPanel}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-neutral-200 px-4 py-3 text-sm">
            <p data-testid="shared-banner">
              Compartilhado com você · <strong>{ROLE_LABEL[state.role]}</strong>. Você vê o painel, os alertas e os comentários; só o dono conversa com a IA.
            </p>
            <form action={leaveWorkspace.bind(null, id)}>
              <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5">
                Sair deste espaço
              </button>
            </form>
          </div>
          <AlertBar alerts={alerts} />
          <DashboardView dashboard={state.dashboard} />
          {documentsPanel}
          {commentsPanel}
        </>
      )}
    </main>
  );
}
