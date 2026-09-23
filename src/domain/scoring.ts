// Soft preferences, satisfaction and fairness. Only candidates that pass all
// required hard constraints receive a normal rank; soft scores never
// compensate for a hard failure.
import { activeConstraints } from "./constraints";
import { candidateCuisines, memberTravelMinutes } from "./feasibility";
import { formatMoney, preferredBudgetScore } from "./money";
import { formatClockShort, formatTimeLabel, localDate, localMinutes, localWeekday, minutesOfDay } from "./time";
import { selectedFlights } from "./travel";
import type {
  Candidate,
  CandidateEvaluation,
  MemberOutcome,
  PlanInput,
  RankingMetrics,
  Reaction,
  ReactionKind,
  ScoreCategory,
  Slot,
  SoftCheck,
} from "./types";

/** Documented category weights (DECISIONS.md). Missing categories are excluded, not zeroed. */
export const SCORE_WEIGHTS: Record<ScoreCategory, number> = {
  schedule: 0.25,
  cost: 0.2,
  travel: 0.15,
  preference: 0.2,
  quality: 0.1,
  vote: 0.1,
};

/** Fairness blend: the least-satisfied person weighs almost as much as the average. */
export const FAIRNESS = { average: 0.55, minimum: 0.45 };
export const NEUTRAL_SATISFACTION = 60;

export const REACTION_SCORE: Record<ReactionKind, number> = {
  love: 1,
  works: 0.75,
  acceptable: 0.5,
  rather_not: 0.2,
  cant: 0,
};

export function groupFit(average: number, minimum: number): number {
  return Math.round(FAIRNESS.average * average + FAIRNESS.minimum * minimum);
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function travelScore(minutes: number | null, preferredMax: number | null): number | null {
  if (minutes == null) return null;
  const good = preferredMax ?? 15;
  const bad = Math.max(good + 20, 60);
  if (minutes <= good) return 100;
  if (minutes >= bad) return 0;
  return Math.round(100 - ((minutes - good) / (bad - good)) * 100);
}

export interface SoftResult {
  soft: SoftCheck[];
  categoryScores: Partial<Record<ScoreCategory, number>>;
}

export function memberSoftScores(
  candidate: Candidate,
  slot: Slot | null,
  outcome: Pick<MemberOutcome, "memberId" | "scheduleLevel" | "cost" | "travelMinutes">,
  input: PlanInput,
  reactions: Reaction[],
): SoftResult {
  const tz = input.plan.timezone;
  const soft: SoftCheck[] = [];
  const scores: Partial<Record<ScoreCategory, number>> = {};
  const prefs: number[] = [];
  const member = input.members.find((m) => m.id === outcome.memberId)!;
  const mine = activeConstraints(input.constraints).filter(
    (c) => c.strength === "soft" && (c.memberId === member.id || c.memberId === null),
  );

  if (outcome.scheduleLevel === "ideal") scores.schedule = 100;
  else if (outcome.scheduleLevel === "works") scores.schedule = 70;

  let preferredTravel: number | null = null;
  for (const c of mine) {
    const p = c.params as Record<string, never>;
    const base = { kind: c.kind, memberId: member.id, constraintId: c.id };
    switch (c.kind) {
      case "preferred_budget": {
        const { score, over } = preferredBudgetScore(outcome.cost?.low ?? null, outcome.cost?.high ?? null, p.amount);
        if (score != null) scores.cost = score;
        if (over > 0) soft.push({ ...base, met: false, message: `${formatMoney(over)} above preferred budget` });
        else if (score != null) soft.push({ ...base, met: true, message: `Within preferred ${formatMoney(p.amount)}` });
        break;
      }
      case "cuisine_preference": {
        if (candidate.type !== "restaurant") break;
        const cats = candidateCuisines(candidate);
        if (cats.length === 0) break;
        const hit = (p.cuisines as string[]).find((x) => cats.some((cat) => cat.includes(x.toLowerCase())));
        if (p.mode === "prefer") {
          prefs.push(hit ? 100 : 45);
          soft.push({ ...base, met: !!hit, message: hit ? `Matches ${hit}` : `Not their preferred ${(p.cuisines as string[]).join("/")}` });
        } else {
          prefs.push(hit ? 15 : 100);
          if (hit) soft.push({ ...base, met: false, message: `Would rather avoid ${hit}` });
        }
        break;
      }
      case "avoid_area": {
        const area = String(p.area).toLowerCase();
        const inArea = (candidate.address ?? "").toLowerCase().includes(area) || candidate.categories.some((x) => x.toLowerCase().includes(area));
        prefs.push(inArea ? 30 : 100);
        if (inArea) soft.push({ ...base, met: false, message: `Would rather avoid ${String(p.area)}` });
        break;
      }
      case "max_travel_minutes": {
        preferredTravel = p.minutes;
        const mins = outcome.travelMinutes ?? memberTravelMinutes(candidate, member);
        if (mins != null && mins > p.minutes) soft.push({ ...base, met: false, message: `~${mins} min away (prefers ≤${p.minutes})` });
        break;
      }
      case "day_preference": {
        if (!slot) break;
        const day = localWeekday(slot.start, tz);
        const matches = p.date ? localDate(slot.start, tz) === p.date : p.weekday === day;
        const label = p.date ?? p.weekday;
        if (p.prefer) {
          prefs.push(matches ? 100 : 55);
          soft.push({ ...base, met: matches, message: matches ? `Their preferred day` : `Prefers ${label}` });
        } else {
          prefs.push(matches ? 30 : 100);
          if (matches) soft.push({ ...base, met: false, message: `Would rather not do ${label}` });
        }
        break;
      }
      case "earliest_start": {
        if (!slot) break;
        const ok = localMinutes(slot.start, tz) >= minutesOfDay(p.time);
        prefs.push(ok ? 100 : 40);
        if (!ok) soft.push({ ...base, met: false, message: `Would rather start after ${formatTimeLabel(p.time)} (starts ${formatClockShort(slot.start, tz)})` });
        break;
      }
      case "latest_end": {
        if (!slot) break;
        const endMin = localMinutes(slot.start, tz) + Math.round((slot.end - slot.start) / 60000);
        const ok = endMin <= minutesOfDay(p.time);
        prefs.push(ok ? 100 : 40);
        if (!ok) soft.push({ ...base, met: false, message: `Would rather be done by ${formatTimeLabel(p.time)}` });
        break;
      }
      case "nonstop_only": {
        const flights = selectedFlights(candidate, member.id);
        if (flights.length === 0) break;
        const stops = flights.reduce((s, f) => s + Number(f.data.stops ?? 0), 0);
        prefs.push(stops === 0 ? 100 : 50);
        soft.push({ ...base, met: stops === 0, message: stops === 0 ? "Nonstop both ways" : `${stops} stop${stops > 1 ? "s" : ""} (prefers nonstop)` });
        break;
      }
      default:
        break;
    }
  }

  const t = travelScore(outcome.travelMinutes, preferredTravel);
  if (t != null) scores.travel = t;
  if (prefs.length) scores.preference = Math.round(prefs.reduce((a, b) => a + b, 0) / prefs.length);
  if (typeof candidate.rating === "number") scores.quality = clamp(Math.round(((candidate.rating - 3) / 2) * 100));
  const reaction = reactions.find((r) => r.candidateId === candidate.id && r.memberId === member.id);
  if (reaction) scores.vote = Math.round(REACTION_SCORE[reaction.reaction] * 100);

  return { soft, categoryScores: scores };
}

export function satisfactionFrom(scores: Partial<Record<ScoreCategory, number>>): { satisfaction: number; lowConfidence: boolean } {
  let total = 0;
  let weight = 0;
  for (const [k, v] of Object.entries(scores) as Array<[ScoreCategory, number]>) {
    total += SCORE_WEIGHTS[k] * v;
    weight += SCORE_WEIGHTS[k];
  }
  if (weight === 0) return { satisfaction: NEUTRAL_SATISFACTION, lowConfidence: true };
  return { satisfaction: Math.round(total / weight), lowConfidence: weight < 0.3 };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function computeMetrics(members: MemberOutcome[], hardFailures: number, unverified: number, input: PlanInput): RankingMetrics {
  const sats = members.map((m) => m.satisfaction);
  const average = sats.length ? Math.round(sats.reduce((a, b) => a + b, 0) / sats.length) : 0;
  const minimum = sats.length ? Math.min(...sats) : 0;
  const soft = members.reduce((n, m) => n + m.soft.filter((s) => !s.met).length, 0);
  const idealMatchCount = members.filter((m) => m.scheduleLevel === "ideal" && m.soft.every((s) => s.met)).length;
  const active = activeConstraints(input.constraints);
  const budgetFit = { withinPreferred: 0, withinMax: 0, overPreferred: 0, unknown: 0 };
  for (const m of members) {
    if (!m.cost || (m.cost.low == null && m.cost.high == null)) budgetFit.unknown++;
    const maxCheck = m.hard.find((h) => h.kind === "max_budget");
    if (maxCheck?.result === "PASS") budgetFit.withinMax++;
    const pref = m.soft.find((s) => s.kind === "preferred_budget");
    if (pref?.met) budgetFit.withinPreferred++;
    else if (pref && !pref.met) budgetFit.overPreferred++;
    else if (!active.some((c) => c.kind === "preferred_budget" && c.memberId === m.memberId) && maxCheck?.result === "PASS") budgetFit.withinPreferred++;
  }
  const mins = members.map((m) => m.travelMinutes).filter((x): x is number => x != null);
  return {
    averageSatisfaction: average,
    minimumSatisfaction: minimum,
    groupFit: groupFit(average, minimum),
    idealMatchCount,
    hardCompromises: hardFailures,
    softCompromises: soft,
    unverifiedChecks: unverified,
    budgetFit,
    convenience: mins.length ? { min: Math.min(...mins), median: median(mins), max: Math.max(...mins) } : null,
  };
}

function highCost(e: CandidateEvaluation): number {
  const highs = e.members.map((m) => m.cost?.high ?? m.cost?.low ?? Infinity);
  return highs.length ? Math.max(...highs) : Infinity;
}

/**
 * Deterministic ordering: FEASIBLE by group fit (fairness-weighted), then the
 * least-satisfied person, ideal matches, fewer soft compromises, lower cost,
 * title and id. UNVERIFIED follow (unranked), then INFEASIBLE by fewest failures.
 */
export function compareEvaluations(a: CandidateEvaluation, b: CandidateEvaluation, titles: Map<string, string>): number {
  const order = { FEASIBLE: 0, UNVERIFIED: 1, INFEASIBLE: 2 } as const;
  if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
  if (a.status === "INFEASIBLE" && a.metrics.hardCompromises !== b.metrics.hardCompromises) {
    return a.metrics.hardCompromises - b.metrics.hardCompromises;
  }
  if (a.status === "UNVERIFIED" && a.metrics.unverifiedChecks !== b.metrics.unverifiedChecks) {
    return a.metrics.unverifiedChecks - b.metrics.unverifiedChecks;
  }
  return (
    b.metrics.groupFit - a.metrics.groupFit ||
    b.metrics.minimumSatisfaction - a.metrics.minimumSatisfaction ||
    b.metrics.idealMatchCount - a.metrics.idealMatchCount ||
    a.metrics.softCompromises - b.metrics.softCompromises ||
    highCost(a) - highCost(b) ||
    (titles.get(a.candidateId) ?? "").localeCompare(titles.get(b.candidateId) ?? "") ||
    a.candidateId.localeCompare(b.candidateId)
  );
}
