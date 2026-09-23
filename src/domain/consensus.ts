// Consensus reflects structured reactions only. It is an alignment signal,
// not a scientific measurement, and incomplete responses are never unanimity.
import { REACTION_SCORE } from "./scoring";
import type {
  CandidateConsensus,
  CandidateEvaluation,
  Constraint,
  ConstraintKind,
  Member,
  ObjectionReason,
  PlanConsensus,
  Reaction,
  ReactionKind,
  Strength,
} from "./types";

export const REACTION_LABELS: Record<ReactionKind, string> = {
  love: "Love it",
  works: "Works for me",
  acceptable: "Acceptable",
  rather_not: "Rather not",
  cant: "Can't do this",
};

export const OBJECTION_REASONS: Record<ObjectionReason, string> = {
  price: "Price",
  schedule: "Schedule",
  place: "The place itself",
  distance: "Distance",
  transportation: "Getting there",
  accessibility: "Accessibility",
  other: "Something else",
};

export function candidateConsensus(candidateId: string, reactions: Reaction[]): CandidateConsensus {
  const counts: Record<ReactionKind, number> = { love: 0, works: 0, acceptable: 0, rather_not: 0, cant: 0 };
  const mine = reactions.filter((r) => r.candidateId === candidateId);
  for (const r of mine) counts[r.reaction]++;
  const alignment = mine.length ? mine.reduce((s, r) => s + REACTION_SCORE[r.reaction], 0) / mine.length : null;
  return {
    counts,
    respondents: mine.length,
    alignment: alignment == null ? null : Math.round(alignment * 100) / 100,
    objections: mine.filter((r) => r.reaction === "cant").map((r) => ({ memberId: r.memberId, reason: r.reason ?? null, note: r.note ?? null })),
  };
}

export function planConsensus(evaluations: CandidateEvaluation[], members: Member[], reactions: Reaction[]): PlanConsensus {
  const active = evaluations.filter((e) => e.status !== "INFEASIBLE");
  if (evaluations.length === 0) {
    return { state: "no_options", label: "No options yet", leadingCandidateId: null, waitingOn: [] };
  }
  // Leader: the candidate with the best reaction alignment among the top feasible/unverified ones,
  // falling back to engine rank.
  const pool = active.length ? active : evaluations;
  const withVotes = pool.filter((e) => e.consensus.respondents > 0);
  const leader = withVotes.length
    ? [...withVotes].sort(
        (a, b) =>
          (b.consensus.alignment ?? 0) * b.consensus.respondents - (a.consensus.alignment ?? 0) * a.consensus.respondents ||
          (a.rank ?? 999) - (b.rank ?? 999),
      )[0]
    : pool[0];
  const reacted = new Set(reactions.filter((r) => r.candidateId === leader.candidateId).map((r) => r.memberId));
  const waitingOn = members.filter((m) => !reacted.has(m.id)).map((m) => m.id);
  const c = leader.consensus;
  const total = members.length;

  if (c.counts.cant > 0) {
    return { state: "objection", label: `${c.counts.cant} can't do the leading option`, leadingCandidateId: leader.candidateId, waitingOn };
  }
  if (c.respondents === 0 || c.respondents / Math.max(1, total) < 0.5) {
    return { state: "gathering", label: `Waiting on ${waitingOn.length} of ${total}`, leadingCandidateId: leader.candidateId, waitingOn };
  }
  const positive = c.counts.love + c.counts.works;
  if (c.respondents === total && positive === total && leader.status === "FEASIBLE") {
    return { state: "strong", label: "Strong alignment", leadingCandidateId: leader.candidateId, waitingOn };
  }
  if ((c.alignment ?? 0) >= 0.6 && c.counts.rather_not <= 1) {
    return {
      state: "leaning",
      label: waitingOn.length ? `Leaning — waiting on ${waitingOn.length}` : "Leaning toward one option",
      leadingCandidateId: leader.candidateId,
      waitingOn,
    };
  }
  return { state: "split", label: "Split — worth a quick compromise", leadingCandidateId: leader.candidateId, waitingOn };
}

export interface ObjectionDiagnosis {
  /** true if an existing active hard constraint already explains the objection */
  alreadyExplained: boolean;
  explainedBy?: string;
  /** Proposed constraint to confirm; NEVER applied without confirmation. */
  proposal: { kind: ConstraintKind; strength: Strength; params: Record<string, unknown>; prompt: string } | null;
  question: string;
}

/**
 * Diagnose a CAN'T DO THIS reaction. Returns a proposal the member must
 * confirm before it becomes an active hard constraint.
 */
export function diagnoseObjection(
  reaction: Reaction,
  evaluation: CandidateEvaluation | undefined,
  candidateTitle: string,
  existing: Constraint[],
): ObjectionDiagnosis {
  const outcome = evaluation?.members.find((m) => m.memberId === reaction.memberId);
  const failing = outcome?.hard.find((h) => h.result === "FAIL");
  if (failing) {
    return { alreadyExplained: true, explainedBy: failing.message, proposal: null, question: `Already accounted for: ${failing.message}.` };
  }
  const cost = outcome?.cost;
  switch (reaction.reason) {
    case "price": {
      const hasMax = existing.some((c) => c.memberId === reaction.memberId && c.kind === "max_budget" && c.status === "active");
      const suggested = cost?.low != null ? Math.max(5, Math.floor(cost.low * 0.9)) : 30;
      return {
        alreadyExplained: false,
        proposal: {
          kind: "max_budget",
          strength: "hard",
          params: { amount: suggested, currency: "USD" },
          prompt: hasMax ? `Lower your maximum to $${suggested}?` : `Set a hard maximum of $${suggested} per person?`,
        },
        question: `What's the most you can spend? ${candidateTitle} looks like ${cost?.low != null ? `$${Math.round(cost.low)}+` : "an unverified price"}.`,
      };
    }
    case "place":
      return {
        alreadyExplained: false,
        proposal: {
          kind: "exclude_candidate",
          strength: "hard",
          params: { candidateId: reaction.candidateId, title: candidateTitle },
          prompt: `Rule out ${candidateTitle} for you entirely?`,
        },
        question: `Should ${candidateTitle} be off the table for you?`,
      };
    case "distance": {
      const mins = outcome?.travelMinutes;
      const suggested = mins != null ? Math.max(5, mins - 5) : 20;
      return {
        alreadyExplained: false,
        proposal: {
          kind: "max_travel_minutes",
          strength: "hard",
          params: { minutes: suggested },
          prompt: `Set a hard limit of ${suggested} minutes of travel?`,
        },
        question: `How far is too far? ${mins != null ? `${candidateTitle} is ~${mins} min from you (estimate).` : ""}`.trim(),
      };
    }
    case "accessibility":
      return {
        alreadyExplained: false,
        proposal: { kind: "accessibility", strength: "hard", params: { need: "wheelchair accessible" }, prompt: "Require wheelchair accessibility?" },
        question: "What accessibility need should every option meet?",
      };
    case "schedule":
      return {
        alreadyExplained: false,
        proposal: null,
        question: "Update your availability so CrowdPlan knows which times don't work.",
      };
    case "transportation":
      return {
        alreadyExplained: false,
        proposal: { kind: "nonstop_only", strength: "hard", params: {}, prompt: "Require nonstop flights?" },
        question: "Is it the route or the way to get there? Tell the group what would work.",
      };
    default:
      return { alreadyExplained: false, proposal: null, question: "Add a note so the group knows what would work instead." };
  }
}
