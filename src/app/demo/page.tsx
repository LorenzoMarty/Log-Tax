import { DashboardView } from "@/dashboard/dashboard-view";
import { sampleDashboard } from "@/dashboard/fixtures";

// Decision (#62): /demo stays public on purpose. It renders only the static `sampleDashboard` fixture (invented numbers,
// no database access, no session), so it exposes nothing; it says so on screen and is kept out of search results.
export const metadata = { title: "Demonstração", robots: { index: false, follow: false } };

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="sr-only">Painel de demonstração</h1>
      <p className="mb-4 rounded-[var(--radius-sm)] bg-info-tint px-4 py-3 text-sm text-info-ink">Demonstração com dados fictícios, só para você ver como o painel funciona.</p>
      <DashboardView dashboard={sampleDashboard} />
    </main>
  );
}
