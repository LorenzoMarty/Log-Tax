import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const patch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/api/client", () => ({ ApiError: class extends Error {}, apiPatch: (...a: unknown[]) => patch(...a), apiDelete: vi.fn() }));

import { AgentEditor } from "../agent-editor";

const docs = [
  { id: "d1", name: "nota.xml" },
  { id: "d2", name: "folha.csv" },
];
const agent = { id: "a1", name: "IA", objective: "x", tools: [] as string[] };

describe("AgentEditor documents", () => {
  beforeEach(() => patch.mockReset().mockResolvedValue({}));

  it("starts with every document checked when the AI has no restriction", () => {
    render(<AgentEditor workspaceId="w" agent={agent} allTools={[]} documents={docs} />);
    expect(screen.getByText("2 de 2 documentos")).toBeInTheDocument();
  });

  it("'Nenhum' saves an empty list", async () => {
    render(<AgentEditor workspaceId="w" agent={agent} allTools={[]} documents={docs} />);
    fireEvent.click(screen.getByRole("button", { name: "Nenhum" }));
    expect(screen.getByText("Nenhum documento")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).toMatchObject({ documents: [] });
  });

  it("saves only the chosen documents", async () => {
    render(<AgentEditor workspaceId="w" agent={{ ...agent, documents: ["d2"] }} allTools={[]} documents={docs} />);
    expect(screen.getByLabelText("folha.csv")).toBeChecked();
    expect(screen.getByLabelText("nota.xml")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).toMatchObject({ documents: ["d2"] });
  });
});
