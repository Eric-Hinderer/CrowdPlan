-- Stale finalization returns HTTP 409 (PostgREST PT409) instead of SQLSTATE
-- 40001, which PostgREST reports as a retryable 503.
create or replace function public.finalize_plan(p_plan uuid, p_candidate uuid, p_expected_version bigint, p_snapshot jsonb, p_notes text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
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
    raise exception 'plan is already finalized' using errcode = 'PT409';
  end if;
  if v_plan.version <> p_expected_version then
    raise exception 'plan changed since you reviewed it (stale version)' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.candidates c where c.id = p_candidate and c.plan_id = p_plan and c.status = 'active') then
    raise exception 'candidate does not belong to this plan' using errcode = '22023';
  end if;
  update public.plans
  set status = 'finalized', finalized_candidate_id = p_candidate, finalized_at = now(),
      final_snapshot = p_snapshot, final_notes = left(p_notes, 2000)
  where id = p_plan returning version into v_version;
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
