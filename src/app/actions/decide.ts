"use server";

import { after } from "next/server";
import { z } from "zod";
import { getDimension } from "@/domain/dimensions";
import { evaluatePlan } from "@/domain/evaluate";
import { formatMoney, formatMoneyRange } from "@/domain/money";
import { makeThisWork, type RepairChange, type RepairResult } from "@/domain/repair";
import { formatClock, formatDay, formatRange, localDate, localTime } from "@/domain/time";
import { loadPlanBundle, toPlanInput, type FinalSnapshot, type PlanBundle } from "@/lib/plan-data";
import { logEvent } from "@/server/events";
import { ActionError, requireAccount, requireViewer, run, type ActionResult } from "@/server/guard";
import { emailExisting, notify } from "@/server/notify";
import { rateLimit } from "@/server/rate-limit";
import { runCriteriaSearch, type SearchRunResult } from "@/server/search";

export async function runSearchAction(planId: string): Promise<ActionResult<SearchRunResult>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const id = z.string().uuid().parse(planId);
    await rateLimit(`search:${viewer.userId}`, 20, 3600, "Searching is limited to keep costs down — try again later.");
    // Authorization first (RLS): only members can trigger a plan's search, and only the organizer
    // may spend the search budget on discovery.
    const bundle = await loadPlanBundle(supabase, id, viewer.userId);
    if (!bundle.isOrganizer) throw new ActionError("Only the organizer can search for options.");
    return runCriteriaSearch(id, bundle.me?.id ?? null);
  });
}

export async function makeThisWorkAction(input: { planId: string; candidateId: string }): Promise<ActionResult<RepairResult & { proposalIds: string[] }>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const planId = z.string().uuid().parse(input.planId);
    const candidateId = z.string().uuid().parse(input.candidateId);
    await rateLimit(`repair:${viewer.userId}`, 60, 3600);
    const bundle = await loadPlanBundle(supabase, planId, viewer.userId);
    if (!bundle.me) throw new ActionError("You're not part of this plan.");
    if (bundle.plan.status !== "collecting") throw new ActionError("This plan is finalized.");
    const result = makeThisWork(candidateId, toPlanInput(bundle));
    const proposalIds: string[] = [];
    if (result.proposals.length) {
      await supabase.from("proposals").update({ status: "superseded" }).eq("candidate_id", candidateId).eq("status", "open");
      const { data, error } = await supabase
        .from("proposals")
        .insert(
          result.proposals.map((p) => ({
            plan_id: planId,
            candidate_id: candidateId,
            kind: p.kind,
            summary: p.headline.slice(0, 300),
            payload: { changes: p.changes, impacts: p.impacts, summary: p.summary, resultStatus: p.resultStatus, costDelta: p.costDelta, shiftMinutes: p.shiftMinutes, remainingIssues: p.remainingIssues },
            created_by: bundle.me!.id,
          })),
        )
        .select("id");
      if (error) throw new Error(error.message);
      proposalIds.push(...(data ?? []).map((d) => d.id));
    }
    after(() => logEvent(planId, bundle.me!.id, "make_this_work", { candidateId, proposals: result.proposals.length, blockers: result.blockers.length }));
    return { ...result, proposalIds };
  });
}

export async function answerProposalAction(input: { proposalId: string; answer: "yes" | "no" }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase, viewer } = await requireViewer();
    const proposalId = z.string().uuid().parse(input.proposalId);
    const { data: p } = await supabase.from("proposals").select("plan_id, status").eq("id", proposalId).maybeSingle();
    if (!p || p.status !== "open") throw new ActionError("That question is closed.");
    const { data: me } = await supabase.from("plan_members").select("id").eq("plan_id", p.plan_id).eq("user_id", viewer.userId).maybeSingle();
    if (!me) throw new ActionError("You're not part of this plan.");
    const { error } = await supabase
      .from("proposal_answers")
      .upsert({ plan_id: p.plan_id, proposal_id: proposalId, member_id: me.id, answer: z.enum(["yes", "no"]).parse(input.answer) }, { onConflict: "proposal_id,member_id" });
    if (error) throw new Error(error.message);
    return null;
  });
}

export async function decideProposalAction(input: { proposalId: string; accept: boolean }): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase, viewer } = await requireAccount();
    const proposalId = z.string().uuid().parse(input.proposalId);
    const { data: p } = await supabase.from("proposals").select("*").eq("id", proposalId).maybeSingle();
    if (!p) throw new ActionError("Proposal not found.");
    if (p.status !== "open") throw new ActionError("This proposal was already decided.");
    const bundle = await loadPlanBundle(supabase, p.plan_id, viewer.userId);
    if (!bundle.isOrganizer) throw new ActionError("Only the organizer can apply changes.");
    if (input.accept) {
      const changes = ((p.payload as { changes?: RepairChange[] }).changes ?? []) as RepairChange[];
      for (const ch of changes) await applyChange(supabase, bundle, ch);
    }
    const { error } = await supabase
      .from("proposals")
      .update({ status: input.accept ? "accepted" : "declined", decided_by: bundle.me?.id ?? null, decided_at: new Date().toISOString() })
      .eq("id", proposalId);
    if (error) throw new Error(error.message);
    if (input.accept && p.candidate_id) {
      await supabase.from("proposals").update({ status: "superseded" }).eq("candidate_id", p.candidate_id).eq("status", "open");
    }
    after(async () => {
      await logEvent(p.plan_id, bundle.me?.id ?? null, input.accept ? "proposal_accepted" : "proposal_declined", { summary: p.summary });
      if (input.accept) {
        await notify({
          planId: p.plan_id,
          userIds: bundle.members.filter((m) => m.user_id !== viewer.userId).map((m) => m.user_id),
          kind: "plan_update",
          title: `Plan updated: ${bundle.plan.title}`,
          body: p.summary,
          dedupeKey: (u) => `proposal_accepted:${proposalId}:${u}`,
        });
      }
    });
    return null;
  });
}

async function applyChange(supabase: Awaited<ReturnType<typeof requireViewer>>["supabase"], bundle: PlanBundle, ch: RepairChange) {
  if (ch.type === "swap_flight") {
    const target = bundle.components.find((c) => c.id === ch.toComponentId && c.candidate_id === ch.candidateId && c.member_id === ch.memberId);
    if (!target) throw new ActionError("That flight option is no longer available.");
    const off = await supabase
      .from("candidate_components")
      .update({ is_selected: false })
      .eq("candidate_id", ch.candidateId)
      .eq("member_id", ch.memberId)
      .eq("kind", "flight")
      .eq("data->>direction", ch.direction)
      .select("id");
    if (off.error) throw new Error(off.error.message);
    const on = await supabase.from("candidate_components").update({ is_selected: true }).eq("id", ch.toComponentId).select("id");
    if (on.error || !on.data?.length) throw new ActionError("Couldn't switch the flight.");
    return;
  }
  const tz = bundle.plan.timezone;
  const cand = bundle.candidates.find((c) => c.id === ch.candidateId);
  if (!cand) throw new ActionError("That option is no longer available.");
  const { error } = await supabase
    .from("candidates")
    .update({ starts_at: new Date(ch.to.start).toISOString(), ends_at: new Date(ch.to.end).toISOString() })
    .eq("id", ch.candidateId);
  if (error) throw new Error(error.message);
  const timeDim = getDimension(bundle.dimensions, "time");
  if (timeDim?.state === "LOCKED") {
    const t = localTime(ch.to.start, tz);
    await supabase.from("plan_dimensions").update({ value: { type: "time", start: t }, display: formatClock(ch.to.start, tz), source: "user" }).eq("plan_id", bundle.plan.id).eq("key", "time");
  }
  const dateDim = getDimension(bundle.dimensions, "date");
  const newDate = localDate(ch.to.start, tz);
  if (dateDim?.state === "LOCKED" && dateDim.value?.type === "dates" && !dateDim.value.dates.includes(newDate)) {
    await supabase.from("plan_dimensions").update({ value: { type: "dates", dates: [newDate] }, display: formatDay(ch.to.start, tz), source: "user" }).eq("plan_id", bundle.plan.id).eq("key", "date");
  }
}

function buildSnapshot(bundle: PlanBundle, candidateId: string, organizerName: string): FinalSnapshot {
  const input = toPlanInput(bundle);
  const evaluation = evaluatePlan(input).evaluations.find((e) => e.candidateId === candidateId);
  const cand = bundle.candidates.find((c) => c.id === candidateId)!;
  const tz = bundle.plan.timezone;
  const when = evaluation?.slot ? formatRange(evaluation.slot.start, evaluation.slot.end, tz) : null;
  const facts: FinalSnapshot["facts"] = [];
  const src = (kind: string) => (kind === "live" ? `Live data (${cand.provider ?? "provider"}, ${cand.fetched_at ? new Date(cand.fetched_at).toLocaleDateString("en-US") : "recent"})` : kind === "estimate" ? "Estimate" : kind === "demo" ? "Demo data" : kind === "user" ? "Entered by the group" : "Unverified");
  if (cand.address) facts.push({ label: "Address", value: cand.address, source: src(cand.source_kind) });
  if (cand.type !== "travel_package") {
    facts.push({ label: "Price", value: cand.cost ? `${formatMoneyRange(cand.cost.min, cand.cost.max)} per person${cand.cost.kind === "price_level" ? " (estimate)" : ""}` : "Price not verified", source: cand.cost ? src(cand.cost.sourceKind) : "Unverified" });
    if (cand.rating != null) facts.push({ label: "Rating", value: `${Number(cand.rating).toFixed(1)}${cand.review_count ? ` (${cand.review_count.toLocaleString("en-US")} reviews)` : ""}`, source: src(cand.source_kind) });
    if (!cand.hours) facts.push({ label: "Hours", value: "Hours unavailable", source: "Unverified" });
  }
  const links: FinalSnapshot["links"] = [];
  if (cand.source_url) links.push({ label: cand.provider?.includes("google_maps") ? "Open in Google Maps" : "Website", url: cand.source_url });
  const website = (cand.attributes as { website?: string }).website;
  if (website && /^https?:\/\//.test(website)) links.push({ label: "Official site", url: website });
  const participants = bundle.members.map((m) => {
    const out = evaluation?.members.find((x) => x.memberId === m.id);
    const cost = out?.cost ? (out.cost.high != null ? formatMoney(out.cost.high) : out.cost.low != null ? `${formatMoney(out.cost.low)}+` : null) : null;
    return { name: m.display_name, color: m.color, cost };
  });
  if (cand.type === "travel_package") {
    for (const m of bundle.members) {
      const flights = bundle.components.filter((c) => c.candidate_id === cand.id && c.kind === "flight" && c.member_id === m.id && c.is_selected);
      for (const f of flights) {
        const d = f.data as { direction?: string; departAt?: number; arriveAt?: number };
        facts.push({
          label: `${m.display_name} · ${d.direction === "return" ? "Return" : "Outbound"}`,
          value: `${f.title}${d.departAt ? ` · departs ${formatDay(d.departAt, tz)} ${formatClock(d.departAt, tz)}` : ""}${d.arriveAt ? ` · arrives ${formatClock(d.arriveAt, tz)}` : ""}${f.cost?.max != null ? ` · ${formatMoney(f.cost.max)}` : ""}`,
          source: src(f.source_kind),
        });
        if (f.source_url) links.push({ label: `Flights for ${m.display_name}`, url: f.source_url });
      }
    }
    const hotel = bundle.components.find((c) => c.candidate_id === cand.id && c.kind === "hotel" && c.is_selected);
    if (hotel) {
      facts.push({ label: "Hotel", value: `${hotel.title}${hotel.cost?.max != null ? ` · ${formatMoney(hotel.cost.max)}/night` : ""}`, source: src(hotel.source_kind) });
      if (hotel.source_url) links.push({ label: "Hotel details", url: hotel.source_url });
    }
    const local = bundle.components.find((c) => c.candidate_id === cand.id && c.kind === "local_estimate" && c.is_selected);
    if (local) facts.push({ label: "Local costs", value: local.title, source: "Estimate" });
  }
  const blockers = evaluation ? [...evaluation.explanation.hardViolations] : [];
  return {
    headline: `${cand.title}${when ? ` · ${when}` : ""}`,
    candidateId,
    candidateTitle: cand.title,
    when,
    slot: evaluation?.slot ?? null,
    participants,
    facts,
    links: dedupeLinks(links),
    blockers,
    finalizedBy: organizerName,
  };
}

function dedupeLinks(links: FinalSnapshot["links"]) {
  const seen = new Set<string>();
  return links.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true))).slice(0, 12);
}

export async function finalizeAction(input: { planId: string; candidateId: string; expectedVersion: number; notes?: string; acknowledgeBlockers?: boolean }): Promise<ActionResult<{ version: number }>> {
  return run(async () => {
    const { supabase, viewer } = await requireAccount();
    const planId = z.string().uuid().parse(input.planId);
    const candidateId = z.string().uuid().parse(input.candidateId);
    const bundle = await loadPlanBundle(supabase, planId, viewer.userId);
    if (!bundle.isOrganizer) throw new ActionError("Only the organizer can finalize this plan.");
    const evaluation = evaluatePlan(toPlanInput(bundle)).evaluations.find((e) => e.candidateId === candidateId);
    if (!evaluation) throw new ActionError("That option is no longer active.");
    if (evaluation.status === "INFEASIBLE" && !input.acknowledgeBlockers) {
      throw new ActionError(`This option still breaks a hard requirement: ${evaluation.explanation.hardViolations.join("; ")}. Resolve it or confirm the exception.`);
    }
    const snapshot = buildSnapshot(bundle, candidateId, bundle.me?.display_name ?? "Organizer");
    const { data, error } = await supabase.rpc("finalize_plan", {
      p_plan: planId,
      p_candidate: candidateId,
      p_expected_version: input.expectedVersion,
      p_snapshot: snapshot,
      p_notes: input.notes?.trim().slice(0, 2000) || null,
    });
    if (error) throw new Error(error.message);
    after(() => emailExisting(planId, "plan_finalized"));
    return { version: Number(data) };
  });
}

export async function reopenAction(planId: string): Promise<ActionResult<null>> {
  return run(async () => {
    const { supabase } = await requireAccount();
    const { error } = await supabase.rpc("reopen_plan", { p_plan: z.string().uuid().parse(planId) });
    if (error) throw new Error(error.message);
    return null;
  });
}
