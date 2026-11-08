import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "../page";

describe("Home", () => {
  it("shows the pt-BR prompt and the estimate disclaimer", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "O que você precisa resolver?" })).toBeInTheDocument();
    expect(screen.getByText(/estimativas ilustrativas/i)).toBeInTheDocument();
  });
});
