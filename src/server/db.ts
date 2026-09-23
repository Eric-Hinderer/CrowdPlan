import "server-only";

import postgres from "postgres";

/**
 * Least-privilege server database role (crowdplan_server). Used only for
 * server-owned state: provider cache, search budgets/ledger, live candidate
 * enrichment, notification fan-out and scheduled jobs. User-facing reads and
 * writes go through the user-scoped Supabase client so RLS authorizes them.
 */
let sql: ReturnType<typeof postgres> | null = null;

export function serverDbConfigured(): boolean {
  return Boolean(process.env.CROWDPLAN_SERVER_DATABASE_URL);
}

export function serverDb() {
  if (!sql) {
    const url = process.env.CROWDPLAN_SERVER_DATABASE_URL;
    if (!url) throw new Error("CROWDPLAN_SERVER_DATABASE_URL is not configured");
    sql = postgres(url, {
      prepare: false, // transaction pooler
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}
