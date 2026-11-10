import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo, Panel } from "@/ui/log";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Confirmar acesso" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.nextLevel !== "aal2" || aal.data.currentLevel === "aal2") redirect("/workspace"); // nothing pending

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo height={40} />
      <Panel>
        <h1 className="lg-heading-1">Confirme que é você</h1>
        <p className="text-ink-muted">Sua conta usa verificação em duas etapas. Digite o código do aplicativo autenticador.</p>
        <VerifyForm recoveryFailed={erro === "recuperacao"} />
      </Panel>
    </main>
  );
}
