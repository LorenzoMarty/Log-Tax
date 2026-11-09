import { notFound, redirect } from "next/navigation";
import { alertStatuses } from "@/alerts/evaluate";
import { loadWorkspaceState } from "@/chat/workspace-state";
import type { DocType } from "@/documents/classify";
import type { StoredExtraction } from "@/documents/storage";
import { mockEngine } from "@/engine";
import { createClient } from "@/lib/supabase/server";
import { buildReport } from "@/report/build";
import { ReportView } from "@/report/report-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Printable report of a workspace. Anyone with access to the workspace can open it (RLS decides). */
export const metadata = { title: "Relatório" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const state = await loadWorkspaceState(supabase, id);
  if (!state) notFound();
  const { data: docs } = await supabase.from("documents").select("name, doc_type, extracted").eq("workspace_id", id).order("created_at");

  const report = buildReport({
    kind: state.kind,
    workspaceName: state.workspaceName,
    company: state.company,
    person: state.person,
    alerts: state.kind === "pessoal" ? [] : alertStatuses(mockEngine, state.company, state.alerts),
    documents: (docs ?? []).map((d) => ({ name: d.name, docType: d.doc_type as DocType | null, missing: ((d.extracted as StoredExtraction | null)?.missing ?? []) })),
    engine: mockEngine,
    generatedAt: new Date(),
  });
  return <ReportView report={report} backHref={`/workspace/${id}`} />;
}
