import axe from "axe-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InviteFields } from "../invite-fields";

const pages = [{ id: "11111111-1111-4111-8111-111111111111", name: "Impostos" }, { id: "22222222-2222-4222-8222-222222222222", name: "Folha" }];
const renderForm = () => render(<form><InviteFields pages={pages} /></form>);
const data = (c: HTMLElement) => new FormData(c.querySelector("form")!);

describe("InviteFields (#152)", () => {
  it("starts on the whole space, with no kind or page sent", () => {
    const { container } = renderForm();
    expect(screen.getByRole("radio", { name: "Espaço inteiro" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Painel" })).not.toBeInTheDocument();
    const f = data(container);
    expect(f.get("scope")).toBe("all");
    expect(f.getAll("kind")).toEqual([]);
  });

  it("offers the kinds and, for the dashboard, the pages by name", () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Só uma parte" }));
    expect(screen.getByRole("checkbox", { name: "Documentos" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Relatório" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Impostos" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Painel" }));
    fireEvent.click(screen.getByRole("radio", { name: "Só algumas páginas" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Folha" }));
    const f = data(container);
    expect(f.getAll("kind")).toEqual(["dashboard"]);
    expect(f.get("pages")).toBe("some");
    expect(f.getAll("page")).toEqual([pages[1].id]);
  });

  it("blocks the edit role while sharing only a part", () => {
    renderForm();
    const editor = screen.getByRole("option", { name: "Edição" }) as HTMLOptionElement;
    expect(editor.disabled).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Só uma parte" }));
    expect(editor.disabled).toBe(true);
  });

  it("falls back from edit to reading when the owner narrows the share", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Papel"), { target: { value: "editor" } });
    fireEvent.click(screen.getByRole("radio", { name: "Só uma parte" }));
    expect(screen.getByLabelText("Papel")).toHaveValue("reader");
  });

  it("has no axe violations in either state", async () => {
    const { container } = renderForm();
    const run = async () => (await axe.run(container, { rules: { region: { enabled: false } } })).violations.map((v) => v.id);
    expect(await run()).toEqual([]);
    fireEvent.click(screen.getByRole("radio", { name: "Só uma parte" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Painel" }));
    fireEvent.click(screen.getByRole("radio", { name: "Só algumas páginas" }));
    expect(await run()).toEqual([]);
  });
});
