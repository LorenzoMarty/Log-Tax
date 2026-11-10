import { publicEnv } from "@/lib/env";

/** Runs once when the server boots: a missing variable stops the start instead of failing on the first request. */
export async function register() {
  publicEnv();
  // Identifiers are encrypted with this key: a production server without it must not start (and silently store them weakly).
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { keyFor } = await import("@/lib/crypto");
    keyFor(process.env.DATA_ENCRYPTION_KEY_ID ?? "k1");
  }
}
