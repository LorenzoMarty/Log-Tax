import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Preview } from "../preview";

const open = () => {
  const details = document.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
};

describe("document preview (#165)", () => {
  it("shows a PDF in the browser viewer through the inline signed URL", () => {
    render(<Preview id="d1" name="guia.pdf" mime="application/pdf" />);
    expect(screen.queryByTitle("Original: guia.pdf")).toBeNull(); // nothing is requested while closed
    open();
    expect(screen.getByTitle("Original: guia.pdf")).toHaveAttribute("src", "/api/documents/d1?inline=1");
  });

  it("shows an image as an image", () => {
    render(<Preview id="d2" name="recibo.jpg" mime="image/jpeg" />);
    open();
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("src", "/api/documents/d2?inline=1");
  });

  it("has no preview for XML, text or unknown types", () => {
    for (const mime of ["application/xml", "text/plain", null]) {
      const { container, unmount } = render(<Preview id="d3" name="x" mime={mime} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
