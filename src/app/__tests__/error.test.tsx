import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "../error";
import GlobalError from "../global-error";
import NotFound from "../not-found";

afterEach(() => vi.restoreAllMocks());

describe("error screens", () => {
  it("reports the error and offers to try again", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    render(<ErrorPage error={error} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível mostrar esta tela");
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith("[log-tax] screen error", "abc123", error);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("the global error screen renders without the layout and also retries", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<GlobalError error={new Error("x")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("the 404 points back to the workspaces", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Não encontramos essa página" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir para os meus espaços" })).toHaveAttribute("href", "/workspace");
  });
});
