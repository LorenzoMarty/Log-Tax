import { Logo, Panel } from "@/ui/log";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string; excluida?: string }> }) {
  const { erro, excluida } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo height={40} />
      <Panel>
        <h1 className="lg-heading-1">Entrar no Log Tax</h1>
        {excluida && (
          <p role="status" className="rounded-[var(--radius-sm)] bg-brand-tint px-4 py-3 text-sm text-brand-ink">
            Sua conta e todos os seus dados foram excluídos.
          </p>
        )}
        {erro && (
          <p role="alert" className="rounded-[var(--radius-sm)] bg-danger-tint px-4 py-3 text-sm text-danger-ink">
            Não foi possível entrar. Peça um novo link.
          </p>
        )}
        <LoginForm />
      </Panel>
    </main>
  );
}
