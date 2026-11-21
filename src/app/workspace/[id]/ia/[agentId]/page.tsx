import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AgentEditor } from "@/agents/agent-editor";
import { TOOL_NAMES } from "@/chat/tools";
import { loadWorkspaceState } from "@/chat/workspace-state";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata = { title: "Editar IA" };

export default async function AgentPage({ params }: { params: Promise<{ id: string; agentId: string }> }) {
  const { id, agentId } = await params;
  if (!UUID.test(id) || !UUID.test(agentId)) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const state = await loadWorkspaceState(supabase, id);
  if (!state || state.role !== "owner") notFound();
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) notFound();
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="lg-heading-1">{agent.name}</h1>
        <Link href={`/workspace/${id}`} className="lg-btn lg-btn-ghost lg-btn-sm">
          Voltar ao espaço
        </Link>
      </header>
      <AgentEditor workspaceId={id} agent={agent} allTools={TOOL_NAMES} />
    </main>
  );
}
