import { describe, expect, it } from "vitest";
import { createRealEngine } from "../real-engine";
import { selectiveCategories, selectiveTax } from "../selective-tax";
import type { CompanyProfile } from "../types";

describe("Imposto Seletivo (#104)", () => {
  it("never invents a rate", () => {
    for (const c of ["2026-06", "2027-03", "2033-01"]) {
      const r = selectiveTax(c, ["1113502"]);
      expect(r.status).toBe("ok");
      expect(JSON.stringify(r)).not.toMatch(/al[íi]quota de \d|R\$ ?\d/);
    }
  });

  it("says it only starts in 2027 before that", () => {
    expect((selectiveTax("2026-06") as { reason: string }).reason).toMatch(/2027/);
    expect((selectiveTax("2028-01") as { reason: string }).reason).not.toMatch(/só começa/);
  });

  it("a company in a subject sector gets the notice, with the categories and the legal source", () => {
    const r = selectiveTax("2027-03", ["1113502", "4635402"]);
    expect(r).toMatchObject({ status: "ok", value: { categories: ["bebidas_alcoolicas"], source: "LC 214/2025, art. 409, §1º", requiresValidation: true } });
    expect(r.status === "ok" && r.value.message).toMatch(/bebidas alcoólicas.*Imposto Seletivo/);
  });

  it("every other company gets not_applicable", () => {
    for (const cnaes of [["4711302"], ["6201501", "7020400"], []]) expect(selectiveTax("2027-03", cnaes).status).toBe("not_applicable");
    expect((selectiveTax("2027-03", ["4711302"]) as { reason: string }).reason).toMatch(/não está na lista/);
  });

  it("maps each art. 409 category from the CNAE, in the law's order", () => {
    expect(selectiveCategories(["2910701"])).toEqual(["veiculos"]);
    expect(selectiveCategories(["3041500"])).toEqual(["embarcacoes_aeronaves"]);
    expect(selectiveCategories(["1220401"])).toEqual(["fumigenos"]);
    expect(selectiveCategories(["1122401"])).toEqual(["bebidas_acucaradas"]);
    expect(selectiveCategories(["0600001"])).toEqual(["bens_minerais"]);
    expect(selectiveCategories(["9200301"])).toEqual(["prognosticos"]);
    expect(selectiveCategories(["1122401", "1113502"])).toEqual(["bebidas_alcoolicas", "bebidas_acucaradas"]);
    expect(selectiveCategories(["1121600"])).toEqual([]); // água mineral is not a sugary drink
  });
});

describe("real engine: the notice next to the diagnosis", () => {
  const company = (cnaes?: string[]): CompanyProfile =>
    ({ id: "c", name: "Teste", regime: "presumido", activity: "comercio", monthlyRevenue: 100_000, uf: "SP", ...(cnaes && { cnaes }) }) as CompanyProfile;

  it("adds the notice for a brewery and leaves the total unchanged", () => {
    const engine = createRealEngine({ competence: "2027-03" });
    const plain = engine.diagnose(company(["4711302"]));
    const brewery = engine.diagnose(company(["1113502"]));
    if (plain.status !== "ok" || brewery.status !== "ok") throw new Error(`expected two diagnoses, got ${plain.status} and ${brewery.status}`);
    expect(brewery.value.monthlyTotal).toBe(plain.value.monthlyTotal);
    expect(brewery.value.assumptions.at(-1)).toMatch(/Imposto Seletivo/);
    expect(plain.value.assumptions.join(" ")).not.toMatch(/Imposto Seletivo/);
  });
});
