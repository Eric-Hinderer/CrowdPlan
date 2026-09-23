"use server";

import { after } from "next/server";
import { z } from "zod";
import { diagnoseObjection, type ObjectionDiagnosis } from "@/domain/consensus";
import { CONSTRAINT_KINDS, validateConstraintParams } from "@/domain/constraints";
import { evaluatePlan } from "@/domain/evaluate";
import type { ConstraintExtraction } from "@/domain/interpretation/schema";
import type { ConstraintKind } from "@/domain/types";
import { loadPlanBundle, toPlanInput } from "@/lib/plan-data";
import { interpretParticipant } from "@/providers/llm";
import { logEvent } from "@/server/events";
import { ActionError, requireViewer, run, type ActionResult } from "@/server/guard";
import { checkEveryoneResponded } from "@/server/notify";
import { rateLimit } from "@/server/rate-limit";

async function myMember(supabase: Awaited<ReturnType<typeof requireViewer>>["supabase"], planId: string, userId: string) {
  const { data } = await supabase.from("plan_members").select("id, role").eq("plan_id", planId).eq("user_id", userId).maybeSingle();
  if (!data) throw new ActionError("You're not part of this plan.");
  return data;
}

const windowSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  level: z.enum(["ideal", "works", "unavailable"]),
});

/** Replace my availability for the plan (atomic from the user's perspective: delete + insert). */
export async function saveAvailabilityAction(input: { planId: string; windows: Array<z.input<typeof windowSchema>> }): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const planId = z.string().uuid().parse(input.planId);
    const windows = z.array(windowSchema).max(300).parse(input.windows);
    const now = Date.now();
    for (const w of windows) {
      if (w.end <= w.start) throw new ActionError("Each time block needs an end after its start.");
      if (w.end - w.start > 31 * 86_400_000) throw new ActionError("Time blocks can't span more than a month.");
      if (Math.abs(w.start - now) > 500 * 86_400_000) throw new ActionError("That date is too far away.");
    }
    const me = await myMember(supabase, planId, viewer.userId);
    const del = await supabase.from("availability_windows").delete().eq("plan_id", planId).eq("member_id", me.id);
    if (del.error) throw new Error(del.error.message);
    if (windows.length) {
      const { error } = await supabase.from("availability_windows").insert(
        windows.map((w) => ({ plan_id: planId, member_id: me.id, starts_at: new Date(w.start).toISOString(), ends_at: new Date(w.end).toISOString(), level: w.level })),
      );
      if (error) throw new Error(error.message);
    }
    await supabase.from("plan_members").update({ responded_at: new Date().toISOString() }).eq("id", me.id);
    after(async () => {
      await logEvent(planId, me.id, "availability_updated", { windows: windows.length });
      await checkEveryoneResponded(planId);
    });
    return { count: windows.length };
  });
}

export async function interpretStatementAction(input: { planId: string; text: string }): Promise<ActionResult<{ extraction: ConstraintExtraction; provider: string }>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const planId = z.string().uuid().parse(input.planId);
    const text = z.string().trim().min(2).max(600).parse(input.text);
    await rateLimit(`interpret:${viewer.userId}`, 60, 3600);
    await myMember(supabase, planId, viewer.userId);
    const { data: plan } = await supabase.from("plans").select("kind, timezone").eq("id", planId).single();
    const { result, provider } = await interpretParticipant(text, { now: Date.now(), timezone: plan!.timezone, kind: plan!.kind });
    return { extraction: result, provider };
  });
}

const draftSchema = z.object({
  kind: z.enum(CONSTRAINT_KINDS as [ConstraintKind, ...ConstraintKind[]]),
  strength: z.enum(["hard", "soft"]),
  params: z.record(z.string(), z.unknown()),
  label: z.string().max(200).optional(),
  sourceText: z.string().max(500).optional(),
});

const clarSchema = z.object({
  sourceText: z.string().min(1).max(500),
  question: z.string().min(1).max(300),
  options: z.array(z.object({ label: z.string().min(1).max(120), constraint: draftSchema.omit({ label: true, sourceText: true }).nullable() })).min(2).max(6),
});

/**
 * Save CONFIRMED constraints and any clarifications still needing an answer.
 * Clarifications never create an active rule until resolved.
 */
export async function saveStatementAction(input: {
  planId: string;
  constraints: Array<z.input<typeof draftSchema>>;
  clarifications: Array<z.input<typeof clarSchema>>;
  source: "parser" | "llm";
  unparsedNotes?: string[];
}): Promise<ActionResult<{ saved: number; pending: number }>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const planId = z.string().uuid().parse(input.planId);
    const drafts = z.array(draftSchema).max(20).parse(input.constraints);
    const clars = z.array(clarSchema).max(6).parse(input.clarifications);
    const notes = z.array(z.string().trim().min(1).max(500)).max(5).parse(input.unparsedNotes ?? []);
    const me = await myMember(supabase, planId, viewer.userId);
    for (const d of drafts) {
      if (!validateConstraintParams(d.kind, d.params).success) throw new ActionError(`Couldn't save "${d.label ?? d.kind}" — details are incomplete.`);
    }
    const rows = [
      ...drafts.map((d) => ({ plan_id: planId, member_id: me.id, kind: d.kind, strength: d.strength, params: d.params, status: "active", source: input.source === "llm" ? "llm" : "parser", source_text: d.sourceText ?? null, label: d.label ?? null })),
      ...notes.map((t) => ({ plan_id: planId, member_id: me.id, kind: "note", strength: "soft", params: { text: t }, status: "active", source: "user", source_text: t, label: t })),
    ];
    if (rows.length) {
      const { error } = await supabase.from("plan_constraints").insert(rows);
      if (error) throw new Error(error.message);
    }
    if (clars.length) {
      const { error } = await supabase.from("clarifications").insert(
        clars.map((c) => ({ plan_id: planId, member_id: me.id, source_text: c.sourceText, question: c.question, options: c.options })),
      );
      if (error) throw new Error(error.message);
    }
    after(() => logEvent(planId, me.id, "constraints_added", { count: rows.length, clarifications: clars.length }));
    return { saved: rows.length, pending: clars.length };
  });
}

export async function resolveClarificationAction(input: { clarificationId: string; optionIndex: number; note?: string }): Promise<ActionResult<{ applied: boolean }>> {
  return run(async () => {
    const { supabase } = await requireViewer();
    const id = z.string().uuid().parse(input.clarificationId);
    const { data: clar } = await supabase.from("clarifications").select("*").eq("id", id).maybeSingle();
    if (!clar) throw new ActionError("That question is no longer available.");
    if (clar.status !== "open") throw new ActionError("That question was already answered.");
    const options = clarSchema.shape.options.parse(clar.options);
    const option = options[input.optionIndex];
    if (!option) throw new ActionError("Pick one of the options.");
    const note = input.note?.trim().slice(0, 500) || null;
    const { data: updated, error } = await supabase
      .from("clarifications")
      .update({ status: "resolved", resolution: { optionIndex: input.optionIndex, note }, resolved_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "open")
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new ActionError("Only the person who wrote this can answer it.");
    let applied = false;
    if (option.constraint) {
      if (!validateConstraintParams(option.constraint.kind, option.constraint.params).success) throw new ActionError("That option is incomplete.");
      const { error: cErr } = await supabase.from("plan_constraints").insert({
        plan_id: clar.plan_id,
        member_id: clar.member_id,
        kind: option.constraint.kind,
        strength: option.constraint.strength,
        params: option.constraint.params,
        status: "active",
        source: "clarification",
        source_text: clar.source_text,
        label: option.label,
      });
      if (cErr) throw new Error(cErr.message);
      applied = true;
    } else if (note) {
      await supabase.from("plan_constraints").insert({ plan_id: clar.plan_id, member_id: clar.member_id, kind: "note", strength: "soft", params: { text: note }, status: "active", source: "clarification", source_text: clar.source_text, label: note });
    }
    return { applied };
  });
}

export async function deleteConstraintAction(constraintId: string): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase } = await requireViewer();
    const { data, error } = await supabase.from("plan_constraints").delete().eq("id", z.string().uuid().parse(constraintId)).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new ActionError("You can only remove your own requirements.");
    return null;
  });
}

export async function setConstraintStrengthAction(input: { constraintId: string; strength: "hard" | "soft" }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase } = await requireViewer();
    const { data, error } = await supabase
      .from("plan_constraints")
      .update({ strength: z.enum(["hard", "soft"]).parse(input.strength) })
      .eq("id", z.string().uuid().parse(input.constraintId))
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new ActionError("You can only change your own requirements.");
    return null;
  });
}

const answersSchema = z.object({
  maxBudget: z.number().positive().max(100000).nullable().optional(),
  preferredBudget: z.number().positive().max(100000).nullable().optional(),
  dietary: z.array(z.string().trim().min(2).max(40)).max(8).optional(),
  cuisinesPreferred: z.array(z.string().trim().min(2).max(40)).max(8).optional(),
  cuisinesAvoid: z.array(z.string().trim().min(2).max(40)).max(8).optional(),
  maxTravelMinutes: z.number().int().min(1).max(600).nullable().optional(),
  maxTravelStrength: z.enum(["hard", "soft"]).optional(),
  nonstop: z.enum(["no", "prefer", "require"]).optional(),
  notes: z.string().trim().max(500).optional(),
});

/** Questionnaire answers → structured constraints (replaces previous form-sourced ones). */
export async function saveResponseAction(input: { planId: string; answers: z.input<typeof answersSchema>; origin?: { label: string | null; lat: number | null; lng: number | null } | null; homeBufferMinutes?: number }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const planId = z.string().uuid().parse(input.planId);
    const a = answersSchema.parse(input.answers);
    const me = await myMember(supabase, planId, viewer.userId);
    if (a.maxBudget && a.preferredBudget && a.preferredBudget > a.maxBudget) throw new ActionError("Your preferred budget is above your maximum.");
    const rows: Array<Record<string, unknown>> = [];
    const c = (kind: ConstraintKind, strength: "hard" | "soft", params: Record<string, unknown>, label: string) =>
      rows.push({ plan_id: planId, member_id: me.id, kind, strength, params, status: "active", source: "user", label });
    if (a.maxBudget) c("max_budget", "hard", { amount: a.maxBudget, currency: "USD" }, `Cannot spend more than $${a.maxBudget}`);
    if (a.preferredBudget) c("preferred_budget", "soft", { amount: a.preferredBudget, currency: "USD" }, `Prefers under $${a.preferredBudget}`);
    for (const d of a.dietary ?? []) c("dietary", "hard", { restriction: d.toLowerCase() }, `Dietary: ${d}`);
    if (a.cuisinesPreferred?.length) c("cuisine_preference", "soft", { cuisines: a.cuisinesPreferred, mode: "prefer" }, `Prefers ${a.cuisinesPreferred.join(", ")}`);
    if (a.cuisinesAvoid?.length) c("cuisine_preference", "soft", { cuisines: a.cuisinesAvoid, mode: "avoid" }, `Would rather avoid ${a.cuisinesAvoid.join(", ")}`);
    if (a.maxTravelMinutes) c("max_travel_minutes", a.maxTravelStrength ?? "soft", { minutes: a.maxTravelMinutes }, `${a.maxTravelStrength === "hard" ? "Won't travel more than" : "Prefers under"} ${a.maxTravelMinutes} min`);
    if (a.nonstop && a.nonstop !== "no") c("nonstop_only", a.nonstop === "require" ? "hard" : "soft", {}, a.nonstop === "require" ? "Nonstop flights only" : "Prefers nonstop");
    const del = await supabase.from("plan_constraints").delete().eq("plan_id", planId).eq("member_id", me.id).eq("source", "user").neq("kind", "note");
    if (del.error) throw new Error(del.error.message);
    if (rows.length) {
      const { error } = await supabase.from("plan_constraints").insert(rows);
      if (error) throw new Error(error.message);
    }
    const { error: rErr } = await supabase
      .from("member_responses")
      .upsert({ plan_id: planId, member_id: me.id, answers: a, submitted_at: new Date().toISOString() }, { onConflict: "member_id" });
    if (rErr) throw new Error(rErr.message);
    const patch: Record<string, unknown> = { responded_at: new Date().toISOString() };
    if (input.origin !== undefined) {
      patch.origin_label = input.origin?.label?.slice(0, 120) ?? null;
      patch.origin_lat = input.origin?.lat ?? null;
      patch.origin_lng = input.origin?.lng ?? null;
    }
    if (input.homeBufferMinutes !== undefined) patch.home_buffer_minutes = z.number().int().min(0).max(600).parse(input.homeBufferMinutes);
    await supabase.from("plan_members").update(patch).eq("id", me.id);
    after(async () => {
      await logEvent(planId, me.id, "response_saved", {});
      await checkEveryoneResponded(planId);
    });
    return null;
  });
}

export async function updateMyNameAction(input: { planId: string; displayName: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const planId = z.string().uuid().parse(input.planId);
    const name = z.string().trim().min(1).max(40).parse(input.displayName);
    const { error } = await supabase.from("plan_members").update({ display_name: name }).eq("plan_id", planId).eq("user_id", viewer.userId);
    if (error) throw new Error(error.message);
    return null;
  });
}

const reactionSchema = z.object({
  planId: z.string().uuid(),
  candidateId: z.string().uuid(),
  reaction: z.enum(["love", "works", "acceptable", "rather_not", "cant"]).nullable(),
  reason: z.enum(["price", "schedule", "place", "distance", "transportation", "accessibility", "other"]).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function reactAction(input: z.input<typeof reactionSchema>): Promise<ActionResult<{ diagnosis: ObjectionDiagnosis | null }>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const r = reactionSchema.parse(input);
    const me = await myMember(supabase, r.planId, viewer.userId);
    if (r.reaction === null) {
      const { error } = await supabase.from("reactions").delete().eq("candidate_id", r.candidateId).eq("member_id", me.id);
      if (error) throw new Error(error.message);
      return { diagnosis: null };
    }
    if (r.reaction === "cant" && !r.reason) throw new ActionError("Tell the group why this doesn't work.");
    const { error } = await supabase
      .from("reactions")
      .upsert(
        { plan_id: r.planId, candidate_id: r.candidateId, member_id: me.id, reaction: r.reaction, reason: r.reaction === "cant" ? r.reason : null, note: r.note ?? null },
        { onConflict: "candidate_id,member_id" },
      );
    if (error) throw new Error(error.message);
    let diagnosis: ObjectionDiagnosis | null = null;
    if (r.reaction === "cant") {
      const bundle = await loadPlanBundle(supabase, r.planId, viewer.userId);
      const input = toPlanInput(bundle);
      const evaluation = evaluatePlan(input).evaluations.find((e) => e.candidateId === r.candidateId);
      const title = bundle.candidates.find((c) => c.id === r.candidateId)?.title ?? "this option";
      diagnosis = diagnoseObjection({ candidateId: r.candidateId, memberId: me.id, reaction: "cant", reason: r.reason ?? null, note: r.note ?? null }, evaluation, title, input.constraints);
    }
    after(() => logEvent(r.planId, me.id, "reacted", { candidateId: r.candidateId, reaction: r.reaction }));
    return { diagnosis };
  });
}

/** Confirmed objection → a real hard constraint (only after the member confirms). */
export async function confirmObjectionConstraintAction(input: { planId: string; kind: ConstraintKind; strength: "hard" | "soft"; params: Record<string, unknown>; label: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const planId = z.string().uuid().parse(input.planId);
    const d = draftSchema.parse({ kind: input.kind, strength: input.strength, params: input.params, label: input.label });
    if (!validateConstraintParams(d.kind, d.params).success) throw new ActionError("That requirement is incomplete.");
    const me = await myMember(supabase, planId, viewer.userId);
    const { error } = await supabase.from("plan_constraints").insert({ plan_id: planId, member_id: me.id, kind: d.kind, strength: d.strength, params: d.params, status: "active", source: "objection", label: d.label ?? null });
    if (error) throw new Error(error.message);
    after(() => logEvent(planId, me.id, "objection_confirmed", { kind: d.kind }));
    return null;
  });
}

export async function markCheckedAction(input: { candidateId: string; restriction: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase } = await requireViewer();
    const id = z.string().uuid().parse(input.candidateId);
    const restriction = z.string().trim().toLowerCase().min(2).max(40).parse(input.restriction);
    const { data: c } = await supabase.from("candidates").select("attributes").eq("id", id).maybeSingle();
    if (!c) throw new ActionError("Option not found.");
    const attrs = (c.attributes ?? {}) as Record<string, unknown>;
    const list = Array.isArray(attrs.dietaryVerified) ? (attrs.dietaryVerified as string[]) : [];
    const { data, error } = await supabase
      .from("candidates")
      .update({ attributes: { ...attrs, dietaryVerified: [...new Set([...list, restriction])] } })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new ActionError("Only the organizer can mark this as checked.");
    return null;
  });
}
