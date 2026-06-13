-- Supabase cron for hourly report-day auto-sync.
-- This job calls the /api/report-day/auto-sync endpoint hosted on the VPS.
-- The endpoint URL and the secret are read from Supabase Vault, so no host or secret value is stored here.
-- Prerequisites:
-- - create a Vault secret named `report_day_auto_sync_url`
-- - create a Vault secret named `report_day_auto_sync_secret`

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.dispatch_report_day_auto_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  cron_secret text;
  target_date text;
begin
  select decrypted_secret
    into base_url
  from vault.decrypted_secrets
  where name = 'report_day_auto_sync_url'
  limit 1;

  if base_url is null or length(trim(base_url)) = 0 then
    raise exception 'Missing cron base url report_day_auto_sync_url';
  end if;

  select decrypted_secret
    into cron_secret
  from vault.decrypted_secrets
  where name = 'report_day_auto_sync_secret'
  limit 1;

  if cron_secret is null or length(trim(cron_secret)) = 0 then
    raise exception 'Missing cron secret report_day_auto_sync_secret';
  end if;

  base_url := regexp_replace(trim(base_url), '/+$', '');
  target_date := to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM-DD');

  perform net.http_post(
    url := base_url || '/api/report-day/auto-sync?date=' || target_date || '&force=true',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

do $$
declare
  existing_job_id integer;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'report_day_auto_sync_hourly'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'hile_report_day_auto_sync_hourly'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end $$;

select cron.schedule(
  'hile_report_day_auto_sync_hourly',
  '0 * * * *',
  $$select public.dispatch_report_day_auto_sync();$$
);

-- Optional verification:
-- select jobid, jobname, schedule, command
-- from cron.job
-- where jobname = 'hile_report_day_auto_sync_hourly';
