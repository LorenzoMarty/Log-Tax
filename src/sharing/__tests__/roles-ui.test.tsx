import { fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => {
  const noop = async () => {};
  return { inviteMember: noop, removeMember: noop, revokeInvite: noop, changeMemberRole: noop, transferOwnership: noop };
});
import { SharePanel, type MemberRow } from "../share-panel";

const members: MemberRow[] = [
  { user_id: "u0", email: "dono@x.com", role: "owner" },
  { user_id: "u1", email: "socio@x.com", role: "admin" },
  { user_id: "u2", email: "leitor@x.com", role: "reader" },
];
const panel = () => render(<SharePanel workspaceId="ws1" members={members} invites={[]} defaultOpen />);

describe("SharePanel roles (#156)", () => {
  it("offers the Administração role when inviting", () => {
    panel();
    const select = screen.getByLabelText("Papel") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("admin");
    expect(within(select).getByRole("option", { name: "Administração" })).toBeInTheDocument();
  });

  it("shows each person's role and a labelled role selector for everyone but the owner", () => {
    panel();
    expect(screen.getByText(/dono@x.com — Dono/)).toBeInTheDocument();
    expect(screen.getByText(/socio@x.com — Administração/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Papel de dono@x.com")).toBeNull();
    const sel = screen.getByLabelText("Papel de socio@x.com") as HTMLSelectElement;
    expect(sel.value).toBe("admin");
    expect([...sel.options].map((o) => o.value)).toEqual(["admin", "editor", "commenter", "reader"]);
    expect(screen.getByRole("button", { name: "Salvar papel de leitor@x.com" })).toBeInTheDocument();
  });

  it("asks for explicit confirmation before transferring, explaining the consequences", () => {
    panel();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transferir propriedade para socio@x.com" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName(/Transferir a propriedade/);
    expect(dialog).toHaveTextContent("Você vira administrador");
    expect(dialog).toHaveTextContent("histórico da sua conversa com a IA passa para socio@x.com");
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Sim, transferir a propriedade" })).toBeInTheDocument();
  });

  it("cancels with the button or Escape and gives focus back", () => {
    panel();
    const open = () => screen.getByRole("button", { name: "Transferir propriedade para socio@x.com" });
    fireEvent.click(open());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(open()).toHaveFocus();
    fireEvent.click(open());
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("has no axe violations, closed or with the dialog open", async () => {
    const { container } = panel();
    const run = () => axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect((await run()).violations).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Transferir propriedade para socio@x.com" }));
    expect((await run()).violations).toEqual([]);
  });
});
