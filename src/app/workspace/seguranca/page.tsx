import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon, Logo } from "@/ui/log";
import { SecurityPanel } from "./security-panel";

export const metadata = { title: "Segurança da conta" };

const NOTICE: Record<string, string> = {
  ativado: "Verificação em duas etapas ativada.",
  desativado: "Verificação em duas etapas desativada.",
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
    </main>
  );
}
