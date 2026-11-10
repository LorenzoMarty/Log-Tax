export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10" aria-busy="true">
      <h1 className="lg-heading-1">Carregando seus espaços…</h1>
      <div className="mt-6 space-y-3" aria-hidden="true">
        <div className="h-16 animate-pulse rounded-[var(--radius-sm)] bg-surface-sunken" />
        <div className="h-16 animate-pulse rounded-[var(--radius-sm)] bg-surface-sunken" />
      </div>
    </main>
  );
}
