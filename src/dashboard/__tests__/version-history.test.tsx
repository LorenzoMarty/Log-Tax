import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { previousVersion, VersionHistory } from "../version-history";
import type { Dashboard } from "../types";

const dash = (version: number): Dashboard => ({ id: "d", name: "Painel", theme: "light", density: "comfortable", widgets: [], version });
const versions = [
  { version: 3, summary: 'Bloco "Carga" removido', created_at: "2026-11-20T10:00:00Z" },
  { version: 2, summary: 'Bloco "Carga" adicionado', created_at: "2026-11-20T09:00:00Z" },
];

/** Named fake of the API behind the proxy: lists `versions` and answers a restore with `restored`. */
class FakeVersionsApi {
  calls: string[] = [];
  constructor(private restored: Dashboard) {}
  fetch = async (url: string, init?: RequestInit) => {
    this.calls.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json(url.endsWith("/restore") ? { dashboard: this.restored } : { versions });
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("previousVersion (#128)", () => {
  it("is the newest version older than the current one, or none", () => {
    expect(previousVersion(versions, 3)).toBe(2);
    expect(previousVersion(versions, 2)).toBeUndefined();
  });
});

describe("VersionHistory (#128)", () => {
  it("undo restores the previous version through the API and hands the dashboard back", async () => {
    const api = new FakeVersionsApi(dash(4));
    vi.stubGlobal("fetch", api.fetch);
    const onRestored = vi.fn();
    render(<VersionHistory workspaceId="ws" dashboard={dash(3)} onRestored={onRestored} />);
    const undo = screen.getByRole("button", { name: "Desfazer" });
    await waitFor(() => expect(undo).toBeEnabled());
    fireEvent.click(undo);
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(dash(4)));
    expect(api.calls).toContain("POST /api/v1/workspaces/ws/dashboard/versions/2/restore");
  });

  it("lists the versions with what changed and marks the current one", async () => {
    vi.stubGlobal("fetch", new FakeVersionsApi(dash(4)).fetch);
    render(<VersionHistory workspaceId="ws" dashboard={dash(3)} onRestored={() => {}} />);
    expect(await screen.findByText('Bloco "Carga" adicionado')).toBeInTheDocument();
    expect(screen.getByText("(atual)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Restaurar", hidden: true })).toHaveLength(1);
  });

  it("says so when the restore fails", async () => {
    vi.stubGlobal("fetch", async (url: string) => (url.endsWith("/restore") ? new Response(null, { status: 403 }) : Response.json({ versions })));
    render(<VersionHistory workspaceId="ws" dashboard={dash(3)} onRestored={() => {}} />);
    const undo = screen.getByRole("button", { name: "Desfazer" });
    await waitFor(() => expect(undo).toBeEnabled());
    fireEvent.click(undo);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não consegui restaurar");
  });
});

describe("VersionHistory redo and read-only (#128)", () => {
  it("redo is enabled only after an undo", async () => {
    vi.stubGlobal("fetch", new FakeVersionsApi(dash(4)).fetch);
    const Host = () => {
      const [d, setD] = useState(dash(3));
      return <VersionHistory workspaceId="ws" dashboard={d} onRestored={setD} />;
    };
    render(<Host />);
    const undo = screen.getByRole("button", { name: "Desfazer" });
    await waitFor(() => expect(undo).toBeEnabled());
    expect(screen.getByRole("button", { name: "Refazer" })).toBeDisabled();
    fireEvent.click(undo);
    await waitFor(() => expect(screen.getByRole("button", { name: "Refazer" })).toBeEnabled());
  });

  it("read-only shows the list without any action button", async () => {
    vi.stubGlobal("fetch", new FakeVersionsApi(dash(4)).fetch);
    render(<VersionHistory workspaceId="ws" dashboard={dash(3)} readOnly />);
    expect(await screen.findByText('Bloco "Carga" adicionado')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Desfazer|Refazer|Restaurar/, hidden: true })).toBeNull();
  });
});
