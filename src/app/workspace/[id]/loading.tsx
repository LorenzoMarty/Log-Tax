export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6" aria-busy="true">
      <h1 className="lg-heading-1">Abrindo o espaço…</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-2" aria-hidden="true">
        <div className="h-64 animate-pulse rounded-[var(--radius-sm)] bg-surface-sunken" />
        <div className="h-64 animate-pulse rounded-[var(--radius-sm)] bg-surface-sunken" />
      </div>
    </main>
  );
}
