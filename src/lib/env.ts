import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL is missing or not a URL" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string({ error: "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing" }).min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is empty"),
});

export type PublicEnv = z.infer<typeof schema>;

/** Validates the raw values and names every variable that is wrong. */
export function parseEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Invalid environment:\n${result.error.issues.map((i) => `- ${i.message}`).join("\n")}`);
}

/** Next only inlines NEXT_PUBLIC_* when they are read literally, so each one is spelled out here. */
export const publicEnv = () =>
  parseEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
