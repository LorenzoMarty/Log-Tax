import { createClient } from "@/lib/supabase/server";
import { Badge, Button, Icon, Logo } from "@/ui/log";
import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInvite, declineInvite } from "@/sharing/actions";
import { MESSAGES } from "@/sharing/messages";
import { ROLE_LABEL, type Role } from "@/sharing/schema";
import { createDefaultWorkspaces, signOut } from "./actions";

export const metadata = { title: "Seus espaços" };

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
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Logo height={32} />
        <form action={signOut} className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-ink-muted">
          <span className="break-all">{user.email}</span>
          <Button type="submit" variant="ghost" size="sm">
            Sair
          </Button>
        </form>
      </header>
      <h1 className="lg-display">Seus espaços</h1>

      {notice && (
        <p role="status" className={`rounded-[var(--radius-md)] px-4 py-3 text-sm ${notice.ok ? "bg-brand-tint text-brand-ink" : "bg-danger-tint text-danger-ink"}`}>
          {notice.text}
        </p>
      )}

      {invites && invites.length > 0 && (
        <section aria-label="Convites" className="flex flex-col gap-2">
          {invites.map((i) => (
            <div key={i.id} data-testid="invite" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-warning-tint px-4 py-3 text-sm text-warning-ink">
              <p>
                <strong>{i.invited_by_email}</strong> convidou você para <strong>{i.workspace_name}</strong> ({ROLE_LABEL[i.role as Role]}).
              </p>
              <div className="flex gap-2">
                <form action={acceptInvite.bind(null, i.id)}>
                  <Button type="submit" variant="inverse" size="sm">
                    Aceitar
                  </Button>
                </form>
                <form action={declineInvite.bind(null, i.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Recusar
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      {workspaces?.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((w) => {
            const role = roleOf.get(w.id);
            return (
              <li key={w.id}>
                <Link href={`/workspace/${w.id}`} className="lg-surface-card">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-ink">{w.name}</span>
                    <Icon name="chevronRight" className="text-ink-muted" />
                  </span>
                  <span className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge tone={w.kind === "empresa" ? "info" : "brand"}>{w.kind === "empresa" ? "Empresa" : "Pessoal"}</Badge>
                    {w.owner_id !== user.id && role && <span className="text-xs text-ink-muted">Compartilhado com você · {ROLE_LABEL[role]}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="text-sm text-ink-muted">
        Seus dados são seus.{" "}
        <a href="/api/account/export" download className="underline">
          Baixar uma cópia de todos os meus dados (JSON)
        </a>
      </p>

      {owned.length === 0 && (
        <form action={createDefaultWorkspaces}>
          <Button type="submit" variant="primary" icon="plus">
            Criar meus espaços
          </Button>
        </form>
      )}
    </main>
  );
}
