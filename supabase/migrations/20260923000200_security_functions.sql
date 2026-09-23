-- CrowdPlan authorization helpers, RLS policies, grants, RPCs and triggers.

-- ---------------------------------------------------------------------------
-- Helper functions (private schema; not reachable through the Data API).
-- They are SECURITY DEFINER only so RLS policies can look up membership
-- without recursive policy evaluation; each checks auth.uid() explicitly.
-- ---------------------------------------------------------------------------
create or replace function private.is_guest()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'cp_guest')::boolean, false);
$$;

create or replace function private.is_plan_member(p_plan uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plan_members m
    where m.plan_id = p_plan and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_plan_organizer(p_plan uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_plan and p.owner_id = (select auth.uid())
  );
$$;

create or replace function private.my_member_id(p_plan uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.id from public.plan_members m
  where m.plan_id = p_plan and m.user_id = (select auth.uid());
$$;

create or replace function private.plan_is_open(p_plan uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.plans p where p.id = p_plan and p.status = 'collecting');
$$;

create or replace function private.gen_share_code()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(6);
  result text := '';
begin
  for i in 0..5 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

create or replace function private.hit_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  win timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  current_count integer;
begin
  insert into private.rate_limits as r (bucket, window_start, count)
  values (p_bucket, win, 1)
  on conflict (bucket, window_start) do update set count = r.count + 1
  returning count into current_count;
  delete from private.rate_limits where window_start < now() - interval '1 day';
  return current_count <= p_max;
end;
$$;

grant usage on schema private to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_guest() to authenticated, service_role;
grant execute on function private.is_plan_member(uuid) to authenticated, service_role;
grant execute on function private.is_plan_organizer(uuid) to authenticated, service_role;
grant execute on function private.my_member_id(uuid) to authenticated, service_role;
grant execute on function private.plan_is_open(uuid) to authenticated, service_role;
grant execute on function private.gen_share_code() to authenticated, service_role;

alter table public.plans alter column share_code set default private.gen_share_code();

-- ---------------------------------------------------------------------------
-- Enable RLS on every public table
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.plan_members enable row level security;
alter table public.plan_invites enable row level security;
alter table public.plan_dimensions enable row level security;
alter table public.member_responses enable row level security;
alter table public.plan_constraints enable row level security;
alter table public.clarifications enable row level security;
alter table public.availability_windows enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_components enable row level security;
alter table public.reactions enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_answers enable row level security;
alter table public.notifications enable row level security;
alter table public.plan_events enable row level security;
alter table public.saved_preferences enable row level security;

-- Anonymous visitors (anon role) get no table access at all.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
grant select, delete on public.plans to authenticated;
grant insert (id, owner_id, title, raw_input, kind, mode, discovery_enabled, timezone,
  location_label, location_lat, location_lng, min_duration_minutes, decide_by, is_demo, test_run_id)
  on public.plans to authenticated;
grant update (title, raw_input, kind, mode, discovery_enabled, timezone, location_label,
  location_lat, location_lng, min_duration_minutes, decide_by, final_notes, updated_at)
  on public.plans to authenticated;

create policy plans_select_members on public.plans for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.is_plan_member(id)));
create policy plans_insert_organizer on public.plans for insert to authenticated
  with check (owner_id = (select auth.uid()) and not (select private.is_guest()));
create policy plans_update_owner on public.plans for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy plans_delete_owner on public.plans for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- plan_members
-- ---------------------------------------------------------------------------
grant select, delete on public.plan_members to authenticated;
grant insert (plan_id, user_id, role, display_name, color, emoji, origin_label, origin_lat, origin_lng)
  on public.plan_members to authenticated;
grant update (display_name, color, emoji, origin_label, origin_lat, origin_lng,
  home_buffer_minutes, responded_at, updated_at)
  on public.plan_members to authenticated;

create policy members_select on public.plan_members for select to authenticated
  using ((select private.is_plan_member(plan_id)) or (select private.is_plan_organizer(plan_id)));
-- Only the plan owner may add themselves as organizer. Guests are added by
-- invite redemption functions, never by direct insert.
create policy members_insert_organizer_self on public.plan_members for insert to authenticated
  with check (
    user_id = (select auth.uid()) and role = 'organizer'
    and (select private.is_plan_organizer(plan_id))
  );
create policy members_update_self on public.plan_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy members_delete on public.plan_members for delete to authenticated
  using (
    (role = 'guest' and user_id = (select auth.uid()))
    or (role = 'guest' and (select private.is_plan_organizer(plan_id)))
  );

-- ---------------------------------------------------------------------------
-- plan_invites (organizer only)
-- ---------------------------------------------------------------------------
grant select on public.plan_invites to authenticated;
grant insert (plan_id, token_hash, created_by, expires_at, max_uses) on public.plan_invites to authenticated;
grant update (revoked_at, expires_at) on public.plan_invites to authenticated;
create policy invites_select_org on public.plan_invites for select to authenticated
  using ((select private.is_plan_organizer(plan_id)));
create policy invites_insert_org on public.plan_invites for insert to authenticated
  with check ((select private.is_plan_organizer(plan_id)) and created_by = (select auth.uid()));
create policy invites_update_org on public.plan_invites for update to authenticated
  using ((select private.is_plan_organizer(plan_id))) with check ((select private.is_plan_organizer(plan_id)));

-- ---------------------------------------------------------------------------
-- plan_dimensions (members read; organizer writes while the plan is open)
-- ---------------------------------------------------------------------------
grant select, delete on public.plan_dimensions to authenticated;
grant insert (plan_id, key, label, state, value, display, source, needs_confirmation, sort)
  on public.plan_dimensions to authenticated;
grant update (label, state, value, display, source, needs_confirmation, sort, updated_at)
  on public.plan_dimensions to authenticated;
create policy dims_select on public.plan_dimensions for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy dims_insert on public.plan_dimensions for insert to authenticated
  with check ((select private.is_plan_organizer(plan_id)) and (select private.plan_is_open(plan_id)));
create policy dims_update on public.plan_dimensions for update to authenticated
  using ((select private.is_plan_organizer(plan_id)) and (select private.plan_is_open(plan_id)))
  with check ((select private.is_plan_organizer(plan_id)));
create policy dims_delete on public.plan_dimensions for delete to authenticated
  using ((select private.is_plan_organizer(plan_id)) and (select private.plan_is_open(plan_id)));

-- ---------------------------------------------------------------------------
-- member_responses (members read; each member writes only their own)
-- ---------------------------------------------------------------------------
grant select on public.member_responses to authenticated;
grant insert (plan_id, member_id, answers, submitted_at) on public.member_responses to authenticated;
grant update (answers, submitted_at, updated_at) on public.member_responses to authenticated;
create policy responses_select on public.member_responses for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy responses_insert_own on public.member_responses for insert to authenticated
  with check (member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id)));
create policy responses_update_own on public.member_responses for update to authenticated
  using (member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id)))
  with check (member_id = (select private.my_member_id(plan_id)));

-- ---------------------------------------------------------------------------
-- plan_constraints
-- ---------------------------------------------------------------------------
grant select, delete on public.plan_constraints to authenticated;
grant insert (plan_id, member_id, kind, strength, params, status, source, source_text, label)
  on public.plan_constraints to authenticated;
grant update (kind, strength, params, status, source_text, label, updated_at)
  on public.plan_constraints to authenticated;
create policy constraints_select on public.plan_constraints for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy constraints_insert on public.plan_constraints for insert to authenticated
  with check (
    (select private.plan_is_open(plan_id)) and (
      member_id = (select private.my_member_id(plan_id))
      or (member_id is null and (select private.is_plan_organizer(plan_id)))
    )
  );
create policy constraints_update on public.plan_constraints for update to authenticated
  using (
    (select private.plan_is_open(plan_id)) and (
      member_id = (select private.my_member_id(plan_id))
      or (member_id is null and (select private.is_plan_organizer(plan_id)))
    )
  )
  with check (
    member_id = (select private.my_member_id(plan_id))
    or (member_id is null and (select private.is_plan_organizer(plan_id)))
  );
create policy constraints_delete on public.plan_constraints for delete to authenticated
  using (
    (select private.plan_is_open(plan_id)) and (
      member_id = (select private.my_member_id(plan_id))
      or (member_id is null and (select private.is_plan_organizer(plan_id)))
    )
  );

-- ---------------------------------------------------------------------------
-- clarifications
-- ---------------------------------------------------------------------------
grant select on public.clarifications to authenticated;
grant insert (plan_id, member_id, source_text, question, options) on public.clarifications to authenticated;
grant update (status, resolution, resolved_at) on public.clarifications to authenticated;
create policy clar_select on public.clarifications for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy clar_insert on public.clarifications for insert to authenticated
  with check (
    member_id = (select private.my_member_id(plan_id))
    or (member_id is null and (select private.is_plan_organizer(plan_id)))
  );
create policy clar_update on public.clarifications for update to authenticated
  using (
    member_id = (select private.my_member_id(plan_id))
    or (member_id is null and (select private.is_plan_organizer(plan_id)))
  )
  with check (
    member_id = (select private.my_member_id(plan_id))
    or (member_id is null and (select private.is_plan_organizer(plan_id)))
  );

-- ---------------------------------------------------------------------------
-- availability_windows (own rows only)
-- ---------------------------------------------------------------------------
grant select, delete on public.availability_windows to authenticated;
grant insert (plan_id, member_id, starts_at, ends_at, level) on public.availability_windows to authenticated;
grant update (starts_at, ends_at, level) on public.availability_windows to authenticated;
create policy avail_select on public.availability_windows for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy avail_insert_own on public.availability_windows for insert to authenticated
  with check (member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id)));
create policy avail_update_own on public.availability_windows for update to authenticated
  using (member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id)))
  with check (member_id = (select private.my_member_id(plan_id)));
create policy avail_delete_own on public.availability_windows for delete to authenticated
  using (member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id)));

-- ---------------------------------------------------------------------------
-- candidates. Members may add user-entered candidates; only the server role
-- writes live/provider data (see server role migration).
-- ---------------------------------------------------------------------------
grant select, delete on public.candidates to authenticated;
grant insert (plan_id, type, title, description, origin, source_kind, source_url, address,
  lat, lng, cost, price_level, categories, attributes, starts_at, ends_at, added_by, enrichment_status)
  on public.candidates to authenticated;
grant update (status, title, description, attributes, starts_at, ends_at, cost, updated_at)
  on public.candidates to authenticated;
create policy cand_select on public.candidates for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy cand_insert on public.candidates for insert to authenticated
  with check (
    (select private.plan_is_open(plan_id))
    and added_by = (select private.my_member_id(plan_id))
    and source_kind in ('user', 'unknown', 'demo')
    and origin in ('fixed', 'shortlist', 'custom', 'demo')
    and enrichment_status in ('none', 'pending')
    and (origin <> 'fixed' or (select private.is_plan_organizer(plan_id)))
  );
-- User-editable fields only apply to user-entered candidates; live provider
-- records can only be withdrawn or annotated by the organizer.
create policy cand_update on public.candidates for update to authenticated
  using (
    (select private.plan_is_open(plan_id)) and (
      (select private.is_plan_organizer(plan_id))
      or (added_by = (select private.my_member_id(plan_id)) and source_kind in ('user', 'unknown'))
    )
  )
  with check ((select private.is_plan_member(plan_id)));
create policy cand_delete on public.candidates for delete to authenticated
  using (
    (select private.plan_is_open(plan_id)) and (
      (select private.is_plan_organizer(plan_id))
      or (added_by = (select private.my_member_id(plan_id)) and source_kind in ('user', 'unknown'))
    )
  );

-- ---------------------------------------------------------------------------
-- candidate_components
-- ---------------------------------------------------------------------------
grant select, delete on public.candidate_components to authenticated;
grant insert (plan_id, candidate_id, kind, member_id, title, data, cost, source_kind, is_selected, sort)
  on public.candidate_components to authenticated;
grant update (is_selected, cost, data, title) on public.candidate_components to authenticated;
create policy comp_select on public.candidate_components for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy comp_insert on public.candidate_components for insert to authenticated
  with check (
    (select private.is_plan_organizer(plan_id)) and (select private.plan_is_open(plan_id))
    and source_kind in ('user', 'estimate', 'demo')
    and exists (select 1 from public.candidates c where c.id = candidate_components.candidate_id and c.plan_id = candidate_components.plan_id)
  );
create policy comp_update on public.candidate_components for update to authenticated
  using ((select private.is_plan_organizer(plan_id)) and (select private.plan_is_open(plan_id)))
  with check ((select private.is_plan_organizer(plan_id)));
create policy comp_delete on public.candidate_components for delete to authenticated
  using ((select private.is_plan_organizer(plan_id)) and (select private.plan_is_open(plan_id))
    and source_kind in ('user', 'estimate', 'demo'));

-- ---------------------------------------------------------------------------
-- reactions (own only)
-- ---------------------------------------------------------------------------
grant select, delete on public.reactions to authenticated;
grant insert (plan_id, candidate_id, member_id, reaction, reason, note) on public.reactions to authenticated;
grant update (reaction, reason, note, updated_at) on public.reactions to authenticated;
create policy react_select on public.reactions for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy react_insert_own on public.reactions for insert to authenticated
  with check (
    member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id))
    and exists (select 1 from public.candidates c where c.id = reactions.candidate_id and c.plan_id = reactions.plan_id)
  );
create policy react_update_own on public.reactions for update to authenticated
  using (member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id)))
  with check (member_id = (select private.my_member_id(plan_id)));
create policy react_delete_own on public.reactions for delete to authenticated
  using (member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id)));

-- ---------------------------------------------------------------------------
-- proposals / answers
-- ---------------------------------------------------------------------------
grant select on public.proposals to authenticated;
grant insert (plan_id, candidate_id, kind, summary, payload, created_by) on public.proposals to authenticated;
grant update (status, decided_by, decided_at) on public.proposals to authenticated;
create policy prop_select on public.proposals for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy prop_insert on public.proposals for insert to authenticated
  with check (created_by = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id)));
create policy prop_update_org on public.proposals for update to authenticated
  using ((select private.is_plan_organizer(plan_id)) and (select private.plan_is_open(plan_id)))
  with check ((select private.is_plan_organizer(plan_id)));

grant select, delete on public.proposal_answers to authenticated;
grant insert (plan_id, proposal_id, member_id, answer) on public.proposal_answers to authenticated;
grant update (answer) on public.proposal_answers to authenticated;
create policy pans_select on public.proposal_answers for select to authenticated
  using ((select private.is_plan_member(plan_id)));
create policy pans_insert_own on public.proposal_answers for insert to authenticated
  with check (
    member_id = (select private.my_member_id(plan_id)) and (select private.plan_is_open(plan_id))
    and exists (select 1 from public.proposals p where p.id = proposal_answers.proposal_id and p.plan_id = proposal_answers.plan_id)
  );
create policy pans_update_own on public.proposal_answers for update to authenticated
  using (member_id = (select private.my_member_id(plan_id)))
  with check (member_id = (select private.my_member_id(plan_id)));
create policy pans_delete_own on public.proposal_answers for delete to authenticated
  using (member_id = (select private.my_member_id(plan_id)));

-- ---------------------------------------------------------------------------
-- notifications (recipient only; created by server/database functions)
-- ---------------------------------------------------------------------------
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notif_select_own on public.notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()));
create policy notif_update_own on public.notifications for update to authenticated
  using (recipient_user_id = (select auth.uid())) with check (recipient_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- plan_events (read-only for members)
-- ---------------------------------------------------------------------------
grant select on public.plan_events to authenticated;
create policy events_select on public.plan_events for select to authenticated
  using ((select private.is_plan_member(plan_id)));

-- ---------------------------------------------------------------------------
-- saved_preferences (owner only, account holders only)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.saved_preferences to authenticated;
create policy prefs_all_own on public.saved_preferences for all to authenticated
  using (user_id = (select auth.uid()) and not (select private.is_guest()))
  with check (user_id = (select auth.uid()) and not (select private.is_guest()));

-- ---------------------------------------------------------------------------
-- Edge functions use service_role (server-side only).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema private to service_role;

-- ---------------------------------------------------------------------------
-- Triggers: updated_at, profile creation, realtime version bump
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger members_touch before update on public.plan_members for each row execute function private.touch_updated_at();
create trigger dims_touch before update on public.plan_dimensions for each row execute function private.touch_updated_at();
create trigger responses_touch before update on public.member_responses for each row execute function private.touch_updated_at();
create trigger constraints_touch before update on public.plan_constraints for each row execute function private.touch_updated_at();
create trigger candidates_touch before update on public.candidates for each row execute function private.touch_updated_at();
create trigger reactions_touch before update on public.reactions for each row execute function private.touch_updated_at();
create trigger prefs_touch before update on public.saved_preferences for each row execute function private.touch_updated_at();

-- Plans: every update bumps the version (used for stale-write detection and
-- as the single realtime signal subscribers listen to).
create or replace function private.plans_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'plan ownership cannot be reassigned' using errcode = '42501';
  end if;
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger plans_before_update before update on public.plans for each row execute function private.plans_before_update();

create or replace function private.members_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.plan_id <> old.plan_id or new.user_id <> old.user_id or new.role <> old.role then
    -- Only privileged database code (claim redemption) may rebind user_id.
    if current_setting('crowdplan.allow_member_rebind', true) is distinct from 'on'
       or new.plan_id <> old.plan_id or new.role <> old.role then
      raise exception 'membership identity cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger members_guard before update on public.plan_members for each row execute function private.members_guard();

create or replace function private.bump_plan_version_from_rows()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.plans p set version = p.version + 1
    where p.id in (select distinct o.plan_id from old_rows o);
  else
    update public.plans p set version = p.version + 1
    where p.id in (select distinct n.plan_id from new_rows n);
  end if;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['plan_dimensions', 'plan_members', 'member_responses', 'plan_constraints',
    'clarifications', 'availability_windows', 'candidates', 'candidate_components', 'reactions',
    'proposals', 'proposal_answers']
  loop
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows
      for each statement execute function private.bump_plan_version_from_rows()', t || '_bump_ins', t);
    execute format('create trigger %I after update on public.%I referencing new table as new_rows
      for each statement execute function private.bump_plan_version_from_rows()', t || '_bump_upd', t);
    execute format('create trigger %I after delete on public.%I referencing old table as old_rows
      for each statement execute function private.bump_plan_version_from_rows()', t || '_bump_del', t);
  end loop;
end;
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: create a plan atomically (SECURITY INVOKER: RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.create_plan(p jsonb)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_plan uuid;
  v_uid uuid := (select auth.uid());
  d jsonb;
  c jsonb;
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into public.plans (owner_id, title, raw_input, kind, mode, discovery_enabled, timezone,
    location_label, location_lat, location_lng, min_duration_minutes, decide_by, is_demo, test_run_id)
  values (
    v_uid,
    p ->> 'title',
    p ->> 'raw_input',
    coalesce(p ->> 'kind', 'activity'),
    coalesce(p ->> 'mode', 'criteria'),
    coalesce((p ->> 'discovery_enabled')::boolean, false),
    coalesce(p ->> 'timezone', 'America/Chicago'),
    p ->> 'location_label',
    (p ->> 'location_lat')::double precision,
    (p ->> 'location_lng')::double precision,
    coalesce((p ->> 'min_duration_minutes')::integer, 120),
    (p ->> 'decide_by')::timestamptz,
    coalesce((p ->> 'is_demo')::boolean, false),
    p ->> 'test_run_id'
  )
  returning id into v_plan;

  insert into public.plan_members (plan_id, user_id, role, display_name, color, emoji)
  values (v_plan, v_uid, 'organizer', coalesce(nullif(p ->> 'organizer_name', ''), 'Organizer'),
    coalesce(p ->> 'organizer_color', '#7c5cff'), p ->> 'organizer_emoji')
  returning id into v_member;

  for d in select * from jsonb_array_elements(coalesce(p -> 'dimensions', '[]'::jsonb)) loop
    insert into public.plan_dimensions (plan_id, key, label, state, value, display, source, needs_confirmation, sort)
    values (v_plan, d ->> 'key', d ->> 'label', d ->> 'state', d -> 'value', d ->> 'display',
      coalesce(d ->> 'source', 'user'), coalesce((d ->> 'needs_confirmation')::boolean, false),
      coalesce((d ->> 'sort')::integer, 0));
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p -> 'candidates', '[]'::jsonb)) loop
    insert into public.candidates (plan_id, type, title, description, origin, source_kind, source_url,
      address, cost, attributes, added_by, enrichment_status)
    values (v_plan, coalesce(c ->> 'type', 'custom'), c ->> 'title', c ->> 'description',
      coalesce(c ->> 'origin', 'shortlist'), coalesce(c ->> 'source_kind', 'user'), c ->> 'source_url',
      c ->> 'address', c -> 'cost', coalesce(c -> 'attributes', '{}'::jsonb), v_member,
      coalesce(c ->> 'enrichment_status', 'none'));
  end loop;

  if p ? 'invite_token_hash' then
    insert into public.plan_invites (plan_id, token_hash, created_by, expires_at)
    values (v_plan, p ->> 'invite_token_hash', v_uid, (p ->> 'invite_expires_at')::timestamptz);
  end if;

  if jsonb_array_length(coalesce(p -> 'constraints', '[]'::jsonb)) > 0 then
    insert into public.plan_constraints (plan_id, member_id, kind, strength, params, status, source, source_text, label)
    select v_plan, null, x ->> 'kind', x ->> 'strength', coalesce(x -> 'params', '{}'::jsonb),
      coalesce(x ->> 'status', 'active'), coalesce(x ->> 'source', 'parser'), x ->> 'source_text', x ->> 'label'
    from jsonb_array_elements(p -> 'constraints') x;
  end if;

  return v_plan;
end;
$$;
revoke execute on function public.create_plan(jsonb) from public, anon;
grant execute on function public.create_plan(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Invite redemption. Core logic is private; two narrow entry points:
--  * redeem_invite: an already signed-in user joins (RLS identity = auth.uid())
--  * redeem_invite_as: service_role only, used by the join-plan edge function
--    after it has minted a guest identity for a visitor without a session.
-- ---------------------------------------------------------------------------
create or replace function private.find_valid_invite(p_code text, p_token text)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_plan uuid;
begin
  if p_code is null or p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return null;
  end if;
  select i.plan_id into v_plan
  from public.plan_invites i
  join public.plans p on p.id = i.plan_id
  where p.share_code = upper(p_code)
    and i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and i.revoked_at is null
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.uses < i.max_uses)
    and p.status <> 'archived';
  return v_plan;
end;
$$;

create or replace function private.redeem_invite_core(p_user uuid, p_code text, p_token text, p_display_name text)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_plan uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_colors text[] := array['#ff6b4a', '#2bb673', '#3d8bfd', '#f5a524', '#b15cff', '#14b8a6', '#ec4899', '#84cc16'];
  v_count integer;
begin
  if p_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not private.hit_rate_limit('redeem:' || p_user::text, 20, 3600) then
    raise exception 'too many attempts' using errcode = '54000';
  end if;
  v_plan := private.find_valid_invite(p_code, p_token);
  if v_plan is null then
    raise exception 'invalid or expired invitation' using errcode = '42501';
  end if;
  if exists (select 1 from public.plan_members m where m.plan_id = v_plan and m.user_id = p_user) then
    return v_plan;
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'display name must be 1-40 characters' using errcode = '22023';
  end if;
  select count(*) into v_count from public.plan_members m where m.plan_id = v_plan;
  if v_count >= 50 then
    raise exception 'plan is full' using errcode = '54000';
  end if;
  insert into public.plan_members (plan_id, user_id, role, display_name, color)
  values (v_plan, p_user, 'guest', v_name, v_colors[(v_count % array_length(v_colors, 1)) + 1]);
  update public.plan_invites i set uses = i.uses + 1
  where i.plan_id = v_plan and i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  insert into public.plan_events (plan_id, kind, payload)
  values (v_plan, 'member_joined', jsonb_build_object('display_name', v_name));
  return v_plan;
end;
$$;

create or replace function public.redeem_invite(p_code text, p_token text, p_display_name text)
returns uuid
language sql volatile security definer
set search_path = ''
as $$
  select private.redeem_invite_core((select auth.uid()), p_code, p_token, p_display_name);
$$;
revoke execute on function public.redeem_invite(text, text, text) from public, anon;
grant execute on function public.redeem_invite(text, text, text) to authenticated;

create or replace function public.check_invite(p_code text, p_token text)
returns table (plan_id uuid, title text, organizer_name text, member_count integer)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.title,
    (select m.display_name from public.plan_members m where m.plan_id = p.id and m.role = 'organizer' limit 1),
    (select count(*)::integer from public.plan_members m where m.plan_id = p.id)
  from public.plans p
  where p.id = private.find_valid_invite(p_code, p_token);
$$;
revoke execute on function public.check_invite(text, text) from public, anon, authenticated;
grant execute on function public.check_invite(text, text) to service_role;

create or replace function public.redeem_invite_as(p_user uuid, p_code text, p_token text, p_display_name text)
returns uuid
language sql volatile security definer
set search_path = ''
as $$
  select private.redeem_invite_core(p_user, p_code, p_token, p_display_name);
$$;
revoke execute on function public.redeem_invite_as(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.redeem_invite_as(uuid, text, text, text) to service_role;

create or replace function public.edge_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language sql volatile security definer
set search_path = ''
as $$
  select private.hit_rate_limit(p_bucket, p_max, p_window_seconds);
$$;
revoke execute on function public.edge_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.edge_rate_limit(text, integer, integer) to service_role;
grant execute on function private.hit_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Finalization (organizer only, stale-version protected)
-- ---------------------------------------------------------------------------
create or replace function public.finalize_plan(
  p_plan uuid, p_candidate uuid, p_expected_version bigint, p_snapshot jsonb, p_notes text
)
returns bigint
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_plan public.plans%rowtype;
  v_version bigint;
begin
  select * into v_plan from public.plans where id = p_plan for update;
  if not found or v_plan.owner_id is distinct from v_uid then
    raise exception 'only the organizer can finalize this plan' using errcode = '42501';
  end if;
  if v_plan.status <> 'collecting' then
    raise exception 'plan is already finalized' using errcode = '55000';
  end if;
  if v_plan.version <> p_expected_version then
    raise exception 'plan changed since you reviewed it (stale version)' using errcode = '40001';
  end if;
  if not exists (select 1 from public.candidates c where c.id = p_candidate and c.plan_id = p_plan and c.status = 'active') then
    raise exception 'candidate does not belong to this plan' using errcode = '22023';
  end if;

  update public.plans
  set status = 'finalized', finalized_candidate_id = p_candidate, finalized_at = now(),
      final_snapshot = p_snapshot, final_notes = left(p_notes, 2000)
  where id = p_plan
  returning version into v_version;

  insert into public.plan_events (plan_id, actor_member_id, kind, payload)
  values (p_plan, private.my_member_id(p_plan), 'plan_finalized', jsonb_build_object('candidate_id', p_candidate));

  insert into public.notifications (plan_id, recipient_user_id, kind, title, body, dedupe_key)
  select p_plan, m.user_id, 'plan_finalized', 'Plan finalized: ' || v_plan.title,
    coalesce(p_snapshot ->> 'headline', 'The plan is set.'),
    'plan_finalized:' || p_plan::text || ':' || m.user_id::text
  from public.plan_members m where m.plan_id = p_plan
  on conflict (dedupe_key) do nothing;

  return v_version;
end;
$$;
revoke execute on function public.finalize_plan(uuid, uuid, bigint, jsonb, text) from public, anon;
grant execute on function public.finalize_plan(uuid, uuid, bigint, jsonb, text) to authenticated;

create or replace function public.reopen_plan(p_plan uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if not private.is_plan_organizer(p_plan) then
    raise exception 'only the organizer can reopen this plan' using errcode = '42501';
  end if;
  update public.plans
  set status = 'collecting', finalized_candidate_id = null, finalized_at = null, final_snapshot = null
  where id = p_plan and status = 'finalized';
  insert into public.plan_events (plan_id, actor_member_id, kind) values (p_plan, private.my_member_id(p_plan), 'plan_reopened');
end;
$$;
revoke execute on function public.reopen_plan(uuid) from public, anon;
grant execute on function public.reopen_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guest -> account claim. Proof of the guest session: the ticket can only be
-- created while authenticated as that guest. Display names are never used.
-- ---------------------------------------------------------------------------
create or replace function public.create_claim_ticket()
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ticket text;
begin
  if v_uid is null or not private.is_guest() then
    raise exception 'only guest sessions can create a claim ticket' using errcode = '42501';
  end if;
  v_ticket := encode(extensions.gen_random_bytes(24), 'hex');
  insert into private.claim_tickets (ticket_hash, guest_user_id, expires_at)
  values (encode(extensions.digest(v_ticket, 'sha256'), 'hex'), v_uid, now() + interval '30 minutes');
  return v_ticket;
end;
$$;
revoke execute on function public.create_claim_ticket() from public, anon;
grant execute on function public.create_claim_ticket() to authenticated;

create or replace function public.redeem_claim_ticket(p_ticket text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_guest uuid;
  v_moved integer := 0;
  v_skipped integer := 0;
  r record;
begin
  if v_uid is null or private.is_guest() then
    raise exception 'sign in to an account before claiming' using errcode = '42501';
  end if;
  update private.claim_tickets t
  set used_at = now(), used_by = v_uid
  where t.ticket_hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex')
    and t.used_at is null and t.expires_at > now()
  returning t.guest_user_id into v_guest;
  if v_guest is null then
    raise exception 'claim ticket is invalid or expired' using errcode = '42501';
  end if;
  perform set_config('crowdplan.allow_member_rebind', 'on', true);
  for r in select m.id, m.plan_id from public.plan_members m where m.user_id = v_guest loop
    if exists (select 1 from public.plan_members x where x.plan_id = r.plan_id and x.user_id = v_uid) then
      v_skipped := v_skipped + 1;
    else
      update public.plan_members set user_id = v_uid where id = r.id;
      v_moved := v_moved + 1;
    end if;
  end loop;
  perform set_config('crowdplan.allow_member_rebind', 'off', true);
  return jsonb_build_object('moved', v_moved, 'skipped', v_skipped);
end;
$$;
revoke execute on function public.redeem_claim_ticket(text) from public, anon;
grant execute on function public.redeem_claim_ticket(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: members subscribe to their plan row (version bumps) and their own
-- notifications. postgres_changes enforces the SELECT policies above.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.plans;
alter publication supabase_realtime add table public.notifications;

-- ---------------------------------------------------------------------------
-- Defense in depth: private functions are never executable by PUBLIC/anon.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
alter default privileges in schema private revoke execute on functions from public;
grant execute on function private.is_guest() to authenticated, service_role;
grant execute on function private.is_plan_member(uuid) to authenticated, service_role;
grant execute on function private.is_plan_organizer(uuid) to authenticated, service_role;
grant execute on function private.my_member_id(uuid) to authenticated, service_role;
grant execute on function private.plan_is_open(uuid) to authenticated, service_role;
grant execute on function private.gen_share_code() to authenticated, service_role;
