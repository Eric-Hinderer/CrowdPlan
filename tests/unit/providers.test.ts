import { describe, expect, it } from "vitest";
import { cacheKey, cachedSearch, MemoryStore, RetryableError } from "@/providers/search/cache";
import { normalizeEvents, normalizeFlights, normalizeHotels, normalizeLocalResults, normalizeWebResults, parseDayHours, parseOperatingHours, titlesMatch } from "@/providers/search/normalize";
import { airportFor } from "@/providers/search/airports";
import { localTime } from "@/domain/time";
import { parseEventStart, pickFlightOptions } from "@/server/search-pure";

const AT = "2026-09-22T15:00:00.000Z";

// Fixtures mirror documented SerpAPI shapes (trimmed). Labeled fixtures — never live evidence.
const mapsFixture = {
  local_results: [
    {
      title: "Lo Sole Mio",
      place_id: "ChIJ-lo-sole",
      gps_coordinates: { latitude: 41.2455, longitude: -96.0122 },
      rating: 4.6,
      reviews: 1873,
      price: "$20–30",
      type: "Italian restaurant",
      types: ["Italian restaurant", "Restaurant"],
      address: "3001 S 32nd Ave, Omaha, NE",
      operating_hours: { monday: "Closed", tuesday: "4–9 PM", friday: "4–10 PM", saturday: "11 AM–2 PM, 4–10 PM" },
      website: "https://losolemio.example",
    },
    { title: "Mystery Spot", price: "$$", type: "Restaurant" },
    { title: 42, place_id: "broken" },
  ],
};

describe("SerpAPI normalization (fixtures)", () => {
  it("normalizes local results with provenance, hours and honest prices", () => {
    const out = normalizeLocalResults(mapsFixture, AT);
    expect(out).toHaveLength(2); // malformed entry skipped
    const lo = out[0];
    expect(lo).toMatchObject({
      provider: "serpapi:google_maps",
      fetchedAt: AT,
      providerRef: "ChIJ-lo-sole",
      title: "Lo Sole Mio",
      lat: 41.2455,
      rating: 4.6,
      reviewCount: 1873,
      cost: { min: 20, max: 30, kind: "range", sourceKind: "live" },
    });
    expect(lo.sourceUrl).toContain("place_id:ChIJ-lo-sole");
    expect(lo.hours).toEqual({
      monday: "closed",
      tuesday: [{ open: "16:00", close: "21:00" }],
      friday: [{ open: "16:00", close: "22:00" }],
      saturday: [{ open: "11:00", close: "14:00" }, { open: "16:00", close: "22:00" }],
    });
    // Price level symbols become labeled estimates; missing hours stay unknown.
    expect(out[1].cost).toMatchObject({ kind: "price_level", sourceKind: "estimate" });
    expect(out[1].hours).toBeNull();
  });

  it("parses hours edge cases", () => {
    expect(parseDayHours("Open 24 hours")).toEqual([{ open: "00:00", close: "24:00" }]);
    expect(parseDayHours("5 PM–12 AM")).toEqual([{ open: "17:00", close: "24:00" }]);
    expect(parseDayHours("11:30 AM–2:30 PM")).toEqual([{ open: "11:30", close: "14:30" }]);
    expect(parseDayHours("whenever")).toBeNull();
    expect(parseOperatingHours({ funday: "9 AM–5 PM" })).toBeNull();
  });

  it("normalizes events and web results, dropping unsafe links", () => {
    const events = normalizeEvents(
      { events_results: [{ title: "Comedy night", date: { start_date: "Oct 3", when: "Sat, Oct 3, 7 – 9 PM" }, address: ["Funny Bone", "Omaha"], link: "https://tickets.example/x", venue: { name: "Funny Bone" } }, { title: "Bad", link: "javascript:alert(1)" }] },
      AT,
    );
    expect(events[0]).toMatchObject({ provider: "serpapi:google_events", title: "Comedy night", whenText: "Sat, Oct 3, 7 – 9 PM", sourceUrl: "https://tickets.example/x" });
    expect(events[1].sourceUrl).toBeNull();
    const web = normalizeWebResults({ organic_results: [{ title: "Official site", link: "https://a.example", snippet: "hi" }, { title: "no link" }] }, AT);
    expect(web).toHaveLength(1);
  });

  it("normalizes one-way flights using airport time zones", () => {
    const json = {
      best_flights: [
        {
          flights: [{ departure_airport: { id: "OMA", time: "2026-10-16 18:30" }, arrival_airport: { id: "LAS", time: "2026-10-16 19:40" }, duration: 190, airline: "Allegiant", flight_number: "G4 123" }],
          total_duration: 190,
          price: 164,
          booking_token: "tok1",
        },
      ],
      other_flights: [
        {
          flights: [
            { departure_airport: { id: "OMA", time: "2026-10-16 06:00" }, arrival_airport: { id: "DEN", time: "2026-10-16 07:05" }, duration: 125, airline: "United", flight_number: "UA 1" },
            { departure_airport: { id: "DEN", time: "2026-10-16 08:30" }, arrival_airport: { id: "LAS", time: "2026-10-16 09:40" }, duration: 130, airline: "United", flight_number: "UA 2" },
          ],
          total_duration: 280,
          price: null,
        },
        { flights: [], price: 1 },
      ],
    };
    const out = normalizeFlights(json, AT, "America/Chicago");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ from: "OMA", to: "LAS", stops: 0, price: 164, departTz: "America/Chicago", arriveTz: "America/Los_Angeles", tzAssumed: false });
    // 18:30 CDT → 23:30 UTC; 19:40 PDT → 02:40 UTC next day
    expect(new Date(out[0].departAt).toISOString()).toBe("2026-10-16T23:30:00.000Z");
    expect(new Date(out[0].arriveAt).toISOString()).toBe("2026-10-17T02:40:00.000Z");
    expect(localTime(out[0].arriveAt, "America/Chicago")).toBe("21:40");
    expect(out[1]).toMatchObject({ stops: 1, price: null }); // unknown price stays unknown
  });

  it("normalizes hotels and rejects malformed responses", () => {
    const out = normalizeHotels({ properties: [{ name: "The Linq", rate_per_night: { extracted_lowest: 109 }, total_rate: { extracted_lowest: 327 }, overall_rating: 4.1, reviews: 50000, link: "https://linq.example" }, { name: "No price" }] }, AT);
    expect(out[0]).toMatchObject({ provider: "serpapi:google_hotels", name: "The Linq", nightlyRate: 109, totalRate: 327, rating: 4.1, sourceUrl: "https://linq.example" });
    expect(out[1].nightlyRate).toBeNull();
    expect(() => normalizeHotels("not json", AT)).toThrow(/Malformed/);
  });

  it("maps airports and matches titles loosely", () => {
    expect(airportFor("OMA")).toBe("OMA");
    expect(airportFor("Omaha, NE")).toBe("OMA");
    expect(airportFor("Las Vegas")).toBe("LAS");
    expect(airportFor("Nowhere")).toBeNull();
    expect(titlesMatch("Charleston's Restaurant", "Charleston's")).toBe(true);
    expect(titlesMatch("Texas Roadhouse", "Firebirds")).toBe(false);
  });

  it("keeps a bounded, varied set of flight options", () => {
    const base = { provider: "p", fetchedAt: AT, sourceUrl: null, from: "A", to: "B", airline: null, flightNumbers: [], departTz: null, arriveTz: null, tzAssumed: false, departLocal: "", arriveLocal: "", durationMinutes: 60, currency: "USD" };
    const list = Array.from({ length: 12 }, (_, i) => ({ ...base, providerRef: `f${i}`, price: 100 + i * 10, departAt: i * 1000, arriveAt: 5000 - i * 100, stops: i % 3 }));
    const picked = pickFlightOptions(list);
    expect(picked.length).toBeLessThanOrEqual(7);
    expect(picked[0].price).toBe(100);
    expect(picked.some((f) => f.arriveAt === Math.min(...list.map((x) => x.arriveAt)))).toBe(true);
  });

  it("only keeps events on the plan's dates with a parseable time", () => {
    const r = parseEventStart({ startDate: "Oct 3", whenText: "Sat, Oct 3, 7 – 9:30 PM" }, "America/Chicago", ["2026-10-03"]);
    expect(localTime(r!.start, "America/Chicago")).toBe("19:00");
    expect(localTime(r!.end, "America/Chicago")).toBe("21:30");
    expect(parseEventStart({ startDate: "Oct 4", whenText: "Sun, Oct 4, 7 – 9 PM" }, "America/Chicago", ["2026-10-03"])).toBeNull();
  });
});

describe("search cache, budgets and deduplication", () => {
  const params = { engine: "google_maps", q: "Italian restaurants in West Omaha" };

  it("canonical keys ignore case/spacing/order but distinguish real differences", () => {
    expect(cacheKey("serpapi", "google_maps", { q: "Italian  Restaurants", ll: "@1,2" })).toBe(cacheKey("serpapi", "google_maps", { ll: "@1,2", q: "italian restaurants" }));
    expect(cacheKey("serpapi", "google_maps", { q: "italian" })).not.toBe(cacheKey("serpapi", "google_maps", { q: "mexican" }));
    expect(cacheKey("serpapi", "google_flights", { outbound_date: "2026-10-16" })).not.toBe(cacheKey("serpapi", "google_flights", { outbound_date: "2026-10-17" }));
  });

  it("reuses fresh results and refetches after TTL expiry", async () => {
    let now = 1_000_000;
    const store = new MemoryStore(() => now);
    let calls = 0;
    const run = () => cachedSearch({ store, planId: "p1", provider: "serpapi", engine: "google_maps", params, configured: true, now: () => now, fetcher: async () => ++calls });
    expect(await run()).toMatchObject({ status: "ok", data: 1, cached: false });
    expect(await run()).toMatchObject({ status: "ok", data: 1, cached: true });
    now += 8 * 24 * 3600 * 1000; // beyond the 7-day venue TTL
    expect(await run()).toMatchObject({ status: "ok", data: 2, cached: false });
    expect(calls).toBe(2);
  });

  it("concurrent identical requests launch exactly one search", async () => {
    const store = new MemoryStore();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return ["result"];
    };
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => cachedSearch({ store, planId: "p1", provider: "serpapi", engine: "google_maps", params, configured: true, fetcher, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))) })),
    );
    expect(calls).toBe(1);
    expect(runs.every((r) => r.status === "ok")).toBe(true);
    expect(store.budgets.get("p1")?.used).toBe(1);
    expect(store.events.filter((e) => e.outcome === "deduplicated")).toHaveLength(4);
  });

  it("stops at the plan budget and returns stale data when available", async () => {
    const store = new MemoryStore();
    store.budgets.set("p2", { used: 0, limit: 2 });
    let n = 0;
    const run = (q: string) => cachedSearch({ store, planId: "p2", provider: "serpapi", engine: "google_events", params: { q }, configured: true, fetcher: async () => ++n });
    expect((await run("a")).status).toBe("ok");
    expect((await run("b")).status).toBe("ok");
    const third = await run("c");
    expect(third.status).toBe("budget_exhausted");
    expect(n).toBe(2);
  });

  it("bounded retries only for retryable errors; not configured never calls out", async () => {
    const store = new MemoryStore();
    let attempts = 0;
    const out = await cachedSearch({
      store, planId: "p3", provider: "serpapi", engine: "google_hotels", params: { q: "x" }, configured: true, maxAttempts: 5, sleep: async () => {},
      fetcher: async () => {
        attempts++;
        throw new RetryableError("busy");
      },
    });
    expect(out).toMatchObject({ status: "error", message: "busy" });
    expect(attempts).toBe(3); // capped at 3
    let hard = 0;
    await cachedSearch({ store, planId: "p3", provider: "serpapi", engine: "google_hotels", params: { q: "y" }, configured: true, sleep: async () => {}, fetcher: async () => { hard++; throw new Error("400 bad request"); } });
    expect(hard).toBe(1);
    let never = 0;
    const nc = await cachedSearch({ store, planId: "p3", provider: "serpapi", engine: "google_hotels", params: { q: "z" }, configured: false, fetcher: async () => ++never });
    expect(nc.status).toBe("not_configured");
    expect(never).toBe(0);
  });
});
