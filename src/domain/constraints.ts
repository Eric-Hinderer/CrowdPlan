// Constraint parameter schemas and human-readable descriptions. Only ACTIVE
// constraints are enforced; PENDING ones (awaiting clarification/confirmation)
// are displayed but never evaluated as hard rules.
import { z } from "zod";
import { formatMoney } from "./money";
import { formatDateLabel, formatTimeLabel } from "./time";
import { WEEKDAYS, type Constraint, type ConstraintKind } from "./types";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weekday = z.enum(WEEKDAYS as [string, ...string[]]);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const daySelector = z.object({ weekday: weekday.optional(), date: localDate.optional() });

export const constraintParamSchemas = {
  max_budget: z.object({ amount: z.number().positive().max(100000), currency: z.string().length(3).default("USD") }),
  preferred_budget: z.object({ amount: z.number().positive().max(100000), currency: z.string().length(3).default("USD") }),
  dietary: z.object({ restriction: z.string().min(2).max(40) }),
  cuisine_preference: z.object({ cuisines: z.array(z.string().min(2).max(40)).min(1).max(10), mode: z.enum(["prefer", "avoid"]) }),
  avoid_area: z.object({ area: z.string().min(2).max(80) }),
  max_travel_minutes: z.object({ minutes: z.number().int().min(1).max(24 * 60) }),
  earliest_start: daySelector.extend({ time }),
  latest_end: daySelector.extend({ time }),
  unavailable_day: daySelector,
  no_travel_day: daySelector,
  earliest_departure: daySelector.extend({ time }),
  latest_arrival_home: daySelector.extend({ time }),
  day_preference: daySelector.extend({ prefer: z.boolean() }),
  exclude_candidate: z.object({ candidateId: z.string().min(1), title: z.string().max(160).optional() }),
  accessibility: z.object({ need: z.string().min(2).max(80) }),
  nonstop_only: z.object({}).passthrough(),
  note: z.object({ text: z.string().min(1).max(500) }),
} satisfies Record<ConstraintKind, z.ZodTypeAny>;

export const CONSTRAINT_KINDS = Object.keys(constraintParamSchemas) as ConstraintKind[];

export function validateConstraintParams(kind: ConstraintKind, params: unknown) {
  return constraintParamSchemas[kind].safeParse(params);
}

/** Constraints that can be checked automatically. `note` is informational only. */
export function isEvaluable(kind: ConstraintKind): boolean {
  return kind !== "note";
}

export function activeConstraints(constraints: Constraint[]): Constraint[] {
  return constraints.filter((c) => c.status === "active" && validateConstraintParams(c.kind, c.params).success);
}

function dayText(p: { weekday?: string; date?: string }): string {
  if (p.date) return formatDateLabel(p.date);
  if (p.weekday) return p.weekday[0].toUpperCase() + p.weekday.slice(1);
  return "";
}

export function describeConstraint(c: Pick<Constraint, "kind" | "params" | "strength">): string {
  const p = c.params as Record<string, never>;
  const day = dayText(p as { weekday?: string; date?: string });
  switch (c.kind) {
    case "max_budget":
      return `Cannot spend more than ${formatMoney(p.amount)}`;
    case "preferred_budget":
      return `Prefers to keep it under ${formatMoney(p.amount)}`;
    case "dietary":
      return `Dietary: ${String(p.restriction)}`;
    case "cuisine_preference":
      return `${p.mode === "avoid" ? "Would rather avoid" : "Prefers"} ${(p.cuisines as string[]).join(", ")}`;
    case "avoid_area":
      return `Would rather avoid ${String(p.area)}`;
    case "max_travel_minutes":
      return c.strength === "hard" ? `Won't travel more than ${p.minutes} min` : `Prefers under ${p.minutes} min away`;
    case "earliest_start":
      return `Can't start before ${formatTimeLabel(p.time)}${day ? ` ${day}` : ""}`;
    case "latest_end":
      return `Must wrap up by ${formatTimeLabel(p.time)}${day ? ` ${day}` : ""}`;
    case "unavailable_day":
      return `Unavailable all day ${day}`;
    case "no_travel_day":
      return `Can't travel on ${day}`;
    case "earliest_departure":
      return `Cannot depart before ${formatTimeLabel(p.time)}${day ? ` ${day}` : ""}`;
    case "latest_arrival_home":
      return `Must arrive home by ${formatTimeLabel(p.time)}${day ? ` ${day}` : ""}`;
    case "day_preference":
      return `${p.prefer ? "Prefers" : "Would rather not do"} ${day}`;
    case "exclude_candidate":
      return `Can't do ${p.title ? String(p.title) : "this option"}`;
    case "accessibility":
      return `Needs ${String(p.need)}`;
    case "nonstop_only":
      return c.strength === "hard" ? "Nonstop flights only" : "Prefers nonstop flights";
    case "note":
      return String(p.text);
    default:
      return c.kind;
  }
}
