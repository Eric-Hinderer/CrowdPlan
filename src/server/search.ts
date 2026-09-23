import "server-only";

import { computeOverlap } from "@/domain/availability";
import { allowedDates, getDimension, searchWindows } from "@/domain/dimensions";
import { addDays, eachDate, localDate, zonedInstant } from "@/domain/time";
import { toPlanInput, type PlanBundle } from "@/lib/plan-data";
import { airportFor } from "@/providers/search/airports";
import { cachedSearch } from "@/providers/search/cache";
import { normalizeEvents, normalizeFlights, normalizeHotels, normalizeLocalResults, titlesMatch } from "@/providers/search/normalize";
import { publicSearchUrl, serpapiConfigured, serpapiRequest } from "@/providers/search/serpapi";
import type { NormalizedEvent, NormalizedFlight, NormalizedHotel, NormalizedPlace, SearchOutcome } from "@/providers/search/types";
import { serverDb, serverDbConfigured } from "./db";
import { logEvent } from "./events";
import { loadPlanForServer } from "./plan-loader";
import { PgSearchStore } from "./search-store";

const MAX_NEW_CANDIDATES = 6;

function store() {
  return new PgSearchStore();
}

export function searchAvailable() {
  return serpapiConfigured() && serverDbConfigured();
}

// ---------------------------------------------------------------------------
// Adapters (cached + budgeted)
// ---------------------------------------------------------------------------

export function searchLocal(planId: string | null, q: string, opts: { ll?: string; charge?: boolean } = {}): Promise<SearchOutcome<NormalizedPlace[]>> {
  const params = { engine: "google_maps", type: "search", q, ll: opts.ll, hl: "en", gl: "us" };
  return cachedSearch({
    store: store(),
    planId,
    provider: "serpapi",
    engine: "google_maps",
    params,
    configured: serpapiConfigured(),
    chargeBudget: opts.charge !== false,
    fetcher: async () => normalizeLocalResults(await serpapiRequest(params), new Date().toISOString()).slice(0, 10),
  });
}

export function searchEvents(planId: string | null, q: string, htichips?: string): Promise<SearchOutcome<NormalizedEvent[]>> {
  const params = { engine: "google_events", q, htichips, hl: "en", gl: "us" };
  return cachedSearch({
    store: store(),
    planId,
    provider: "serpapi",
    engine: "google_events",
    params,
    configured: serpapiConfigured(),
    fetcher: async () => normalizeEvents(await serpapiRequest(params), new Date().toISOString()).slice(0, 10),
  });
}

export function searchFlights(planId: string | null, from: string, to: string, date: string, tz: string): Promise<SearchOutcome<NormalizedFlight[]>> {
  const params = { engine: "google_flights", type: 2, departure_id: from, arrival_id: to, outbound_date: date, adults: 1, currency: "USD", hl: "en", gl: "us" };
  return cachedSearch({
    store: store(),
    planId,
    provider: "serpapi",
    engine: "google_flights",
    params,
    configured: serpapiConfigured(),
    fetcher: async () => normalizeFlights(await serpapiRequest(params), new Date().toISOString(), tz, "USD", publicSearchUrl("google_flights", params)).slice(0, 12),
  });
}

export function searchHotels(planId: string | null, q: string, checkIn: string, checkOut: string, adults: number): Promise<SearchOutcome<NormalizedHotel[]>> {
  const params = { engine: "google_hotels", q, check_in_date: checkIn, check_out_date: checkOut, adults: Math.max(1, Math.min(adults, 12)), currency: "USD", hl: "en", gl: "us" };
  return cachedSearch({
    store: store(),
    planId,
    provider: "serpapi",
    engine: "google_hotels",
    params,
    configured: serpapiConfigured(),
    fetcher: async () => normalizeHotels(await serpapiRequest(params), new Date().toISOString(), publicSearchUrl("google_hotels", params)).slice(0, 10),
  });
}

// ---------------------------------------------------------------------------
// Enrichment of user-named places (fixed place / shortlist). One lookup each.
// ---------------------------------------------------------------------------

function llFor(plan: PlanBundle["plan"]) {
  return plan.location_lat != null && plan.location_lng != null ? `@${plan.location_lat},${plan.location_lng},12z` : undefined;
}

export async function enrichCandidatesInBackground(planId: string, candidateIds?: string[]) {
  if (!serverDbConfigured()) return;
  const sql = serverDb();
  const rows = await sql`
    select c.id, c.title, c.address, c.source_url, p.location_label, p.location_lat, p.location_lng, p.kind, p.status
    from public.candidates c join public.plans p on p.id = c.plan_id
    where c.plan_id = ${planId} and c.enrichment_status = 'pending' and c.status = 'active'
      ${candidateIds?.length ? sql`and c.id in ${sql(candidateIds)}` : sql``}
    limit 8`;
  for (const c of rows) {
    if (!serpapiConfigured() || c.status !== "collecting") {
      await sql`update public.candidates set enrichment_status = 'none' where id = ${c.id}`;
      continue;
    }
    const q = [c.title, c.location_label].filter(Boolean).join(" ");
    const ll = c.location_lat != null ? `@${c.location_lat},${c.location_lng},12z` : undefined;
    const out = await searchLocal(planId, q, { ll });
    if (out.status !== "ok") {
      await sql`update public.candidates set enrichment_status = ${out.status === "budget_exhausted" ? "none" : "failed"} where id = ${c.id}`;
      continue;
    }
    const match = out.data.find((p) => titlesMatch(p.title, c.title));
    if (!match) {
      await sql`update public.candidates set enrichment_status = 'not_found' where id = ${c.id}`;
      continue;
    }
    await applyPlace(c.id, match);
  }
}

async function applyPlace(candidateId: string, p: NormalizedPlace) {
  const sql = serverDb();
  const type = p.categories.some((x) => /restaurant|bar|grill|cafe|bistro|diner|pizza|steak|food/i.test(x)) ? "restaurant" : undefined;
  await sql`
    update public.candidates set
      source_kind = 'live', provider = ${p.provider}, provider_ref = ${p.providerRef}, fetched_at = ${p.fetchedAt},
      source_url = coalesce(source_url, ${p.sourceUrl}), address = ${p.address}, lat = ${p.lat}, lng = ${p.lng},
      rating = ${p.rating}, review_count = ${p.reviewCount}, price_level = ${p.priceText},
      cost = coalesce(${p.cost ? sql.json(p.cost as never) : null}::jsonb, cost),
      hours = ${p.hours ? sql.json(p.hours as never) : null}, categories = ${p.categories},
      attributes = attributes || ${sql.json({ website: p.website, phone: p.phone, thumbnail: p.thumbnail } as never)},
      type = coalesce(${type ?? null}, type), enrichment_status = 'done'
    where id = ${candidateId}`;
}

// ---------------------------------------------------------------------------
// Criteria / discovery search: runs only after viable time windows exist.
// ---------------------------------------------------------------------------

export interface SearchRunResult {
  added: number;
  searched: string[];
  outcome: "ok" | "not_configured" | "budget_exhausted" | "error" | "blocked";
  message?: string;
}

export async function runCriteriaSearch(planId: string, requestedBy: string | null): Promise<SearchRunResult> {
  const bundle = await loadPlanForServer(planId);
  if (!bundle) return { added: 0, searched: [], outcome: "error", message: "Plan not found" };
  const { plan } = bundle;
  if (plan.status !== "collecting") return { added: 0, searched: [], outcome: "blocked", message: "This plan is finalized." };
  if (plan.kind === "travel") return runTravelSearch(planId);
  const discoveryAllowed = plan.mode === "criteria" || plan.mode === "discovery" || plan.discovery_enabled;
  if (!discoveryAllowed) {
    return { added: 0, searched: [], outcome: "blocked", message: "This plan compares only the options your group named. Turn on suggestions to search for more." };
  }
  const input = toPlanInput(bundle);
  const overlap = computeOverlap(input.members, input.availability, searchWindows(input.dimensions, input.plan), input.plan.minDurationMinutes);
  if (overlap.respondedIds.length < Math.min(2, input.members.length) || !overlap.best) {
    return { added: 0, searched: [], outcome: "blocked", message: "Collect availability first — CrowdPlan searches only after it knows when the group can meet." };
  }
  if (!serpapiConfigured()) return { added: 0, searched: [], outcome: "not_configured", message: "Live search isn't configured. Add options by name or link." };

  const cuisine = getDimension(bundle.dimensions, "cuisine");
  const area = getDimension(bundle.dimensions, "area");
  const activity = getDimension(bundle.dimensions, "activity");
  const where = [area?.value?.type === "area" ? area.value.label : null, plan.location_label].filter(Boolean).join(", ");
  const queries: Array<{ kind: "local" | "events"; q: string }> = [];
  if (plan.kind === "dinner") {
    const c = cuisine?.value?.type === "list" ? cuisine.value.items.join(" ") : cuisine?.value?.type === "text" ? cuisine.value.text : "";
    queries.push({ kind: "local", q: `${c} restaurants ${where ? `in ${where}` : ""}`.trim() });
  } else {
    const what = activity?.state !== "UNDECIDED" && activity?.value?.type === "text" ? activity.value.text : "fun things to do";
    queries.push({ kind: "local", q: `${what} ${where ? `in ${where}` : ""}`.trim() });
    if (plan.mode === "discovery" || plan.discovery_enabled) queries.push({ kind: "events", q: `events ${where ? `in ${where}` : ""}`.trim() });
  }

  let added = 0;
  const searched: string[] = [];
  const sql = serverDb();
  for (const query of queries) {
    searched.push(query.q);
    if (query.kind === "local") {
      const out = await searchLocal(planId, query.q, { ll: llFor(plan) });
      if (out.status === "budget_exhausted") return { added, searched, outcome: "budget_exhausted", message: "This plan used its search budget. Cached results are still shown." };
      if (out.status !== "ok") return { added, searched, outcome: out.status === "not_configured" ? "not_configured" : "error", message: out.status === "error" ? out.message : undefined };
      for (const p of out.data) {
        if (added >= MAX_NEW_CANDIDATES) break;
        const inserted = await sql`
          insert into public.candidates (plan_id, type, title, origin, source_kind, provider, provider_ref, source_url, fetched_at,
            address, lat, lng, cost, rating, review_count, price_level, hours, categories, attributes, enrichment_status)
          values (${planId}, ${plan.kind === "dinner" ? "restaurant" : "activity"}, ${p.title.slice(0, 160)}, ${plan.mode === "discovery" ? "discovery" : "criteria"},
            'live', ${p.provider}, ${p.providerRef}, ${p.sourceUrl}, ${p.fetchedAt}, ${p.address}, ${p.lat}, ${p.lng},
            ${p.cost ? sql.json(p.cost as never) : null}, ${p.rating}, ${p.reviewCount}, ${p.priceText},
            ${p.hours ? sql.json(p.hours as never) : null}, ${p.categories},
            ${sql.json({ website: p.website, phone: p.phone, thumbnail: p.thumbnail } as never)}, 'done')
          on conflict (plan_id, provider, provider_ref) where provider_ref is not null do nothing
          returning id`;
        added += inserted.length;
      }
    } else {
      const dates = allowedDates(bundle.dimensions, input.plan).slice(0, 3);
      const out = await searchEvents(planId, query.q, dates.length <= 2 ? "date:week" : "date:month");
      if (out.status !== "ok") continue;
      for (const e of out.data) {
        if (added >= MAX_NEW_CANDIDATES) break;
        const startsAt = parseEventStart(e, plan.timezone, dates);
        if (!startsAt) continue; // only events that fall on the plan's dates
        const inserted = await sql`
          insert into public.candidates (plan_id, type, title, description, origin, source_kind, provider, provider_ref, source_url, fetched_at,
            address, starts_at, ends_at, categories, attributes, enrichment_status)
          values (${planId}, 'event', ${e.title.slice(0, 160)}, ${e.description}, 'discovery', 'live', ${e.provider}, ${e.providerRef?.slice(0, 300) ?? null},
            ${e.sourceUrl}, ${e.fetchedAt}, ${[e.venueName, e.address].filter(Boolean).join(" · ") || null},
            ${new Date(startsAt.start).toISOString()}, ${new Date(startsAt.end).toISOString()}, ${["Event"]},
            ${sql.json({ whenText: e.whenText, ticketUrl: e.ticketUrl, thumbnail: e.thumbnail } as never)}, 'done')
          on conflict (plan_id, provider, provider_ref) where provider_ref is not null do nothing
          returning id`;
        added += inserted.length;
      }
    }
  }
  await logEvent(planId, requestedBy, "search_run", { added, queries: searched });
  return { added, searched, outcome: "ok" };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Oct 3" + "Sat, Oct 3, 7 – 10 PM" → instants, only if on an allowed date. */
export function parseEventStart(e: Pick<NormalizedEvent, "startDate" | "whenText">, tz: string, allowed: string[]): { start: number; end: number } | null {
  const m = /([A-Za-z]{3})[a-z]*\s+(\d{1,2})/.exec(e.startDate ?? e.whenText ?? "");
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const date = allowed.find((d) => Number(d.slice(5, 7)) === month + 1 && Number(d.slice(8, 10)) === Number(m[2]));
  if (!date) return null;
  const t = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(e.whenText ?? "");
  if (!t) return null;
  const endMer = t[6].toUpperCase();
  const startMer = (t[3] ?? endMer).toUpperCase();
  const to24 = (h: string, mm: string | undefined, mer: string) => {
    let hh = Number(h) % 12;
    if (mer === "PM") hh += 12;
    return `${String(hh).padStart(2, "0")}:${mm ?? "00"}`;
  };
  const start = zonedInstant(date, to24(t[1], t[2], startMer), tz);
  let end = zonedInstant(date, to24(t[4], t[5], endMer), tz);
  if (end <= start) end += 24 * 3600_000;
  return { start, end };
}

// ---------------------------------------------------------------------------
// Travel: bounded search. Narrow dates first, then one-way flights per
// distinct origin and direction, one hotel query per destination/date pair.
// ---------------------------------------------------------------------------

export async function runTravelSearch(planId: string): Promise<SearchRunResult> {
  const bundle = await loadPlanForServer(planId);
  if (!bundle) return { added: 0, searched: [], outcome: "error", message: "Plan not found" };
  if (!serpapiConfigured()) return { added: 0, searched: [], outcome: "not_configured", message: "Live flight and hotel search isn't configured." };
  const input = toPlanInput(bundle);
  const { plan } = bundle;
  const sql = serverDb();

  const destDim = getDimension(bundle.dimensions, "destination");
  const destinations: string[] = [];
  if (destDim?.value?.type === "place") destinations.push(destDim.value.name);
  for (const c of bundle.candidates) if (c.type === "destination" && c.status === "active" && destinations.length < 3) destinations.push(c.title);
  if (!destinations.length) return { added: 0, searched: [], outcome: "blocked", message: "Add a destination first." };

  const nightsDim = getDimension(bundle.dimensions, "nights");
  const nights = nightsDim?.value?.type === "nights" ? nightsDim.value.min : 3;
  const pairs = bestDatePairs(input, nights, destinations.length > 1 ? 1 : 2);
  if (!pairs.length) return { added: 0, searched: [], outcome: "blocked", message: "No dates work for everyone who responded yet. Collect availability first." };

  const home = airportFor(plan.location_label) ?? "OMA";
  const originOf = (m: PlanBundle["members"][number]) => airportFor(m.origin_label) ?? home;
  const origins = [...new Set(bundle.members.map(originOf))].slice(0, 4);
  const searched: string[] = [];
  let added = 0;
  const componentsBatch: Array<Record<string, unknown>> = [];

  for (const destination of destinations) {
    const to = airportFor(destination);
    if (!to) continue;
    for (const pair of pairs) {
      const flightsByOrigin = new Map<string, { out: NormalizedFlight[]; ret: NormalizedFlight[] }>();
      for (const from of origins) {
        const out = await searchFlights(planId, from, to, pair.start, plan.timezone);
        const ret = await searchFlights(planId, to, from, pair.end, plan.timezone);
        searched.push(`${from}→${to} ${pair.start}`, `${to}→${from} ${pair.end}`);
        if (out.status === "budget_exhausted" || ret.status === "budget_exhausted") {
          return { added, searched, outcome: "budget_exhausted", message: "This plan used its search budget." };
        }
        flightsByOrigin.set(from, { out: out.status === "ok" ? out.data : [], ret: ret.status === "ok" ? ret.data : [] });
      }
      const hotels = await searchHotels(planId, `${destination} hotels`, pair.start, pair.end, bundle.members.length);
      searched.push(`hotels ${destination} ${pair.start}`);
      const title = `${destination} · ${shortRange(pair.start, pair.end)}`;
      const ref = `${destination.toLowerCase()}|${pair.start}|${pair.end}`;
      const cand = await sql`
        insert into public.candidates (plan_id, type, title, origin, source_kind, provider, provider_ref, attributes, enrichment_status, fetched_at)
        values (${planId}, 'travel_package', ${title}, 'criteria', 'live', 'crowdplan:travel', ${ref},
          ${sql.json({ destination, startDate: pair.start, endDate: pair.end, nights: pair.nights, airports: { to, origins } } as never)}, 'done', now())
        on conflict (plan_id, provider, provider_ref) where provider_ref is not null do update set fetched_at = now()
        returning id`;
      const candidateId = cand[0].id as string;
      added++;
      await sql`delete from public.candidate_components where candidate_id = ${candidateId} and source_kind in ('live', 'estimate')`;
      let sort = 0;
      for (const m of bundle.members) {
        const f = flightsByOrigin.get(originOf(m));
        for (const [direction, list] of [["outbound", f?.out ?? []], ["return", f?.ret ?? []]] as const) {
          const options = pickFlightOptions(list);
          options.forEach((o, i) => {
            sort++;
            componentsBatch.push({
              plan_id: planId,
              candidate_id: candidateId,
              kind: "flight",
              member_id: m.id,
              title: `${o.from} → ${o.to} · ${o.airline ?? "Flight"} ${o.flightNumbers.join("/")}`.slice(0, 200),
              data: { direction, airline: o.airline, from: o.from, to: o.to, departAt: o.departAt, arriveAt: o.arriveAt, departTz: o.departTz, arriveTz: o.arriveTz, stops: o.stops, durationMinutes: o.durationMinutes, flightNumbers: o.flightNumbers, tzAssumed: o.tzAssumed, departLocal: o.departLocal, arriveLocal: o.arriveLocal },
              cost: o.price != null ? { min: o.price, max: o.price, currency: "USD", basis: "per_person", kind: "quote", sourceKind: "live" } : null,
              source_kind: "live",
              provider: o.provider,
              provider_ref: o.providerRef?.slice(0, 300) ?? null,
              source_url: o.sourceUrl,
              fetched_at: o.fetchedAt,
              is_selected: i === 0,
              sort,
            });
          });
        }
      }
      const hotelOptions = hotels.status === "ok" ? pickHotels(hotels.data) : [];
      const rooms = Math.ceil(bundle.members.length / 2);
      hotelOptions.forEach((h, i) => {
        componentsBatch.push({
          plan_id: planId,
          candidate_id: candidateId,
          kind: "hotel",
          member_id: null,
          title: h.name.slice(0, 200),
          data: { name: h.name, checkIn: pair.start, checkOut: pair.end, nights: pair.nights, rooms, guests: bundle.members.length, rating: h.rating, nightlyRate: h.nightlyRate, totalRate: h.totalRate, hotelClass: h.hotelClass, thumbnail: h.thumbnail },
          cost: h.nightlyRate != null ? { min: h.nightlyRate, max: h.nightlyRate, currency: "USD", basis: "per_night", kind: "quote", sourceKind: "live" } : null,
          source_kind: "live",
          provider: h.provider,
          provider_ref: h.providerRef?.slice(0, 300) ?? null,
          source_url: h.sourceUrl,
          fetched_at: h.fetchedAt,
          is_selected: i === 0,
          sort: ++sort,
        });
      });
      const perDay = 90;
      componentsBatch.push({
        plan_id: planId,
        candidate_id: candidateId,
        kind: "local_estimate",
        member_id: null,
        title: `Food & getting around (~$${perDay}/day estimate)`,
        data: { perDay, days: pair.nights + 1 },
        cost: { min: perDay * (pair.nights + 1), max: perDay * (pair.nights + 1), currency: "USD", basis: "per_person", kind: "estimate", sourceKind: "estimate" },
        source_kind: "estimate",
        provider: "crowdplan:estimate",
        provider_ref: null,
        source_url: null,
        fetched_at: null,
        is_selected: true,
        sort: ++sort,
      });
      if (componentsBatch.length) {
        const batch = componentsBatch.splice(0).map((r) => ({ ...r, data: sql.json(r.data as never), cost: r.cost ? sql.json(r.cost as never) : null }));
        await sql`insert into public.candidate_components ${sql(batch as unknown as Record<string, string>[], "plan_id", "candidate_id", "kind", "member_id", "title", "data", "cost", "source_kind", "provider", "provider_ref", "source_url", "fetched_at", "is_selected", "sort")}`;
      }
    }
  }
  await logEvent(planId, null, "travel_search_run", { added, searched: searched.length });
  return { added, searched, outcome: added ? "ok" : "error", message: added ? undefined : "No destinations with a known airport." };
}

function shortRange(a: string, b: string) {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(a)}–${f(b)}`;
}

/** Keep a varied, bounded set: cheapest few plus earliest/latest arrivals for repairs. */
export function pickFlightOptions(list: NormalizedFlight[]): NormalizedFlight[] {
  const priced = list.filter((f) => f.price != null).sort((a, b) => a.price! - b.price! || a.departAt - b.departAt);
  const picked = new Map<string, NormalizedFlight>();
  for (const f of priced.slice(0, 4)) picked.set(f.providerRef ?? String(f.departAt), f);
  const byArrival = [...priced].sort((a, b) => a.arriveAt - b.arriveAt);
  for (const f of [byArrival[0], byArrival[byArrival.length - 1], ...priced.filter((x) => x.stops === 0).slice(0, 2)]) {
    if (f && picked.size < 7) picked.set(f.providerRef ?? String(f.departAt), f);
  }
  return [...picked.values()];
}

export function pickHotels(list: NormalizedHotel[]): NormalizedHotel[] {
  return list
    .filter((h) => h.nightlyRate != null)
    .sort((a, b) => ((b.rating ?? 3) >= 4 ? 1 : 0) - ((a.rating ?? 3) >= 4 ? 1 : 0) || a.nightlyRate! - b.nightlyRate!)
    .slice(0, 3);
}

/** Candidate trip dates where every responding member is available all days. */
export function bestDatePairs(input: ReturnType<typeof toPlanInput>, nights: number, max: number): Array<{ start: string; end: string; nights: number }> {
  const dates = allowedDates(input.dimensions, input.plan, 60);
  const tz = input.plan.timezone;
  const responded = new Set(input.availability.map((w) => w.memberId));
  const scored: Array<{ start: string; end: string; nights: number; score: number }> = [];
  for (const start of dates) {
    const end = addDays(start, nights);
    if (end > dates[dates.length - 1]) break;
    let ok = true;
    let score = 0;
    for (const m of input.members) {
      if (!responded.has(m.id)) continue;
      for (const d of eachDate(start, end)) {
        const s = zonedInstant(d, "00:00", tz) + 3600_000;
        const e = zonedInstant(d, "23:00", tz);
        const w = input.availability.filter((x) => x.memberId === m.id && x.start < e && x.end > s);
        if (w.some((x) => x.level === "unavailable") || !w.some((x) => x.level !== "unavailable")) {
          ok = false;
          break;
        }
        score += w.some((x) => x.level === "ideal") ? 2 : 1;
      }
      if (!ok) break;
    }
    if (ok && responded.size > 0) scored.push({ start, end, nights, score });
  }
  scored.sort((a, b) => b.score - a.score || a.start.localeCompare(b.start));
  const out: typeof scored = [];
  for (const s of scored) {
    if (out.every((o) => Math.abs(Date.parse(o.start) - Date.parse(s.start)) >= 3 * 86_400_000)) out.push(s);
    if (out.length >= max) break;
  }
  return out.map(({ start, end, nights: n }) => ({ start, end, nights: n }));
}

export function todayIn(tz: string) {
  return localDate(Date.now(), tz);
}
