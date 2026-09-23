import { describe, expect, it } from "vitest";
import { computeOverlap, heatmap, normalizeWindows, slotStatuses } from "@/domain/availability";
import { searchWindows } from "@/domain/dimensions";
import { formatClockShort, localTime, zonedInstant } from "@/domain/time";
import { dim, member, plan, TZ, win } from "./fixtures";

const friday = "2026-10-02";
const eric = member("eric", "Eric");
const jake = member("jake", "Jake");
const sarah = member("sarah", "Sarah");
const fridayOnly = [dim("date", "LOCKED", { type: "dates", dates: [friday] }), dim("time", "CONSTRAINED", { type: "timeWindow", start: "16:00", end: "24:00" })];

describe("availability overlap", () => {
  it("master example: after 6 / after 7 / 5–9 overlap at 7:00–9:00 PM", () => {
    const windows = [
      win("eric", friday, "18:00", "24:00"),
      win("jake", friday, "19:00", "24:00"),
      win("sarah", friday, "17:00", "21:00"),
    ];
    const search = searchWindows(fridayOnly, plan());
    const result = computeOverlap([eric, jake, sarah], windows, search, 60);
    expect(result.best).not.toBeNull();
    expect(localTime(result.best!.start, TZ)).toBe("19:00");
    expect(localTime(result.best!.end, TZ)).toBe("21:00");
    expect(result.best!.available.sort()).toEqual(["eric", "jake", "sarah"]);
    expect(result.best!.everyone).toBe(true);
    expect(formatClockShort(result.best!.start, TZ)).toBe("7 PM");
  });

  it("reports no full overlap when schedules do not intersect", () => {
    const windows = [win("eric", friday, "17:00", "18:30"), win("jake", friday, "19:00", "21:00")];
    const result = computeOverlap([eric, jake], windows, searchWindows(fridayOnly, plan()), 60);
    expect(result.windows.every((w) => !w.everyone)).toBe(true);
    expect(result.best?.available.length).toBe(1);
  });

  it("explicit NOT AVAILABLE overrides works/ideal for that member", () => {
    const windows = [
      win("eric", friday, "17:00", "23:00", "works"),
      win("eric", friday, "19:00", "20:00", "unavailable"),
      win("jake", friday, "17:00", "23:00", "works"),
    ];
    const result = computeOverlap([eric, jake], windows, searchWindows(fridayOnly, plan()), 60);
    const both = result.windows.filter((w) => w.everyone).map((w) => [localTime(w.start, TZ), localTime(w.end, TZ)]);
    expect(both).toEqual([["20:00", "23:00"], ["17:00", "19:00"]]);
  });

  it("prefers windows with more ideal time when availability ties", () => {
    const windows = [
      win("eric", friday, "17:00", "19:00", "works"),
      win("eric", friday, "20:00", "22:00", "ideal"),
      win("jake", friday, "17:00", "19:00", "works"),
      win("jake", friday, "20:00", "22:00", "ideal"),
    ];
    const result = computeOverlap([eric, jake], windows, searchWindows(fridayOnly, plan()), 60);
    expect(localTime(result.best!.start, TZ)).toBe("20:00");
    expect(result.best!.ideal.sort()).toEqual(["eric", "jake"]);
  });

  it("never treats a missing response as availability", () => {
    const windows = [win("eric", friday, "18:00", "22:00"), win("jake", friday, "18:00", "22:00")];
    const result = computeOverlap([eric, jake, sarah], windows, searchWindows(fridayOnly, plan()), 60);
    expect(result.unknownIds).toEqual(["sarah"]);
    expect(result.best!.everyoneResponding).toBe(true);
    expect(result.best!.everyone).toBe(false);
    const statuses = slotStatuses([eric, jake, sarah], windows, { start: result.best!.start, end: result.best!.end });
    expect(statuses.sarah).toBe("unknown");
  });

  it("treats unmarked time of a responding member as not available", () => {
    const windows = [win("eric", friday, "18:00", "19:00"), win("jake", friday, "18:00", "22:00")];
    const statuses = slotStatuses([eric, jake], windows, { start: zonedInstant(friday, "20:00", TZ), end: zonedInstant(friday, "21:00", TZ) });
    expect(statuses.eric).toBe("unmarked");
    expect(statuses.jake).toBe("works");
  });

  it("enforces minimum duration", () => {
    const windows = [win("eric", friday, "18:00", "19:30"), win("jake", friday, "19:00", "22:00")];
    const result = computeOverlap([eric, jake], windows, searchWindows(fridayOnly, plan()), 60);
    expect(result.windows.some((w) => w.everyone)).toBe(false); // only 30 minutes together
  });

  it("supports date ranges across multiple days", () => {
    const weekend = [dim("date", "CONSTRAINED", { type: "dateRange", start: "2026-10-03", end: "2026-10-04" })];
    const windows = [
      win("eric", "2026-10-03", "10:00", "16:00"),
      win("jake", "2026-10-04", "12:00", "18:00"),
      win("eric", "2026-10-04", "13:00", "18:00", "ideal"),
    ];
    const result = computeOverlap([eric, jake], windows, searchWindows(weekend, plan()), 120);
    expect(result.best).not.toBeNull();
    expect(new Date(result.best!.start).toISOString()).toBe(new Date(zonedInstant("2026-10-04", "13:00", TZ)).toISOString());
  });

  it("handles overnight windows", () => {
    const late = [dim("date", "LOCKED", { type: "dates", dates: [friday] }), dim("time", "CONSTRAINED", { type: "timeWindow", start: "21:00", end: "02:00" })];
    const windows = [win("eric", friday, "22:00", "02:00"), win("jake", friday, "23:00", "03:00")];
    const result = computeOverlap([eric, jake], windows, searchWindows(late, plan()), 60);
    expect(localTime(result.best!.start, TZ)).toBe("23:00");
    expect(localTime(result.best!.end, TZ)).toBe("02:00");
  });

  it("is daylight-saving aware (Nov 1 2026 fall back)", () => {
    // 00:00–04:00 local on the DST day is 5 real hours.
    const s = zonedInstant("2026-11-01", "00:00", TZ);
    const e = zonedInstant("2026-11-01", "04:00", TZ);
    expect((e - s) / 3600_000).toBe(5);
    const windows = [
      { memberId: "eric", start: s, end: e, level: "works" as const },
      { memberId: "jake", start: s, end: e, level: "works" as const },
    ];
    const result = computeOverlap([eric, jake], windows, [{ start: s, end: e }], 60);
    expect((result.best!.end - result.best!.start) / 3600_000).toBe(5);
  });

  it("heatmap counts each bucket and normalizes windows", () => {
    const windows = normalizeWindows([
      win("eric", friday, "18:00", "19:00"),
      win("eric", friday, "19:00", "20:00"),
      win("jake", friday, "18:30", "20:00"),
    ]);
    expect(windows.filter((w) => w.memberId === "eric")).toHaveLength(1);
    const buckets = heatmap([eric, jake], windows, [{ start: zonedInstant(friday, "18:00", TZ), end: zonedInstant(friday, "20:00", TZ) }], 30);
    expect(buckets.map((b) => b.available.length)).toEqual([1, 2, 2, 2]);
  });
});
