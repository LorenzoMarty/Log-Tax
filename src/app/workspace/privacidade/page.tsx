import Link from "next/link";
import { redirect } from "next/navigation";
import { deleteAllMyDocuments, grantDocumentsConsent, revokeDocumentsConsent } from "@/account/consent-actions";
import { createClient } from "@/lib/supabase/server";
import { Button, Icon, Logo } from "@/ui/log";

export const metadata = { title: "Privacidade e consentimentos" };

const NOTICE: Record<string, { text: string; ok: boolean }> = {
  revogado: { text: "Consentimento revogado. Novos envios de documentos estão bloqueados.", ok: true },
  concedido: { text: "Consentimento registrado.", ok: true },
  apagados: { text: "Todos os seus documentos foram apagados.", ok: true },
  falhou: { text: "Não foi possível apagar os documentos agora. Nada foi alterado: tente de novo.", ok: false },
};

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: history }, { data: active }, { count }] = await Promise.all([
    sb.from("consents").select("id, version, action, created_at").eq("purpose", "documents").order("created_at", { ascending: false }),
    sb.rpc("has_consent", { p_purpose: "documents" }),
    sb.from("documents").select("*", { count: "exact", head: true }),
  ]);
  const notice = ok ? NOTICE[ok] : undefined;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <Logo height={28} />
        <Link href="/workspace" className="lg-btn lg-btn-ghost lg-btn-sm">
          <Icon name="chevronLeft" />
          Seus espaços
        </Link>
      </header>
      <h1 className="lg-display">Privacidade e consentimentos</h1>
      {notice && (
        <p role="status" className={`rounded-[var(--radius-md)] px-4 py-3 text-sm ${notice.ok ? "bg-brand-tint text-brand-ink" : "bg-danger-tint text-danger-ink"}`}>
          {notice.text}
        </p>
      )}

      <section aria-labelledby="docs" className="flex flex-col gap-3">
        <h2 id="docs" className="lg-heading-1">
          Documentos
        </h2>
        <p>
          Você autorizou o Log Tax a armazenar e ler os documentos que envia, para organizar e analisar seus impostos. Situação atual: <strong data-testid="consent-state">{active === true ? "autorizado" : "não autorizado"}</strong>.
        </p>
        {active === true ? (
          <form action={revokeDocumentsConsent}>
            <Button type="submit">Revogar autorização</Button>
          </form>
        ) : (
          <form action={grantDocumentsConsent}>
            <Button type="submit" variant="primary">
              Autorizar de novo
            </Button>
          </form>
        )}
        {active !== true && (count ?? 0) > 0 && (
          <form action={deleteAllMyDocuments} className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-warning-tint px-4 py-3 text-sm text-warning-ink">
            <p>
              Você ainda tem <strong>{count}</strong> documento(s) armazenado(s). Revogar a autorização impede novos envios, mas não apaga o que já está guardado.
            </p>
            <div>
              <Button type="submit" size="sm">
                Apagar todos os meus documentos
              </Button>
            </div>
          </form>
        )}
        <h3 className="font-semibold">Histórico</h3>
        {history?.length ? (
          <ul data-testid="consent-history" className="divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-3 py-2">
                <span>
                  {h.action === "granted" ? "Autorizou" : "Revogou"} <span className="text-ink-muted">(texto versão {h.version})</span>
                </span>
                <time dateTime={h.created_at} className="text-ink-muted">
                  {when(h.created_at)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma decisão registrada ainda.</p>
        )}
      </section>
    </main>
  );
}
