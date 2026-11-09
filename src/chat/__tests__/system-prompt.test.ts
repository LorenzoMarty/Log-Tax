import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "@/engine";
import { buildSystemPrompt } from "../system-prompt";

describe("system prompt", () => {
  const prompt = buildSystemPrompt({ workspaceName: "Minha Empresa" });

  it("is in Portuguese and carries the estimate disclaimer", () => {
    expect(prompt).toContain(DISCLAIMER);
    expect(prompt).toMatch(/português/i);
  });

  it("forbids inventing numbers and routes calculations to the tools", () => {
    expect(prompt).toMatch(/nunca invente/i);
    expect(prompt).toMatch(/ferramentas/i);
    expect(prompt).toMatch(/dados suficientes/i);
  });

  it("only mentions 'garantido' inside a prohibition", () => {
    const sentences = prompt.split(/(?<=[.!?\n])\s+/).filter((s) => /garantid/i.test(s));
    expect(sentences.length).toBeGreaterThan(0);
    for (const s of sentences) expect(s).toMatch(/nunca|não/i);
  });

  it("asks for plain text because the chat does not render Markdown", () => {
    expect(prompt).toMatch(/não use markdown/i);
  });

  it("tells the model destructive actions need user confirmation", () => {
    expect(prompt).toMatch(/confirmação/i);
  });

  it("names the workspace and, for an agent, its objective", () => {
    expect(prompt).toContain("Minha Empresa");
    const agent = buildSystemPrompt({ workspaceName: "Inventário", agent: { name: "IA do Inventário", objective: "Acompanhar prazos" } });
    expect(agent).toContain("IA do Inventário");
    expect(agent).toContain("Acompanhar prazos");
  });
});
