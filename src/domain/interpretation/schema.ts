// Structured interpretation contracts. BOTH the LLM adapter and the
// deterministic parser must produce values that validate against these
// schemas. Interpretation extracts; it never chooses winners.
import { z } from "zod";
import { CONSTRAINT_KINDS, validateConstraintParams } from "../constraints";
import type { ConstraintKind } from "../types";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);

export const dimensionValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(160) }),
  z.object({ type: z.literal("place"), name: z.string().min(1).max(160), candidateId: z.string().optional() }),
  z.object({ type: z.literal("dates"), dates: z.array(localDate).min(1).max(31) }),
  z.object({ type: z.literal("dateRange"), start: localDate, end: localDate }),
  z.object({ type: z.literal("timeWindow"), start: localTime, end: localTime }),
  z.object({ type: z.literal("time"), start: localTime }),
  z.object({
    type: z.literal("money"),
    min: z.number().nonnegative().optional(),
    max: z.number().positive().optional(),
    currency: z.string().length(3),
    basis: z.enum(["per_person", "per_group"]),
  }),
  z.object({ type: z.literal("list"), items: z.array(z.string().min(1).max(60)).min(1).max(12) }),
  z.object({ type: z.literal("nights"), min: z.number().int().min(1).max(60), max: z.number().int().min(1).max(60) }),
  z.object({ type: z.literal("area"), label: z.string().min(1).max(120), lat: z.number().optional(), lng: z.number().optional(), radiusKm: z.number().positive().optional() }),
  z.object({ type: z.literal("minutes"), minutes: z.number().int().positive() }),
]);

export const dimensionDraftSchema = z.object({
  key: z.string().regex(/^[a-z_]{2,32}$/),
  label: z.string().min(1).max(40),
  state: z.enum(["LOCKED", "CONSTRAINED", "UNDECIDED"]),
  value: dimensionValueSchema.nullable(),
  display: z.string().max(200),
  needsConfirmation: z.boolean(),
});

export const clarificationOptionSchema = z.object({
  label: z.string().min(1).max(120),
  /** For plan-level ambiguity: the dimension value this option would set. */
  dimension: z.lazy(() => dimensionDraftSchema).optional(),
  /** A constraint to apply if this option is chosen; absent = free text / no rule. */
  constraint: z
    .object({
      kind: z.enum(CONSTRAINT_KINDS as [ConstraintKind, ...ConstraintKind[]]),
      strength: z.enum(["hard", "soft"]),
      params: z.record(z.string(), z.unknown()),
    })
    .nullable(),
});

export const clarificationSchema = z.object({
  sourceText: z.string().min(1).max(500),
  question: z.string().min(1).max(300),
  options: z.array(clarificationOptionSchema).min(2).max(6),
});

export const planExtractionSchema = z.object({
  title: z.string().min(1).max(140),
  kind: z.enum(["activity", "dinner", "travel"]),
  mode: z.enum(["fixed", "criteria", "shortlist", "discovery"]),
  dimensions: z.array(dimensionDraftSchema).max(16),
  shortlist: z.array(z.string().min(1).max(160)).max(12),
  clarifications: z.array(clarificationSchema).max(6),
});

export const constraintDraftSchema = z
  .object({
    kind: z.enum(CONSTRAINT_KINDS as [ConstraintKind, ...ConstraintKind[]]),
    strength: z.enum(["hard", "soft"]),
    params: z.record(z.string(), z.unknown()),
    label: z.string().max(200),
    sourceText: z.string().max(500),
  })
  .refine((c) => validateConstraintParams(c.kind, c.params).success, { message: "Invalid constraint parameters" });

export const constraintExtractionSchema = z.object({
  constraints: z.array(constraintDraftSchema).max(20),
  needsClarification: z.boolean(),
  clarifications: z.array(clarificationSchema).max(6),
  /** Text that could not be turned into a rule (kept as a note, never guessed). */
  unparsed: z.array(z.string().max(500)).max(10),
});

export type DimensionDraft = z.infer<typeof dimensionDraftSchema>;
export type ClarificationDraft = z.infer<typeof clarificationSchema>;
export type PlanExtraction = z.infer<typeof planExtractionSchema>;
export type ConstraintDraft = z.infer<typeof constraintDraftSchema>;
export type ConstraintExtraction = z.infer<typeof constraintExtractionSchema>;

export interface InterpretationContext {
  /** epoch ms */
  now: number;
  timezone: string;
  kind?: "activity" | "dinner" | "travel";
}
