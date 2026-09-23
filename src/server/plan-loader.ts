import "server-only";

import type { PlanBundle } from "@/lib/plan-data";
import { serverDb } from "./db";

function iso<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as T;
}

/**
 * Server-role plan loader for background work (jobs, enrichment, search).
 * Never used to answer a user request without a prior RLS-checked access.
 */
export async function loadPlanForServer(planId: string): Promise<PlanBundle | null> {
  const sql = serverDb();
  const [plans, members, dims, constraints, avail, cands, comps, reacts, clars] = await Promise.all([
    sql`select * from public.plans where id = ${planId}`,
    sql`select * from public.plan_members where plan_id = ${planId} order by joined_at`,
    sql`select * from public.plan_dimensions where plan_id = ${planId} order by sort`,
    sql`select * from public.plan_constraints where plan_id = ${planId} order by created_at`,
    sql`select member_id, starts_at, ends_at, level from public.availability_windows where plan_id = ${planId}`,
    sql`select * from public.candidates where plan_id = ${planId} order by created_at`,
    sql`select * from public.candidate_components where plan_id = ${planId} order by sort`,
    sql`select candidate_id, member_id, reaction, reason, note from public.reactions where plan_id = ${planId}`,
    sql`select * from public.clarifications where plan_id = ${planId} order by created_at`,
  ]);
  if (!plans.length) return null;
  const plan = iso(plans[0]) as unknown as PlanBundle["plan"];
  plan.version = Number(plan.version);
  return {
    plan,
    members: members.map((m) => iso(m)) as unknown as PlanBundle["members"],
    me: null,
    isOrganizer: false,
    dimensions: dims.map((d) => ({
      key: d.key,
      label: d.label,
      state: d.state,
      value: d.value,
      display: d.display ?? "",
      source: d.source,
      needsConfirmation: d.needs_confirmation,
    })),
    constraints: constraints.map((c) => iso(c)) as unknown as PlanBundle["constraints"],
    clarifications: clars.map((c) => iso(c)) as unknown as PlanBundle["clarifications"],
    availability: avail.map((w) => ({ memberId: w.member_id, start: new Date(w.starts_at).getTime(), end: new Date(w.ends_at).getTime(), level: w.level })),
    candidates: cands.map((c) => ({ ...iso(c), rating: c.rating == null ? null : Number(c.rating) })) as unknown as PlanBundle["candidates"],
    components: comps.map((c) => iso(c)) as unknown as PlanBundle["components"],
    reactions: reacts.map((r) => ({ candidateId: r.candidate_id, memberId: r.member_id, reaction: r.reaction, reason: r.reason, note: r.note })),
    responses: {},
    proposals: [],
    proposalAnswers: [],
    events: [],
    loadedAt: Date.now(),
  };
}
