import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let stored: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (stored ? { value: stored } : undefined) }) }));

import WorkspaceLayout from "../layout";

async function renderLayout() {
  const ui = await WorkspaceLayout({ children: <p>oi</p> });
  return render(ui).container.firstElementChild as HTMLElement;
}

describe("workspace layout theme (#157)", () => {
  beforeEach(() => {
    stored = undefined;
  });
  it("forces dark when the cookie says dark", async () => {
    stored = "dark";
    expect((await renderLayout()).getAttribute("data-theme")).toBe("dark");
  });
  it("forces light when the cookie says light", async () => {
    stored = "light";
    expect((await renderLayout()).getAttribute("data-theme")).toBe("light");
  });
  it("leaves the system preference alone without a cookie", async () => {
    expect((await renderLayout()).hasAttribute("data-theme")).toBe(false);
  });
});
