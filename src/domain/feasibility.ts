// Deterministic hard-constraint engine. Hard constraints are predicates that
// return PASS, FAIL or UNKNOWN; UNKNOWN is never treated as PASS. No LLM is
// involved in deciding feasibility.
import { slotStatuses, type OverlapResult } from "./availability";
import { activeConstraints } from "./constraints";
import { dateDimension, getDimension, allowedDates, timeBounds } from "./dimensions";
import { estimateDriveMinutes, hasCoords, haversineKm } from "./geo";
import { checkMaxBudget, formatMoney, isEstimated, perPersonBounds } from "./money";
import {
  addDays,
  formatClockShort,
  formatDay,
  formatRange,
  localDate,
  localMinutes,
  localWeekday,
  minutesOfDay,
  formatTimeLabel,
  weekdayOfDate,
  zonedInstant,
} from "./time";
import { selectedFlights, travelCostFor } from "./travel";
import type {
  Candidate,
  CandidateStatus,
  CheckResult,
  Constraint,
  CostSummary,
  HardCheck,
  Member,
  PlanInput,
  Slot,
  Weekday,
  WeeklyHours,
} from "./types";

// ---------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------

export function openDuring(hours: WeeklyHours | null, slot: Slot, tz: string): CheckResult {
  if (!hours) return "UNKNOWN";
  const day = localWeekday(slot.start, tz);
  const entry = hours[day];
  if (entry === undefined) return "UNKNOWN";
  if (entry === "closed") return "FAIL";
  const start = localMinutes(slot.start, tz);
  const duration = Math.round((slot.end - slot.start) / 60000);
  for (const { open, close } of entry) {
    const o = minutesOfDay(open);
    let c = close === "24:00" ? 1440 : minutesOfDay(close);
    if (c <= o) c += 1440; // closes after midnight
    if (start >= o && start + duration <= c) return "PASS";
  }
  // Also consider yesterday's after-midnight hours.
  const prev = hours[localWeekday(slot.start - 24 * 3600_000, tz)];
  if (Array.isArray(prev)) {
    for (const { open, close } of prev) {
      const o = minutesOfDay(open);
      const c = minutesOfDay(close);
      if (c <= o && start + duration <= c) return "PASS";
    }
  }
  return "FAIL";
}

// ---------------------------------------------------------------------------
// Slot selection: each candidate is evaluated at its own best time
// ---------------------------------------------------------------------------

export function tripSlot(candidate: Candidate): Slot | null {
  const flights = candidate.components.filter((c) => c.kind === "flight" && c.isSelected);
  const departs = flights.map((f) => f.data.departAt).filter((x): x is number => typeof x === "number");
  const arrives = flights.map((f) => f.data.arriveAt).filter((x): x is number => typeof x === "number");
  if (departs.length && arrives.length) return { start: Math.min(...departs), end: Math.max(...arrives) };
  if (candidate.startsAt && candidate.endsAt) return { start: candidate.startsAt, end: candidate.endsAt };
  return null;
}

export function chooseSlot(candidate: Candidate, input: PlanInput, overlap: OverlapResult): Slot | null {
  const { plan } = input;
  const duration = plan.minDurationMinutes * 60000;
  if (candidate.type === "travel_package") return tripSlot(candidate);
  if (candidate.startsAt) {
    return { start: candidate.startsAt, end: candidate.endsAt ?? candidate.startsAt + duration };
  }
  const bounds = timeBounds(input.dimensions, plan.kind);
  if (bounds.fixedStart) {
    // Specific start time: choose the allowed date with the strongest availability.
    let best: { slot: Slot; score: number } | null = null;
    let fallback: Slot | null = null;
    for (const date of allowedDates(input.dimensions, plan)) {
      const start = zonedInstant(date, bounds.fixedStart, plan.timezone);
      const slot = { start, end: start + duration };
      fallback ??= slot;
      if (openDuring(candidate.hours, slot, plan.timezone) === "FAIL") continue;
      const statuses = slotStatuses(input.members, input.availability, slot);
      const score = Object.values(statuses).reduce((s, v) => s + (v === "ideal" ? 3 : v === "works" ? 2 : v === "unknown" ? 1 : 0), 0);
      if (!best || score > best.score) best = { slot, score };
    }
    // If closed on every allowed date, evaluate the first one so the closure is reported.
    return best?.slot ?? fallback;
  }
  for (const w of overlap.windows) {
    // Slide within the window in 15-minute steps to find an open period.
    for (let start = w.start; start + duration <= w.end; start += 15 * 60000) {
      const slot = { start, end: start + duration };
      if (openDuring(candidate.hours, slot, plan.timezone) !== "FAIL") return slot;
    }
  }
  // Closed during every shared window: evaluate the best window so "Closed" is explained.
  const best = overlap.windows[0];
  return best ? { start: best.start, end: Math.min(best.end, best.start + duration) } : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesDay(p: { weekday?: string; date?: string }, instant: number, tz: string): boolean {
  if (p.date) return localDate(instant, tz) === p.date;
  if (p.weekday) return localWeekday(instant, tz) === p.weekday;
  return true;
}

function slotTouchesDay(p: { weekday?: string; date?: string }, slot: Slot, tz: string): boolean {
  for (let t = slot.start; t < slot.end; t += 3600_000) {
    if (matchesDay(p, t, tz)) return true;
  }
  return matchesDay(p, slot.end - 1, tz);
}

/** First local date >= start (yyyy-MM-dd) that matches the day selector. */
function dateForSelector(p: { weekday?: string; date?: string }, fromDate: string, span = 14): string | null {
  if (p.date) return p.date;
  if (!p.weekday) return null;
  for (let i = 0; i < span; i++) {
    const d = addDays(fromDate, i);
    if (weekdayOfDate(d) === (p.weekday as Weekday)) return d;
  }
  return null;
}

const DIETARY_CONFLICTS: Record<string, string[]> = {
  shellfish: ["seafood", "sushi", "oyster", "crab", "lobster", "crawfish", "shrimp", "poke"],
  fish: ["seafood", "sushi", "fish", "poke"],
  vegan: ["steakhouse", "barbecue", "bbq"],
  vegetarian: ["barbecue", "bbq"],
};

function norm(s: string) {
  return s.toLowerCase().trim();
}

export function candidateCuisines(candidate: Candidate): string[] {
  const fromAttr = Array.isArray(candidate.attributes.cuisines) ? (candidate.attributes.cuisines as string[]) : [];
  return [...candidate.categories, ...fromAttr].map(norm);
}

export function memberCost(candidate: Candidate, member: Member, input: PlanInput): CostSummary | null {
  if (candidate.type === "travel_package") return travelCostFor(candidate, member.id, input.members);
  if (!candidate.cost) {
    return { low: null, high: null, currency: "USD", estimated: false, unknownParts: ["Price not verified"], parts: [] };
  }
  const { low, high } = perPersonBounds(candidate.cost, input.members.length);
  return {
    low,
    high,
    currency: candidate.cost.currency,
    estimated: isEstimated(candidate.cost),
    unknownParts: low == null && high == null ? ["Price not verified"] : [],
    parts: [{ label: candidate.title, amount: high ?? low, sourceKind: candidate.cost.sourceKind, estimated: isEstimated(candidate.cost) }],
  };
}

export function memberTravelMinutes(candidate: Candidate, member: Member): number | null {
  if (!hasCoords(member.origin) || !hasCoords(candidate)) return null;
  return estimateDriveMinutes(haversineKm(member.origin, candidate));
}

// ---------------------------------------------------------------------------
// Plan-level checks derived from LOCKED/CONSTRAINED dimensions
// ---------------------------------------------------------------------------

export function planLevelChecks(candidate: Candidate, slot: Slot | null, input: PlanInput): HardCheck[] {
  const checks: HardCheck[] = [];
  const { plan, dimensions } = input;
  const tz = plan.timezone;

  const place = getDimension(dimensions, "place") ?? getDimension(dimensions, "destination");
  if (place?.state === "LOCKED" && place.value && (place.value.type === "place" || place.value.type === "text")) {
    const name = place.value.type === "place" ? place.value.name : place.value.text;
    const lockedId = place.value.type === "place" ? place.value.candidateId : undefined;
    const matches =
      (lockedId && lockedId === candidate.id) ||
      norm(candidate.title).includes(norm(name)) ||
      norm(name).includes(norm(candidate.title)) ||
      norm(String(candidate.attributes.destination ?? "")).includes(norm(name));
    checks.push({
      kind: "locked_place",
      memberId: null,
      result: matches ? "PASS" : "FAIL",
      message: matches ? `${place.label} locked: ${name}` : `${place.label} is locked to ${name}`,
    });
  }

  const cuisine = getDimension(dimensions, "cuisine");
  if (cuisine && cuisine.state !== "UNDECIDED" && cuisine.value && candidate.type === "restaurant") {
    const wanted = cuisine.value.type === "list" ? cuisine.value.items : cuisine.value.type === "text" ? [cuisine.value.text] : [];
    const have = candidateCuisines(candidate);
    const hit = wanted.find((w) => have.some((h) => h.includes(norm(w))));
    checks.push(
      hit
        ? { kind: "cuisine", memberId: null, result: "PASS", message: `${hit[0].toUpperCase()}${hit.slice(1)}` }
        : have.length > 0
          ? { kind: "cuisine", memberId: null, result: "FAIL", message: `Not ${wanted.join(" or ")}` }
          : { kind: "cuisine", memberId: null, result: "UNKNOWN", message: "Cuisine not verified" },
    );
  }

  const budget = getDimension(dimensions, "budget");
  if (budget && budget.state !== "UNDECIDED" && budget.value?.type === "money" && budget.value.max != null && candidate.type !== "travel_package") {
    const { low, high } = perPersonBounds(candidate.cost, input.members.length);
    const r = checkMaxBudget(low, high, budget.value.max, isEstimated(candidate.cost));
    checks.push({ kind: "plan_budget", memberId: null, result: r.result, estimated: r.estimated, message: r.result === "PASS" ? `Within the ${formatMoney(budget.value.max)}/person budget` : r.message, delta: r.over ? { amount: r.over } : undefined });
  }

  const area = getDimension(dimensions, "area");
  if (area && area.state !== "UNDECIDED" && area.value?.type === "area" && hasCoords(area.value) && area.value.radiusKm) {
    if (hasCoords(candidate)) {
      const km = haversineKm(area.value, candidate);
      checks.push({
        kind: "area",
        memberId: null,
        result: km <= area.value.radiusKm ? "PASS" : "FAIL",
        estimated: true,
        message: km <= area.value.radiusKm ? `In ${area.value.label}` : `${Math.round(km)} km outside ${area.value.label}`,
      });
    } else {
      checks.push({ kind: "area", memberId: null, result: "UNKNOWN", message: "Location not verified" });
    }
  }

  const dateDim = dateDimension(dimensions);
  if (dateDim && dateDim.state !== "UNDECIDED" && candidate.startsAt && plan.kind !== "travel") {
    const ok = allowedDates(dimensions, plan).includes(localDate(candidate.startsAt, tz));
    checks.push({ kind: "date", memberId: null, result: ok ? "PASS" : "FAIL", message: ok ? `On ${formatDay(candidate.startsAt, tz)}` : `${formatDay(candidate.startsAt, tz)} is outside ${dateDim.display}` });
  }

  if (candidate.type === "travel_package") {
    const nights = getDimension(dimensions, "nights");
    const start = typeof candidate.attributes.startDate === "string" ? candidate.attributes.startDate : null;
    const end = typeof candidate.attributes.endDate === "string" ? candidate.attributes.endDate : null;
    if (nights && nights.state !== "UNDECIDED" && nights.value?.type === "nights" && start && end) {
      const n = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
      const ok = n >= nights.value.min && n <= nights.value.max;
      checks.push({ kind: "nights", memberId: null, result: ok ? "PASS" : "FAIL", message: ok ? `${n} nights` : `${n} nights is outside ${nights.display}` });
    }
    if (dateDim && dateDim.state !== "UNDECIDED" && start && end) {
      const allowed = allowedDates(dimensions, plan);
      const ok = allowed.includes(start) && allowed.includes(end);
      checks.push({ kind: "dates", memberId: null, result: ok ? "PASS" : "FAIL", message: ok ? `Within ${dateDim.display}` : `Dates fall outside ${dateDim.display}` });
    }
  }

  if (slot && ["restaurant", "venue", "activity"].includes(candidate.type)) {
    const open = openDuring(candidate.hours, slot, tz);
    checks.push({
      kind: "hours",
      memberId: null,
      result: open,
      advisory: open === "UNKNOWN",
      message: open === "PASS" ? `Open ${formatRange(slot.start, slot.end, tz)}` : open === "FAIL" ? `Closed ${formatRange(slot.start, slot.end, tz)}` : "Hours unavailable",
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Per-member hard checks
// ---------------------------------------------------------------------------

export function memberHardChecks(
  candidate: Candidate,
  slot: Slot | null,
  member: Member,
  input: PlanInput,
  constraints: Constraint[],
): { checks: HardCheck[]; scheduleLevel: "ideal" | "works" | null; cost: CostSummary | null; travelMinutes: number | null } {
  const tz = input.plan.timezone;
  const checks: HardCheck[] = [];
  let scheduleLevel: "ideal" | "works" | null = null;

  // Availability (implicit hard requirement for every required participant).
  if (slot) {
    const status = slotStatuses([member], input.availability, slot)[member.id];
    const when = formatRange(slot.start, slot.end, tz);
    if (status === "ideal" || status === "works") {
      scheduleLevel = status;
      checks.push({ kind: "availability", memberId: member.id, result: "PASS", message: `Available ${when}` });
    } else if (status === "unknown") {
      checks.push({ kind: "availability", memberId: member.id, result: "UNKNOWN", message: "Hasn't shared availability yet" });
    } else {
      checks.push({
        kind: "availability",
        memberId: member.id,
        result: "FAIL",
        message: status === "unavailable" ? `Not available ${when}` : `Hasn't marked ${when} as available`,
      });
    }
  } else {
    checks.push({ kind: "availability", memberId: member.id, result: "UNKNOWN", message: "No time slot works yet" });
  }

  const cost = memberCost(candidate, member, input);
  const travelMinutes = memberTravelMinutes(candidate, member);
  const flights = selectedFlights(candidate, member.id);
  const outbound = flights.find((f) => f.data.direction === "outbound");
  const ret = flights.find((f) => f.data.direction === "return");
  const tripStartDate = slot ? localDate(slot.start, tz) : null;

  const mine = constraints.filter((c) => c.strength === "hard" && (c.memberId === member.id || c.memberId === null));
  for (const c of mine) {
    const p = c.params as Record<string, never>;
    const base = { kind: c.kind, memberId: member.id, constraintId: c.id };
    switch (c.kind) {
      case "max_budget": {
        const r = checkMaxBudget(cost?.low ?? null, cost?.high ?? null, p.amount, cost?.estimated ?? false);
        checks.push({ ...base, result: r.result, estimated: r.estimated, message: r.result === "PASS" ? `Within ${formatMoney(p.amount)} max` : r.message, delta: r.over ? { amount: r.over } : undefined });
        break;
      }
      case "dietary": {
        if (candidate.type !== "restaurant") break;
        const restriction = norm(String(p.restriction));
        const verified = Array.isArray(candidate.attributes.dietaryVerified) && (candidate.attributes.dietaryVerified as string[]).map(norm).includes(restriction);
        const conflicts = DIETARY_CONFLICTS[restriction] ?? [];
        const cats = candidateCuisines(candidate);
        const conflict = conflicts.find((x) => cats.some((cat) => cat.includes(x)));
        if (conflict) checks.push({ ...base, result: "FAIL", message: `${candidate.title} is a ${conflict} place (${restriction} restriction)` });
        else if (verified) checks.push({ ...base, result: "PASS", message: `${restriction}-friendly (checked by the group)` });
        else checks.push({ ...base, result: "UNKNOWN", message: `Can't verify ${restriction}-friendly options` });
        break;
      }
      case "max_travel_minutes": {
        if (candidate.type === "travel_package") break;
        if (travelMinutes == null) checks.push({ ...base, result: "UNKNOWN", message: "Travel time unknown" });
        else if (travelMinutes <= p.minutes) checks.push({ ...base, result: "PASS", estimated: true, message: `~${travelMinutes} min away (est.)` });
        else checks.push({ ...base, result: "FAIL", estimated: true, message: `~${travelMinutes} min away; max ${p.minutes} min`, delta: { minutes: travelMinutes - p.minutes } });
        break;
      }
      case "earliest_start": {
        if (!slot || candidate.type === "travel_package") break;
        if (!matchesDay(p, slot.start, tz)) break;
        const start = localMinutes(slot.start, tz);
        const limit = minutesOfDay(p.time);
        checks.push(start >= limit
          ? { ...base, result: "PASS", message: `Starts after ${formatTimeLabel(p.time)}` }
          : { ...base, result: "FAIL", message: `Can't start before ${formatTimeLabel(p.time)}; starts ${formatClockShort(slot.start, tz)}`, delta: { minutes: limit - start } });
        break;
      }
      case "latest_end": {
        if (!slot || candidate.type === "travel_package") break;
        if (!matchesDay(p, slot.start, tz)) break;
        const endMin = localMinutes(slot.start, tz) + Math.round((slot.end - slot.start) / 60000);
        const limit = minutesOfDay(p.time);
        checks.push(endMin <= limit
          ? { ...base, result: "PASS", message: `Done by ${formatTimeLabel(p.time)}` }
          : { ...base, result: "FAIL", message: `Must leave by ${formatTimeLabel(p.time)}; ends ${formatClockShort(slot.end, tz)}`, delta: { minutes: endMin - limit } });
        break;
      }
      case "unavailable_day": {
        if (!slot) break;
        const hit = slotTouchesDay(p, slot, tz);
        checks.push(hit
          ? { ...base, result: "FAIL", message: `Unavailable ${p.date ? formatDay(slot.start, tz) : String(p.weekday)}` }
          : { ...base, result: "PASS", message: "Avoids unavailable day" });
        break;
      }
      case "no_travel_day": {
        if (candidate.type !== "travel_package") break;
        if (flights.length === 0) {
          checks.push({ ...base, result: "UNKNOWN", message: "Flights not selected" });
          break;
        }
        const bad = flights.find((f) => (f.data.departAt && matchesDay(p, f.data.departAt, tz)) || (f.data.arriveAt && matchesDay(p, f.data.arriveAt, tz)));
        checks.push(bad
          ? { ...base, result: "FAIL", message: `Travels on ${p.date ?? p.weekday}` }
          : { ...base, result: "PASS", message: `No travel on ${p.date ?? p.weekday}` });
        break;
      }
      case "earliest_departure": {
        if (candidate.type !== "travel_package") break;
        if (!outbound?.data.departAt || !tripStartDate) {
          checks.push({ ...base, result: "UNKNOWN", message: "Outbound flight not selected" });
          break;
        }
        const date = dateForSelector(p, addDays(tripStartDate, -1)) ?? localDate(outbound.data.departAt, tz);
        const limit = zonedInstant(date, p.time, tz);
        const ok = outbound.data.departAt >= limit;
        checks.push(ok
          ? { ...base, result: "PASS", message: `Departs ${formatDay(outbound.data.departAt, tz)} ${formatClockShort(outbound.data.departAt, tz)}` }
          : { ...base, result: "FAIL", message: `Outbound departs ${formatDay(outbound.data.departAt, tz)} ${formatClockShort(outbound.data.departAt, tz)}; can't leave before ${formatTimeLabel(p.time)} ${p.weekday ?? ""}`.trim(), delta: { minutes: Math.round((limit - outbound.data.departAt) / 60000) } });
        break;
      }
      case "latest_arrival_home": {
        if (candidate.type !== "travel_package") break;
        if (!ret?.data.arriveAt || !tripStartDate) {
          checks.push({ ...base, result: "UNKNOWN", message: "Return flight not selected" });
          break;
        }
        const date = dateForSelector(p, tripStartDate) ?? localDate(ret.data.arriveAt, tz);
        const deadline = zonedInstant(date, p.time, tz);
        const home = ret.data.arriveAt + member.homeBufferMinutes * 60000;
        const ok = home <= deadline;
        const msg = `Return lands ${formatClockShort(ret.data.arriveAt, tz)}, home ~${formatClockShort(home, tz)}`;
        checks.push(ok
          ? { ...base, result: "PASS", message: `${msg}; needs home by ${formatTimeLabel(p.time)}` }
          : { ...base, result: "FAIL", message: `${msg}; must be home by ${formatTimeLabel(p.time)}`, delta: { minutes: Math.round((home - deadline) / 60000) } });
        break;
      }
      case "exclude_candidate": {
        if (p.candidateId === candidate.id) checks.push({ ...base, result: "FAIL", message: `Can't do ${candidate.title}` });
        break;
      }
      case "accessibility": {
        const a = candidate.attributes.accessibility;
        checks.push(a === true
          ? { ...base, result: "PASS", message: `${String(p.need)} confirmed` }
          : a === false
            ? { ...base, result: "FAIL", message: `Not ${String(p.need)}` }
            : { ...base, result: "UNKNOWN", message: `${String(p.need)} not verified` });
        break;
      }
      case "nonstop_only": {
        if (candidate.type !== "travel_package") break;
        if (flights.length === 0) checks.push({ ...base, result: "UNKNOWN", message: "Flights not selected" });
        else {
          const stops = flights.reduce((s, f) => s + Number(f.data.stops ?? 0), 0);
          checks.push(stops === 0 ? { ...base, result: "PASS", message: "Nonstop both ways" } : { ...base, result: "FAIL", message: `${stops} stop${stops > 1 ? "s" : ""}; needs nonstop` });
        }
        break;
      }
      default:
        break;
    }
  }
  return { checks, scheduleLevel, cost, travelMinutes };
}

export function worst(results: CheckResult[]): CheckResult {
  if (results.includes("FAIL")) return "FAIL";
  if (results.includes("UNKNOWN")) return "UNKNOWN";
  return "PASS";
}

export function candidateStatus(planChecks: HardCheck[], memberChecks: HardCheck[][]): CandidateStatus {
  const all = [...planChecks, ...memberChecks.flat()];
  if (all.some((c) => c.result === "FAIL")) return "INFEASIBLE";
  if (all.some((c) => c.result === "UNKNOWN" && !c.advisory)) return "UNVERIFIED";
  return "FEASIBLE";
}

export function hardConstraintsFor(input: PlanInput): Constraint[] {
  return activeConstraints(input.constraints).filter((c) => c.strength === "hard");
}

export function isDateWithin(date: string, input: PlanInput): boolean {
  return allowedDates(input.dimensions, input.plan).includes(date);
}
