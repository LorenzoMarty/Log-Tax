import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DemoPage, { metadata } from "../demo/page";

describe("/demo", () => {
  it("says it is made of fictional data and stays out of search results", () => {
    render(<DemoPage />);
    expect(screen.getByText(/dados fictícios/i)).toBeInTheDocument();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
