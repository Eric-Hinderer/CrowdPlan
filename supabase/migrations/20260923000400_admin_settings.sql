-- Service-role-only accessor for private settings used by edge functions.
create or replace function public.get_app_setting(p_key text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select s.value from private.app_settings s where s.key = p_key;
$$;
revoke execute on function public.get_app_setting(text) from public, anon, authenticated;
grant execute on function public.get_app_setting(text) to service_role;
