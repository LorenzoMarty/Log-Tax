import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { alertStatuses } from "@/alerts/evaluate";
import { ChatPanel } from "@/chat/chat-panel";
import { loadWorkspaceState } from "@/chat/workspace-state";
import { mockEngine } from "@/engine";
import { createClient } from "@/lib/supabase/server";

export default async function WorkspaceChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadWorkspaceState(supabase, id);
  if (!state) notFound();

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{state.workspaceName}</h1>
        <Link href="/workspace" className="text-sm underline">
          Todos os espaços
        </Link>
      </header>
      <ChatPanel workspaceId={id} initialMessages={state.messages} initialDashboard={state.dashboard} initialAlerts={alertStatuses(mockEngine, state.company, state.alerts)} />
    </main>
  );
}
