import { describe, expect, it } from "vitest";
import { candidateConsensus, diagnoseObjection, planConsensus } from "@/domain/consensus";
import { evaluatePlan } from "@/domain/evaluate";
import { makeThisWork } from "@/domain/repair";
import { localTime, zonedInstant } from "@/domain/time";
import { travelCostFor } from "@/domain/travel";
import type { Candidate, Component, Reaction } from "@/domain/types";
import { candidate, constraint, dim, flight, input, member, plan, TZ, win } from "./fixtures";

const friday = "2026-10-02";
const members = [member("eric", "Eric"), member("jake", "Jake"), member("sarah", "Sarah")];

describe("consensus", () => {
  const r = (memberId: string, reaction: Reaction["reaction"], reason?: Reaction["reason"]): Reaction => ({ candidateId: "a", memberId, reaction, reason });

  it("counts every reaction type and computes alignment", () => {
    const c = candidateConsensus("a", [r("eric", "love"), r("jake", "works"), r("sarah", "acceptable"), r("x", "rather_not"), r("y", "cant", "price")]);
    expect(c.counts).toEqual({ love: 1, works: 1, acceptable: 1, rather_not: 1, cant: 1 });
    expect(c.respondents).toBe(5);
    expect(c.alignment).toBeCloseTo((1 + 0.75 + 0.5 + 0.2 + 0) / 5, 2);
    expect(c.objections).toEqual([{ memberId: "y", reason: "price", note: null }]);
  });

  const baseInput = (reactions: Reaction[]) =>
    input({
      dimensions: [dim("date", "LOCKED", { type: "dates", dates: [friday] })],
      members,
      availability: members.map((m) => win(m.id, friday, "17:00", "23:00")),
      candidates: [candidate("a", { type: "venue" })],
      reactions,
    });

  it("incomplete responses are not unanimity", () => {
    const e = evaluatePlan(baseInput([r("eric", "love")]));
    expect(e.consensus.state).toBe("gathering");
    expect(e.consensus.waitingOn).toEqual(["jake", "sarah"]);
  });

  it("strong alignment needs everyone positive", () => {
    expect(evaluatePlan(baseInput([r("eric", "love"), r("jake", "works"), r("sarah", "love")])).consensus.state).toBe("strong");
    expect(evaluatePlan(baseInput([r("eric", "love"), r("jake", "works"), r("sarah", "acceptable")])).consensus.state).toBe("leaning");
    expect(evaluatePlan(baseInput([r("eric", "love"), r("jake", "cant", "schedule")])).consensus.state).toBe("objection");
    expect(evaluatePlan(baseInput([r("eric", "rather_not"), r("jake", "rather_not"), r("sarah", "acceptable")])).consensus.state).toBe("split");
  });

  it("no options yet", () => {
    expect(planConsensus([], members, []).state).toBe("no_options");
  });

  it("CAN'T DO THIS proposes a missing hard constraint for confirmation", () => {
    const inp = baseInput([]);
    inp.candidates[0].cost = { min: 55, max: 70, currency: "USD", basis: "per_person", kind: "range", sourceKind: "live" };
    const ev = evaluatePlan(inp).evaluations[0];
    const d = diagnoseObjection(r("sarah", "cant", "price"), ev, "Steakhouse", []);
    expect(d.alreadyExplained).toBe(false);
    expect(d.proposal).toMatchObject({ kind: "max_budget", strength: "hard", params: { amount: 49 } });
    const place = diagnoseObjection(r("sarah", "cant", "place"), ev, "Steakhouse", []);
    expect(place.proposal).toMatchObject({ kind: "exclude_candidate", params: { candidateId: "a" } });
  });

  it("objection already explained by an active hard constraint", () => {
    const inp = baseInput([]);
    inp.candidates[0].cost = { min: 55, max: 70, currency: "USD", basis: "per_person", kind: "range", sourceKind: "live" };
    inp.constraints = [constraint("sarah", "max_budget", "hard", { amount: 40 })];
    const ev = evaluatePlan(inp).evaluations[0];
    const d = diagnoseObjection(r("sarah", "cant", "price"), ev, "Steakhouse", inp.constraints);
    expect(d.alreadyExplained).toBe(true);
    expect(d.proposal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Travel: Austin repair (+$47 earlier return)
// ---------------------------------------------------------------------------

function austin(extraReturn: Component[] = []): Candidate {
  const comps: Component[] = [];
  for (const m of members) {
    comps.push(flight(`${m.id}-out`, m.id, "outbound", ["2026-10-09", "18:30"], ["2026-10-09", "20:30"], 150));
    comps.push(flight(`${m.id}-ret`, m.id, "return", ["2026-10-11", "20:10"], ["2026-10-11", "22:34"], 160));
  }
  comps.push(...extraReturn);
  comps.push({
    id: "hotel",
    kind: "hotel",
    memberId: null,
    title: "Hotel Van Zandt",
    data: { name: "Hotel Van Zandt", checkIn: "2026-10-09", checkOut: "2026-10-11", nights: 2, rooms: 2, guests: 3 },
    cost: { min: 240, max: 240, currency: "USD", basis: "per_night", kind: "quote", sourceKind: "live" },
    sourceKind: "live",
    isSelected: true,
  });
  comps.push({
    id: "local",
    kind: "local_estimate",
    memberId: null,
    title: "Food & local transport (estimate)",
    data: {},
    cost: { min: 150, max: 150, currency: "USD", basis: "per_person", kind: "estimate", sourceKind: "estimate" },
    sourceKind: "estimate",
    isSelected: true,
  });
  return candidate("austin", { type: "travel_package", title: "Austin", attributes: { destination: "Austin", startDate: "2026-10-09", endDate: "2026-10-11" }, components: comps });
}

const travelBase = (c: Candidate, extraConstraints = [] as ReturnType<typeof constraint>[]) =>
  input({
    plan: plan({ kind: "travel" }),
    dimensions: [dim("dates", "CONSTRAINED", { type: "dateRange", start: "2026-10-01", end: "2026-10-31" }, "October")],
    members,
    availability: members.map((m) => win(m.id, "2026-10-09", "00:00", "24:00")).concat(
      members.map((m) => win(m.id, "2026-10-10", "00:00", "24:00")),
      members.map((m) => win(m.id, "2026-10-11", "00:00", "24:00")),
      members.map((m) => win(m.id, "2026-10-12", "00:00", "02:00")),
    ),
    constraints: [constraint("sarah", "latest_arrival_home", "hard", { weekday: "sunday", time: "21:00" }), ...extraConstraints],
    candidates: [c],
  });

describe("travel totals", () => {
  it("per-traveler total = own flights + hotel share + local estimate, with provenance", () => {
    const c = austin();
    const cost = travelCostFor(c, "sarah", members);
    // flights 150 + 160, hotel 240*2 nights*2 rooms = 960 / 3 = 320, local 150
    expect(cost.high).toBe(780);
    expect(cost.estimated).toBe(true);
    expect(cost.parts.map((p) => p.sourceKind)).toEqual(["live", "live", "live", "estimate"]);
  });

  it("a plan-wide per-person budget applies to each traveler total", () => {
    const inp = travelBase(austin());
    inp.constraints = [];
    inp.dimensions.push(dim("budget", "CONSTRAINED", { type: "money", max: 700, currency: "USD", basis: "per_person" }, "≤ $700"));
    const e = evaluatePlan(inp).evaluations[0];
    expect(e.status).toBe("INFEASIBLE");
    expect(e.explanation.hardViolations).toContain("Sarah: Trip total is $80 over the $700/person budget");
  });

  it("an unknown flight price leaves the total unverified", () => {
    const c = austin();
    c.components = c.components.map((x) => (x.id === "sarah-ret" ? { ...x, cost: null } : x));
    const cost = travelCostFor(c, "sarah", members);
    expect(cost.high).toBeNull();
    expect(cost.unknownParts[0]).toMatch(/price not verified/);
  });
});

describe("Make This Work", () => {
  it("finds the earlier return (+$47) and checks arrival HOME, not the airport", () => {
    const early = flight("sarah-ret-early", "sarah", "return", ["2026-10-11", "17:20"], ["2026-10-11", "19:38"], 207, { isSelected: false });
    const tooLate = flight("sarah-ret-2045", "sarah", "return", ["2026-10-11", "18:30"], ["2026-10-11", "20:45"], 170, { isSelected: false });
    const inp = travelBase(austin([early, tooLate]));
    const before = evaluatePlan(inp).evaluations[0];
    expect(before.status).toBe("INFEASIBLE");
    expect(before.explanation.hardViolations[0]).toMatch(/^Sarah: Return lands 10:34 PM, home ~11:19 PM; must be home by 9 PM/);

    const r = makeThisWork("austin", inp);
    expect(r.proposals).toHaveLength(1);
    const p = r.proposals[0];
    // 20:45 lands before 21:00 but home ~21:30 — rejected; 19:38 → home 20:23 accepted.
    expect(p.changes[0]).toMatchObject({ type: "swap_flight", memberId: "sarah", toComponentId: "sarah-ret-early", costDelta: 47 });
    expect(p.headline).toBe("Austin can work.");
    expect(p.summary).toContain("+$47 for Sarah");
    expect(p.summary).toContain("All hard constraints now satisfied");
    expect(p.resultStatus).not.toBe("INFEASIBLE");
  });

  it("rejects a repair whose added cost breaks the maximum budget", () => {
    const early = flight("sarah-ret-early", "sarah", "return", ["2026-10-11", "17:20"], ["2026-10-11", "19:38"], 207, { isSelected: false });
    const inp = travelBase(austin([early]), [constraint("sarah", "max_budget", "hard", { amount: 800 })]);
    // Current total 780; +47 → 827 > 800.
    const r = makeThisWork("austin", inp);
    expect(r.proposals).toHaveLength(0);
    expect(r.noFixReason).toMatch(/None of the available alternatives satisfy every hard constraint/);
  });

  it("reports honestly when no alternatives are cached and names the bounded search", () => {
    const r = makeThisWork("austin", travelBase(austin()));
    expect(r.proposals).toHaveLength(0);
    expect(r.searchesNeeded).toEqual([{ memberId: "sarah", direction: "return", reason: "No cached return alternatives for Sarah" }]);
    expect(r.noFixReason).toMatch(/search budget/);
  });

  it("escape room: Jake arrives 8:15 → asks 'Would everyone be okay starting at 8:30?'", () => {
    const dims = [dim("date", "LOCKED", { type: "dates", dates: [friday] }), dim("time", "LOCKED", { type: "time", start: "20:00" }, "8 PM")];
    const room = candidate("escape", { type: "activity", title: "Escape room", hours: { friday: [{ open: "12:00", close: "24:00" }] } });
    const inp = input({
      plan: plan({ minDurationMinutes: 60 }),
      dimensions: dims,
      members,
      availability: members.map((m) => win(m.id, friday, "17:00", "23:30")),
      constraints: [constraint("jake", "earliest_start", "hard", { time: "20:15" })],
      candidates: [room],
    });
    const before = evaluatePlan(inp).evaluations[0];
    expect(before.status).toBe("INFEASIBLE");
    const r = makeThisWork("escape", inp);
    const p = r.proposals[0];
    expect(p.kind).toBe("question");
    expect(p.headline).toBe("Would everyone be okay starting at 8:30 PM?");
    expect(p.changes[0]).toMatchObject({ type: "shift_time", touchesLockedTime: true });
    expect(localTime((p.changes[0] as { to: { start: number } }).to.start, TZ)).toBe("20:30");
    expect(p.resultStatus).toBe("FEASIBLE");
  });

  it("does not change a locked place; reports no fix and a focused question", () => {
    const inp = input({
      dimensions: [dim("date", "LOCKED", { type: "dates", dates: [friday] })],
      members,
      availability: members.map((m) => win(m.id, friday, "17:00", "23:00")),
      constraints: [constraint("sarah", "max_budget", "hard", { amount: 40 })],
      candidates: [candidate("steak", { title: "Steakhouse", cost: { min: 45, max: 55, currency: "USD", basis: "per_person", kind: "range", sourceKind: "live" } })],
    });
    const r = makeThisWork("steak", inp);
    expect(r.proposals).toHaveLength(0);
    expect(r.noFixReason).toMatch(/Sarah — \$5 over maximum budget/);
    expect(r.focusedQuestion).toEqual({ text: "Sarah, could $45 work for Steakhouse? It's $5 over your max.", memberIds: ["sarah"] });
  });

  it("feasible candidates need no repair", () => {
    const inp = input({
      dimensions: [dim("date", "LOCKED", { type: "dates", dates: [friday] })],
      members,
      availability: members.map((m) => win(m.id, friday, "17:00", "23:00")),
      candidates: [candidate("ok", { type: "venue" })],
    });
    const r = makeThisWork("ok", inp);
    expect(r.blockers).toEqual([]);
    expect(r.proposals).toEqual([]);
    expect(zonedInstant(friday, "17:00", TZ)).toBeLessThan(zonedInstant(friday, "18:00", TZ));
  });
});
