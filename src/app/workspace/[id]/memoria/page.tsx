import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadWorkspaceState } from "@/chat/workspace-state";
import { createClient } from "@/lib/supabase/server";
import { MemoryManager, type MemoryItem } from "@/memory/memory-manager";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata = { title: "O que a IA lembra" };

export default async function MemoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const state = await loadWorkspaceState(supabase, id);
  if (!state || state.role !== "owner") notFound();
  const { data } = await supabase.from("workspace_memories").select("id, text, agent_id").eq("workspace_id", id).order("created_at");
  const agentName = new Map(state.agents.map((a) => [a.id, a.name]));
  const items: MemoryItem[] = (data ?? []).map((m) => ({
    id: m.id,
    text: m.text,
    scope: m.agent_id ? `Só na IA ${agentName.get(m.agent_id) ?? "removida"}` : "Em todo o espaço",
  }));
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="lg-heading-1">O que a IA lembra em {state.workspaceName}</h1>
        <Link href={`/workspace/${id}`} className="lg-btn lg-btn-ghost lg-btn-sm">
          Voltar ao espaço
        </Link>
      </header>
      <p className="text-sm text-ink-muted">
        Preferências e fatos que você pediu para a IA guardar. Só você, dono do espaço, vê esta lista; convidados nunca a veem.
      </p>
      <MemoryManager workspaceId={id} initial={items} />
    </main>
  );
}
