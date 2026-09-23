// Pure normalization of SerpAPI responses into CrowdPlan's provider-neutral
// shapes. Responses are validated leniently (unknown fields ignored, missing
// fields become null) — never trusted, never passed to the UI raw.
import { z } from "zod";
import { parsePriceString } from "@/domain/money";
import { zonedInstant } from "@/domain/time";
import type { WeeklyHours, Weekday } from "@/domain/types";
import { AIRPORT_TZ } from "./airports";
import type { NormalizedEvent, NormalizedFlight, NormalizedHotel, NormalizedPlace, NormalizedWebResult } from "./types";

const num = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v), z.number().finite()).nullable().optional().catch(null);
const str = z.string().max(2000).nullable().optional().catch(null);
const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u))
  .nullable()
  .optional()
  .catch(null);

const rawPlace = z.object({
  title: z.string().min(1).max(300),
  place_id: str,
  data_id: str,
  gps_coordinates: z.object({ latitude: num, longitude: num }).nullable().optional().catch(null),
  rating: num,
  reviews: num,
  price: str,
  type: str,
  types: z.array(z.string()).nullable().optional().catch(null),
  address: str,
  operating_hours: z.record(z.string(), z.string()).nullable().optional().catch(null),
  hours: str,
  website: httpUrl,
  phone: str,
  thumbnail: httpUrl,
});

const DAYS: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function clock12(raw: string, fallbackMeridiem?: "AM" | "PM"): { value: string; meridiem: "AM" | "PM" | undefined } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|a\.m\.|p\.m\.)?$/i.exec(raw.trim().replace(/ | /g, " "));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = (m[3]?.toUpperCase().replace(/\./g, "") as "AM" | "PM" | undefined) ?? fallbackMeridiem;
  if (mer === "PM" && h < 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { value: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, meridiem: m[3] ? mer : undefined };
}

/** "11 AM–2 PM, 5–10 PM" → [{open:"11:00",close:"14:00"},{open:"17:00",close:"22:00"}] */
export function parseDayHours(text: string): Array<{ open: string; close: string }> | "closed" | null {
  const t = text.trim().replace(/ | /g, " ");
  if (/^closed$/i.test(t)) return "closed";
  if (/open 24 hours/i.test(t)) return [{ open: "00:00", close: "24:00" }];
  const out: Array<{ open: string; close: string }> = [];
  for (const part of t.split(/,\s*/)) {
    const [a, b] = part.split(/\s*[–—-]\s*/);
    if (!a || !b) return null;
    const close = clock12(b);
    if (!close) return null;
    // "5–10 PM": the opening time inherits the closing meridiem.
    const open = clock12(a, close.meridiem ?? undefined);
    if (!open) return null;
    out.push({ open: open.value, close: close.value === "00:00" ? "24:00" : close.value });
  }
  return out.length ? out : null;
}

export function parseOperatingHours(raw: Record<string, string> | null | undefined): WeeklyHours | null {
  if (!raw) return null;
  const hours: WeeklyHours = {};
  let any = false;
  for (const [k, v] of Object.entries(raw)) {
    const day = DAYS.find((d) => d === k.toLowerCase().trim());
    if (!day) continue;
    const parsed = parseDayHours(v);
    if (parsed) {
      hours[day] = parsed;
      any = true;
    }
  }
  return any ? hours : null;
}

function mapsUrl(p: { place_id?: string | null; title: string }): string {
  return p.place_id
    ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(p.place_id)}`
    : `https://www.google.com/maps/search/${encodeURIComponent(p.title)}`;
}

export function normalizeLocalResults(json: unknown, fetchedAt: string): NormalizedPlace[] {
  const root = z.object({ local_results: z.array(z.unknown()).optional(), place_results: z.unknown().optional() }).passthrough().safeParse(json);
  if (!root.success) throw new Error("Malformed maps response");
  const items = [...(root.data.place_results ? [root.data.place_results] : []), ...(root.data.local_results ?? [])];
  const out: NormalizedPlace[] = [];
  for (const item of items) {
    const p = rawPlace.safeParse(item);
    if (!p.success) continue; // skip malformed entries instead of failing the whole response
    const d = p.data;
    const lat = d.gps_coordinates?.latitude ?? null;
    const lng = d.gps_coordinates?.longitude ?? null;
    out.push({
      provider: "serpapi:google_maps",
      fetchedAt,
      providerRef: d.place_id ?? d.data_id ?? null,
      sourceUrl: mapsUrl({ place_id: d.place_id, title: d.title }),
      title: d.title,
      address: d.address ?? null,
      lat: lat != null && Math.abs(lat) <= 90 ? lat : null,
      lng: lng != null && Math.abs(lng) <= 180 ? lng : null,
      rating: d.rating != null && d.rating >= 0 && d.rating <= 5 ? d.rating : null,
      reviewCount: d.reviews != null && d.reviews >= 0 ? Math.round(d.reviews) : null,
      priceText: d.price ?? null,
      cost: parsePriceString(d.price ?? null, "live"),
      categories: [...new Set([d.type, ...(d.types ?? [])].filter((x): x is string => !!x))].slice(0, 8),
      hours: parseOperatingHours(d.operating_hours),
      website: d.website ?? null,
      phone: d.phone ?? null,
      thumbnail: d.thumbnail ?? null,
    });
  }
  return out;
}

const rawEvent = z.object({
  title: z.string().min(1).max(300),
  date: z.object({ start_date: str, when: str }).nullable().optional().catch(null),
  address: z.array(z.string()).nullable().optional().catch(null),
  link: httpUrl,
  venue: z.object({ name: str }).nullable().optional().catch(null),
  description: str,
  ticket_info: z.array(z.object({ link: httpUrl })).nullable().optional().catch(null),
  thumbnail: httpUrl,
});

export function normalizeEvents(json: unknown, fetchedAt: string): NormalizedEvent[] {
  const root = z.object({ events_results: z.array(z.unknown()).optional() }).passthrough().safeParse(json);
  if (!root.success) throw new Error("Malformed events response");
  const out: NormalizedEvent[] = [];
  for (const item of root.data.events_results ?? []) {
    const e = rawEvent.safeParse(item);
    if (!e.success) continue;
    const d = e.data;
    out.push({
      provider: "serpapi:google_events",
      fetchedAt,
      providerRef: d.link ?? d.title,
      sourceUrl: d.link ?? null,
      title: d.title,
      whenText: d.date?.when ?? null,
      startDate: d.date?.start_date ?? null,
      venueName: d.venue?.name ?? null,
      address: d.address?.join(", ") ?? null,
      description: d.description ? d.description.slice(0, 500) : null,
      ticketUrl: d.ticket_info?.find((t) => t.link)?.link ?? null,
      thumbnail: d.thumbnail ?? null,
    });
  }
  return out;
}

export function normalizeWebResults(json: unknown, fetchedAt: string): NormalizedWebResult[] {
  const root = z.object({ organic_results: z.array(z.unknown()).optional() }).passthrough().safeParse(json);
  if (!root.success) throw new Error("Malformed search response");
  const out: NormalizedWebResult[] = [];
  for (const item of root.data.organic_results ?? []) {
    const r = z.object({ title: z.string().min(1).max(300), link: httpUrl, snippet: str, displayed_link: str }).safeParse(item);
    if (!r.success || !r.data.link) continue;
    out.push({ provider: "serpapi:google", fetchedAt, providerRef: r.data.link, sourceUrl: r.data.link, title: r.data.title, snippet: r.data.snippet ?? null, displayedLink: r.data.displayed_link ?? null });
  }
  return out;
}

const rawLeg = z.object({
  departure_airport: z.object({ id: z.string().min(3).max(4), time: z.string() }),
  arrival_airport: z.object({ id: z.string().min(3).max(4), time: z.string() }),
  duration: num,
  airline: str,
  flight_number: str,
});

const rawFlight = z.object({
  flights: z.array(rawLeg).min(1).max(8),
  total_duration: num,
  price: num,
  booking_token: str,
});

/** Airport-local "2026-10-09 18:30" → instant. */
function airportInstant(local: string, airport: string, fallbackTz: string): { at: number; tz: string; assumed: boolean } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(local);
  if (!m) return null;
  const tz = AIRPORT_TZ[airport] ?? fallbackTz;
  return { at: zonedInstant(m[1], `${m[2].padStart(2, "0")}:${m[3]}`, tz), tz, assumed: !AIRPORT_TZ[airport] };
}

export function normalizeFlights(json: unknown, fetchedAt: string, fallbackTz: string, currency = "USD", sourceUrl: string | null = null): NormalizedFlight[] {
  const root = z.object({ best_flights: z.array(z.unknown()).optional(), other_flights: z.array(z.unknown()).optional() }).passthrough().safeParse(json);
  if (!root.success) throw new Error("Malformed flights response");
  const out: NormalizedFlight[] = [];
  for (const item of [...(root.data.best_flights ?? []), ...(root.data.other_flights ?? [])]) {
    const f = rawFlight.safeParse(item);
    if (!f.success) continue;
    const first = f.data.flights[0];
    const last = f.data.flights[f.data.flights.length - 1];
    const dep = airportInstant(first.departure_airport.time, first.departure_airport.id, fallbackTz);
    const arr = airportInstant(last.arrival_airport.time, last.arrival_airport.id, fallbackTz);
    if (!dep || !arr || arr.at <= dep.at - 12 * 3600_000) continue;
    const numbers = f.data.flights.map((l) => l.flight_number).filter((x): x is string => !!x);
    out.push({
      provider: "serpapi:google_flights",
      fetchedAt,
      providerRef: f.data.booking_token ?? `${first.departure_airport.id}-${first.departure_airport.time}-${numbers.join("+")}`,
      sourceUrl,
      from: first.departure_airport.id,
      to: last.arrival_airport.id,
      airline: first.airline ?? null,
      flightNumbers: numbers,
      departAt: dep.at,
      arriveAt: arr.at,
      departTz: dep.tz,
      arriveTz: arr.tz,
      tzAssumed: dep.assumed || arr.assumed,
      departLocal: first.departure_airport.time,
      arriveLocal: last.arrival_airport.time,
      stops: f.data.flights.length - 1,
      durationMinutes: f.data.total_duration ?? null,
      price: f.data.price != null && f.data.price > 0 ? f.data.price : null,
      currency,
    });
  }
  // Deduplicate identical itineraries that appear in both lists.
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.flightNumbers.join("+")}|${f.departAt}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const rawHotel = z.object({
  name: z.string().min(1).max(300),
  link: httpUrl,
  property_token: str,
  gps_coordinates: z.object({ latitude: num, longitude: num }).nullable().optional().catch(null),
  rate_per_night: z.object({ extracted_lowest: num }).nullable().optional().catch(null),
  total_rate: z.object({ extracted_lowest: num }).nullable().optional().catch(null),
  overall_rating: num,
  reviews: num,
  extracted_hotel_class: num,
  amenities: z.array(z.string()).nullable().optional().catch(null),
  images: z.array(z.object({ thumbnail: httpUrl })).nullable().optional().catch(null),
});

export function normalizeHotels(json: unknown, fetchedAt: string, fallbackUrl: string | null = null): NormalizedHotel[] {
  const root = z.object({ properties: z.array(z.unknown()).optional() }).passthrough().safeParse(json);
  if (!root.success) throw new Error("Malformed hotels response");
  const out: NormalizedHotel[] = [];
  for (const item of root.data.properties ?? []) {
    const h = rawHotel.safeParse(item);
    if (!h.success) continue;
    const d = h.data;
    out.push({
      provider: "serpapi:google_hotels",
      fetchedAt,
      providerRef: d.property_token ?? d.name,
      sourceUrl: d.link ?? fallbackUrl,
      name: d.name,
      lat: d.gps_coordinates?.latitude ?? null,
      lng: d.gps_coordinates?.longitude ?? null,
      nightlyRate: d.rate_per_night?.extracted_lowest ?? null,
      totalRate: d.total_rate?.extracted_lowest ?? null,
      rating: d.overall_rating != null && d.overall_rating <= 5 ? Math.round(d.overall_rating * 10) / 10 : null,
      reviewCount: d.reviews ?? null,
      hotelClass: d.extracted_hotel_class ?? null,
      amenities: (d.amenities ?? []).slice(0, 8),
      thumbnail: d.images?.find((i) => i.thumbnail)?.thumbnail ?? null,
    });
  }
  return out;
}

/** Loose title match used when enriching a user-named place. */
export function titlesMatch(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|restaurant|bar|grill|and|&)\b/g, " ").replace(/\s+/g, " ").trim();
  const x = n(a);
  const y = n(b);
  return !!x && !!y && (x.includes(y) || y.includes(x) || x.split(" ")[0] === y.split(" ")[0]);
}
