import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { createDefaultWorkspaces, signOut } from "./actions";

export default async function WorkspacePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: workspaces } = await supabase.from("workspaces").select("id, name, kind").order("created_at");

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Seus espaços</h1>
        <form action={signOut} className="flex items-center gap-3 text-sm">
          <span>{user.email}</span>
          <button type="submit" className="rounded-lg border border-neutral-300 px-3 py-1.5">
            Sair
          </button>
        </form>
      </header>
      {workspaces?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => (
            <li key={w.id} className="rounded-2xl border border-neutral-200 p-4">
              <p className="font-medium">{w.name}</p>
              <p className="text-sm text-neutral-500">{w.kind === "empresa" ? "Empresa" : "Pessoal"}</p>
            </li>
          ))}
        </ul>
      ) : (
        <form action={createDefaultWorkspaces}>
          <button type="submit" className="rounded-xl bg-neutral-900 px-4 py-3 text-white">
            Criar meus espaços
          </button>
        </form>
      )}
    </main>
  );
}
