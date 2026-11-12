"use client";

import { flushSync } from "react-dom";

type TransitionHost = { startViewTransition?: (update: () => void) => unknown };

/**
 * Applies a dashboard change inside a View Transition, so blocks that move or leave glide instead of jumping (#131).
 * Browsers without the API just apply the change. Reduced motion is honoured in CSS (globals.css), not here. Client-only: flushSync cannot load in a server component.
 * Example: `applyWithTransition(() => setDashboard(next))`.
 */
export function applyWithTransition(update: () => void, host: TransitionHost | undefined = globalThis.document): void {
  if (!host?.startViewTransition) return update();
  // The callback must leave the DOM in its final state before it returns, hence flushSync.
  host.startViewTransition(() => flushSync(update));
}
