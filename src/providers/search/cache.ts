// Search cost control: canonical cache keys, TTL by volatility, atomic
// in-flight claims (concurrent identical searches launch ONE request), a
// per-plan budget reserved BEFORE any outbound call, bounded retries, and a
// ledger of every attempt. Storage is injected so it can be unit-tested.
import { createHash } from "node:crypto";
import type { SearchEngine, SearchOutcome } from "./types";

export const TTL_SECONDS: Record<SearchEngine, number> = {
  google_maps: 7 * 24 * 3600, // static venue facts
  google: 3 * 24 * 3600,
  google_events: 12 * 3600,
  google_hotels: 6 * 3600,
  google_flights: 3 * 3600, // volatile prices
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : v)]),
    );
  }
  return value;
}

export function cacheKey(provider: string, engine: SearchEngine, params: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([provider, engine, canonical(params)])).digest("hex");
}

export interface CacheRow<T> {
  status: "pending" | "ok" | "error";
  normalized: T | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  claimedUntil: string | null;
}

export type LedgerOutcome = "cache_hit" | "network" | "deduplicated" | "budget_exhausted" | "error" | "not_configured" | "rate_limited";

export interface SearchStore {
  get<T>(key: string): Promise<CacheRow<T> | null>;
  /** Atomically claim the key for fetching. Returns false if another worker holds an unexpired claim. */
  claim(key: string, provider: string, engine: SearchEngine, params: Record<string, unknown>, claimSeconds: number): Promise<boolean>;
  complete<T>(key: string, normalized: T, fetchedAt: string, expiresAt: string): Promise<void>;
  fail(key: string, message: string): Promise<void>;
  /** Atomically consume one unit of the plan's search budget. */
  reserveBudget(planId: string): Promise<boolean>;
  ledger(planId: string | null, key: string, provider: string, engine: SearchEngine, outcome: LedgerOutcome): Promise<void>;
  touch(key: string): Promise<void>;
}

export interface CachedSearchOptions<T> {
  store: SearchStore;
  planId: string | null;
  provider: string;
  engine: SearchEngine;
  params: Record<string, unknown>;
  configured: boolean;
  fetcher: () => Promise<T>;
  now?: () => number;
  ttlSeconds?: number;
  maxAttempts?: number;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** When false, the request is not charged to a plan (e.g. global cache warm). */
  chargeBudget?: boolean;
}

export class RetryableError extends Error {}

export async function cachedSearch<T>(opts: CachedSearchOptions<T>): Promise<SearchOutcome<T>> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const key = cacheKey(opts.provider, opts.engine, opts.params);
  const { store } = opts;

  const fresh = (row: CacheRow<T> | null) => row?.status === "ok" && row.normalized != null && row.expiresAt != null && Date.parse(row.expiresAt) > now();
  const staleOf = (row: CacheRow<T> | null) => (row?.normalized != null && row.fetchedAt ? { data: row.normalized, fetchedAt: row.fetchedAt } : undefined);

  let row = await store.get<T>(key);
  if (fresh(row)) {
    await store.touch(key);
    await store.ledger(opts.planId, key, opts.provider, opts.engine, "cache_hit");
    return { status: "ok", data: row!.normalized!, fetchedAt: row!.fetchedAt!, cached: true };
  }
  if (!opts.configured) {
    await store.ledger(opts.planId, key, opts.provider, opts.engine, "not_configured");
    return { status: "not_configured" };
  }

  const claimed = await store.claim(key, opts.provider, opts.engine, opts.params, 45);
  if (!claimed) {
    // Someone else is fetching the identical query: wait for their result.
    const deadline = now() + (opts.waitMs ?? 15_000);
    while (now() < deadline) {
      await sleep(300);
      row = await store.get<T>(key);
      if (fresh(row)) {
        await store.ledger(opts.planId, key, opts.provider, opts.engine, "deduplicated");
        return { status: "ok", data: row!.normalized!, fetchedAt: row!.fetchedAt!, cached: true };
      }
      if (row?.status === "error") break;
    }
    return { status: "error", message: "Search is taking longer than expected", stale: staleOf(row) };
  }

  if (opts.chargeBudget !== false && opts.planId) {
    const ok = await store.reserveBudget(opts.planId);
    if (!ok) {
      await store.fail(key, "budget_exhausted");
      await store.ledger(opts.planId, key, opts.provider, opts.engine, "budget_exhausted");
      return { status: "budget_exhausted", stale: staleOf(row) };
    }
  }

  const attempts = Math.max(1, Math.min(opts.maxAttempts ?? 2, 3));
  let lastError = "Search failed";
  for (let i = 0; i < attempts; i++) {
    try {
      await store.ledger(opts.planId, key, opts.provider, opts.engine, "network");
      const data = await opts.fetcher();
      const fetchedAt = new Date(now()).toISOString();
      const expiresAt = new Date(now() + (opts.ttlSeconds ?? TTL_SECONDS[opts.engine]) * 1000).toISOString();
      await store.complete(key, data, fetchedAt, expiresAt);
      return { status: "ok", data, fetchedAt, cached: false };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (!(e instanceof RetryableError) || i === attempts - 1) break;
      await sleep(400 * (i + 1));
    }
  }
  await store.fail(key, lastError);
  await store.ledger(opts.planId, key, opts.provider, opts.engine, "error");
  return { status: "error", message: lastError, stale: staleOf(row) };
}

/** In-memory store (tests and local fallback). */
export class MemoryStore implements SearchStore {
  rows = new Map<string, CacheRow<unknown> & { claimedUntilMs?: number }>();
  budgets = new Map<string, { used: number; limit: number }>();
  events: Array<{ planId: string | null; outcome: LedgerOutcome }> = [];
  constructor(private now: () => number = Date.now) {}
  async get<T>(key: string) {
    return (this.rows.get(key) as CacheRow<T> | undefined) ?? null;
  }
  async claim(key: string) {
    const r = this.rows.get(key);
    if (r?.status === "pending" && (r.claimedUntilMs ?? 0) > this.now()) return false;
    this.rows.set(key, { status: "pending", normalized: r?.normalized ?? null, fetchedAt: r?.fetchedAt ?? null, expiresAt: r?.expiresAt ?? null, claimedUntil: null, claimedUntilMs: this.now() + 45_000 });
    return true;
  }
  async complete<T>(key: string, normalized: T, fetchedAt: string, expiresAt: string) {
    this.rows.set(key, { status: "ok", normalized, fetchedAt, expiresAt, claimedUntil: null });
  }
  async fail(key: string) {
    const r = this.rows.get(key);
    this.rows.set(key, { status: "error", normalized: r?.normalized ?? null, fetchedAt: r?.fetchedAt ?? null, expiresAt: r?.expiresAt ?? null, claimedUntil: null });
  }
  async reserveBudget(planId: string) {
    const b = this.budgets.get(planId) ?? { used: 0, limit: 12 };
    if (b.used >= b.limit) return false;
    b.used++;
    this.budgets.set(planId, b);
    return true;
  }
  async ledger(planId: string | null, _key: string, _p: string, _e: SearchEngine, outcome: LedgerOutcome) {
    this.events.push({ planId, outcome });
  }
  async touch() {}
}
