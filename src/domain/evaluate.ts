// Engine orchestration:
// 1 validate/normalize -> 2 viable windows -> 3 dimension + participant hard
// predicates -> 4 separate infeasible/unverified -> 5 soft scores -> 6 fairness
// -> 7 consensus (separate from model fit) -> 8 explanations from facts.
import { computeOverlap, respondedMemberIds, type OverlapResult } from "./availability";
import { activeConstraints } from "./constraints";
import { candidateConsensus, planConsensus } from "./consensus";
import { dateDimension, getDimension, searchWindows, slotRespectsDimensions } from "./dimensions";
import { candidateStatus, chooseSlot, memberHardChecks, planLevelChecks, worst } from "./feasibility";
import { formatMoney, formatMoneyRange } from "./money";
import { compareEvaluations, computeMetrics, memberSoftScores, satisfactionFrom } from "./scoring";
import { formatRange } from "./time";
import type {
  Candidate,
  CandidateEvaluation,
  DimensionStatus,
  Explanation,
  HardCheck,
  MemberOutcome,
  PlanConsensus,
  PlanInput,
  Slot,
} from "./types";

export interface PlanEvaluation {
  overlap: OverlapResult;
  search: Slot[];
  evaluations: CandidateEvaluation[];
  consensus: PlanConsensus;
  dimensionStatus: DimensionStatus[];
  responses: { total: number; responded: number; waiting: string[] };
  /** Violations of the LOCKED/CONSTRAINED invariant (should always be empty). */
  invariantViolations: string[];
}

export function evaluateCandidate(candidate: Candidate, input: PlanInput, overlap: OverlapResult, slotOverride?: Slot | null): CandidateEvaluation {
  const slot = slotOverride !== undefined ? slotOverride : chooseSlot(candidate, input, overlap);
  const hard = activeConstraints(input.constraints).filter((c) => c.strength === "hard");
  const planChecks = planLevelChecks(candidate, slot, input);
  const members: MemberOutcome[] = input.members.map((member) => {
    const { checks, scheduleLevel, cost, travelMinutes } = memberHardChecks(candidate, slot, member, input, hard);
    const { soft, categoryScores } = memberSoftScores(candidate, slot, { memberId: member.id, scheduleLevel, cost, travelMinutes }, input, input.reactions);
    const { satisfaction, lowConfidence } = satisfactionFrom(categoryScores);
    return {
      memberId: member.id,
      feasibility: worst(checks.map((c) => c.result)),
      hard: checks,
      soft,
      satisfaction,
      lowConfidence,
      categoryScores,
      scheduleLevel,
      cost,
      travelMinutes,
    };
  });
  const status = candidateStatus(planChecks, members.map((m) => m.hard));
  const allHard = [...planChecks, ...members.flatMap((m) => m.hard)];
  const failures = allHard.filter((c) => c.result === "FAIL").length;
  const unverified = allHard.filter((c) => c.result === "UNKNOWN" && !c.advisory).length;
  const metrics = computeMetrics(members, failures, unverified, input);
  const evaluation: CandidateEvaluation = {
    candidateId: candidate.id,
    status,
    slot,
    planChecks,
    members,
    metrics,
    rank: null,
    explanation: { positives: [], compromises: [], hardViolations: [], unknowns: [] },
    consensus: candidateConsensus(candidate.id, input.reactions),
  };
  evaluation.explanation = explain(candidate, evaluation, input);
  return evaluation;
}

export function evaluatePlan(input: PlanInput): PlanEvaluation {
  const search = searchWindows(input.dimensions, input.plan);
  const overlap = computeOverlap(input.members, input.availability, search, input.plan.minDurationMinutes);
  const titles = new Map(input.candidates.map((c) => [c.id, c.title]));
  const evaluations = input.candidates
    .filter((c) => c.status === "active")
    .map((c) => evaluateCandidate(c, input, overlap))
    .sort((a, b) => compareEvaluations(a, b, titles));
  let rank = 1;
  for (const e of evaluations) if (e.status === "FEASIBLE") e.rank = rank++;

  const invariantViolations: string[] = [];
  for (const e of evaluations) {
    const cand = input.candidates.find((c) => c.id === e.candidateId)!;
    // Only engine-chosen slots are automatic resolutions; fixed event times are checked as predicates.
    if (e.slot && !cand.startsAt && cand.type !== "travel_package") {
      for (const v of slotRespectsDimensions(e.slot, input.dimensions, input.plan)) invariantViolations.push(`${cand.title}: ${v.message}`);
    }
  }

  const responded = respondedMemberIds(input.members, input.availability);
  const respondedSet = new Set([...responded, ...input.members.filter((m) => m.respondedAt).map((m) => m.id)]);
  const consensus = planConsensus(evaluations, input.members, input.reactions);
  return {
    overlap,
    search,
    evaluations,
    consensus,
    dimensionStatus: dimensionStatuses(input, overlap, evaluations, consensus, respondedSet),
    responses: {
      total: input.members.length,
      responded: respondedSet.size,
      waiting: input.members.filter((m) => !respondedSet.has(m.id)).map((m) => m.id),
    },
    invariantViolations,
  };
}

// ---------------------------------------------------------------------------
// Explanations: generated only from evaluated facts.
// ---------------------------------------------------------------------------

function nameOf(input: PlanInput, memberId: string | null) {
  if (!memberId) return "Group";
  return input.members.find((m) => m.id === memberId)?.displayName ?? "Someone";
}

export function explain(candidate: Candidate, e: CandidateEvaluation, input: PlanInput): Explanation {
  const tz = input.plan.timezone;
  const n = input.members.length;
  const positives: string[] = [];
  const compromises: string[] = [];
  const hardViolations: string[] = [];
  const unknowns: string[] = [];

  const avail = e.members.map((m) => m.hard.find((h) => h.kind === "availability"));
  const availablePass = avail.filter((a) => a?.result === "PASS").length;
  if (e.slot && availablePass === n && n > 0) positives.push(`Everyone available ${formatRange(e.slot.start, e.slot.end, tz)}`);
  else if (e.slot && availablePass > 0) positives.push(`${availablePass} of ${n} available ${formatRange(e.slot.start, e.slot.end, tz)}`);

  const ideal = e.members.filter((m) => m.scheduleLevel === "ideal").length;
  if (ideal > 0 && ideal < n) positives.push(`${ideal} of ${n} call this time ideal`);
  if (ideal === n && n > 1) positives.push("Ideal time for everyone");

  const maxChecks = e.members.flatMap((m) => m.hard.filter((h) => h.kind === "max_budget"));
  if (maxChecks.length > 0 && maxChecks.every((h) => h.result === "PASS")) {
    positives.push(maxChecks.length === n ? "Everyone under max budget" : `All ${maxChecks.length} budget limits met`);
  }
  const bf = e.metrics.budgetFit;
  const prefCount = e.members.filter((m) => m.soft.some((s) => s.kind === "preferred_budget")).length;
  if (prefCount > 0 && bf.withinPreferred > 0) positives.push(`${bf.withinPreferred} of ${n} within preferred budget`);

  const nonstop = e.members.filter((m) => {
    const flights = candidate.components.filter((c) => c.kind === "flight" && c.memberId === m.memberId && c.isSelected);
    return flights.length > 0 && flights.every((f) => Number(f.data.stops ?? 0) === 0);
  }).length;
  if (candidate.type === "travel_package" && nonstop > 0) positives.push(`${nonstop} of ${n} have nonstop flights`);

  for (const pc of e.planChecks) {
    if (pc.result === "PASS" && ["cuisine", "plan_budget", "locked_place", "area", "hours", "nights", "dates"].includes(pc.kind)) {
      positives.push(pc.message + (pc.estimated ? " (estimate)" : ""));
    }
  }
  if (typeof candidate.rating === "number") {
    positives.push(`Rated ${candidate.rating.toFixed(1)}${candidate.reviewCount ? ` (${candidate.reviewCount.toLocaleString("en-US")} reviews)` : ""}`);
  }

  const memberCosts = e.members.map((m) => m.cost).filter((c): c is NonNullable<typeof c> => !!c);
  if (candidate.type === "travel_package" && memberCosts.length) {
    const highs = memberCosts.map((c) => c.high).filter((x): x is number => x != null);
    if (highs.length === memberCosts.length) {
      positives.push(`About ${formatMoneyRange(Math.min(...highs), Math.max(...highs))} per person${memberCosts.some((c) => c.estimated) ? " (includes estimates)" : ""}`);
    }
  }

  for (const m of e.members) {
    for (const s of m.soft) if (!s.met) compromises.push(`${nameOf(input, m.memberId)}: ${s.message}`);
    for (const h of m.hard) {
      if (h.result === "FAIL") hardViolations.push(`${nameOf(input, m.memberId)}: ${h.message}`);
      if (h.result === "UNKNOWN") unknowns.push(`${nameOf(input, m.memberId)}: ${h.message}`);
    }
  }
  for (const pc of e.planChecks) {
    if (pc.result === "FAIL") hardViolations.push(pc.message);
    if (pc.result === "UNKNOWN") unknowns.push(pc.message);
  }
  if (!candidate.cost && candidate.type !== "travel_package" && !unknowns.some((u) => u.includes("Price not verified"))) {
    unknowns.push("Price not verified");
  }
  return {
    positives: dedupe(positives),
    compromises: dedupe(compromises),
    hardViolations: dedupe(hardViolations),
    unknowns: dedupe(unknowns),
  };
}

function dedupe(list: string[]) {
  return [...new Set(list)];
}

// ---------------------------------------------------------------------------
// Resolution board statuses
// ---------------------------------------------------------------------------

function dimensionStatuses(
  input: PlanInput,
  overlap: OverlapResult,
  evaluations: CandidateEvaluation[],
  consensus: PlanConsensus,
  responded: Set<string>,
): DimensionStatus[] {
  const tz = input.plan.timezone;
  const out: DimensionStatus[] = [];
  const finalized = input.plan.status === "finalized";
  const leader = evaluations.find((e) => e.candidateId === consensus.leadingCandidateId) ?? evaluations[0];
  const leaderTitle = leader ? input.candidates.find((c) => c.id === leader.candidateId)?.title : undefined;
  const anyViable = evaluations.some((e) => e.status !== "INFEASIBLE");

  for (const dim of input.dimensions) {
    let progress: DimensionStatus["progress"] = dim.state === "LOCKED" ? "RESOLVED" : "OPEN";
    let summary = dim.display || (dim.state === "UNDECIDED" ? "Undecided" : "");
    let detail: string | undefined;
    const isWhen = dim === dateDimension(input.dimensions) || dim.key === "time";
    if (isWhen && input.plan.kind !== "travel") {
      const best = leader?.slot ?? overlap.best;
      if (best) {
        const availableCount = leader
          ? leader.members.filter((m) => m.hard.find((h) => h.kind === "availability")?.result === "PASS").length
          : overlap.best?.available.length ?? 0;
        detail = `${formatRange(best.start, best.end, tz)} · ${availableCount}/${input.members.length} available`;
        if (dim.state !== "LOCKED") progress = availableCount === input.members.length ? "RESOLVED" : "OPEN";
      } else if (overlap.respondedIds.length >= 2) {
        progress = "BLOCKED";
        detail = "No shared time among people who responded";
      } else {
        detail = "Waiting for availability";
      }
    }
    if ((dim.key === "place" || dim.key === "activity" || dim.key === "destination") && dim.state !== "LOCKED") {
      if (finalized) progress = "RESOLVED";
      else if (!evaluations.length) detail = input.plan.mode === "shortlist" ? "Add the options you're considering" : "No options yet";
      else if (!anyViable) {
        progress = "BLOCKED";
        detail = "Every option currently breaks a hard constraint";
      } else if (leaderTitle) detail = `Leading: ${leaderTitle}`;
    }
    if (dim.key === "budget" && dim.value?.type === "money" && dim.value.max != null && leader) {
      const over = leader.planChecks.find((c) => c.kind === "plan_budget" && c.result === "FAIL");
      if (over) progress = "BLOCKED";
      detail = over ? over.message : `≤ ${formatMoney(dim.value.max)}/person`;
    }
    if (finalized) progress = "RESOLVED";
    out.push({ key: dim.key, label: dim.label, state: dim.state, progress, summary, detail });
  }

  // WHO row (participants) — always present.
  out.push({
    key: "participants",
    label: "Who",
    state: "LOCKED",
    progress: responded.size === input.members.length && input.members.length > 0 ? "RESOLVED" : "OPEN",
    summary: `${input.members.length} participant${input.members.length === 1 ? "" : "s"}`,
    detail: `${responded.size} responded`,
  });
  if (!getDimension(input.dimensions, "budget")) {
    const anyBudget = activeConstraints(input.constraints).some((c) => c.kind === "max_budget" || c.kind === "preferred_budget");
    out.push({
      key: "budget",
      label: "Budget",
      state: "UNDECIDED",
      progress: anyBudget ? "OPEN" : "RESOLVED",
      summary: anyBudget ? "Individual limits" : "Not required",
    });
  }
  return out;
}

export function checkTitle(check: HardCheck, input: PlanInput): string {
  return check.memberId ? `${nameOf(input, check.memberId)}: ${check.message}` : check.message;
}
