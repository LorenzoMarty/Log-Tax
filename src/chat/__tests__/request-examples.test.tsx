import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { REQUEST_EXAMPLES, RequestExamples } from "../request-examples";

describe("RequestExamples", () => {
  it("lists the PRD examples under 'O que posso pedir?'", () => {
    render(<RequestExamples onPick={vi.fn()} disabled={false} />);
    expect(screen.getByRole("heading", { name: "O que posso pedir?" })).toBeInTheDocument();
    for (const text of REQUEST_EXAMPLES) expect(screen.getByRole("button", { name: text })).toBeInTheDocument();
  });

  it("hands the clicked example to onPick", () => {
    const onPick = vi.fn();
    render(<RequestExamples onPick={onPick} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: REQUEST_EXAMPLES[0] }));
    expect(onPick).toHaveBeenCalledWith(REQUEST_EXAMPLES[0]);
  });

  it("cannot be clicked while the AI is answering", () => {
    render(<RequestExamples onPick={vi.fn()} disabled />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
