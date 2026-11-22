import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { saveDisplayName } from "@/account/profile-actions";
import { parseTheme, THEME_COOKIE } from "@/account/theme";
import { saveTheme } from "@/account/theme-actions";
import { createClient } from "@/lib/supabase/server";
import { Button, Icon, Input, Logo } from "@/ui/log";

export const metadata = { title: "Minha conta" };

const NOTICE: Record<string, { text: string; ok: boolean }> = {
  "nome-salvo": { text: "Nome salvo.", ok: true },
  "tema-salvo": { text: "Tema salvo.", ok: true },
  "nome-invalido": { text: "Digite um nome de 1 a 80 caracteres.", ok: false },
  falhou: { text: "Não foi possível salvar agora. Tente de novo.", ok: false },
};

const THEMES = [
  { value: "auto", label: "Automático (segue o aparelho)" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];

/** Where a person sees their email, changes their name and reaches privacy, security and the data export (#157). */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const notice = ok ? NOTICE[ok] : undefined;
  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <Logo height={28} />
        <Link href="/workspace" className="lg-btn lg-btn-ghost lg-btn-sm">
          <Icon name="chevronLeft" />
          Seus espaços
        </Link>
      </header>
      <h1 className="lg-display">Minha conta</h1>
      {notice && (
        <p role="status" className={`rounded-[var(--radius-md)] px-4 py-3 text-sm ${notice.ok ? "bg-brand-tint text-brand-ink" : "bg-surface-sunken text-ink"}`}>
          {notice.text}
        </p>
      )}

      <h2 className="lg-heading-1">Perfil</h2>
      <p className="text-sm">
        <span className="text-ink-muted">Email:</span> <strong>{user.email}</strong>
      </p>
      <form action={saveDisplayName} className="flex flex-wrap items-end gap-3">
        <Input id="account-name" name="name" label="Seu nome" defaultValue={name} maxLength={80} autoComplete="name" className="min-w-0" />
        <Button type="submit" variant="primary">
          Salvar nome
        </Button>
      </form>

      <h2 className="lg-heading-1">Preferências</h2>
      <form action={saveTheme} className="flex flex-wrap items-end gap-3">
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 text-ink-muted">Tema</legend>
          {THEMES.map((t) => (
            <label key={t.value} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="theme" value={t.value} defaultChecked={t.value === theme} />
              {t.label}
            </label>
          ))}
        </fieldset>
        <Button type="submit" variant="primary">
          Salvar tema
        </Button>
      </form>

      <h2 className="lg-heading-1">Privacidade e segurança</h2>
      <ul className="flex flex-col gap-2 text-sm">
        <li>
          <Link href="/workspace/seguranca" className="underline">
            Segurança da conta (verificação em duas etapas e dispositivos)
          </Link>
        </li>
        <li>
          <Link href="/workspace/privacidade" className="underline">
            Privacidade e consentimentos
          </Link>
        </li>
        <li>
          <a href="/api/account/export" download className="underline">
            Baixar uma cópia de todos os meus dados (JSON)
          </a>
        </li>
      </ul>
    </main>
  );
}
