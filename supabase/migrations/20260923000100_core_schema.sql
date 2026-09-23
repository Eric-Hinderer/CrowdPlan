-- CrowdPlan core schema.
-- Domain states (LOCKED / CONSTRAINED / UNDECIDED) are persisted per dimension.
-- All public tables are protected by RLS (see 20260923000200_rls.sql).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user; guests included). Authorization never reads
-- user-editable metadata: guest status is taken from app_metadata in the JWT.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  raw_input text check (char_length(raw_input) <= 2000),
  kind text not null default 'activity' check (kind in ('activity', 'dinner', 'travel')),
  mode text not null default 'criteria' check (mode in ('fixed', 'criteria', 'shortlist', 'discovery')),
  -- Explicit opt-in for broader suggestions. Fixed and shortlist plans never
  -- run discovery unless this is true.
  discovery_enabled boolean not null default false,
  status text not null default 'collecting' check (status in ('collecting', 'finalized', 'archived')),
  timezone text not null default 'America/Chicago' check (char_length(timezone) <= 64),
  location_label text check (char_length(location_label) <= 120),
  location_lat double precision check (location_lat between -90 and 90),
  location_lng double precision check (location_lng between -180 and 180),
  min_duration_minutes integer not null default 120 check (min_duration_minutes between 15 and 1440),
  decide_by timestamptz,
  share_code text not null unique check (share_code ~ '^[A-Z2-9]{6}$'),
  search_budget integer not null default 12 check (search_budget between 0 and 200),
  searches_used integer not null default 0 check (searches_used >= 0),
  version bigint not null default 1,
  finalized_candidate_id uuid,
  finalized_at timestamptz,
  final_snapshot jsonb,
  final_notes text check (char_length(final_notes) <= 2000),
  is_demo boolean not null default false,
  test_run_id text check (char_length(test_run_id) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plans_owner_idx on public.plans (owner_id);
create index plans_status_idx on public.plans (status) where status = 'collecting';

-- ---------------------------------------------------------------------------
-- Members (organizer + guests). Role and user binding are not client-writable.
-- ---------------------------------------------------------------------------
create table public.plan_members (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('organizer', 'guest')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  color text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  emoji text check (char_length(emoji) <= 8),
  origin_label text check (char_length(origin_label) <= 120),
  origin_lat double precision check (origin_lat between -90 and 90),
  origin_lng double precision check (origin_lng between -180 and 180),
  home_buffer_minutes integer not null default 45 check (home_buffer_minutes between 0 and 600),
  responded_at timestamptz,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, user_id)
);
create index plan_members_user_idx on public.plan_members (user_id);

-- ---------------------------------------------------------------------------
-- Invitations. Only a SHA-256 verifier of the bearer token is stored.
-- The public share_code on plans is a display code, never proof of access.
-- ---------------------------------------------------------------------------
create table public.plan_invites (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  uses integer not null default 0,
  max_uses integer check (max_uses is null or max_uses > 0),
  created_at timestamptz not null default now()
);
create index plan_invites_plan_idx on public.plan_invites (plan_id);

-- ---------------------------------------------------------------------------
-- Dimensions: LOCKED / CONSTRAINED / UNDECIDED
-- ---------------------------------------------------------------------------
create table public.plan_dimensions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  key text not null check (key ~ '^[a-z_]{2,32}$'),
  label text not null check (char_length(label) between 1 and 40),
  state text not null check (state in ('LOCKED', 'CONSTRAINED', 'UNDECIDED')),
  value jsonb,
  display text check (char_length(display) <= 200),
  source text not null default 'user' check (source in ('parser', 'llm', 'user', 'system', 'demo')),
  needs_confirmation boolean not null default false,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (plan_id, key)
);

-- ---------------------------------------------------------------------------
-- Participant responses (contextual questionnaire answers)
-- ---------------------------------------------------------------------------
create table public.member_responses (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  member_id uuid not null references public.plan_members (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (member_id)
);
create index member_responses_plan_idx on public.member_responses (plan_id);

-- ---------------------------------------------------------------------------
-- Constraints / preferences. Pending constraints are NOT enforced.
-- member_id null = plan-level constraint set by the organizer.
-- ---------------------------------------------------------------------------
create table public.plan_constraints (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  member_id uuid references public.plan_members (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  strength text not null check (strength in ('hard', 'soft')),
  params jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'pending', 'rejected')),
  source text not null default 'user' check (source in ('parser', 'llm', 'user', 'objection', 'repair', 'clarification', 'demo')),
  source_text text check (char_length(source_text) <= 500),
  label text check (char_length(label) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plan_constraints_plan_idx on public.plan_constraints (plan_id);
create index plan_constraints_member_idx on public.plan_constraints (member_id);

-- ---------------------------------------------------------------------------
-- Clarification questions: ambiguous input waits here until resolved.
-- ---------------------------------------------------------------------------
create table public.clarifications (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  member_id uuid references public.plan_members (id) on delete cascade,
  source_text text not null check (char_length(source_text) <= 500),
  question text not null check (char_length(question) <= 300),
  options jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index clarifications_plan_idx on public.clarifications (plan_id);
create index clarifications_member_idx on public.clarifications (member_id);

-- ---------------------------------------------------------------------------
-- Availability windows, stored as concrete instants [starts_at, ends_at).
-- ---------------------------------------------------------------------------
create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  member_id uuid not null references public.plan_members (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  level text not null check (level in ('ideal', 'works', 'unavailable')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '31 days')
);
create index availability_plan_member_idx on public.availability_windows (plan_id, member_id);
create index availability_member_idx on public.availability_windows (member_id);

-- ---------------------------------------------------------------------------
-- Universal candidates with provenance.
-- ---------------------------------------------------------------------------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  type text not null check (type in ('restaurant', 'venue', 'activity', 'event', 'destination', 'travel_package', 'custom')),
  title text not null check (char_length(title) between 1 and 160),
  description text check (char_length(description) <= 1000),
  origin text not null check (origin in ('fixed', 'shortlist', 'criteria', 'discovery', 'custom', 'repair', 'demo')),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  source_kind text not null default 'user' check (source_kind in ('live', 'estimate', 'user', 'unknown', 'demo')),
  provider text check (char_length(provider) <= 40),
  provider_ref text check (char_length(provider_ref) <= 300),
  source_url text check (char_length(source_url) <= 1000 and (source_url is null or source_url ~ '^https?://')),
  fetched_at timestamptz,
  address text check (char_length(address) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  cost jsonb,
  rating numeric(3, 2) check (rating between 0 and 5),
  review_count integer check (review_count >= 0),
  price_level text check (char_length(price_level) <= 20),
  hours jsonb,
  categories text[] not null default '{}',
  attributes jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  enrichment_status text not null default 'none' check (enrichment_status in ('none', 'pending', 'done', 'failed', 'not_found')),
  added_by uuid references public.plan_members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index candidates_plan_idx on public.candidates (plan_id);
create unique index candidates_provider_ref_uq on public.candidates (plan_id, provider, provider_ref)
  where provider_ref is not null;

alter table public.plans
  add constraint plans_finalized_candidate_fk
  foreign key (finalized_candidate_id) references public.candidates (id) on delete set null;
create index plans_finalized_candidate_idx on public.plans (finalized_candidate_id);

-- Component candidates (flights per traveler, hotel, local estimates).
create table public.candidate_components (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  kind text not null check (kind in ('flight', 'hotel', 'local_estimate', 'other')),
  member_id uuid references public.plan_members (id) on delete cascade,
  title text not null check (char_length(title) <= 200),
  data jsonb not null default '{}'::jsonb,
  cost jsonb,
  source_kind text not null default 'unknown' check (source_kind in ('live', 'estimate', 'user', 'unknown', 'demo')),
  provider text,
  provider_ref text,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  fetched_at timestamptz,
  is_selected boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index candidate_components_candidate_idx on public.candidate_components (candidate_id);
create index candidate_components_plan_idx on public.candidate_components (plan_id);
create index candidate_components_member_idx on public.candidate_components (member_id);

-- ---------------------------------------------------------------------------
-- Reactions (one per member per candidate)
-- ---------------------------------------------------------------------------
create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  member_id uuid not null references public.plan_members (id) on delete cascade,
  reaction text not null check (reaction in ('love', 'works', 'acceptable', 'rather_not', 'cant')),
  reason text check (reason in ('price', 'schedule', 'place', 'distance', 'transportation', 'accessibility', 'other')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, member_id),
  -- CAN'T DO THIS requires a reason.
  check (reaction <> 'cant' or reason is not null)
);
create index reactions_plan_idx on public.reactions (plan_id);
create index reactions_member_idx on public.reactions (member_id);

-- ---------------------------------------------------------------------------
-- Make This Work proposals and focused follow-up questions
-- ---------------------------------------------------------------------------
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete cascade,
  kind text not null check (kind in ('change', 'question')),
  summary text not null check (char_length(summary) <= 300),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'superseded')),
  created_by uuid references public.plan_members (id) on delete set null,
  decided_by uuid references public.plan_members (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index proposals_plan_idx on public.proposals (plan_id);
create index proposals_candidate_idx on public.proposals (candidate_id);

create table public.proposal_answers (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  member_id uuid not null references public.plan_members (id) on delete cascade,
  answer text not null check (answer in ('yes', 'no')),
  created_at timestamptz not null default now(),
  unique (proposal_id, member_id)
);
create index proposal_answers_plan_idx on public.proposal_answers (plan_id);
create index proposal_answers_member_idx on public.proposal_answers (member_id);

-- ---------------------------------------------------------------------------
-- Notifications (in-app; email when configured). dedupe_key prevents spam.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.plans (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  title text not null check (char_length(title) <= 200),
  body text check (char_length(body) <= 1000),
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  email_status text not null default 'none' check (email_status in ('none', 'pending', 'sent', 'skipped', 'failed')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_recipient_idx on public.notifications (recipient_user_id, created_at desc);
create index notifications_plan_idx on public.notifications (plan_id);

-- ---------------------------------------------------------------------------
-- Plan event history (activity feed / audit)
-- ---------------------------------------------------------------------------
create table public.plan_events (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.plans (id) on delete cascade,
  actor_member_id uuid references public.plan_members (id) on delete set null,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index plan_events_plan_idx on public.plan_events (plan_id, created_at desc);
create index plan_events_actor_idx on public.plan_events (actor_member_id);

-- ---------------------------------------------------------------------------
-- Saved stable preferences (owner only). Sensitive fields require explicit
-- confirmation before being applied to a plan.
-- ---------------------------------------------------------------------------
create table public.saved_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  home_area text check (char_length(home_area) <= 120),
  usual_dinner_budget integer check (usual_dinner_budget between 0 and 10000),
  favorite_cuisines text[] not null default '{}',
  dietary_restrictions text[] not null default '{}',
  activity_preferences text[] not null default '{}',
  travel_preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Private, server-only tables (schema not exposed through the Data API)
-- ---------------------------------------------------------------------------
create table private.provider_cache (
  cache_key text primary key check (char_length(cache_key) <= 128),
  provider text not null,
  engine text not null,
  params jsonb not null,
  status text not null check (status in ('pending', 'ok', 'error')),
  normalized jsonb,
  error text,
  claimed_until timestamptz,
  fetched_at timestamptz,
  expires_at timestamptz,
  hit_count integer not null default 0,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index provider_cache_expires_idx on private.provider_cache (expires_at);

create table private.search_ledger (
  id bigint generated always as identity primary key,
  plan_id uuid references public.plans (id) on delete cascade,
  cache_key text not null,
  provider text not null,
  engine text not null,
  outcome text not null check (outcome in ('cache_hit', 'network', 'deduplicated', 'budget_exhausted', 'error', 'not_configured', 'rate_limited')),
  created_at timestamptz not null default now()
);
create index search_ledger_plan_idx on private.search_ledger (plan_id, created_at desc);

create table private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);

create table private.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  plan_id uuid references public.plans (id) on delete cascade,
  dedupe_key text not null unique,
  status text not null default 'started' check (status in ('started', 'done', 'failed', 'skipped')),
  attempts integer not null default 1,
  detail jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_runs_plan_idx on private.job_runs (plan_id);

create table private.claim_tickets (
  ticket_hash text primary key check (ticket_hash ~ '^[0-9a-f]{64}$'),
  guest_user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index claim_tickets_guest_idx on private.claim_tickets (guest_user_id);
create index claim_tickets_used_by_idx on private.claim_tickets (used_by);

-- Secrets that database code needs (e.g. job endpoint secret). Values are
-- inserted out-of-band, never through migrations.
create table private.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table private.provider_cache enable row level security;
alter table private.search_ledger enable row level security;
alter table private.rate_limits enable row level security;
alter table private.job_runs enable row level security;
alter table private.claim_tickets enable row level security;
alter table private.app_settings enable row level security;
