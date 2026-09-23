-- Least-privilege login role used by the Next.js server for work that must not
-- be client-writable: provider cache, search budgets/ledger, live candidate
-- enrichment, notifications fan-out and scheduled jobs.
-- The role is created NOLOGIN here; LOGIN and its password are set out-of-band
-- per environment (never committed):
--   alter role crowdplan_server with login password '<generated>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'crowdplan_server') then
    create role crowdplan_server nologin noinherit;
  end if;
end;
$$;

grant usage on schema public, private, extensions to crowdplan_server;
grant select on all tables in schema public to crowdplan_server;
grant insert, update on public.candidates, public.candidate_components, public.notifications,
  public.plan_events, public.proposals to crowdplan_server;
grant update (searches_used, search_budget, updated_at, version) on public.plans to crowdplan_server;
grant update (enrichment_status) on public.candidates to crowdplan_server;
grant select, insert, update, delete on private.provider_cache, private.search_ledger,
  private.rate_limits, private.job_runs to crowdplan_server;
grant select on private.app_settings to crowdplan_server;
grant execute on function private.hit_rate_limit(text, integer, integer) to crowdplan_server;
grant execute on function private.is_guest(), private.is_plan_member(uuid), private.is_plan_organizer(uuid),
  private.my_member_id(uuid), private.plan_is_open(uuid) to crowdplan_server;

-- RLS: the server role has explicit, table-scoped policies (it is not BYPASSRLS).
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'plans', 'plan_members', 'plan_invites', 'plan_dimensions',
    'member_responses', 'plan_constraints', 'clarifications', 'availability_windows', 'candidates',
    'candidate_components', 'reactions', 'proposals', 'proposal_answers', 'notifications', 'plan_events',
    'saved_preferences']
  loop
    execute format('create policy %I on public.%I for select to crowdplan_server using (true)', t || '_server_read', t);
  end loop;
  foreach t in array array['candidates', 'candidate_components', 'notifications', 'plan_events', 'proposals', 'plans']
  loop
    execute format('create policy %I on public.%I for update to crowdplan_server using (true) with check (true)', t || '_server_update', t);
  end loop;
  foreach t in array array['candidates', 'candidate_components', 'notifications', 'plan_events', 'proposals']
  loop
    execute format('create policy %I on public.%I for insert to crowdplan_server with check (true)', t || '_server_insert', t);
  end loop;
  foreach t in array array['provider_cache', 'search_ledger', 'rate_limits', 'job_runs', 'app_settings']
  loop
    execute format('create policy %I on private.%I for all to crowdplan_server using (true) with check (true)', t || '_server_all', t);
  end loop;
end;
$$;
