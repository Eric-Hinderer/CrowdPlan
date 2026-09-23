// Pure helpers for search orchestration (no I/O): event date parsing,
// bounded option selection and trip date narrowing.
import { allowedDates } from "@/domain/dimensions";
import { addDays, eachDate, zonedInstant } from "@/domain/time";
import type { PlanInput } from "@/domain/types";
import type { NormalizedEvent, NormalizedFlight, NormalizedHotel } from "@/providers/search/types";

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
export function bestDatePairs(input: PlanInput, nights: number, max: number): Array<{ start: string; end: string; nights: number }> {
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

