import { DashboardView } from "@/dashboard/dashboard-view";
import { sampleDashboard } from "@/dashboard/fixtures";

export const metadata = { title: "Demonstração" };

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="sr-only">Painel de demonstração</h1>
      <DashboardView dashboard={sampleDashboard} />
    </main>
  );
}
