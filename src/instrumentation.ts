import { publicEnv } from "@/lib/env";

/** Runs once when the server boots: a missing variable stops the start instead of failing on the first request. */
export function register() {
  publicEnv();
}
