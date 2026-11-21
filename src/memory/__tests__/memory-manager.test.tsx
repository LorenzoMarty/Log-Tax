import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryManager } from "../memory-manager";

const items = [
  { id: "m1", text: "Prefiro respostas curtas", scope: "Em todo o espaço" },
  { id: "m2", text: "Meu contador é o Carlos", scope: "Só na IA Empresa" },
];

function mockFetch(res: { ok: boolean; status?: number; body?: unknown }) {
  const fn = vi.fn(async () => ({
    ok: res.ok,
    status: res.status ?? (res.ok ? 200 : 500),
    headers: new Headers(),
    json: async () => res.body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("MemoryManager", () => {
  it("shows an empty state in Portuguese when nothing is remembered", () => {
    render(<MemoryManager workspaceId="ws1" initial={[]} />);
    expect(screen.getByTestId("memories-empty")).toHaveTextContent("ainda não guardou nada");
  });

  it("lists every memory with its scope", () => {
    render(<MemoryManager workspaceId="ws1" initial={items} />);
    expect(screen.getByText("Prefiro respostas curtas")).toBeInTheDocument();
    expect(screen.getByText("Só na IA Empresa")).toBeInTheDocument();
  });

  it("corrects a memory through the API and shows the new text", async () => {
    const fetchMock = mockFetch({ ok: true, body: { id: "m1", text: "Prefiro respostas longas" } });
    render(<MemoryManager workspaceId="ws1" initial={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Corrigir: Prefiro respostas curtas" }));
    const box = screen.getByLabelText("Texto da memória");
    fireEvent.change(box, { target: { value: "Prefiro respostas longas" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Memória corrigida.");
    expect(screen.getByText("Prefiro respostas longas")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/workspaces/ws1/memories/m1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Prefiro respostas longas" });
  });

  it("asks for confirmation before forgetting, and cancelling deletes nothing", async () => {
    const fetchMock = mockFetch({ ok: true, status: 204 });
    render(<MemoryManager workspaceId="ws1" initial={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Esquecer: Meu contador é o Carlos" }));
    expect(screen.getByRole("alertdialog", { name: "Confirmar que a IA esqueça" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Meu contador é o Carlos")).toBeInTheDocument();
  });

  it("forgets after confirmation and shows the empty state when the last one goes", async () => {
    const fetchMock = mockFetch({ ok: true, status: 204 });
    render(<MemoryManager workspaceId="ws1" initial={[items[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Esquecer:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByTestId("memories-empty")).toBeInTheDocument());
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("keeps the item and shows the server message when the API refuses", async () => {
    mockFetch({ ok: false, status: 403, body: { error: { code: "forbidden", message: "Só quem é dono do espaço vê ou altera o que a IA lembra." } } });
    render(<MemoryManager workspaceId="ws1" initial={[items[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: /^Esquecer:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("dono do espaço");
    expect(screen.getByText("Prefiro respostas curtas")).toBeInTheDocument();
  });
});
