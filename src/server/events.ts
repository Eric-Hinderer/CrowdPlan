import "server-only";

import { serverDb, serverDbConfigured } from "./db";

/** Append-only plan history written by the least-privilege server role. Never blocks the user action. */
export async function logEvent(planId: string, actorMemberId: string | null, kind: string, payload: Record<string, unknown> = {}) {
  if (!serverDbConfigured()) return;
  try {
    const sql = serverDb();
    await sql`insert into public.plan_events (plan_id, actor_member_id, kind, payload) values (${planId}, ${actorMemberId}, ${kind}, ${sql.json(payload as never)})`;
  } catch (e) {
    console.error("[events] failed to log", kind, e instanceof Error ? e.message : e);
  }
}
