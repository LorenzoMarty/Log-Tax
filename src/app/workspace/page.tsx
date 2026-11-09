import { createClient } from "@/lib/supabase/server";
import { Badge, Button, Icon, Logo } from "@/ui/log";
import Link from "next/link";
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
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Logo height={32} />
        <form action={signOut} className="flex items-center gap-3 text-sm text-ink-muted">
          <span>{user.email}</span>
          <Button type="submit" variant="ghost" size="sm">
            Sair
          </Button>
        </form>
      </header>
      <h1 className="lg-display">Seus espaços</h1>
      {workspaces?.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link href={`/workspace/${w.id}`} className="lg-surface-card">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-ink">{w.name}</span>
                  <Icon name="chevronRight" className="text-ink-muted" />
                </span>
                <span className="mt-3 block">
                  <Badge tone={w.kind === "empresa" ? "info" : "brand"}>{w.kind === "empresa" ? "Empresa" : "Pessoal"}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <form action={createDefaultWorkspaces}>
          <Button type="submit" variant="primary" icon="plus">
            Criar meus espaços
          </Button>
        </form>
      )}
    </main>
  );
}
