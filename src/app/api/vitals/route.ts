import { z } from "zod";
import { log } from "@/lib/log";

const metric = z.object({
  name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  value: z.number().min(0).max(600_000),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  path: z.string().max(120),
  navigationType: z.string().max(30).optional(),
});

/** Receives one Web Vital from a real visit and logs it (CLS is sent times 1000). Public and tiny on purpose; no user data is accepted. */
export async function POST(request: Request) {
  const parsed = metric.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  // `name` and `value` are on the logger's drop list (they could carry content), so the fields are renamed.
  const { name, value, ...rest } = parsed.data;
  log("info", "web_vital", { metric: name, amount: value, ...rest });
  return new Response(null, { status: 204 });
}
