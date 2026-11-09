import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "../page";

describe("Home", () => {
  it("shows the pt-BR prompt and the estimate disclaimer", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "O que você precisa resolver?" })).toBeInTheDocument();
    expect(screen.getByText(/estimativas ilustrativas/i)).toBeInTheDocument();
  });

  it("leads to the sign-in instead of pretending to be a chat", () => {
    render(<Home />);
    expect(screen.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar" })).not.toBeInTheDocument();
  });

  it("explains what the product does in a short list", () => {
    render(<Home />);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
  });
});
