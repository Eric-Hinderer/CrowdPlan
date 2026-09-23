import { zonedInstant } from "@/domain/time";
import type {
  AvailabilityLevel,
  AvailabilityWindow,
  Candidate,
  Component,
  Constraint,
  Dimension,
  Member,
  PlanContext,
  PlanInput,
} from "@/domain/types";

export const TZ = "America/Chicago";
/** Tuesday 2026-09-22 10:00 CDT — fixed "now" for relative dates. */
export const NOW = Date.parse("2026-09-22T15:00:00Z");

export function member(id: string, name = id, extra: Partial<Member> = {}): Member {
  return { id, displayName: name, role: "guest", color: "#3d8bfd", respondedAt: null, homeBufferMinutes: 45, ...extra };
}

export function win(memberId: string, date: string, start: string, end: string, level: AvailabilityLevel = "works", tz = TZ): AvailabilityWindow {
  const s = zonedInstant(date, start, tz);
  let e = zonedInstant(date, end, tz);
  if (e <= s) e += 24 * 3600_000;
  return { memberId, start: s, end: e, level };
}

export function plan(extra: Partial<PlanContext> = {}): PlanContext {
  return {
    id: "plan-1",
    title: "Test plan",
    kind: "activity",
    mode: "fixed",
    timezone: TZ,
    minDurationMinutes: 60,
    status: "collecting",
    now: NOW,
    ...extra,
  };
}

export function dim(key: string, state: Dimension["state"], value: Dimension["value"], display = key): Dimension {
  return { key, label: key, state, value, display, source: "user", needsConfirmation: false };
}

export function candidate(id: string, extra: Partial<Candidate> = {}): Candidate {
  return {
    id,
    type: "restaurant",
    title: id,
    origin: "shortlist",
    status: "active",
    sourceKind: "user",
    cost: null,
    hours: null,
    categories: [],
    attributes: {},
    components: [],
    ...extra,
  };
}

let cid = 0;
export function constraint(memberId: string | null, kind: Constraint["kind"], strength: Constraint["strength"], params: Record<string, unknown>, status: Constraint["status"] = "active"): Constraint {
  return { id: `c${++cid}`, memberId, kind, strength, status, params };
}

export function flight(id: string, memberId: string, direction: "outbound" | "return", departLocal: [string, string], arriveLocal: [string, string], price: number | null, extra: Partial<Component> = {}): Component {
  return {
    id,
    kind: "flight",
    memberId,
    title: `${direction === "outbound" ? "OMA → AUS" : "AUS → OMA"} ${departLocal[1]}`,
    data: {
      direction,
      airline: "Test Air",
      from: direction === "outbound" ? "OMA" : "AUS",
      to: direction === "outbound" ? "AUS" : "OMA",
      departAt: zonedInstant(departLocal[0], departLocal[1], TZ),
      arriveAt: zonedInstant(arriveLocal[0], arriveLocal[1], TZ),
      stops: 0,
      durationMinutes: 150,
      flightNumbers: [id],
    },
    cost: price == null ? null : { min: price, max: price, currency: "USD", basis: "per_person", kind: "quote", sourceKind: "live" },
    sourceKind: "live",
    provider: "serpapi",
    fetchedAt: "2026-09-22T15:00:00Z",
    isSelected: true,
    ...extra,
  };
}

export function input(extra: Partial<PlanInput> = {}): PlanInput {
  return {
    plan: plan(),
    dimensions: [],
    members: [],
    availability: [],
    constraints: [],
    candidates: [],
    reactions: [],
    ...extra,
  };
}
