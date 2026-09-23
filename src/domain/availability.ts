// Availability overlap. Windows are half-open [start, end). Precedence inside
// one member: explicit NOT AVAILABLE > IDEAL > WORKS. A member who has shared
// availability but left a period unmarked is "unmarked" (not available); a
// member who has shared nothing is "unknown" — never shown as available.
import type { AvailabilityWindow, Member, Slot } from "./types";

export type MemberSlotStatus = "ideal" | "works" | "unavailable" | "unmarked" | "unknown";

export interface OverlapSegment {
  start: number;
  end: number;
  status: Record<string, MemberSlotStatus>;
  available: string[];
  ideal: string[];
}

export interface OverlapWindow {
  start: number;
  end: number;
  /** members available for the entire window */
  available: string[];
  /** members for whom the entire window is ideal */
  ideal: string[];
  /** members available for part of the window */
  partial: string[];
  unavailable: string[];
  unknown: string[];
  /** every responding member is available (and at least one responded) */
  everyoneResponding: boolean;
  /** every member (including non-responders) is available */
  everyone: boolean;
  idealMinutes: number;
}

export interface OverlapResult {
  segments: OverlapSegment[];
  /** ranked, each at least minDuration long */
  windows: OverlapWindow[];
  best: OverlapWindow | null;
  respondedIds: string[];
  unknownIds: string[];
}

export function respondedMemberIds(members: Member[], windows: AvailabilityWindow[]): string[] {
  const withWindows = new Set(windows.map((w) => w.memberId));
  return members.filter((m) => withWindows.has(m.id)).map((m) => m.id);
}

export function memberStatusAt(
  memberId: string,
  start: number,
  end: number,
  windows: AvailabilityWindow[],
  responded: boolean,
): MemberSlotStatus {
  if (!responded) return "unknown";
  const mine = windows.filter((w) => w.memberId === memberId && w.end > start && w.start < end);
  if (mine.some((w) => w.level === "unavailable")) return "unavailable"; // any overlap with a hard exclusion
  // Adjacent windows (e.g. one per day) jointly cover a longer slot.
  if (covered(mine.filter((w) => w.level === "ideal"), start, end)) return "ideal";
  if (covered(mine.filter((w) => w.level !== "unavailable"), start, end)) return "works";
  return "unmarked";
}

function covered(list: AvailabilityWindow[], start: number, end: number): boolean {
  let cursor = start;
  for (const w of [...list].sort((a, b) => a.start - b.start)) {
    if (w.start > cursor) return false;
    cursor = Math.max(cursor, w.end);
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

function isAvailable(s: MemberSlotStatus) {
  return s === "ideal" || s === "works";
}

/** Split the search windows at every boundary and classify each member per segment. */
export function computeSegments(members: Member[], windows: AvailabilityWindow[], search: Slot[]): OverlapSegment[] {
  const responded = new Set(respondedMemberIds(members, windows));
  const segments: OverlapSegment[] = [];
  for (const range of search) {
    const cuts = new Set<number>([range.start, range.end]);
    for (const w of windows) {
      if (w.start > range.start && w.start < range.end) cuts.add(w.start);
      if (w.end > range.start && w.end < range.end) cuts.add(w.end);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      const start = sorted[i];
      const end = sorted[i + 1];
      const status: Record<string, MemberSlotStatus> = {};
      for (const m of members) status[m.id] = memberStatusAt(m.id, start, end, windows, responded.has(m.id));
      const available = members.filter((m) => isAvailable(status[m.id])).map((m) => m.id);
      const ideal = members.filter((m) => status[m.id] === "ideal").map((m) => m.id);
      const prev = segments[segments.length - 1];
      if (prev && prev.end === start && sameStatus(prev.status, status)) {
        prev.end = end;
      } else {
        segments.push({ start, end, status, available, ideal });
      }
    }
  }
  return segments;
}

function sameStatus(a: Record<string, MemberSlotStatus>, b: Record<string, MemberSlotStatus>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Group overlap: maximal contiguous runs with the same available set,
 * ranked by (#available desc, ideal minutes desc, duration desc, start asc).
 */
export function computeOverlap(
  members: Member[],
  windows: AvailabilityWindow[],
  search: Slot[],
  minDurationMinutes: number,
): OverlapResult {
  const segments = computeSegments(members, windows, search);
  const respondedIds = respondedMemberIds(members, windows);
  const unknownIds = members.filter((m) => !respondedIds.includes(m.id)).map((m) => m.id);
  const runs: OverlapWindow[] = [];
  let current: { start: number; end: number; segs: OverlapSegment[] } | null = null;

  const flush = () => {
    if (!current) return;
    const segs = current.segs;
    const available = segs[0].available;
    if (available.length > 0) {
      const ideal = members
        .filter((m) => segs.every((s) => s.status[m.id] === "ideal"))
        .map((m) => m.id);
      const idealMinutes = segs.reduce((sum, s) => sum + (s.ideal.length * (s.end - s.start)) / 60000, 0);
      const unavailable = members
        .filter((m) => !available.includes(m.id) && respondedIds.includes(m.id))
        .map((m) => m.id);
      const partial = unavailable.filter((id) => segs.some((s) => isAvailable(s.status[id])));
      runs.push({
        start: current.start,
        end: current.end,
        available,
        ideal,
        partial,
        unavailable: unavailable.filter((id) => !partial.includes(id)),
        unknown: unknownIds,
        everyoneResponding: respondedIds.length > 0 && respondedIds.every((id) => available.includes(id)),
        everyone: members.length > 0 && members.every((m) => available.includes(m.id)),
        idealMinutes,
      });
    }
    current = null;
  };

  for (const seg of segments) {
    if (current && current.end === seg.start && sameSet(current.segs[0].available, seg.available)) {
      current.end = seg.end;
      current.segs.push(seg);
    } else {
      flush();
      current = { start: seg.start, end: seg.end, segs: [seg] };
    }
  }
  flush();

  const minMs = minDurationMinutes * 60000;
  const ranked = runs
    .filter((w) => w.end - w.start >= minMs)
    .sort(
      (a, b) =>
        b.available.length - a.available.length ||
        b.idealMinutes - a.idealMinutes ||
        b.end - b.start - (a.end - a.start) ||
        a.start - b.start,
    );
  return { segments, windows: ranked, best: ranked[0] ?? null, respondedIds, unknownIds };
}

/** Status of each member for a concrete slot (used by feasibility). */
export function slotStatuses(members: Member[], windows: AvailabilityWindow[], slot: Slot): Record<string, MemberSlotStatus> {
  const responded = new Set(respondedMemberIds(members, windows));
  const out: Record<string, MemberSlotStatus> = {};
  for (const m of members) out[m.id] = memberStatusAt(m.id, slot.start, slot.end, windows, responded.has(m.id));
  return out;
}

/** Heatmap buckets: for each bucket, how many members are available/ideal. */
export function heatmap(
  members: Member[],
  windows: AvailabilityWindow[],
  search: Slot[],
  bucketMinutes = 30,
): Array<{ start: number; end: number; available: string[]; ideal: string[]; unavailable: string[]; unknown: string[] }> {
  const responded = new Set(respondedMemberIds(members, windows));
  const out = [];
  for (const range of search) {
    for (let t = range.start; t < range.end; t += bucketMinutes * 60000) {
      const end = Math.min(range.end, t + bucketMinutes * 60000);
      const available: string[] = [];
      const ideal: string[] = [];
      const unavailable: string[] = [];
      const unknown: string[] = [];
      for (const m of members) {
        const s = memberStatusAt(m.id, t, end, windows, responded.has(m.id));
        if (s === "ideal") {
          ideal.push(m.id);
          available.push(m.id);
        } else if (s === "works") available.push(m.id);
        else if (s === "unknown") unknown.push(m.id);
        else unavailable.push(m.id);
      }
      out.push({ start: t, end, available, ideal, unavailable, unknown });
    }
  }
  return out;
}

/** Merge adjacent/overlapping windows of the same level for one member. */
export function normalizeWindows(windows: AvailabilityWindow[]): AvailabilityWindow[] {
  const byKey = new Map<string, AvailabilityWindow[]>();
  for (const w of windows) {
    if (w.end <= w.start) continue;
    const key = `${w.memberId}|${w.level}`;
    byKey.set(key, [...(byKey.get(key) ?? []), w]);
  }
  const out: AvailabilityWindow[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.start - b.start);
    let cur = { ...list[0] };
    for (const w of list.slice(1)) {
      if (w.start <= cur.end) cur.end = Math.max(cur.end, w.end);
      else {
        out.push(cur);
        cur = { ...w };
      }
    }
    out.push(cur);
  }
  return out.sort((a, b) => a.start - b.start || a.memberId.localeCompare(b.memberId));
}
