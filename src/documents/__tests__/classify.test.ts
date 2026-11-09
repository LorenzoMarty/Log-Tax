import { describe, expect, it } from "vitest";
import { classifyDocument, DOC_LABEL, formatExtracted } from "../classify";

const nfe = (over: { vNF?: string; nNF?: string; cnpj?: string } = {}) => `<?xml version="1.0"?>
<nfeProc><NFe><infNFe>
  <ide><nNF>${over.nNF ?? "1234"}</nNF><dhEmi>2026-10-05T10:30:00-03:00</dhEmi></ide>
  <emit><CNPJ>${over.cnpj ?? "12345678000190"}</CNPJ><xNome>Fornecedor Exemplo</xNome></emit>
  <dest><CNPJ>99999999000199</CNPJ></dest>
  <total><ICMSTot>${over.vNF === "" ? "" : `<vNF>${over.vNF ?? "1500.00"}</vNF>`}</ICMSTot></total>
</infNFe></NFe></nfeProc>`;

describe("classifyDocument: by content", () => {
  it("reads the essentials of an NF-e XML", () => {
    const c = classifyDocument({ name: "arquivo.xml", mime: "application/xml", text: nfe() });
    expect(c.type).toBe("nota_fiscal");
    expect(c.confidence).toBe("alta");
    expect(c.extracted).toEqual({ numero: "1234", emitente_cnpj: "12345678000190", valor_total: "1500.00", emissao: "2026-10-05" });
    expect(c.missing).toEqual([]);
  });

  it("takes the emitter's CNPJ, not the recipient's", () => {
    expect(classifyDocument({ name: "x.xml", mime: "text/xml", text: nfe({ cnpj: "11111111000111" }) }).extracted.emitente_cnpj).toBe("11111111000111");
  });

  it("still identifies an incomplete NF-e and says exactly what is missing, without inventing it", () => {
    const c = classifyDocument({ name: "x.xml", mime: "text/xml", text: nfe({ vNF: "" }) });
    expect(c.type).toBe("nota_fiscal");
    expect(c.extracted.valor_total).toBeUndefined();
    expect(c.missing).toEqual(["valor_total"]);
  });

  it("content wins over a misleading file name", () => {
    expect(classifyDocument({ name: "foto-ferias.xml", mime: "text/xml", text: nfe() }).type).toBe("nota_fiscal");
  });

  it("does not trust XML that is not an NF-e", () => {
    const c = classifyDocument({ name: "dados.xml", mime: "text/xml", text: "<config><nNF>9</nNF></config>" });
    expect(c.type).toBe("outro");
    expect(c.extracted).toEqual({});
  });
});

describe("classifyDocument: by file name (PDF and images are not read in this version)", () => {
  const cases: [string, ReturnType<typeof classifyDocument>["type"]][] = [
    ["Nota Fiscal Janeiro.PDF", "nota_fiscal"],
    ["danfe-0042.pdf", "nota_fiscal"],
    ["informe-rendimentos-2025.pdf", "informe_rendimentos"],
    ["Informe de Rendimentos.png", "informe_rendimentos"],
    ["recibo-consulta-médica.png", "comprovante_despesa"],
    ["mensalidade-escola.pdf", "comprovante_despesa"],
    ["declaração-irpf-2024.pdf", "declaracao"],
    ["foto.jpg", "outro"],
  ];
  it.each(cases)("%s → %s", (name, type) => {
    const c = classifyDocument({ name, mime: name.endsWith("png") ? "image/png" : "application/pdf" });
    expect(c.type).toBe(type);
    expect(c.confidence).toBe("baixa");
    expect(c.extracted).toEqual({});
  });

  it("tells the user the values must be checked by hand", () => {
    const c = classifyDocument({ name: "nota.pdf", mime: "application/pdf" });
    expect(c.notes.join(" ")).toMatch(/PDF|imagem/i);
    expect(c.notes.join(" ")).toMatch(/ilustrativa|confira/i);
  });
});

describe("robustness", () => {
  it("never throws on odd input", () => {
    expect(() => classifyDocument({ name: "", mime: "", text: "" })).not.toThrow();
    expect(() => classifyDocument({ name: "a", mime: "application/xml", text: "<nfe" + "x".repeat(10) })).not.toThrow();
    expect(classifyDocument({ name: "", mime: "" }).type).toBe("outro");
  });

  it("is deterministic", () => {
    const i = { name: "nota.xml", mime: "text/xml", text: nfe() };
    expect(classifyDocument(i)).toEqual(classifyDocument(i));
  });
});

describe("display helpers", () => {
  it("labels every type in Portuguese", () => {
    expect(DOC_LABEL.nota_fiscal).toBe("Nota fiscal");
    expect(DOC_LABEL.informe_rendimentos).toBe("Informe de rendimentos");
    expect(DOC_LABEL.outro).toBe("Outro");
  });

  it("formats extracted values for people", () => {
    expect(formatExtracted({ numero: "1234", emitente_cnpj: "12345678000190", valor_total: "1500.00", emissao: "2026-10-05" })).toEqual([
      ["Número", "1234"],
      ["CNPJ do emitente", "12.345.678/0001-90"],
      ["Valor total", "R$ 1.500,00"],
      ["Emissão", "05/10/2026"],
    ]);
  });
});
