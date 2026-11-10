"use client";

import { useReportWebVitals } from "next/web-vitals";

/** Sends Core Web Vitals (LCP, INP, CLS, FCP, TTFB) of real visits to /api/vitals, where they become log lines. No personal data. */
export function WebVitals() {
  useReportWebVitals((metric) => {
    const body = JSON.stringify({ name: metric.name, value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value), rating: metric.rating, path: window.location.pathname.replace(/[0-9a-f-]{36}/g, ":id"), navigationType: metric.navigationType });
    // sendBeacon survives page unloads (LCP and INP are final only then)
    if (!navigator.sendBeacon?.("/api/vitals", new Blob([body], { type: "application/json" }))) void fetch("/api/vitals", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
  });
  return null;
}
