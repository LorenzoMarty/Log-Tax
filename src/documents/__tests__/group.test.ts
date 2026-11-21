import { describe, expect, it } from "vitest";
import { groupDocuments, type DocumentRow } from "../documents-panel";

const doc = (id: string, doc_type: DocumentRow["doc_type"], emissao?: string): DocumentRow => ({
  id,
  name: id,
  doc_type,
  extracted: emissao ? { fields: { emissao }, missing: [], notes: [], confidence: "alta" } : null,
  size_bytes: 1,
  created_at: "2026-01-01",
});

describe("groupDocuments", () => {
  it("groups by type then period, newest first, undated last", () => {
    const g = groupDocuments([doc("a", "nota_fiscal", "2026-09-05"), doc("b", "nota_fiscal", "2026-10-01"), doc("c", "nota_fiscal"), doc("d", null)]);
    expect(g.map((x) => x.type)).toEqual(["nota_fiscal", "outro"]);
    expect(g[0].periods.map(([p]) => p)).toEqual(["10/2026", "09/2026", "Sem período"]);
  });
});
