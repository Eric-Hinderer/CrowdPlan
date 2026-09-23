import "server-only";

import { RetryableError } from "./cache";

/** Server-only SerpAPI transport. The key never leaves the server. */
export function serpapiConfigured(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY);
}

const NO_RESULTS = /hasn't returned any results|no results/i;

export async function serpapiRequest(params: Record<string, string | number | undefined>): Promise<unknown> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) throw new Error("SERPAPI_API_KEY is not configured");
  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  url.searchParams.set("api_key", key);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store", headers: { accept: "application/json" } });
  } catch (e) {
    throw new RetryableError(e instanceof Error ? `Search provider unreachable: ${e.name}` : "Search provider unreachable");
  }
  if (res.status === 429 || res.status >= 500) throw new RetryableError(`Search provider busy (${res.status})`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("Search provider returned an unreadable response");
  }
  const err = (json as { error?: unknown })?.error;
  if (typeof err === "string") {
    if (NO_RESULTS.test(err)) return {};
    throw new Error(`Search provider error: ${err.slice(0, 160)}`);
  }
  if (!res.ok) throw new Error(`Search provider error (${res.status})`);
  return json;
}

/** Link a person can open to see the same results (no API key). */
export function publicSearchUrl(engine: string, params: Record<string, string | number | undefined>): string | null {
  if (engine === "google_flights" && params.departure_id && params.arrival_id && params.outbound_date) {
    return `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${params.departure_id} to ${params.arrival_id} on ${params.outbound_date} one way`)}`;
  }
  if (engine === "google_hotels" && params.q) {
    return `https://www.google.com/travel/hotels?q=${encodeURIComponent(String(params.q))}`;
  }
  return null;
}
