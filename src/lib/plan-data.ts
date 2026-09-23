// Isomorphic plan loader: the same queries run on the server (first render)
// and in the browser (realtime refetch), always under the viewer's RLS.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AvailabilityWindow,
  Candidate,
  Component,
  Constraint,
  Dimension,
  Member,
  Money,
  PlanInput,
  Reaction,
  WeeklyHours,
} from "@/domain/types";

export interface PlanRow {
  id: string;
  owner_id: string;
  title: string;
  raw_input: string | null;
  kind: "activity" | "dinner" | "travel";
  mode: "fixed" | "criteria" | "shortlist" | "discovery";
  discovery_enabled: boolean;
  status: "collecting" | "finalized" | "archived";
  timezone: string;
  location_label: string | null;
  location_lat: number | null;
  location_lng: number | null;
  min_duration_minutes: number;
  decide_by: string | null;
  share_code: string;
  search_budget: number;
  searches_used: number;
  version: number;
  finalized_candidate_id: string | null;
  finalized_at: string | null;
  final_snapshot: FinalSnapshot | null;
  final_notes: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemberRow {
  id: string;
  plan_id: string;
  user_id: string;
  role: "organizer" | "guest";
  display_name: string;
  color: string;
  emoji: string | null;
  origin_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  home_buffer_minutes: number;
  responded_at: string | null;
  joined_at: string;
}

export interface ConstraintRow {
  id: string;
  plan_id: string;
  member_id: string | null;
  kind: Constraint["kind"];
  strength: Constraint["strength"];
  params: Record<string, unknown>;
  status: Constraint["status"];
  source: string;
  source_text: string | null;
  label: string | null;
  created_at: string;
}

export interface ClarificationRow {
  id: string;
  plan_id: string;
  member_id: string | null;
  source_text: string;
  question: string;
  options: Array<{ label: string; constraint: { kind: Constraint["kind"]; strength: Constraint["strength"]; params: Record<string, unknown> } | null }>;
  status: "open" | "resolved" | "dismissed";
  resolution: { optionIndex: number; note?: string } | null;
  created_at: string;
}

export interface ProposalRow {
  id: string;
  plan_id: string;
  candidate_id: string | null;
  kind: "change" | "question";
  summary: string;
  payload: Record<string, unknown>;
  status: "open" | "accepted" | "declined" | "superseded";
  created_by: string | null;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface ProposalAnswerRow {
  proposal_id: string;
  member_id: string;
  answer: "yes" | "no";
}

export interface EventRow {
  id: number;
  actor_member_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CandidateRow {
  id: string;
  plan_id: string;
  type: Candidate["type"];
  title: string;
  description: string | null;
  origin: Candidate["origin"];
  status: Candidate["status"];
  source_kind: Candidate["sourceKind"];
  provider: string | null;
  provider_ref: string | null;
  source_url: string | null;
  fetched_at: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  cost: Money | null;
  rating: number | null;
  review_count: number | null;
  price_level: string | null;
  hours: WeeklyHours | null;
  categories: string[];
  attributes: Record<string, unknown>;
  starts_at: string | null;
  ends_at: string | null;
  enrichment_status: "none" | "pending" | "done" | "failed" | "not_found";
  added_by: string | null;
  created_at: string;
}

export interface ComponentRow {
  id: string;
  candidate_id: string;
  kind: Component["kind"];
  member_id: string | null;
  title: string;
  data: Component["data"];
  cost: Money | null;
  source_kind: Component["sourceKind"];
  provider: string | null;
  fetched_at: string | null;
  source_url: string | null;
  is_selected: boolean;
  sort: number;
}

export interface FinalSnapshot {
  headline: string;
  candidateId: string;
  candidateTitle: string;
  when: string | null;
  slot: { start: number; end: number } | null;
  participants: Array<{ name: string; color: string; cost: string | null }>;
  facts: Array<{ label: string; value: string; source: string }>;
  links: Array<{ label: string; url: string }>;
  blockers: string[];
  finalizedBy: string;
}

export interface PlanBundle {
  plan: PlanRow;
  members: MemberRow[];
  me: MemberRow | null;
  isOrganizer: boolean;
  dimensions: Dimension[];
  constraints: ConstraintRow[];
  clarifications: ClarificationRow[];
  availability: AvailabilityWindow[];
  candidates: CandidateRow[];
  components: ComponentRow[];
  reactions: Reaction[];
  responses: Record<string, { answers: Record<string, unknown>; submittedAt: string | null }>;
  proposals: ProposalRow[];
  proposalAnswers: ProposalAnswerRow[];
  events: EventRow[];
  loadedAt: number;
}

export class PlanAccessError extends Error {}

export async function loadPlanBundle(supabase: SupabaseClient, planId: string, userId: string | null): Promise<PlanBundle> {
  const [plan, members, dims, constraints, clar, avail, cands, comps, reacts, resps, props, pans, events] = await Promise.all([
    supabase.from("plans").select("*").eq("id", planId).maybeSingle(),
    supabase.from("plan_members").select("*").eq("plan_id", planId).order("joined_at"),
    supabase.from("plan_dimensions").select("*").eq("plan_id", planId).order("sort"),
    supabase.from("plan_constraints").select("*").eq("plan_id", planId).order("created_at"),
    supabase.from("clarifications").select("*").eq("plan_id", planId).order("created_at"),
    supabase.from("availability_windows").select("member_id, starts_at, ends_at, level").eq("plan_id", planId),
    supabase.from("candidates").select("*").eq("plan_id", planId).order("created_at"),
    supabase.from("candidate_components").select("*").eq("plan_id", planId).order("sort"),
    supabase.from("reactions").select("candidate_id, member_id, reaction, reason, note").eq("plan_id", planId),
    supabase.from("member_responses").select("member_id, answers, submitted_at").eq("plan_id", planId),
    supabase.from("proposals").select("*").eq("plan_id", planId).order("created_at", { ascending: false }).limit(30),
    supabase.from("proposal_answers").select("proposal_id, member_id, answer").eq("plan_id", planId),
    supabase.from("plan_events").select("id, actor_member_id, kind, payload, created_at").eq("plan_id", planId).order("created_at", { ascending: false }).limit(25),
  ]);
  const firstError = [plan, members, dims, constraints, clar, avail, cands, comps, reacts, resps, props, pans, events].find((r) => r.error)?.error;
  if (firstError) throw new Error(firstError.message);
  if (!plan.data) throw new PlanAccessError("Plan not found or you don't have access");

  const memberRows = (members.data ?? []) as MemberRow[];
  const me = userId ? memberRows.find((m) => m.user_id === userId) ?? null : null;
  const responses: PlanBundle["responses"] = {};
  for (const r of resps.data ?? []) responses[r.member_id] = { answers: (r.answers ?? {}) as Record<string, unknown>, submittedAt: r.submitted_at };

  return {
    plan: plan.data as PlanRow,
    members: memberRows,
    me,
    isOrganizer: !!userId && (plan.data as PlanRow).owner_id === userId,
    dimensions: (dims.data ?? []).map((d) => ({
      key: d.key,
      label: d.label,
      state: d.state,
      value: d.value,
      display: d.display ?? "",
      source: d.source,
      needsConfirmation: d.needs_confirmation,
    })),
    constraints: (constraints.data ?? []) as ConstraintRow[],
    clarifications: (clar.data ?? []) as ClarificationRow[],
    availability: (avail.data ?? []).map((w) => ({
      memberId: w.member_id,
      start: Date.parse(w.starts_at),
      end: Date.parse(w.ends_at),
      level: w.level,
    })),
    candidates: (cands.data ?? []) as CandidateRow[],
    components: (comps.data ?? []) as ComponentRow[],
    reactions: (reacts.data ?? []).map((r) => ({ candidateId: r.candidate_id, memberId: r.member_id, reaction: r.reaction, reason: r.reason, note: r.note })),
    responses,
    proposals: (props.data ?? []) as ProposalRow[],
    proposalAnswers: (pans.data ?? []) as ProposalAnswerRow[],
    events: (events.data ?? []) as EventRow[],
    loadedAt: Date.now(),
  };
}

export function toDomainMember(m: MemberRow): Member {
  return {
    id: m.id,
    displayName: m.display_name,
    role: m.role,
    color: m.color,
    respondedAt: m.responded_at,
    origin: { label: m.origin_label, lat: m.origin_lat, lng: m.origin_lng },
    homeBufferMinutes: m.home_buffer_minutes,
  };
}

export function toDomainCandidate(c: CandidateRow, components: ComponentRow[]): Candidate {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    description: c.description,
    origin: c.origin,
    status: c.status,
    sourceKind: c.source_kind,
    provider: c.provider,
    providerRef: c.provider_ref,
    sourceUrl: c.source_url,
    fetchedAt: c.fetched_at,
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    cost: c.cost,
    rating: c.rating == null ? null : Number(c.rating),
    reviewCount: c.review_count,
    priceLevel: c.price_level,
    hours: c.hours,
    categories: c.categories ?? [],
    attributes: c.attributes ?? {},
    startsAt: c.starts_at ? Date.parse(c.starts_at) : null,
    endsAt: c.ends_at ? Date.parse(c.ends_at) : null,
    components: components
      .filter((x) => x.candidate_id === c.id)
      .map((x) => ({
        id: x.id,
        kind: x.kind,
        memberId: x.member_id,
        title: x.title,
        data: x.data ?? {},
        cost: x.cost,
        sourceKind: x.source_kind,
        provider: x.provider,
        fetchedAt: x.fetched_at,
        sourceUrl: x.source_url,
        isSelected: x.is_selected,
      })),
  };
}

export function toPlanInput(b: PlanBundle, now = Date.now()): PlanInput {
  return {
    plan: {
      id: b.plan.id,
      title: b.plan.title,
      kind: b.plan.kind,
      mode: b.plan.mode,
      timezone: b.plan.timezone,
      minDurationMinutes: b.plan.min_duration_minutes,
      status: b.plan.status,
      location: { label: b.plan.location_label, lat: b.plan.location_lat, lng: b.plan.location_lng },
      now,
    },
    dimensions: b.dimensions,
    members: b.members.map(toDomainMember),
    availability: b.availability,
    constraints: b.constraints.map((c) => ({
      id: c.id,
      memberId: c.member_id,
      kind: c.kind,
      strength: c.strength,
      status: c.status,
      params: c.params ?? {},
      label: c.label,
      sourceText: c.source_text,
    })),
    candidates: b.candidates.map((c) => toDomainCandidate(c, b.components)),
    reactions: b.reactions,
  };
}
