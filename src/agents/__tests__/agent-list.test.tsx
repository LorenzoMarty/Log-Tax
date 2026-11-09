import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentList } from "../agent-list";

const agents = [
  { id: "a1", name: "IA da Empresa", objective: "Acompanhar impostos", tools: ["get_tax_diagnosis", "run_simulation"] },
  { id: "a2", name: "IA Patrimonial", objective: "Acompanhar o patrimônio", tools: [] },
];

describe("AgentList", () => {
  it("renders nothing until the first agent exists", () => {
    const { container } = render(<AgentList workspaceId="ws1" agents={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links the general assistant and every agent, with objective and tool count", () => {
    render(<AgentList workspaceId="ws1" agents={agents} />);
    const nav = screen.getByRole("navigation", { name: "Minhas IAs" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/workspace/ws1", "/workspace/ws1?ia=a1", "/workspace/ws1?ia=a2"]);
    expect(within(nav).getByText("Acompanhar impostos")).toBeInTheDocument();
    expect(within(nav).getByText("2 ferramentas")).toBeInTheDocument();
    expect(within(nav).getByText("sem ferramentas")).toBeInTheDocument();
  });

  it("marks the current conversation", () => {
    const { rerender } = render(<AgentList workspaceId="ws1" agents={agents} />);
    expect(screen.getByRole("link", { name: /Assistente geral/ })).toHaveAttribute("aria-current", "page");
    rerender(<AgentList workspaceId="ws1" agents={agents} currentAgentId="a2" />);
    expect(screen.getByRole("link", { name: /IA Patrimonial/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Assistente geral/ })).not.toHaveAttribute("aria-current");
  });
});
