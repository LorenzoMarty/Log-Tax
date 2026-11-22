import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ inviteMember: vi.fn(), revokeInvite: vi.fn(), removeMember: vi.fn() }));
import { SharePanel } from "../share-panel";

const P1 = "11111111-1111-4111-8111-111111111111";
const pages = [{ id: P1, name: "Impostos" }];

describe("SharePanel access list (#152)", () => {
  it("shows each member's and invite's cut, pages by name", () => {
    render(
      <SharePanel
        workspaceId="w"
        defaultOpen
        pages={pages}
        members={[
          { user_id: "o", email: "dono@x.com", role: "owner", scope: null },
          { user_id: "a", email: "contadora@x.com", role: "reader", scope: { kinds: ["dashboard", "report"], dashboardIds: [P1] } },
          { user_id: "b", email: "socio@x.com", role: "commenter", scope: null },
        ]}
        invites={[{ id: "i", email: "novo@x.com", role: "reader", scope: { kinds: ["documents"] } }]}
      />,
    );
    const list = screen.getByRole("list", { name: "Quem tem acesso" });
    expect(within(list).getByText(/contadora@x.com/).closest("li")).toHaveTextContent("Painel (só: Impostos), Relatório");
    expect(within(list).getByText(/socio@x.com/).closest("li")).toHaveTextContent("Espaço inteiro");
    expect(within(list).getByText(/novo@x.com/).closest("li")).toHaveTextContent("Documentos");
    expect(within(list).getByText(/dono@x.com/).closest("li")).not.toHaveTextContent("Espaço inteiro");
  });
});
