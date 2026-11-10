// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLlm } from "../llm-factory";
import { scriptedLlm } from "../scripted-llm";

afterEach(() => vi.unstubAllEnvs());

describe("getLlm", () => {
  it("uses the scripted stand-in outside production", () => {
    vi.stubEnv("LOG_TAX_LLM", "scripted");
    vi.stubEnv("NODE_ENV", "test");
    expect(getLlm()).toBe(scriptedLlm);
  });

  it("refuses the scripted stand-in in production and asks for the real model", () => {
    vi.stubEnv("LOG_TAX_LLM", "scripted");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => getLlm()).toThrow(/OPENAI_API_KEY/);
  });

  it("in production with a key it builds the real client, never the scripted one", () => {
    vi.stubEnv("LOG_TAX_LLM", "scripted");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(getLlm()).not.toBe(scriptedLlm);
  });
});
