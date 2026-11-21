import { z } from "zod";

const base = { id: z.string().min(1), title: z.string().min(1), size: z.enum(["sm", "md", "lg"]) };
// Reais in the newer blocks are exact decimal strings, never floats; limits mirror api/app/chat/dashboard.py.
const money = z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/);
const label = z.string().min(1).max(60);
const note = z.string().max(300);
const cell = z.string().max(80);
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
  z.strictObject({
    ...base,
    kind: z.literal("projection"),
    points: z.array(z.strictObject({ label, value: money, projected: z.boolean() })).min(1).max(36),
    basis: note,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("payroll"),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    items: z.array(z.strictObject({ label, amount: money })).min(1).max(12),
    total: money,
    notes: z.array(note).max(8).optional(),
  }),
  z
    .strictObject({
      ...base,
      kind: z.literal("table"),
      columns: z.array(label).min(1).max(6),
      rows: z.array(z.array(cell).max(6)).max(30),
    })
    .refine((w) => w.rows.every((r) => r.length === w.columns.length), "every row needs one cell per column"),
  z
    .strictObject({
      ...base,
      kind: z.literal("goal"),
      current: money,
      target: money,
      unit: z.string().max(20).optional(),
      deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .refine((w) => Number(w.target) > 0, "target must be positive"),
]);
