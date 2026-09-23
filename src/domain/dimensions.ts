// Dimension semantics: LOCKED values are fixed, CONSTRAINED values bound the
// search space, UNDECIDED values are resolved by the engine. Every automatic
// resolution must pass `slotRespectsDimensions` / `valueRespectsDimension`.
import {
  addDays,
  DAY,
  eachDate,
  formatDateLabel,
  formatTimeLabel,
  isLocalDate,
  isLocalTime,
  localDate,
  localMinutes,
  minutesOfDay,
  zonedInstant,
} from "./time";
import type { Dimension, DimensionValue, PlanContext, PlanKind, Slot } from "./types";

export const DATE_KEYS = ["date", "dates"] as const;

export function getDimension(dimensions: Dimension[], key: string): Dimension | undefined {
  return dimensions.find((d) => d.key === key);
}

export function dateDimension(dimensions: Dimension[]): Dimension | undefined {
  return getDimension(dimensions, "date") ?? getDimension(dimensions, "dates");
}

export function defaultDailyWindow(kind: PlanKind): { start: string; end: string } {
  if (kind === "dinner") return { start: "16:00", end: "23:00" };
  if (kind === "travel") return { start: "00:00", end: "24:00" };
  return { start: "08:00", end: "24:00" };
}

/** Local dates the plan may happen on, derived from LOCKED/CONSTRAINED date dimensions. */
export function allowedDates(dimensions: Dimension[], plan: PlanContext, horizonDays = 14): string[] {
  const dim = dateDimension(dimensions);
  const value = dim?.state !== "UNDECIDED" ? dim?.value : null;
  if (value?.type === "dates") return [...value.dates].filter(isLocalDate).sort();
  if (value?.type === "dateRange" && isLocalDate(value.start) && isLocalDate(value.end)) {
    return eachDate(value.start, value.end);
  }
  const today = localDate(plan.now, plan.timezone);
  return eachDate(today, addDays(today, horizonDays - 1));
}

export interface TimeBounds {
  /** local window each day; end may be "24:00" or wrap past midnight */
  window: { start: string; end: string };
  /** a LOCKED/CONSTRAINED specific start time */
  fixedStart: string | null;
  source: "dimension" | "default";
}

export function timeBounds(dimensions: Dimension[], kind: PlanKind): TimeBounds {
  const dim = getDimension(dimensions, "time");
  if (dim && dim.state !== "UNDECIDED" && dim.value) {
    if (dim.value.type === "timeWindow" && isLocalTime(dim.value.start) && isLocalTime(dim.value.end)) {
      return { window: { start: dim.value.start, end: dim.value.end }, fixedStart: null, source: "dimension" };
    }
    if (dim.value.type === "time" && isLocalTime(dim.value.start)) {
      return { window: { start: dim.value.start, end: "24:00" }, fixedStart: dim.value.start, source: "dimension" };
    }
  }
  return { window: defaultDailyWindow(kind), fixedStart: null, source: "default" };
}

/** Concrete search windows (instants) = allowed dates x daily time window. */
export function searchWindows(dimensions: Dimension[], plan: PlanContext): Slot[] {
  const dates = allowedDates(dimensions, plan);
  const bounds = timeBounds(dimensions, plan.kind);
  const out: Slot[] = [];
  for (const date of dates) {
    const start = zonedInstant(date, bounds.window.start, plan.timezone);
    let end = zonedInstant(date, bounds.window.end, plan.timezone);
    if (end <= start) end = zonedInstant(addDays(date, 1), bounds.window.end, plan.timezone); // overnight window
    out.push({ start, end });
  }
  return out;
}

export interface DimensionViolation {
  key: string;
  message: string;
}

/**
 * Invariant used by the engine and tests: a resolved slot must lie inside
 * LOCKED/CONSTRAINED date and time dimensions.
 */
export function slotRespectsDimensions(slot: Slot, dimensions: Dimension[], plan: PlanContext): DimensionViolation[] {
  const violations: DimensionViolation[] = [];
  const dateDim = dateDimension(dimensions);
  if (dateDim && dateDim.state !== "UNDECIDED" && dateDim.value && plan.kind !== "travel") {
    const d = localDate(slot.start, plan.timezone);
    const allowed = allowedDates(dimensions, plan);
    if (!allowed.includes(d)) {
      violations.push({ key: dateDim.key, message: `${formatDateLabel(d)} is outside ${dateDim.display}` });
    }
  }
  const timeDim = getDimension(dimensions, "time");
  if (timeDim && timeDim.state !== "UNDECIDED" && timeDim.value && plan.kind !== "travel") {
    const startMin = localMinutes(slot.start, plan.timezone);
    if (timeDim.value.type === "time") {
      if (startMin !== minutesOfDay(timeDim.value.start)) {
        violations.push({ key: "time", message: `Start differs from ${timeDim.state.toLowerCase()} time ${formatTimeLabel(timeDim.value.start)}` });
      }
    } else if (timeDim.value.type === "timeWindow") {
      const ws = minutesOfDay(timeDim.value.start);
      const we = minutesOfDay(timeDim.value.end);
      const durationMin = Math.round((slot.end - slot.start) / 60000);
      const endMin = startMin + durationMin;
      const wraps = we <= ws;
      const inside = wraps
        ? (startMin >= ws || startMin < we) && durationMin <= (24 * 60 - ws + we)
        : startMin >= ws && endMin <= we;
      if (!inside) {
        violations.push({ key: "time", message: `Time falls outside ${timeDim.display}` });
      }
    }
  }
  return violations;
}

/** Whether a proposed value for a dimension is permitted by its state. */
export function valueRespectsDimension(dim: Dimension, proposed: DimensionValue): boolean {
  if (dim.state === "UNDECIDED" || !dim.value) return true;
  const current = dim.value;
  if (dim.state === "LOCKED") {
    return JSON.stringify(normalizeValue(current)) === JSON.stringify(normalizeValue(proposed));
  }
  // CONSTRAINED
  switch (current.type) {
    case "dates":
      if (proposed.type === "dates") return proposed.dates.every((d) => current.dates.includes(d));
      return false;
    case "dateRange":
      if (proposed.type === "dates") return proposed.dates.every((d) => d >= current.start && d <= current.end);
      if (proposed.type === "dateRange") return proposed.start >= current.start && proposed.end <= current.end;
      return false;
    case "timeWindow": {
      const ws = minutesOfDay(current.start);
      const we = current.end === "24:00" ? 24 * 60 : minutesOfDay(current.end);
      if (proposed.type === "time") {
        const t = minutesOfDay(proposed.start);
        return we > ws ? t >= ws && t < we : t >= ws || t < we;
      }
      if (proposed.type === "timeWindow") {
        return minutesOfDay(proposed.start) >= ws && (proposed.end === "24:00" ? 24 * 60 : minutesOfDay(proposed.end)) <= we;
      }
      return false;
    }
    case "money":
      if (proposed.type === "money") {
        const max = current.max ?? Infinity;
        const min = current.min ?? 0;
        return (proposed.max ?? proposed.min ?? 0) <= max && (proposed.min ?? proposed.max ?? 0) >= min;
      }
      return false;
    case "nights":
      if (proposed.type === "nights") return proposed.min >= current.min && proposed.max <= current.max;
      return false;
    case "list":
      if (proposed.type === "list") return proposed.items.every((i) => current.items.map(lc).includes(lc(i)));
      if (proposed.type === "text") return current.items.map(lc).includes(lc(proposed.text));
      return false;
    default:
      return JSON.stringify(normalizeValue(current)) === JSON.stringify(normalizeValue(proposed));
  }
}

function lc(s: string) {
  return s.trim().toLowerCase();
}

function normalizeValue(v: DimensionValue): DimensionValue {
  if (v.type === "text") return { type: "text", text: lc(v.text) };
  if (v.type === "place") return { type: "place", name: lc(v.name) };
  if (v.type === "dates") return { type: "dates", dates: [...v.dates].sort() };
  return v;
}

/** Validate structural sanity of a dimension edit (used by server actions). */
export function validateDimension(dim: Dimension): string | null {
  if (dim.state !== "UNDECIDED" && !dim.value) return `${dim.label} needs a value when ${dim.state.toLowerCase()}`;
  const v = dim.value;
  if (!v) return null;
  switch (v.type) {
    case "dates":
      return v.dates.length > 0 && v.dates.every(isLocalDate) ? null : "Invalid date";
    case "dateRange":
      return isLocalDate(v.start) && isLocalDate(v.end) && v.start <= v.end && (new Date(v.end).getTime() - new Date(v.start).getTime()) / DAY <= 370
        ? null
        : "Invalid date range";
    case "timeWindow":
      return isLocalTime(v.start) && isLocalTime(v.end) ? null : "Invalid time window";
    case "time":
      return isLocalTime(v.start) ? null : "Invalid time";
    case "money":
      if (v.min != null && v.max != null && v.min > v.max) return "Minimum is above maximum";
      if ((v.max ?? 0) < 0 || (v.min ?? 0) < 0) return "Amounts must be positive";
      return null;
    case "nights":
      return v.min >= 1 && v.max >= v.min && v.max <= 60 ? null : "Invalid number of nights";
    default:
      return null;
  }
}
