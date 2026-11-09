import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { alertStatuses } from "@/alerts/evaluate";
import { ChatPanel } from "@/chat/chat-panel";
import { loadWorkspaceState } from "@/chat/workspace-state";
import { mockEngine } from "@/engine";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WorkspaceChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ia?: string }>;
}) {
  const { id } = await params;
  const { ia } = await searchParams;
  if (!UUID.test(id) || (ia && !UUID.test(ia))) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadWorkspaceState(supabase, id, ia);
  if (!state) notFound();

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {state.workspaceName}
          {state.agent && <span className="font-normal text-neutral-500"> · {state.agent.name}</span>}
        </h1>
        <Link href="/workspace" className="text-sm underline">
          Todos os espaços
        </Link>
      </header>
      <ChatPanel
        key={ia ?? "geral"}
        workspaceId={id}
        agentId={state.agent?.id}
        initialAgents={state.agents}
        initialMessages={state.messages}
        initialDashboard={state.dashboard}
        initialAlerts={state.kind === "pessoal" ? [] : alertStatuses(mockEngine, state.company, state.alerts)}
      />
    </main>
  );
}
