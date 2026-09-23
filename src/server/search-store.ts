import "server-only";

import type { CacheRow, LedgerOutcome, SearchStore } from "@/providers/search/cache";
import type { SearchEngine } from "@/providers/search/types";
import { serverDb } from "./db";

/** Shared Postgres-backed cache (private schema, crowdplan_server role). */
export class PgSearchStore implements SearchStore {
  private sql = serverDb();

  async get<T>(key: string): Promise<CacheRow<T> | null> {
    const rows = await this.sql`
      select status, normalized, fetched_at, expires_at, claimed_until
      from private.provider_cache where cache_key = ${key}`;
    if (!rows.length) return null;
    const r = rows[0];
    return {
      status: r.status,
      normalized: r.normalized as T | null,
      fetchedAt: r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      claimedUntil: r.claimed_until ? new Date(r.claimed_until).toISOString() : null,
    };
  }

  async claim(key: string, provider: string, engine: SearchEngine, params: Record<string, unknown>, claimSeconds: number): Promise<boolean> {
    const rows = await this.sql`
      insert into private.provider_cache (cache_key, provider, engine, params, status, claimed_until, attempts)
      values (${key}, ${provider}, ${engine}, ${this.sql.json(params as never)}, 'pending', now() + make_interval(secs => ${claimSeconds}), 1)
      on conflict (cache_key) do update
        set status = 'pending', claimed_until = now() + make_interval(secs => ${claimSeconds}),
            attempts = private.provider_cache.attempts + 1, updated_at = now()
        where private.provider_cache.status <> 'pending' or private.provider_cache.claimed_until < now()
      returning cache_key`;
    return rows.length === 1;
  }

  async complete<T>(key: string, normalized: T, fetchedAt: string, expiresAt: string): Promise<void> {
    await this.sql`
      update private.provider_cache
      set status = 'ok', normalized = ${this.sql.json(normalized as never)}, fetched_at = ${fetchedAt}, expires_at = ${expiresAt},
          claimed_until = null, error = null, updated_at = now()
      where cache_key = ${key}`;
  }

  async fail(key: string, message: string): Promise<void> {
    await this.sql`
      update private.provider_cache set status = 'error', error = ${message.slice(0, 300)}, claimed_until = null, updated_at = now()
      where cache_key = ${key}`;
  }

  async reserveBudget(planId: string): Promise<boolean> {
    const rows = await this.sql`
      update public.plans set searches_used = searches_used + 1
      where id = ${planId} and searches_used < search_budget and status = 'collecting'
      returning id`;
    return rows.length === 1;
  }

  async ledger(planId: string | null, key: string, provider: string, engine: SearchEngine, outcome: LedgerOutcome): Promise<void> {
    await this.sql`
      insert into private.search_ledger (plan_id, cache_key, provider, engine, outcome)
      values (${planId}, ${key}, ${provider}, ${engine}, ${outcome})`;
  }

  async touch(key: string): Promise<void> {
    await this.sql`update private.provider_cache set hit_count = hit_count + 1 where cache_key = ${key}`;
  }
}
