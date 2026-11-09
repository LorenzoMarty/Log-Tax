import { z } from "zod";

const base = { id: z.string().min(1), title: z.string().min(1), size: z.enum(["sm", "md", "lg"]) };
const point = z.strictObject({ label: z.string(), value: z.number() });

/** Validates widgets coming from the model before they reach the dashboard reducer. */
export const widgetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("kpi"), value: z.string(), caption: z.string().optional() }),
  z.strictObject({ ...base, kind: z.literal("bar"), data: z.array(point) }),
  z.strictObject({ ...base, kind: z.literal("line"), data: z.array(point) }),
  z.strictObject({
    ...base,
    kind: z.literal("breakdown"),
    items: z.array(z.strictObject({ label: z.string(), amount: z.number() })),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("opportunities"),
    items: z.array(z.strictObject({ title: z.string(), monthlySavings: z.number() })),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("deadlines"),
    items: z.array(z.strictObject({ label: z.string(), date: z.string() })),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("compare"),
    rows: z.array(z.strictObject({ label: z.string(), today: z.string(), potential: z.string() })),
    summary: z.string().optional(),
    labels: z.tuple([z.string(), z.string()]).optional(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("checklist"),
    items: z.array(z.strictObject({ label: z.string(), done: z.boolean() })),
  }),
  z.strictObject({ ...base, kind: z.literal("text"), body: z.string() }),
]);
