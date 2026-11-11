import { describe, expect, it } from "vitest";
import { companyFieldsSchema, inconsistencies, mergeSeries, monthRevenue, normalizeProfile } from "../company-schema";
import { seedCompany } from "../seed";

const VALID_CNPJ = "11222333000181";

describe("field schema", () => {
  it("accepts the complete fiscal profile", () => {
    const r = companyFieldsSchema.partial().safeParse({
      name: "Loja X",
      cnpj: VALID_CNPJ,
      cnaes: ["4712100", "4789099"],
      regime: "simples",
      anexo: "I",
      activity: "comercio",
      uf: "SP",
      municipio: { name: "São Paulo", ibge: "3550308" },
      openedAt: "2020-03-10",
      series: [{ month: "2026-01", revenue: { comercio: 80000, servico: 0 }, purchases: 40000, payroll: 12000, proLabore: 3000 }],
    });
    expect(r.success).toBe(true);
  });

  it("refuses malformed fields with a clear reason", () => {
    const bad = (patch: object) => companyFieldsSchema.partial().safeParse(patch).error?.issues.map((i) => i.message).join("; ");
    expect(bad({ cnpj: "11222333000180" })).toMatch(/CNPJ inválido/);
    expect(bad({ cnaes: ["471"] })).toMatch(/7 dígitos/);
    expect(bad({ uf: "XX" })).toBeDefined();
    expect(bad({ openedAt: "10/03/2020" })).toMatch(/AAAA-MM-DD/);
    expect(bad({ series: [{ month: "2026-13" }] })).toMatch(/AAAA-MM/);
    expect(bad({ series: [{ month: "2026-01", revenue: { comercio: -5 } }] })).toBeDefined();
    expect(bad({ anexo: "VI" })).toBeDefined();
    expect(bad({ unknownField: 1 })).toBeDefined();
  });
});

describe("inconsistencies", () => {
  it("is quiet for a coherent profile", () => {
    expect(inconsistencies({ regime: "simples", anexo: "III", openedAt: "2020-01-01", series: [{ month: "2026-01" }, { month: "2026-02" }] }, "2026-11-10")).toEqual([]);
  });

  it("flags an annex outside the Simples", () => {
    expect(inconsistencies({ regime: "presumido", anexo: "III" })[0]).toMatch(/anexo III só existe no Simples/);
  });

  it("flags dates that cannot be", () => {
    expect(inconsistencies({ openedAt: "2099-01-01" }, "2026-11-10")[0]).toMatch(/futuro/);
    expect(inconsistencies({ series: [{ month: "2027-01" }] }, "2026-11-10")[0]).toMatch(/ainda não aconteceu/);
    expect(inconsistencies({ openedAt: "2025-06-01", series: [{ month: "2025-01" }] }, "2026-11-10")[0]).toMatch(/antes da abertura/);
  });

  it("flags repeated months, repeated CNAEs and suspicious amounts", () => {
    expect(inconsistencies({ series: [{ month: "2026-01" }, { month: "2026-01" }] }, "2026-11-10")[0]).toMatch(/mais de uma vez/);
    expect(inconsistencies({ cnaes: ["4712100", "4712100"] })[0]).toMatch(/repetidos/);
    expect(inconsistencies({ series: [{ month: "2026-01", proLabore: 5000, payroll: 3000 }] }, "2026-11-10")[0]).toMatch(/pró-labore é maior/);
    expect(inconsistencies({ series: [{ month: "2026-01", revenue: { comercio: 100 }, purchases: 5000 }] }, "2026-11-10")[0]).toMatch(/20 vezes/);
  });
});

describe("series", () => {
  it("merges by month, field by field, sorted", () => {
    const merged = mergeSeries(
      [{ month: "2026-02", revenue: { comercio: 10 }, purchases: 5 }, { month: "2026-01", payroll: 1 }],
      [{ month: "2026-02", revenue: { servico: 7 } }, { month: "2026-03", purchases: 9 }],
    );
    expect(merged.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(merged[1]).toEqual({ month: "2026-02", revenue: { comercio: 10, servico: 7 }, purchases: 5 });
    expect(monthRevenue(merged[1])).toBe(17);
  });
});

describe("normalizeProfile (profiles saved before these fields existed)", () => {
  it("loads an old profile unchanged and fills nothing it does not know", () => {
    const old = { ...seedCompany };
    expect(normalizeProfile(old, seedCompany)).toEqual(old);
  });

  it("drops invalid leftovers instead of failing, and keeps the id", () => {
    const out = normalizeProfile({ id: "abc", name: "X", regime: "presumido", activity: "comercio", uf: "ZZ", junk: true }, seedCompany);
    expect(out.id).toBe("abc");
    expect(out).not.toHaveProperty("junk");
  });

  it("falls back when nothing usable is stored", () => {
    expect(normalizeProfile(null, seedCompany)).toEqual(seedCompany);
  });
});
