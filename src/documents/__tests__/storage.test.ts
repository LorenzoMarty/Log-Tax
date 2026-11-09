import { describe, expect, it } from "vitest";
import { resolveMime, safeFileName, toStored } from "../storage";
import { classifyDocument } from "../classify";

describe("resolveMime", () => {
  it("trusts a known browser type", () => {
    expect(resolveMime("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(resolveMime("a.xml", "text/xml")).toBe("text/xml");
  });
  it("falls back to the extension only when the browser gave nothing useful", () => {
    expect(resolveMime("nota.XML", "")).toBe("application/xml");
    expect(resolveMime("foto.jpeg", "application/octet-stream")).toBe("image/jpeg");
  });
  it("refuses anything else, even with a friendly extension", () => {
    expect(resolveMime("virus.exe", "application/x-msdownload")).toBeUndefined();
    expect(resolveMime("virus.pdf", "application/x-msdownload")).toBeUndefined();
    expect(resolveMime("sem-extensao", "")).toBeUndefined();
  });
});

describe("safeFileName", () => {
  it("strips paths, accents and unsafe characters", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\x\\Informe de Rendimentos (2025).pdf")).toBe("Informe_de_Rendimentos_2025_.pdf");
    expect(safeFileName("declaração.pdf")).toBe("declaracao.pdf");
    expect(safeFileName("...")).toBe("arquivo");
    expect(safeFileName("")).toBe("arquivo");
  });
  it("keeps the end of very long names (the extension)", () => {
    const n = safeFileName(`${"a".repeat(300)}.pdf`);
    expect(n).toHaveLength(100);
    expect(n.endsWith(".pdf")).toBe(true);
  });
});

describe("toStored", () => {
  it("keeps fields, missing, notes and confidence together", () => {
    const c = classifyDocument({ name: "nota.pdf", mime: "application/pdf" });
    expect(toStored(c)).toEqual({ fields: {}, missing: [], notes: c.notes, confidence: "baixa" });
  });
});
