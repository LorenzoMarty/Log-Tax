import { describe, expect, it } from "vitest";
import { parseEnv } from "../env";

const ok = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "key" };

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseEnv(ok)).toEqual(ok);
  });

  it("names the missing variable", () => {
    expect(() => parseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: undefined })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => parseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" })).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("names every missing variable at once", () => {
    expect(() => parseEnv({})).toThrow(/URL[\s\S]*ANON_KEY/);
  });

  it("rejects a URL that is not a URL", () => {
    expect(() => parseEnv({ ...ok, NEXT_PUBLIC_SUPABASE_URL: "nope" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
