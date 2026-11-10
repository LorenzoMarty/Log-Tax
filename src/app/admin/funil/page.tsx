import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FUNNEL, FUNNEL_LABEL, type ProductEvent } from "@/lib/track";
import { Logo } from "@/ui/log";

export const metadata = { title: "Funil da jornada", robots: { index: false, follow: false } };

export default async function FunnelPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!isAdmin(user?.email)) notFound();

  const { data } = await createAdminClient().from("product_funnel").select("event, people");
  const people = new Map((data ?? []).map((r) => [r.event as ProductEvent, Number(r.people)]));
  const top = Math.max(1, ...FUNNEL.map((e) => people.get(e) ?? 0));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <Logo height={28} />
      <h1 className="lg-display">Funil da jornada</h1>
      <p className="text-sm text-ink-muted">Pessoas distintas que chegaram a cada etapa. Só entram aqui quem autorizou a medição; nenhum evento guarda valores ou mensagens.</p>
      <ol data-testid="funnel" className="flex flex-col gap-3">
        {FUNNEL.map((event) => {
          const n = people.get(event) ?? 0;
          return (
            <li key={event} className="flex flex-col gap-1">
              <span className="flex justify-between text-sm">
                <span>{FUNNEL_LABEL[event]}</span>
                <strong>{n}</strong>
              </span>
              <span className="h-2 rounded-full bg-surface-sunken" aria-hidden="true">
                <span className="block h-2 rounded-full bg-brand" style={{ width: `${Math.round((n / top) * 100)}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
