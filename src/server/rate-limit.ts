import "server-only";

import { serverDb, serverDbConfigured } from "./db";
import { ActionError } from "./guard";

/**
 * Fixed-window rate limit backed by private.rate_limits (shared across
 * serverless instances). Fails open only when the server DB isn't configured.
 */
export async function rateLimit(bucket: string, max: number, windowSeconds: number, message = "You're doing that a lot — try again in a few minutes.") {
  if (!serverDbConfigured()) return;
  const sql = serverDb();
  const rows = await sql`select private.hit_rate_limit(${bucket}, ${max}, ${windowSeconds}) as ok`;
  if (!rows[0]?.ok) throw new ActionError(message);
}
