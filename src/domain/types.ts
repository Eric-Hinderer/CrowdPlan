// CrowdPlan domain model. Pure types: no framework, network or database code.

export type DimensionState = "LOCKED" | "CONSTRAINED" | "UNDECIDED";
export type DataSource = "parser" | "llm" | "user" | "system" | "demo";

export type DimensionValue =
  | { type: "text"; text: string }
  | { type: "place"; name: string; candidateId?: string }
  /** One or more specific local dates (yyyy-MM-dd). */
  | { type: "dates"; dates: string[] }
  /** Inclusive local date range (yyyy-MM-dd). */
  | { type: "dateRange"; start: string; end: string }
  /** Local time-of-day window, "HH:mm". end may be "24:00". */
  | { type: "timeWindow"; start: string; end: string }
  /** A specific local start time, "HH:mm". */
  | { type: "time"; start: string }
  | { type: "money"; min?: number; max?: number; currency: string; basis: "per_person" | "per_group" }
  | { type: "list"; items: string[] }
  | { type: "nights"; min: number; max: number }
  | { type: "area"; label: string; lat?: number; lng?: number; radiusKm?: number }
  | { type: "minutes"; minutes: number };

export interface Dimension {
  key: string;
  label: string;
  state: DimensionState;
  value: DimensionValue | null;
  display: string;
  source: DataSource;
  /** Extracted from interpretation and not yet confirmed by a person. */
  needsConfirmation: boolean;
}

export type PlanKind = "activity" | "dinner" | "travel";
export type PlanMode = "fixed" | "criteria" | "shortlist" | "discovery";

export interface Member {
  id: string;
  displayName: string;
  role: "organizer" | "guest";
  color: string;
  respondedAt: string | null;
  origin?: { label?: string | null; lat?: number | null; lng?: number | null } | null;
  /** Minutes from arrival airport to home (arrival-home model for travel). */
  homeBufferMinutes: number;
}

export type AvailabilityLevel = "ideal" | "works" | "unavailable";

export interface AvailabilityWindow {
  memberId: string;
  /** epoch ms, inclusive */
  start: number;
  /** epoch ms, exclusive */
  end: number;
  level: AvailabilityLevel;
}

export type Strength = "hard" | "soft";
export type ConstraintStatus = "active" | "pending" | "rejected";

export type ConstraintKind =
  | "max_budget"
  | "preferred_budget"
  | "dietary"
  | "cuisine_preference"
  | "avoid_area"
  | "max_travel_minutes"
  | "earliest_start"
  | "latest_end"
  | "unavailable_day"
  | "no_travel_day"
  | "earliest_departure"
  | "latest_arrival_home"
  | "day_preference"
  | "exclude_candidate"
  | "accessibility"
  | "nonstop_only"
  | "note";

export interface Constraint {
  id: string;
  /** null = plan-level (applies to everyone) */
  memberId: string | null;
  kind: ConstraintKind;
  strength: Strength;
  status: ConstraintStatus;
  params: Record<string, unknown>;
  label?: string | null;
  sourceText?: string | null;
}

export type SourceKind = "live" | "estimate" | "user" | "unknown" | "demo";

export interface Money {
  min?: number | null;
  max?: number | null;
  currency: string;
  basis: "per_person" | "per_group" | "per_night" | "total";
  /** quote = exact price; range = provider range; estimate/price_level are approximations */
  kind: "quote" | "range" | "estimate" | "price_level" | "user";
  sourceKind: SourceKind;
}

export type Weekday = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
export const WEEKDAYS: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** null = hours unknown ("Hours unavailable"). */
export type WeeklyHours = Partial<Record<Weekday, Array<{ open: string; close: string }> | "closed">>;

export interface FlightData {
  direction: "outbound" | "return";
  airline: string | null;
  from: string;
  to: string;
  /** epoch ms */
  departAt: number;
  /** epoch ms */
  arriveAt: number;
  /** IANA zones used to render local times */
  departTz?: string | null;
  arriveTz?: string | null;
  stops: number;
  durationMinutes: number | null;
  flightNumbers: string[];
}

export interface HotelData {
  name: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  guests: number;
  rating?: number | null;
  nightlyRate?: number | null;
  totalRate?: number | null;
}

export interface Component {
  id: string;
  kind: "flight" | "hotel" | "local_estimate" | "other";
  memberId: string | null;
  title: string;
  data: Partial<FlightData> & Partial<HotelData> & Record<string, unknown>;
  cost: Money | null;
  sourceKind: SourceKind;
  provider?: string | null;
  fetchedAt?: string | null;
  sourceUrl?: string | null;
  isSelected: boolean;
}

export type CandidateType = "restaurant" | "venue" | "activity" | "event" | "destination" | "travel_package" | "custom";

export interface Candidate {
  id: string;
  type: CandidateType;
  title: string;
  description?: string | null;
  origin: "fixed" | "shortlist" | "criteria" | "discovery" | "custom" | "repair" | "demo";
  status: "active" | "withdrawn";
  sourceKind: SourceKind;
  provider?: string | null;
  providerRef?: string | null;
  sourceUrl?: string | null;
  fetchedAt?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  cost: Money | null;
  rating?: number | null;
  reviewCount?: number | null;
  priceLevel?: string | null;
  hours: WeeklyHours | null;
  categories: string[];
  attributes: Record<string, unknown>;
  /** Fixed start/end for events or a proposed time (epoch ms). */
  startsAt?: number | null;
  endsAt?: number | null;
  components: Component[];
}

export type ReactionKind = "love" | "works" | "acceptable" | "rather_not" | "cant";
export type ObjectionReason = "price" | "schedule" | "place" | "distance" | "transportation" | "accessibility" | "other";

export interface Reaction {
  candidateId: string;
  memberId: string;
  reaction: ReactionKind;
  reason?: ObjectionReason | null;
  note?: string | null;
}

export interface PlanContext {
  id: string;
  title: string;
  kind: PlanKind;
  mode: PlanMode;
  timezone: string;
  minDurationMinutes: number;
  status: "collecting" | "finalized" | "archived";
  location?: { label?: string | null; lat?: number | null; lng?: number | null } | null;
  /** epoch ms used as "now" for relative date semantics (injected for determinism) */
  now: number;
}

export interface PlanInput {
  plan: PlanContext;
  dimensions: Dimension[];
  members: Member[];
  availability: AvailabilityWindow[];
  constraints: Constraint[];
  candidates: Candidate[];
  reactions: Reaction[];
}

// ---------------------------------------------------------------------------
// Evaluation output
// ---------------------------------------------------------------------------

export type CheckResult = "PASS" | "FAIL" | "UNKNOWN";

export interface HardCheck {
  kind: string;
  memberId: string | null;
  constraintId?: string;
  result: CheckResult;
  /** PASS based on an estimate rather than verified data */
  estimated?: boolean;
  /** UNKNOWN that is shown to people but does not make the candidate unverified (e.g. opening hours) */
  advisory?: boolean;
  message: string;
  delta?: { amount?: number; minutes?: number };
}

export interface SoftCheck {
  kind: string;
  memberId: string;
  constraintId?: string;
  met: boolean;
  message: string;
}

export type ScoreCategory = "schedule" | "cost" | "travel" | "preference" | "quality" | "vote";

export interface CostSummary {
  /** lower bound per person, if known */
  low: number | null;
  /** upper bound per person, if known */
  high: number | null;
  currency: string;
  estimated: boolean;
  unknownParts: string[];
  parts: Array<{ label: string; amount: number | null; sourceKind: SourceKind; estimated: boolean }>;
}

export interface MemberOutcome {
  memberId: string;
  feasibility: CheckResult;
  hard: HardCheck[];
  soft: SoftCheck[];
  satisfaction: number;
  /** true when satisfaction had no category data and uses the neutral default */
  lowConfidence: boolean;
  categoryScores: Partial<Record<ScoreCategory, number>>;
  scheduleLevel: "ideal" | "works" | null;
  cost: CostSummary | null;
  travelMinutes: number | null;
}

export interface Slot {
  start: number;
  end: number;
}

export interface Explanation {
  positives: string[];
  compromises: string[];
  hardViolations: string[];
  unknowns: string[];
}

export interface RankingMetrics {
  averageSatisfaction: number;
  minimumSatisfaction: number;
  groupFit: number;
  idealMatchCount: number;
  hardCompromises: number;
  softCompromises: number;
  unverifiedChecks: number;
  budgetFit: { withinPreferred: number; withinMax: number; overPreferred: number; unknown: number };
  convenience: { min: number; median: number; max: number } | null;
}

export type CandidateStatus = "FEASIBLE" | "UNVERIFIED" | "INFEASIBLE";

export interface CandidateConsensus {
  counts: Record<ReactionKind, number>;
  respondents: number;
  /** 0..1 mean reaction score among respondents, null without reactions */
  alignment: number | null;
  objections: Array<{ memberId: string; reason: ObjectionReason | null; note: string | null }>;
}

export interface CandidateEvaluation {
  candidateId: string;
  status: CandidateStatus;
  slot: Slot | null;
  planChecks: HardCheck[];
  members: MemberOutcome[];
  metrics: RankingMetrics;
  /** Rank among FEASIBLE candidates only (1-based); null otherwise */
  rank: number | null;
  explanation: Explanation;
  consensus: CandidateConsensus;
}

export type PlanConsensusState = "no_options" | "gathering" | "objection" | "split" | "leaning" | "strong";

export interface PlanConsensus {
  state: PlanConsensusState;
  label: string;
  leadingCandidateId: string | null;
  waitingOn: string[];
}

export type DimensionProgress = "RESOLVED" | "OPEN" | "BLOCKED";

export interface DimensionStatus {
  key: string;
  label: string;
  state: DimensionState;
  progress: DimensionProgress;
  summary: string;
  detail?: string;
}
