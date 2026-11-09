import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">O que você precisa resolver?</h1>
      <p className="text-lg text-neutral-700">Log Tax é um assistente de inteligência tributária: você conversa e ele organiza, calcula e acompanha os seus impostos.</p>
      <ul className="list-disc space-y-1 pl-5 text-neutral-700">
        <li>Descubra quanto paga de imposto e para onde vai o dinheiro.</li>
        <li>Veja oportunidades legais de economia e simule cenários.</li>
        <li>Monte painéis, alertas e relatórios só conversando, e compartilhe com a sua contadora.</li>
      </ul>
      <div>
        <Link href="/login" className="inline-block rounded-xl bg-neutral-900 px-5 py-3 font-medium text-white">
          Entrar
        </Link>
      </div>
      <p className="text-sm text-neutral-600">Log Tax mostra estimativas ilustrativas. Valide qualquer decisão com um contador.</p>
    </main>
  );
}
