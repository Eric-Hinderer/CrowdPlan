import { describe, expect, it } from "vitest";
import { slotRespectsDimensions, valueRespectsDimension, validateDimension } from "@/domain/dimensions";
import { evaluatePlan } from "@/domain/evaluate";
import { checkMaxBudget, parsePriceString, perPersonBounds, preferredBudgetScore } from "@/domain/money";
import { groupFit } from "@/domain/scoring";
import { localTime, zonedInstant } from "@/domain/time";
import { candidate, constraint, dim, input, member, plan, TZ, win } from "./fixtures";

const friday = "2026-10-02";
const members = [member("eric", "Eric"), member("jake", "Jake"), member("sarah", "Sarah")];
const allFriday = members.map((m) => win(m.id, friday, "17:00", "23:00"));
const fridayDims = [
  dim("date", "LOCKED", { type: "dates", dates: [friday] }, "Friday"),
  dim("time", "UNDECIDED", null),
  dim("place", "UNDECIDED", null),
];

describe("dimension states", () => {
  it("locked values cannot be changed by automatic resolution", () => {
    const locked = dim("date", "LOCKED", { type: "dates", dates: [friday] });
    expect(valueRespectsDimension(locked, { type: "dates", dates: [friday] })).toBe(true);
    expect(valueRespectsDimension(locked, { type: "dates", dates: ["2026-10-03"] })).toBe(false);
    const place = dim("place", "LOCKED", { type: "place", name: "Vala's" });
    expect(valueRespectsDimension(place, { type: "place", name: "vala's" })).toBe(true);
    expect(valueRespectsDimension(place, { type: "place", name: "Zoo" })).toBe(false);
  });

  it("constrained values bound the resolution", () => {
    const range = dim("date", "CONSTRAINED", { type: "dateRange", start: "2026-10-03", end: "2026-10-04" });
    expect(valueRespectsDimension(range, { type: "dates", dates: ["2026-10-04"] })).toBe(true);
    expect(valueRespectsDimension(range, { type: "dates", dates: ["2026-10-05"] })).toBe(false);
    const budget = dim("budget", "CONSTRAINED", { type: "money", max: 40, currency: "USD", basis: "per_person" });
    expect(valueRespectsDimension(budget, { type: "money", max: 35, currency: "USD", basis: "per_person" })).toBe(true);
    expect(valueRespectsDimension(budget, { type: "money", max: 45, currency: "USD", basis: "per_person" })).toBe(false);
    const evening = dim("time", "CONSTRAINED", { type: "timeWindow", start: "17:00", end: "24:00" });
    expect(valueRespectsDimension(evening, { type: "time", start: "19:30" })).toBe(true);
    expect(valueRespectsDimension(evening, { type: "time", start: "12:00" })).toBe(false);
  });

  it("undecided dimensions accept any resolution", () => {
    expect(valueRespectsDimension(dim("time", "UNDECIDED", null), { type: "time", start: "03:00" })).toBe(true);
  });

  it("validates dimension edits", () => {
    expect(validateDimension(dim("date", "LOCKED", null))).toMatch(/needs a value/);
    expect(validateDimension(dim("budget", "CONSTRAINED", { type: "money", min: 50, max: 40, currency: "USD", basis: "per_person" }))).toMatch(/above/);
    expect(validateDimension(dim("date", "LOCKED", { type: "dates", dates: ["2026-02-30"] }))).toBe("Invalid date");
  });

  it("engine-chosen slots always satisfy LOCKED/CONSTRAINED time and date", () => {
    const dims = [
      dim("date", "CONSTRAINED", { type: "dateRange", start: "2026-10-03", end: "2026-10-04" }, "Next weekend"),
      dim("time", "CONSTRAINED", { type: "timeWindow", start: "13:00", end: "19:00" }, "Afternoon"),
    ];
    const availability = members.flatMap((m) => [win(m.id, "2026-10-02", "10:00", "23:00"), win(m.id, "2026-10-04", "09:00", "22:00")]);
    const result = evaluatePlan(input({ dimensions: dims, members, availability, candidates: [candidate("valas", { type: "venue" })] }));
    const slot = result.evaluations[0].slot!;
    expect(localTime(slot.start, TZ) >= "13:00").toBe(true);
    expect(slotRespectsDimensions(slot, dims, plan())).toEqual([]);
    expect(result.invariantViolations).toEqual([]);
  });
});

describe("budget semantics", () => {
  it("parses provider price strings without inventing precision", () => {
    expect(parsePriceString("$20–30", "live")).toMatchObject({ min: 20, max: 30, kind: "range", sourceKind: "live" });
    expect(parsePriceString("$$", "live")).toMatchObject({ kind: "price_level", sourceKind: "estimate" });
    expect(parsePriceString("$50+", "live")).toMatchObject({ min: 50, max: null });
    expect(parsePriceString(null, "live")).toBeNull();
  });

  it("maximum budget: fail, pass, straddle and unknown", () => {
    expect(checkMaxBudget(52, 60, 40, false)).toMatchObject({ result: "FAIL", over: 12 });
    expect(checkMaxBudget(20, 30, 40, false).result).toBe("PASS");
    expect(checkMaxBudget(30, 45, 40, false).result).toBe("UNKNOWN");
    expect(checkMaxBudget(null, null, 40, false)).toMatchObject({ result: "UNKNOWN", message: "Price not verified" });
  });

  it("preferred vs maximum budget and per-group basis", () => {
    expect(preferredBudgetScore(20, 30, 35).score).toBe(100);
    expect(preferredBudgetScore(50, 64, 35)).toMatchObject({ over: 22 });
    expect(perPersonBounds({ min: 120, max: 120, currency: "USD", basis: "per_group", kind: "quote", sourceKind: "user" }, 4)).toEqual({ low: 30, high: 30 });
  });
});

describe("hard constraints and feasibility", () => {
  it("marks a candidate not feasible with a person-specific reason (scenario F)", () => {
    const c = [constraint("sarah", "max_budget", "hard", { amount: 40 })];
    const pricey = candidate("steakhouse", { title: "Steakhouse", cost: { min: 82, max: 90, currency: "USD", basis: "per_person", kind: "range", sourceKind: "user" } });
    const cheap = candidate("pizza", { title: "Pizza", cost: { min: 15, max: 25, currency: "USD", basis: "per_person", kind: "range", sourceKind: "user" } });
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, constraints: c, candidates: [pricey, cheap] }));
    const bad = r.evaluations.find((e) => e.candidateId === "steakhouse")!;
    expect(bad.status).toBe("INFEASIBLE");
    expect(bad.rank).toBeNull();
    expect(bad.explanation.hardViolations).toContain("Sarah: $42 over maximum budget");
    const good = r.evaluations.find((e) => e.candidateId === "pizza")!;
    expect(good.status).toBe("FEASIBLE");
    expect(good.rank).toBe(1);
    expect(r.evaluations[0].candidateId).toBe("pizza");
  });

  it("soft scores can never outrank a hard failure", () => {
    const c = [constraint("jake", "exclude_candidate", "hard", { candidateId: "loved" })];
    const loved = candidate("loved", { rating: 4.9, cost: { min: 10, max: 15, currency: "USD", basis: "per_person", kind: "range", sourceKind: "user" } });
    const meh = candidate("meh", { rating: 3.1, cost: { min: 30, max: 38, currency: "USD", basis: "per_person", kind: "range", sourceKind: "user" } });
    const reactions = members.map((m) => ({ candidateId: "loved", memberId: m.id, reaction: "love" as const }));
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, constraints: c, candidates: [loved, meh], reactions }));
    expect(r.evaluations[0].candidateId).toBe("meh");
    expect(r.evaluations.find((e) => e.candidateId === "loved")!.status).toBe("INFEASIBLE");
  });

  it("unknown facts are not treated as passing (unverified, unranked)", () => {
    const c = [constraint("eric", "max_budget", "hard", { amount: 50 })];
    const noPrice = candidate("mystery", { title: "Mystery Bistro" });
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, constraints: c, candidates: [noPrice] }));
    expect(r.evaluations[0].status).toBe("UNVERIFIED");
    expect(r.evaluations[0].rank).toBeNull();
    expect(r.evaluations[0].explanation.unknowns).toContain("Eric: Price not verified");
  });

  it("pending (unclarified) constraints are not enforced", () => {
    const c = [constraint("jake", "unavailable_day", "hard", { weekday: "friday" }, "pending")];
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, constraints: c, candidates: [candidate("a", { type: "venue" })] }));
    expect(r.evaluations[0].status).toBe("FEASIBLE");
  });

  it("availability is a hard requirement per participant with explicit reasons", () => {
    const availability = [win("eric", friday, "18:00", "22:00"), win("jake", friday, "18:00", "22:00"), win("sarah", "2026-10-03", "18:00", "22:00")];
    const event = candidate("show", { type: "event", title: "Comedy show", startsAt: zonedInstant(friday, "19:00", TZ), endsAt: zonedInstant(friday, "21:00", TZ) });
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability, candidates: [event] }));
    const e = r.evaluations[0];
    expect(e.status).toBe("INFEASIBLE");
    expect(e.explanation.hardViolations[0]).toMatch(/^Sarah: Hasn't marked Fri Oct 2, 7:00 PM–9:00 PM as available/);
  });

  it("plan-level constrained cuisine and budget filter candidates", () => {
    const dims = [...fridayDims, dim("cuisine", "CONSTRAINED", { type: "list", items: ["Italian"] }, "Italian"), dim("budget", "CONSTRAINED", { type: "money", max: 40, currency: "USD", basis: "per_person" }, "≤ $40")];
    const italian = candidate("it", { categories: ["Italian restaurant"], cost: { min: 20, max: 30, currency: "USD", basis: "per_person", kind: "range", sourceKind: "live" } });
    const mexican = candidate("mx", { categories: ["Mexican restaurant"], cost: { min: 10, max: 20, currency: "USD", basis: "per_person", kind: "range", sourceKind: "live" } });
    const pricey = candidate("it2", { categories: ["Italian restaurant"], cost: { min: 50, max: 70, currency: "USD", basis: "per_person", kind: "range", sourceKind: "live" } });
    const r = evaluatePlan(input({ plan: plan({ kind: "dinner" }), dimensions: dims, members, availability: allFriday, candidates: [italian, mexican, pricey] }));
    expect(r.evaluations.map((e) => [e.candidateId, e.status])).toEqual([["it", "FEASIBLE"], ["mx", "INFEASIBLE"], ["it2", "INFEASIBLE"]]);
  });

  it("hours: closed is a failure, unknown hours are advisory ('Hours unavailable')", () => {
    const closed = candidate("closed", { type: "venue", hours: { friday: "closed" } });
    const unknown = candidate("unknown", { type: "venue", hours: null });
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, candidates: [closed, unknown] }));
    expect(r.evaluations.find((e) => e.candidateId === "closed")!.status).toBe("INFEASIBLE");
    const u = r.evaluations.find((e) => e.candidateId === "unknown")!;
    expect(u.status).toBe("FEASIBLE");
    expect(u.explanation.unknowns).toContain("Hours unavailable");
  });

  it("dietary conflicts fail, unverified dietary needs stay unknown until checked", () => {
    const c = [constraint("sarah", "dietary", "hard", { restriction: "shellfish" })];
    const seafood = candidate("oyster", { categories: ["Seafood restaurant"] });
    const pasta = candidate("pasta", { categories: ["Italian restaurant"] });
    const checked = candidate("checked", { categories: ["Italian restaurant"], attributes: { dietaryVerified: ["shellfish"] } });
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, constraints: c, candidates: [seafood, pasta, checked] }));
    const s = Object.fromEntries(r.evaluations.map((e) => [e.candidateId, e.status]));
    expect(s).toEqual({ oyster: "INFEASIBLE", pasta: "UNVERIFIED", checked: "FEASIBLE" });
  });

  it("fixed place: other candidates violate the locked place", () => {
    const dims = [dim("place", "LOCKED", { type: "place", name: "Vala's" }, "Vala's"), ...fridayDims.slice(0, 2)];
    const r = evaluatePlan(input({ dimensions: dims, members, availability: allFriday, candidates: [candidate("v", { title: "Vala's Pumpkin Patch", type: "venue" }), candidate("z", { title: "Zoo", type: "venue" })] }));
    expect(r.evaluations.find((e) => e.candidateId === "v")!.status).toBe("FEASIBLE");
    expect(r.evaluations.find((e) => e.candidateId === "z")!.explanation.hardViolations).toContain("place is locked to Vala's");
  });
});

describe("scoring and fairness", () => {
  it("group fit blends average and minimum", () => {
    expect(groupFit(76, 20)).toBeLessThan(groupFit(74, 70));
  });

  it("a strong average cannot hide one person's poor outcome", () => {
    // Option A: great for Eric and Jake, terrible for Sarah (way over preferred budget, avoided cuisine).
    const c = [
      constraint("sarah", "preferred_budget", "soft", { amount: 20 }),
      constraint("sarah", "cuisine_preference", "soft", { cuisines: ["Sushi"], mode: "avoid" }),
      constraint("eric", "cuisine_preference", "soft", { cuisines: ["Sushi"], mode: "prefer" }),
      constraint("jake", "cuisine_preference", "soft", { cuisines: ["Sushi"], mode: "prefer" }),
    ];
    const sushi = candidate("sushi", { title: "Sushi Bar", categories: ["Sushi restaurant"], rating: 4.9, cost: { min: 45, max: 60, currency: "USD", basis: "per_person", kind: "range", sourceKind: "user" } });
    const diner = candidate("diner", { title: "Diner", categories: ["American restaurant"], rating: 4.2, cost: { min: 12, max: 18, currency: "USD", basis: "per_person", kind: "range", sourceKind: "user" } });
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, constraints: c, candidates: [sushi, diner] }));
    const s = r.evaluations.find((e) => e.candidateId === "sushi")!;
    const d = r.evaluations.find((e) => e.candidateId === "diner")!;
    expect(s.metrics.averageSatisfaction).toBeGreaterThanOrEqual(d.metrics.averageSatisfaction - 5);
    expect(s.metrics.minimumSatisfaction).toBeLessThanOrEqual(40);
    expect(d.rank).toBe(1);
    expect(s.explanation.compromises.some((x) => x.startsWith("Sarah:"))).toBe(true);
  });

  it("deterministic tie-breaking by title then id", () => {
    const a = candidate("b-id", { title: "Alpha" });
    const b = candidate("a-id", { title: "Bravo" });
    const r1 = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, candidates: [b, a] }));
    const r2 = evaluatePlan(input({ dimensions: fridayDims, members, availability: allFriday, candidates: [a, b] }));
    expect(r1.evaluations.map((e) => e.candidateId)).toEqual(["b-id", "a-id"]);
    expect(r2.evaluations.map((e) => e.candidateId)).toEqual(["b-id", "a-id"]);
  });

  it("reports compromise counts, ideal matches and budget fit", () => {
    const c = [constraint("sarah", "preferred_budget", "soft", { amount: 30 }), constraint("eric", "max_budget", "hard", { amount: 80 })];
    const availability = [win("eric", friday, "17:00", "23:00", "ideal"), win("jake", friday, "17:00", "23:00", "ideal"), win("sarah", friday, "17:00", "23:00")];
    const x = candidate("x", { cost: { min: 45, max: 55, currency: "USD", basis: "per_person", kind: "range", sourceKind: "user" } });
    const r = evaluatePlan(input({ dimensions: fridayDims, members, availability, constraints: c, candidates: [x] }));
    const e = r.evaluations[0];
    expect(e.metrics.softCompromises).toBe(1);
    expect(e.metrics.idealMatchCount).toBe(2);
    expect(e.metrics.budgetFit.overPreferred).toBe(1);
    expect(e.explanation.compromises).toContain("Sarah: $20 above preferred budget");
  });
});
