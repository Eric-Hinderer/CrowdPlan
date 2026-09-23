// Make This Work / Resolve It. Consumes structured blockers, generates bounded
// candidate changes, re-runs EVERY hard predicate on each change, and ranks
// repairs by minimality (people affected, added cost, time shift). Locked
// choices are never silently changed: a repair that touches a locked value is
// returned as a question that needs confirmation.
import type { OverlapResult } from "./availability";
import { computeOverlap } from "./availability";
import { allowedDates, getDimension, searchWindows, timeBounds } from "./dimensions";
import { evaluateCandidate } from "./evaluate";
import { formatMoney } from "./money";
import { addDays, formatClockShort, formatDay, formatRange, formatTimeLabel, localDate, localMinutes, minutesOfDay, zonedInstant } from "./time";
import { flightOptions } from "./travel";
import type { Candidate, CandidateEvaluation, CandidateStatus, HardCheck, PlanInput, Slot } from "./types";

export type RepairChange =
  | { type: "shift_time"; candidateId: string; from: Slot | null; to: Slot; touchesLockedTime: boolean }
  | {
      type: "swap_flight";
      candidateId: string;
      memberId: string;
      direction: "outbound" | "return";
      fromComponentId: string | null;
      toComponentId: string;
      costDelta: number | null;
    };

export interface RepairProposal {
  candidateId: string;
  kind: "change" | "question";
  changes: RepairChange[];
  headline: string;
  summary: string;
  impacts: Array<{ memberId: string | null; text: string }>;
  costDelta: number;
  shiftMinutes: number;
  peopleAffected: number;
  resultStatus: CandidateStatus;
  remainingIssues: string[];
}

export interface RepairResult {
  candidateId: string;
  status: CandidateStatus;
  blockers: HardCheck[];
  proposals: RepairProposal[];
  noFixReason: string | null;
  /** The single smallest follow-up question, targeted at the people who can answer it. */
  focusedQuestion: { text: string; memberIds: string[] } | null;
  /** Alternatives the server may fetch (bounded) before trying again. */
  searchesNeeded: Array<{ memberId: string; direction: "outbound" | "return"; reason: string }>;
  evaluationsRun: number;
}

const MAX_EVALUATIONS = 400;
const SCHEDULE_KINDS = new Set(["availability", "earliest_start", "latest_end", "unavailable_day", "hours"]);
const FLIGHT_KINDS = new Set(["latest_arrival_home", "earliest_departure", "no_travel_day", "nonstop_only", "max_budget"]);

function nameOf(input: PlanInput, id: string | null) {
  return input.members.find((m) => m.id === id)?.displayName ?? "Someone";
}

function blockersOf(e: CandidateEvaluation): HardCheck[] {
  return [...e.planChecks, ...e.members.flatMap((m) => m.hard)].filter((c) => c.result === "FAIL");
}

function withSelectedFlight(candidate: Candidate, memberId: string, direction: "outbound" | "return", componentId: string): Candidate {
  return {
    ...candidate,
    components: candidate.components.map((c) =>
      c.kind === "flight" && c.memberId === memberId && c.data.direction === direction ? { ...c, isSelected: c.id === componentId } : c,
    ),
  };
}

function memberFails(e: CandidateEvaluation, memberId: string) {
  return e.members.find((m) => m.memberId === memberId)?.hard.filter((h) => h.result === "FAIL") ?? [];
}

export function makeThisWork(candidateId: string, input: PlanInput, overlapIn?: OverlapResult): RepairResult {
  const candidate = input.candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error("Unknown candidate");
  const overlap = overlapIn ?? computeOverlap(input.members, input.availability, searchWindows(input.dimensions, input.plan), input.plan.minDurationMinutes);
  const base = evaluateCandidate(candidate, input, overlap);
  const blockers = blockersOf(base);
  let evaluationsRun = 1;
  const result: RepairResult = {
    candidateId,
    status: base.status,
    blockers,
    proposals: [],
    noFixReason: null,
    focusedQuestion: null,
    searchesNeeded: [],
    evaluationsRun,
  };

  if (blockers.length === 0) {
    const unknowns = [...base.planChecks, ...base.members.flatMap((m) => m.hard)].filter((c) => c.result === "UNKNOWN" && !c.advisory);
    if (unknowns.length === 0) {
      result.noFixReason = null;
      return result;
    }
    // Only unknowns: ask the one question that would verify the most.
    const waiting = unknowns.filter((u) => u.kind === "availability").map((u) => u.memberId!).filter(Boolean);
    if (waiting.length) {
      result.focusedQuestion = { text: `Waiting on availability from ${waiting.map((id) => nameOf(input, id)).join(", ")}.`, memberIds: waiting };
    } else {
      const u = unknowns[0];
      result.focusedQuestion = {
        text: u.memberId ? `${nameOf(input, u.memberId)}: ${u.message}. Can someone check?` : `${u.message}. Can someone check?`,
        memberIds: u.memberId ? [u.memberId] : [],
      };
    }
    return result;
  }

  const unfixable = blockers.filter(
    (b) => !SCHEDULE_KINDS.has(b.kind) && !(candidate.type === "travel_package" && FLIGHT_KINDS.has(b.kind)),
  );
  if (unfixable.length > 0) {
    result.noFixReason = `No change CrowdPlan can make fixes this: ${unfixable.map((b) => (b.memberId ? `${nameOf(input, b.memberId)} — ${b.message}` : b.message)).join("; ")}.`;
    result.focusedQuestion = focusedQuestionFor(unfixable, input, candidate);
    return result;
  }

  // ---- Travel: swap flights for the people who are blocked -----------------
  if (candidate.type === "travel_package") {
    const blockedMembers = [...new Set(blockers.map((b) => b.memberId).filter((x): x is string => !!x))];
    let working = candidate;
    const changes: RepairChange[] = [];
    const impacts: RepairProposal["impacts"] = [];
    let totalDelta = 0;
    let solvedAll = true;
    for (const memberId of blockedMembers) {
      const fails = memberFails(base, memberId);
      const directions: Array<"outbound" | "return"> = [];
      if (fails.some((f) => f.kind === "latest_arrival_home")) directions.push("return");
      if (fails.some((f) => f.kind === "earliest_departure")) directions.push("outbound");
      if (fails.some((f) => ["no_travel_day", "nonstop_only", "max_budget"].includes(f.kind))) {
        if (!directions.includes("outbound")) directions.push("outbound");
        if (!directions.includes("return")) directions.push("return");
      }
      let best: { cand: Candidate; change: RepairChange; delta: number; eval: CandidateEvaluation } | null = null;
      for (const direction of directions) {
        const current = working.components.find((c) => c.kind === "flight" && c.memberId === memberId && c.data.direction === direction && c.isSelected);
        const options = flightOptions(working, memberId, direction).filter((o) => o.id !== current?.id);
        if (options.length === 0) {
          result.searchesNeeded.push({ memberId, direction, reason: `No cached ${direction} alternatives for ${nameOf(input, memberId)}` });
          continue;
        }
        for (const option of options) {
          if (evaluationsRun >= MAX_EVALUATIONS) break;
          const trial = withSelectedFlight(working, memberId, direction, option.id);
          const trialInput = { ...input, candidates: input.candidates.map((c) => (c.id === candidateId ? trial : c)) };
          const ev = evaluateCandidate(trial, trialInput, overlap);
          evaluationsRun++;
          if (memberFails(ev, memberId).length > 0) continue; // every predicate re-checked, incl. max budget
          const delta = (option.cost?.max ?? option.cost?.min ?? 0) - (current?.cost?.max ?? current?.cost?.min ?? 0);
          if (!best || delta < best.delta) {
            best = {
              cand: trial,
              eval: ev,
              delta,
              change: { type: "swap_flight", candidateId, memberId, direction, fromComponentId: current?.id ?? null, toComponentId: option.id, costDelta: delta },
            };
          }
        }
      }
      if (!best) {
        solvedAll = false;
        continue;
      }
      working = best.cand;
      changes.push(best.change);
      totalDelta += best.delta;
      const opt = working.components.find((c) => c.id === (best!.change as { toComponentId: string }).toComponentId)!;
      const member = input.members.find((m) => m.id === memberId)!;
      const arrive = opt.data.arriveAt as number | undefined;
      const when = arrive
        ? (best.change as { direction: string }).direction === "return"
          ? `arrives ${formatClockShort(arrive, input.plan.timezone)}, home ~${formatClockShort(arrive + member.homeBufferMinutes * 60000, input.plan.timezone)}`
          : `departs ${formatClockShort(opt.data.departAt as number, input.plan.timezone)}`
        : opt.title;
      impacts.push({
        memberId,
        text: `${member.displayName} takes ${(best.change as { direction: string }).direction === "return" ? "an earlier return" : "a different outbound"} flight (${when}); ${best.delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(best.delta))} for ${member.displayName}`,
      });
    }
    if (changes.length > 0) {
      const finalInput = { ...input, candidates: input.candidates.map((c) => (c.id === candidateId ? working : c)) };
      const finalEval = evaluateCandidate(working, finalInput, overlap);
      evaluationsRun++;
      const remaining = blockersOf(finalEval);
      result.proposals.push({
        candidateId,
        kind: "change",
        changes,
        headline: remaining.length === 0 ? `${candidate.title} can work.` : `${candidate.title} gets closer.`,
        summary:
          remaining.length === 0
            ? `${impacts.map((i) => i.text).join(". ")}. All hard constraints now satisfied.`
            : `${impacts.map((i) => i.text).join(". ")}. Still blocked: ${remaining.map((r) => r.message).join("; ")}.`,
        impacts,
        costDelta: totalDelta,
        shiftMinutes: 0,
        peopleAffected: changes.length,
        resultStatus: finalEval.status,
        remainingIssues: remaining.map((r) => r.message),
      });
    }
    if (!solvedAll && result.proposals.length === 0) {
      result.noFixReason = result.searchesNeeded.length
        ? "No saved alternative flights fix this yet. CrowdPlan can look for nearby options within the plan's search budget."
        : "None of the available alternatives satisfy every hard constraint (including maximum budgets).";
      result.focusedQuestion = focusedQuestionFor(blockers, input, candidate);
    }
    result.evaluationsRun = evaluationsRun;
    return result;
  }

  // ---- Activities/dinners: shift the time ----------------------------------
  const tz = input.plan.timezone;
  const duration = base.slot ? base.slot.end - base.slot.start : input.plan.minDurationMinutes * 60000;
  const timeDim = getDimension(input.dimensions, "time");
  const lockedTime = timeDim?.state === "LOCKED";
  const bounds = timeBounds(
    // Search the whole reasonable day when the time is locked; any result becomes a question.
    lockedTime ? input.dimensions.filter((d) => d.key !== "time") : input.dimensions,
    input.plan.kind,
  );
  const origin = base.slot?.start ?? null;
  const dates = allowedDates(input.dimensions, input.plan);
  const orderedDates = origin ? [localDate(origin, tz), ...dates.filter((d) => d !== localDate(origin, tz))] : dates;
  const trials: Array<{ slot: Slot; ev: CandidateEvaluation; shift: number }> = [];
  for (const date of orderedDates) {
    const ws = minutesOfDay(bounds.window.start);
    let we = bounds.window.end === "24:00" ? 1440 : minutesOfDay(bounds.window.end);
    if (we <= ws) we += 1440;
    // Social plans start on the hour or half hour.
    for (let m = Math.ceil(ws / 30) * 30; m + duration / 60000 <= we; m += 30) {
      if (evaluationsRun >= MAX_EVALUATIONS) break;
      const d = m >= 1440 ? addDays(date, 1) : date;
      const start = zonedInstant(d, `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, tz);
      if (origin != null && start === origin) continue;
      const slot = { start, end: start + duration };
      const trial: Candidate = candidate.startsAt ? { ...candidate, startsAt: slot.start, endsAt: slot.end } : candidate;
      const trialInput = candidate.startsAt ? { ...input, candidates: input.candidates.map((c) => (c.id === candidateId ? trial : c)) } : input;
      const ev = evaluateCandidate(trial, trialInput, overlap, slot);
      evaluationsRun++;
      if (ev.status !== "INFEASIBLE") trials.push({ slot, ev, shift: origin == null ? 0 : Math.round(Math.abs(start - origin) / 60000) });
    }
  }
  trials.sort((a, b) => (a.ev.status === "FEASIBLE" ? 0 : 1) - (b.ev.status === "FEASIBLE" ? 0 : 1) || a.shift - b.shift || a.slot.start - b.slot.start);
  for (const t of trials.slice(0, 2)) {
    const sameDay = origin != null && localDate(origin, tz) === localDate(t.slot.start, tz);
    const touchesLocked = lockedTime || (!!candidate.startsAt && sameDay === false);
    const when = sameDay ? formatClockShort(t.slot.start, tz) : `${formatDay(t.slot.start, tz)} at ${formatClockShort(t.slot.start, tz)}`;
    const blockerNames = [...new Set(blockers.map((b) => b.memberId).filter((x): x is string => !!x))].map((id) => nameOf(input, id));
    result.proposals.push({
      candidateId,
      kind: "question",
      changes: [{ type: "shift_time", candidateId, from: base.slot, to: t.slot, touchesLockedTime: touchesLocked }],
      headline: `Would everyone be okay starting at ${when}?`,
      summary: `${candidate.title} ${formatRange(t.slot.start, t.slot.end, tz)} works for ${blockerNames.length ? blockerNames.join(", ") : "everyone"}${t.ev.status === "FEASIBLE" ? "; all hard constraints satisfied" : "; some facts still unverified"}.`,
      impacts: [{ memberId: null, text: origin ? `${t.shift} min ${t.slot.start > origin ? "later" : "earlier"} for everyone` : "New time for everyone" }],
      costDelta: 0,
      shiftMinutes: t.shift,
      peopleAffected: input.members.length,
      resultStatus: t.ev.status,
      remainingIssues: t.ev.explanation.unknowns,
    });
  }
  if (result.proposals.length === 0) {
    result.noFixReason = "No time within the plan's date and time limits works for every required person.";
    result.focusedQuestion = focusedQuestionFor(blockers, input, candidate);
  }
  result.evaluationsRun = evaluationsRun;
  return result;
}

/** The smallest useful question: ask only the people whose answer could unblock it. */
function focusedQuestionFor(blockers: HardCheck[], input: PlanInput, candidate: Candidate): { text: string; memberIds: string[] } | null {
  const byMember = new Map<string, HardCheck[]>();
  for (const b of blockers) if (b.memberId) byMember.set(b.memberId, [...(byMember.get(b.memberId) ?? []), b]);
  if (byMember.size === 1) {
    const [memberId, checks] = [...byMember.entries()][0];
    const name = nameOf(input, memberId);
    const budget = checks.find((c) => c.kind === "max_budget" && c.delta?.amount != null);
    const limit = budget ? input.constraints.find((c) => c.id === budget.constraintId) : null;
    if (budget && limit) {
      const max = Number((limit.params as { amount: number }).amount);
      if (budget.delta!.amount! <= max * 0.2) {
        return { text: `${name}, could ${formatMoney(max + budget.delta!.amount!)} work for ${candidate.title}? It's ${formatMoney(budget.delta!.amount!)} over your max.`, memberIds: [memberId] };
      }
    }
    const avail = checks.find((c) => c.kind === "availability");
    if (avail) return { text: `${name}, is there any way ${avail.message.replace(/^Not available |^Hasn't marked | as available$/g, "")} could work?`, memberIds: [memberId] };
    const early = checks.find((c) => c.kind === "earliest_start" || c.kind === "latest_end");
    if (early) return { text: `${name}: ${early.message}. Is that firm?`, memberIds: [memberId] };
  }
  const planBudget = blockers.find((b) => b.kind === "plan_budget");
  if (planBudget) return { text: `${candidate.title} is over the plan budget. Keep it in the running or drop it?`, memberIds: input.members.filter((m) => m.role === "organizer").map((m) => m.id) };
  return null;
}

export function describeChange(change: RepairChange, input: PlanInput): string {
  const tz = input.plan.timezone;
  if (change.type === "shift_time") {
    return `Move to ${formatRange(change.to.start, change.to.end, tz)}${change.touchesLockedTime ? " (changes a locked time — needs confirmation)" : ""}`;
  }
  return `${nameOf(input, change.memberId)}: switch ${change.direction} flight${change.costDelta != null ? ` (${change.costDelta >= 0 ? "+" : "−"}${formatMoney(Math.abs(change.costDelta))})` : ""}`;
}

export function localTimeLabel(instant: number, tz: string) {
  return formatTimeLabel(`${String(Math.floor(localMinutes(instant, tz) / 60)).padStart(2, "0")}:${String(localMinutes(instant, tz) % 60).padStart(2, "0")}`);
}
