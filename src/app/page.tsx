import Link from "next/link";
import { Logo } from "@/ui/log";

export const metadata = { alternates: { canonical: "/" } };

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-10">
      <Logo height={40} />
      <h1 className="lg-display">O que você precisa resolver?</h1>
      <p className="text-lg text-ink">Log Tax é um assistente de inteligência tributária: você conversa e ele organiza, calcula e acompanha os seus impostos.</p>
      <ul className="list-disc space-y-1 pl-5 text-ink">
        <li>Descubra quanto paga de imposto e para onde vai o dinheiro.</li>
        <li>Veja oportunidades legais de economia e simule cenários.</li>
        <li>Monte painéis, alertas e relatórios só conversando, e compartilhe com a sua contadora.</li>
      </ul>
      <div>
        <Link href="/login" className="lg-btn lg-btn-primary">
          Entrar
        </Link>
      </div>
      <section aria-labelledby="perguntas" className="flex flex-col gap-3">
        <h2 id="perguntas" className="lg-heading-1">
          Perguntas que você pode fazer
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-ink">
          <li>Quanto estou pagando de imposto, e por quê?</li>
          <li>Existe alguma forma legal de pagar menos?</li>
          <li>Se meu faturamento aumentar, o que acontece?</li>
          <li>Tenho alguma obrigação ou prazo chegando?</li>
          <li>Quanto vou pagar na declaração do Imposto de Renda?</li>
        </ul>
        <p className="text-ink-muted">Sem termos técnicos: quando aparecer um, a IA explica em palavras comuns.</p>
      </section>
      <p className="text-sm text-ink-muted">Log Tax mostra estimativas ilustrativas. Valide qualquer decisão com um contador.</p>
    </main>
  );
}
