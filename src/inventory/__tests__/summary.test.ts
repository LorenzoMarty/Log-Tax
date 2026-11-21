import { describe, expect, it } from "vitest";
import { addMonths, inventorySummary, splitCents } from "../summary";

const estate = { deceased_name: "João", died_at: "2026-10-31", uf: "SP" };
const heirs = [
  { id: "1", name: "Ana", relationship: "filha", share: "50.00" },
  { id: "2", name: "Beto", relationship: null, share: "30.00" },
  { id: "3", name: "Caio", relationship: null, share: "20.00" },
];
const assets = [
  { id: "a", kind: "imovel", description: "Apto", value: "400000.00" },
  { id: "b", kind: "veiculo", description: "Carro", value: "80000.00" },
];

describe("inventory summary", () => {
  it("clamps the 2-month deadline to the month end", () => {
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
    expect(addMonths("2026-10-15", 2)).toBe("2026-12-15");
  });

  it("splits cents exactly", () => {
    expect(splitCents(10_000, [33.33, 33.33, 33.34])).toEqual([3333, 3333, 3334]);
    expect(splitCents(1, [50, 50]).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("computes net, amounts, deadline and checklist", () => {
    const s = inventorySummary(estate, heirs, assets, ["Certidão de Óbito.pdf"], "2026-11-21");
    expect(s.net).toBe(480000);
    expect(s.heirs.map((h) => h.amount)).toEqual([240000, 144000, 96000]);
    expect(s.pendencias).toEqual([]);
    expect(s.canSplit).toBe(true);
    expect(s.opensBy).toBe("2026-12-31");
    expect(s.checklist[0]).toEqual({ label: "Certidão de óbito", done: true });
    expect(s.checklist[1].done).toBe(false);
  });

  it("flags shares != 100% and debts above assets", () => {
    const debts = [...assets, { id: "d", kind: "divida", description: "x", value: 500000 }];
    const s = inventorySummary(estate, heirs.slice(0, 2), debts, [], "2027-01-10");
    expect(s.pendencias).toHaveLength(2);
    expect(s.canSplit).toBe(false);
    expect(s.overdue).toBe(true);
  });
});
