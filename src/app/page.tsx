export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">O que você precisa resolver?</h1>
      <form className="flex gap-2" aria-label="Conversa com a IA">
        <input
          aria-label="Mensagem"
          placeholder="Quero entender meus impostos..."
          className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button type="button" className="rounded-xl bg-neutral-900 px-4 text-white dark:bg-white dark:text-neutral-900">
          Enviar
        </button>
      </form>
      <p className="text-sm text-neutral-500">
        Log Tax mostra estimativas ilustrativas. Valide qualquer decisão com um contador.
      </p>
    </main>
  );
}
