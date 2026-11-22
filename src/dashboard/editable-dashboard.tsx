"use client";

import { useState } from "react";
import { DashboardView } from "./dashboard-view";
import { layoutAnnouncement, postLayout, type LayoutChange } from "./layout";
import type { Dashboard } from "./types";
import { VersionHistory } from "./version-history";

/** The dashboard an editor (not the owner) sees: they cannot chat with the AI but can move/resize blocks and undo (#129). */
export function EditableDashboard({ workspaceId, initial }: { workspaceId: string; initial: Dashboard }) {
  const [dashboard, setDashboard] = useState(initial);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function change(c: LayoutChange) {
    setError("");
    const next = await postLayout(workspaceId, c);
    if (!next) return setError("Não consegui salvar a mudança. Tente de novo.");
    setDashboard(next);
    setStatus(layoutAnnouncement(next, c));
  }

  return (
    <>
      <VersionHistory workspaceId={workspaceId} dashboard={dashboard} onRestored={setDashboard} />
      <DashboardView dashboard={dashboard} onLayout={change} />
      <p role="status" className="sr-only">{status}</p>
      {error && <p role="alert" className="text-danger-ink">{error}</p>}
    </>
  );
}
