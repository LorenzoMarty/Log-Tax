import { DashboardView } from "@/dashboard/dashboard-view";
import { sampleDashboard } from "@/dashboard/fixtures";

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <DashboardView dashboard={sampleDashboard} />
    </main>
  );
}
