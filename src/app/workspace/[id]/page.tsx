import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChatPanel } from "@/chat/chat-panel";
import { loadWorkspaceState } from "@/chat/workspace-state";
import { createClient } from "@/lib/supabase/server";
import { Icon, Logo } from "@/ui/log";

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
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Logo height={28} symbolOnly />
          <h1 className="lg-heading-1">{state.workspaceName}</h1>
        </div>
        <Link href="/workspace" className="lg-btn lg-btn-ghost lg-btn-sm">
          <Icon name="chevronLeft" />
          Todos os espaços
        </Link>
      </header>
      <ChatPanel workspaceId={id} initialMessages={state.messages} initialDashboard={state.dashboard} />
    </main>
  );
}
