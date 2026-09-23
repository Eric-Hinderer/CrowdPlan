-- Scheduled jobs: pg_cron calls the app's authenticated job endpoint through
-- pg_net every 10 minutes. The endpoint URL and shared secret are stored per
-- environment in private.app_settings ('jobs_url', 'jobs_secret'), inserted
-- out-of-band — never committed.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function private.dispatch_jobs()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.app_settings where key = 'jobs_url';
  select value into v_secret from private.app_settings where key = 'jobs_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-job-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
revoke execute on function private.dispatch_jobs() from public, anon, authenticated;

select cron.schedule('crowdplan-jobs', '*/10 * * * *', $$select private.dispatch_jobs()$$);

-- Keep job history bounded.
select cron.schedule('crowdplan-job-history-trim', '17 3 * * *', $$delete from private.job_runs where created_at < now() - interval '30 days'$$);
