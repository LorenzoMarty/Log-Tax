import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInvite, declineInvite } from "@/sharing/actions";
import { MESSAGES } from "@/sharing/messages";
import { ROLE_LABEL, type Role } from "@/sharing/schema";
import { createDefaultWorkspaces, signOut } from "./actions";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { msg } = await searchParams;

  const [{ data: workspaces }, { data: roles }, { data: invites }] = await Promise.all([
    supabase.from("workspaces").select("id, name, kind, owner_id").order("created_at"),
    supabase.from("workspace_members").select("workspace_id, role").eq("user_id", user.id),
    supabase.from("workspace_invites").select("id, workspace_name, role, invited_by_email").eq("email", (user.email ?? "").toLowerCase()),
  ]);
  const roleOf = new Map((roles ?? []).map((r) => [r.workspace_id, r.role as Role]));
  const owned = (workspaces ?? []).filter((w) => w.owner_id === user.id);
  const notice = msg ? MESSAGES[msg] : undefined;

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

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${notice.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-800"}`}>
          {notice.text}
        </p>
      )}

      {invites && invites.length > 0 && (
        <section aria-label="Convites" className="space-y-2">
          {invites.map((i) => (
            <div key={i.id} data-testid="invite" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p>
                <strong>{i.invited_by_email}</strong> convidou você para <strong>{i.workspace_name}</strong> ({ROLE_LABEL[i.role as Role]}).
              </p>
              <div className="flex gap-2">
                <form action={acceptInvite.bind(null, i.id)}>
                  <button type="submit" className="rounded-lg bg-amber-900 px-3 py-1.5 text-white">
                    Aceitar
                  </button>
                </form>
                <form action={declineInvite.bind(null, i.id)}>
                  <button type="submit" className="rounded-lg border border-amber-900 px-3 py-1.5">
                    Recusar
                  </button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      {workspaces?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((w) => {
            const role = roleOf.get(w.id);
            return (
              <li key={w.id}>
                <Link href={`/workspace/${w.id}`} className="block rounded-2xl border border-neutral-200 p-4 hover:border-neutral-400">
                  <p className="font-medium">{w.name}</p>
                  <p className="text-sm text-neutral-500">{w.kind === "empresa" ? "Empresa" : "Pessoal"}</p>
                  {w.owner_id !== user.id && role && <p className="mt-1 text-xs text-neutral-500">Compartilhado com você · {ROLE_LABEL[role]}</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {owned.length === 0 && (
        <form action={createDefaultWorkspaces}>
          <button type="submit" className="rounded-xl bg-neutral-900 px-4 py-3 text-white">
            Criar meus espaços
          </button>
        </form>
      )}
    </main>
  );
}
