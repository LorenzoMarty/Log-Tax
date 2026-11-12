import { describe, expect, it, vi } from "vitest";
import { widgetTransitionName } from "../motion";
import { applyWithTransition } from "../view-transition";

/** Stands in for `document` in a browser with the View Transitions API: records the call, then runs the update. */
class FakeTransitionHost {
  calls = 0;
  startViewTransition = (update: () => void) => {
    this.calls++;
    update();
  };
}

describe("applyWithTransition", () => {
  it("runs the update inside a view transition when the browser supports it", () => {
    const host = new FakeTransitionHost();
    const update = vi.fn();
    applyWithTransition(update, host);
    expect(host.calls).toBe(1);
    expect(update).toHaveBeenCalledOnce();
  });

  it("just applies the update where the API is missing", () => {
    const update = vi.fn();
    applyWithTransition(update, {});
    applyWithTransition(update, undefined);
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe("widgetTransitionName", () => {
  it("is a valid CSS identifier, unique per id", () => {
    expect(widgetTransitionName("kpi")).toBe("widget-kpi");
    expect(widgetTransitionName("kpi 1/ä")).toBe("widget-kpi-1--");
    expect(widgetTransitionName("a")).not.toBe(widgetTransitionName("b"));
  });
});
