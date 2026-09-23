-- 1) Travel search refresh replaces its own live/estimate components.
grant delete on public.candidate_components to crowdplan_server;
create policy candidate_components_server_delete on public.candidate_components for delete to crowdplan_server
  using (source_kind in ('live', 'estimate'));

-- 2) Account email (for optional email notifications). Copied from auth.users for
--    account holders only; guest identities never get an email stored here.
alter table public.profiles add column email text check (char_length(email) <= 320);

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 60), ''),
    case when coalesce((new.raw_app_meta_data ->> 'cp_guest')::boolean, false) then null else new.email end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and not coalesce((new.raw_app_meta_data ->> 'cp_guest')::boolean, false) then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.sync_profile_email();

update public.profiles p set email = u.email
from auth.users u
where u.id = p.id and not coalesce((u.raw_app_meta_data ->> 'cp_guest')::boolean, false);

revoke execute on all functions in schema private from public, anon;
