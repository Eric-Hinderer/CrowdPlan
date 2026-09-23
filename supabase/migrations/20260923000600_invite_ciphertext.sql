-- Organizers need to re-copy their share link. The bearer token is stored only
-- as (a) a SHA-256 verifier used for redemption and (b) an AES-256-GCM
-- ciphertext encrypted with a server-only key (CROWDPLAN_INVITE_KEY). A
-- database read alone never yields a usable token.
alter table public.plan_invites add column token_ciphertext text check (char_length(token_ciphertext) <= 400);
grant insert (token_ciphertext) on public.plan_invites to authenticated;

create or replace function public.create_plan(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
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
  values (v_uid, p ->> 'title', p ->> 'raw_input', coalesce(p ->> 'kind', 'activity'), coalesce(p ->> 'mode', 'criteria'),
    coalesce((p ->> 'discovery_enabled')::boolean, false), coalesce(p ->> 'timezone', 'America/Chicago'),
    p ->> 'location_label', (p ->> 'location_lat')::double precision, (p ->> 'location_lng')::double precision,
    coalesce((p ->> 'min_duration_minutes')::integer, 120), (p ->> 'decide_by')::timestamptz,
    coalesce((p ->> 'is_demo')::boolean, false), p ->> 'test_run_id')
  returning id into v_plan;

  insert into public.plan_members (plan_id, user_id, role, display_name, color, emoji)
  values (v_plan, v_uid, 'organizer', coalesce(nullif(p ->> 'organizer_name', ''), 'Organizer'),
    coalesce(p ->> 'organizer_color', '#5b3df5'), p ->> 'organizer_emoji')
  returning id into v_member;

  for d in select * from jsonb_array_elements(coalesce(p -> 'dimensions', '[]'::jsonb)) loop
    insert into public.plan_dimensions (plan_id, key, label, state, value, display, source, needs_confirmation, sort)
    values (v_plan, d ->> 'key', d ->> 'label', d ->> 'state', d -> 'value', d ->> 'display',
      coalesce(d ->> 'source', 'user'), coalesce((d ->> 'needs_confirmation')::boolean, false), coalesce((d ->> 'sort')::integer, 0));
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p -> 'candidates', '[]'::jsonb)) loop
    insert into public.candidates (plan_id, type, title, description, origin, source_kind, source_url, address, cost, attributes, added_by, enrichment_status)
    values (v_plan, coalesce(c ->> 'type', 'custom'), c ->> 'title', c ->> 'description', coalesce(c ->> 'origin', 'shortlist'),
      coalesce(c ->> 'source_kind', 'user'), c ->> 'source_url', c ->> 'address', c -> 'cost',
      coalesce(c -> 'attributes', '{}'::jsonb), v_member, coalesce(c ->> 'enrichment_status', 'none'));
  end loop;

  if p ? 'invite_token_hash' then
    insert into public.plan_invites (plan_id, token_hash, token_ciphertext, created_by, expires_at)
    values (v_plan, p ->> 'invite_token_hash', p ->> 'invite_token_ciphertext', v_uid, (p ->> 'invite_expires_at')::timestamptz);
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
