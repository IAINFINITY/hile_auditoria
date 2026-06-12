-- Supabase cron for hourly report-day auto-sync.
-- This job calls the existing /api/report-day/auto-sync endpoint.
-- The secret is read from Supabase Vault, so no secret value is stored here.
-- Prerequisite: create a Vault secret named `report_day_auto_sync_secret`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.dispatch_report_day_auto_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cron_secret text;
  target_date text;
begin
  select decrypted_secret
    into cron_secret
  from vault.decrypted_secrets
  where name = 'report_day_auto_sync_secret'
  limit 1;

  if cron_secret is null or length(trim(cron_secret)) = 0 then
    raise exception 'Missing cron secret report_day_auto_sync_secret';
  end if;

  target_date := to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM-DD');

  perform net.http_post(
    url := 'https://hile-auditoria.vercel.app/api/report-day/auto-sync?date=' || target_date || '&force=true',
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
