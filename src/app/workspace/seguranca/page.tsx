import Link from "next/link";
import { redirect } from "next/navigation";
import { deviceLabel } from "@/account/devices";
import { revokeSession, signOutEverywhere } from "@/account/session-actions";
import { createClient } from "@/lib/supabase/server";
import { Button, Icon, Logo } from "@/ui/log";
import { SecurityPanel } from "./security-panel";

export const metadata = { title: "Segurança da conta" };

const NOTICE: Record<string, string> = {
  ativado: "Verificação em duas etapas ativada.",
  desativado: "Verificação em duas etapas desativada.",
  "sessao-encerrada": "Sessão encerrada.",
  recuperado: "Código aceito. A verificação em duas etapas foi desativada: ative-a de novo quando quiser.",
};

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const factors = await sb.auth.mfa.listFactors();
  const { data: sessions } = await sb.rpc("my_sessions");
  const enabled = (factors.data?.totp.length ?? 0) > 0; // listFactors().totp only holds verified factors

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <Logo height={28} />
        <Link href="/workspace" className="lg-btn lg-btn-ghost lg-btn-sm">
          <Icon name="chevronLeft" />
          Seus espaços
        </Link>
      </header>
      <h1 className="lg-display">Segurança da conta</h1>
      {ok && NOTICE[ok] && (
        <p role="status" className="rounded-[var(--radius-md)] bg-brand-tint px-4 py-3 text-sm text-brand-ink">
          {NOTICE[ok]}
        </p>
      )}
      <h2 className="lg-heading-1">Verificação em duas etapas</h2>
      <SecurityPanel enabled={enabled} />

      <h2 className="lg-heading-1">Dispositivos conectados</h2>
      <ul data-testid="sessions" className="divide-y divide-line text-sm">
        {((sessions ?? []) as { id: string; created_at: string; refreshed_at: string | null; user_agent: string | null; ip: string | null; is_current: boolean }[]).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span>
              <strong>{deviceLabel(s.user_agent)}</strong>
              {s.is_current && <span className="ml-2 rounded-full bg-brand-tint px-2 py-0.5 text-xs text-brand-ink">Este dispositivo</span>}
              <span className="block text-ink-muted">
                {s.ip ?? "IP desconhecido"} · entrou em {new Date(s.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })}
              </span>
            </span>
            {!s.is_current && (
              <form action={revokeSession}>
                <input type="hidden" name="session" value={s.id} />
                <Button type="submit" size="sm">
                  Encerrar
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <form action={signOutEverywhere}>
        <Button type="submit">Sair de todos os dispositivos</Button>
      </form>
    </main>
  );
}
