import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEditor } from "../agent-editor";

const patch = vi.fn();
vi.mock("@/api/client", () => ({
  ApiError: class extends Error {},
  apiPatch: (...a: unknown[]) => patch(...a),
  apiDelete: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const docs = [
  { id: "d1", name: "nota-marco.xml" },
  { id: "d2", name: "recibo.pdf" },
];
const base = { id: "a1", name: "IA", objective: "obj", tools: ["get_document"] };

beforeEach(() => patch.mockReset().mockResolvedValue({}));

describe("AgentEditor: documents the AI may read", () => {
  it("an AI with no restriction shows 'todos' and sends the same patch as before", async () => {
    render(<AgentEditor workspaceId="w" agent={{ ...base, documents: null }} allTools={["get_document"]} documents={docs} />);
    expect(screen.getByRole("radio", { name: /Todos os documentos/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).not.toHaveProperty("documents");
  });

  it("'nenhum' sends an empty list", async () => {
    render(<AgentEditor workspaceId="w" agent={{ ...base, documents: null }} allTools={["get_document"]} documents={docs} />);
    fireEvent.click(screen.getByRole("radio", { name: /Nenhum documento/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patch.mock.calls[0][1].documents).toEqual([]));
  });

  it("choosing documents lists them with checkboxes and sends only the checked ids", async () => {
    render(<AgentEditor workspaceId="w" agent={{ ...base, documents: ["d1"] }} allTools={["get_document"]} documents={docs} />);
    expect(screen.getByRole("radio", { name: /Só os que eu escolher/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "nota-marco.xml" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "recibo.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patch.mock.calls[0][1].documents).toEqual(["d1", "d2"]));
  });

  it("shows how many documents the AI can use", () => {
    render(<AgentEditor workspaceId="w" agent={{ ...base, documents: ["d1"] }} allTools={[]} documents={docs} />);
    expect(screen.getByText("Esta IA pode usar 1 de 2 documentos.")).toBeInTheDocument();
  });

  it("hides the list of documents unless choosing", () => {
    render(<AgentEditor workspaceId="w" agent={{ ...base, documents: null }} allTools={[]} documents={docs} />);
    expect(screen.queryByRole("checkbox", { name: "recibo.pdf" })).not.toBeInTheDocument();
    expect(screen.getByText("Esta IA pode usar 2 de 2 documentos.")).toBeInTheDocument();
  });
});
