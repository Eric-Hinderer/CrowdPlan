import { describe, expect, it } from "vitest";
import { parseClock, parseParticipantStatement, parsePlanStatement } from "@/domain/interpretation/parser";
import { constraintExtractionSchema, planExtractionSchema } from "@/domain/interpretation/schema";
import { NOW, TZ } from "./fixtures";

const ctx = { now: NOW, timezone: TZ };
const dimOf = (r: ReturnType<typeof parsePlanStatement>, key: string) => r.dimensions.find((d) => d.key === key);

describe("plan statement parsing (no LLM key)", () => {
  it("Vala's sometime next weekend → fixed place, constrained dates, undecided time", () => {
    const r = parsePlanStatement("Vala's sometime next weekend", ctx);
    expect(r.mode).toBe("fixed");
    expect(dimOf(r, "place")).toMatchObject({ state: "LOCKED", value: { type: "place", name: "Vala's" } });
    expect(dimOf(r, "date")).toMatchObject({ state: "CONSTRAINED", value: { type: "dateRange", start: "2026-10-03", end: "2026-10-04" }, needsConfirmation: true });
    expect(dimOf(r, "time")?.state).toBe("UNDECIDED");
  });

  it("Dinner at Firebirds Friday → locked place and date", () => {
    const r = parsePlanStatement("Dinner at Firebirds Friday", ctx);
    expect(r.kind).toBe("dinner");
    expect(r.mode).toBe("fixed");
    expect(dimOf(r, "place")).toMatchObject({ state: "LOCKED", value: { name: "Firebirds" } });
    expect(dimOf(r, "activity")).toMatchObject({ state: "LOCKED", display: "Dinner" });
    expect(dimOf(r, "date")).toMatchObject({ state: "LOCKED", value: { type: "dates", dates: ["2026-09-25"] } });
  });

  it("Dinner Friday, Italian, somewhere out west, under $40 → criteria mode", () => {
    const r = parsePlanStatement("Dinner Friday, Italian, somewhere out west, under $40", ctx);
    expect(r.mode).toBe("criteria");
    expect(dimOf(r, "cuisine")).toMatchObject({ state: "CONSTRAINED", value: { type: "list", items: ["Italian"] } });
    expect(dimOf(r, "area")).toMatchObject({ state: "CONSTRAINED", display: "West side", needsConfirmation: true });
    expect(dimOf(r, "budget")).toMatchObject({ state: "CONSTRAINED", value: { max: 40, basis: "per_person" } });
    expect(dimOf(r, "place")?.state).toBe("UNDECIDED");
    expect(dimOf(r, "time")?.state).toBe("UNDECIDED");
  });

  it("Dinner Friday, Italian, West Omaha, under $40 keeps the named area", () => {
    const r = parsePlanStatement("Dinner Friday, Italian, West Omaha, under $40", ctx);
    expect(dimOf(r, "area")).toMatchObject({ display: "West Omaha", needsConfirmation: false });
  });

  it("Find something fun Saturday night → discovery with evening window", () => {
    const r = parsePlanStatement("Find something fun Saturday night", ctx);
    expect(r.mode).toBe("discovery");
    expect(dimOf(r, "activity")?.state).toBe("UNDECIDED");
    expect(dimOf(r, "date")).toMatchObject({ value: { dates: ["2026-09-26"] } });
    expect(dimOf(r, "time")).toMatchObject({ state: "CONSTRAINED", value: { type: "timeWindow", start: "17:00", end: "24:00" } });
  });

  it("Vegas sometime in October, 3-4 nights, under $800 each → travel", () => {
    const r = parsePlanStatement("Vegas sometime in October, 3-4 nights, under $800 each", ctx);
    expect(r.kind).toBe("travel");
    expect(dimOf(r, "destination")).toMatchObject({ state: "LOCKED", value: { name: "Las Vegas" } });
    expect(dimOf(r, "dates")).toMatchObject({ state: "CONSTRAINED", value: { type: "dateRange", start: "2026-10-01", end: "2026-10-31" } });
    expect(dimOf(r, "nights")).toMatchObject({ value: { min: 3, max: 4 } });
    expect(dimOf(r, "budget")).toMatchObject({ value: { max: 800, basis: "per_person" } });
    expect(dimOf(r, "flights")?.state).toBe("UNDECIDED");
    expect(dimOf(r, "lodging")?.state).toBe("UNDECIDED");
  });

  it("shortlists never trigger discovery", () => {
    const r = parsePlanStatement("Dinner Friday options: Firebirds, Charleston's, Texas Roadhouse", ctx);
    expect(r.mode).toBe("shortlist");
    expect(r.shortlist).toEqual(["Firebirds", "Charleston's", "Texas Roadhouse"]);
    const r2 = parsePlanStatement("Which of these three places should we choose?", ctx);
    expect(r2.mode).toBe("shortlist");
  });

  it("asks when a weekday could mean today", () => {
    const friday = Date.parse("2026-09-25T15:00:00Z");
    const r = parsePlanStatement("Dinner Friday", { now: friday, timezone: TZ });
    expect(r.clarifications[0].question).toMatch(/today or next Friday/);
  });

  it("output always validates against the extraction schema", () => {
    for (const s of ["Vala's next weekend", "Something fun Saturday night", "Drinks tonight after 8", "Brunch tomorrow at 11am downtown"]) {
      expect(planExtractionSchema.safeParse(parsePlanStatement(s, ctx)).success).toBe(true);
    }
  });

  it("parses times with explicit and assumed meridiem", () => {
    expect(parseClock("5")).toEqual({ time: "17:00", assumed: true });
    expect(parseClock("9pm")).toEqual({ time: "21:00", assumed: false });
    expect(parseClock("11:30 a.m.")).toEqual({ time: "11:30", assumed: false });
    expect(parseClock("noon")).toEqual({ time: "12:00", assumed: false });
    expect(parseClock("25")).toBeNull();
  });
});

describe("participant statements", () => {
  it("master example: can't leave before 5 Friday; home Sunday before 9", () => {
    const r = parseParticipantStatement("I can't leave before 5 Friday because of work, and I need to be home Sunday before 9.", { ...ctx, kind: "travel" });
    expect(r.needsClarification).toBe(false);
    expect(r.constraints.map((c) => [c.kind, c.strength, c.params])).toEqual([
      ["earliest_departure", "hard", { time: "17:00", weekday: "friday" }],
      ["latest_arrival_home", "hard", { time: "21:00", weekday: "sunday" }],
    ]);
    expect(r.constraints[0].label).toBe("Cannot depart before 5 PM Friday");
    expect(r.constraints[1].label).toBe("Must arrive home by 9 PM Sunday");
  });

  it("\"I can't go Sunday\" asks for clarification and creates no hard rule", () => {
    const r = parseParticipantStatement("I can't go Sunday.", { ...ctx, kind: "travel" });
    expect(r.constraints).toEqual([]);
    expect(r.needsClarification).toBe(true);
    const q = r.clarifications[0];
    expect(q.question).toBe("When you say you can't go Sunday, what do you mean?");
    expect(q.options.map((o) => o.label)).toEqual([
      "I need to be home before Sunday",
      "I can't travel on Sunday",
      "I'm unavailable for the whole day Sunday",
      "Something else",
    ]);
    expect(q.options[2].constraint).toEqual({ kind: "unavailable_day", strength: "hard", params: { weekday: "sunday" } });
  });

  it("hard vs soft examples from the master spec", () => {
    const k = (s: string) => parseParticipantStatement(s, { ...ctx, kind: "dinner" }).constraints.map((c) => [c.kind, c.strength]);
    expect(k("I'm allergic to shellfish.")).toEqual([["dietary", "hard"]]);
    expect(k("I'd rather not drive downtown.")).toEqual([["avoid_area", "soft"]]);
    expect(k("I cannot spend more than $50.")).toEqual([["max_budget", "hard"]]);
    expect(k("I'd prefer to keep it under $35.")).toEqual([["preferred_budget", "soft"]]);
    expect(k("I'd rather do Sunday but Saturday works.")).toEqual([["day_preference", "soft"]]);
  });

  it("explicit whole-day unavailability is not ambiguous", () => {
    const r = parseParticipantStatement("I'm out of town Saturday", { ...ctx, kind: "activity" });
    expect(r.constraints[0]).toMatchObject({ kind: "unavailable_day", strength: "hard", params: { weekday: "saturday" } });
  });

  it("keeps unparseable text as unparsed instead of guessing", () => {
    const r = parseParticipantStatement("My cousin might visit", { ...ctx, kind: "activity" });
    expect(r.constraints).toEqual([]);
    expect(r.unparsed).toEqual(["My cousin might visit"]);
  });

  it("schema rejects invalid constraint parameters", () => {
    const bad = constraintExtractionSchema.safeParse({
      constraints: [{ kind: "max_budget", strength: "hard", params: { amount: -5 }, label: "x", sourceText: "x" }],
      needsClarification: false,
      clarifications: [],
      unparsed: [],
    });
    expect(bad.success).toBe(false);
  });
});
