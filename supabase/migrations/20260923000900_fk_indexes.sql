-- Covering indexes for foreign keys flagged by the performance advisor. Removing
-- a member or user sets these columns to null / cascades, which otherwise scans.
create index if not exists candidates_added_by_idx on public.candidates (added_by);
create index if not exists plan_invites_created_by_idx on public.plan_invites (created_by);
create index if not exists proposals_created_by_idx on public.proposals (created_by);
create index if not exists proposals_decided_by_idx on public.proposals (decided_by);
