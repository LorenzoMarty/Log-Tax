import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/ui/log";
import { PortalClients } from "@/portal/clients";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = { title: "Portal do contador" };

export default async function PortalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Logo height={32} />
        <Link href="/workspace" className="text-sm underline">
          Seus espaços
        </Link>
      </header>
      <h1 className="lg-display">Portal do contador</h1>
      <p className="text-sm text-ink-muted">Os clientes que convidaram você, com o que precisa de atenção primeiro.</p>
      <PortalClients />
    </main>
  );
}
