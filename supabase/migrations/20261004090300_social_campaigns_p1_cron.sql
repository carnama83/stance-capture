-- Facebook Campaign Manager, Phase 1: missed-task marking.
--
-- SQL only (no HTTP, no secrets), so it is safe to register identically on Dev,
-- UAT and Prod. Every 5 minutes:
--   * open tasks of ACTIVE campaigns more than 60 minutes past their slot become
--     'missed' (PDD §10: no burst backfill; a post can still be recorded late);
--   * active campaigns whose last day has ended and have no open tasks complete.
-- Paused campaigns are left alone; resume skips their overdue tasks.

create or replace function admin.cron_mark_missed_social_jobs()
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_missed int;
  v_done int;
begin
  update public.social_campaign_jobs j
     set status = 'missed', skip_reason = 'not posted within 60 minutes of the slot'
    from public.social_campaigns c
   where c.id = j.campaign_id
     and c.status = 'active'
     and j.status in ('scheduled', 'claimed')
     and j.scheduled_at < now() - interval '60 minutes';
  get diagnostics v_missed = row_count;

  update public.social_campaigns c
     set status = 'completed', completed_at = now()
   where c.status = 'active'
     and ((c.start_date + c.duration_days)::timestamp at time zone c.timezone) <= now()
     and not exists (select 1 from public.social_campaign_jobs j
                      where j.campaign_id = c.id and j.status in ('scheduled', 'claimed'));
  get diagnostics v_done = row_count;

  if v_missed > 0 or v_done > 0 then
    insert into admin.cron_runs (job, finished_at, ok, message)
    values ('social_mark_missed_jobs', now(), true, format('missed=%s completed=%s', v_missed, v_done));
  end if;
end $$;

revoke all on function admin.cron_mark_missed_social_jobs() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'social_mark_missed_jobs') then
    perform cron.schedule('social_mark_missed_jobs', '*/5 * * * *',
      $cron$select admin.cron_mark_missed_social_jobs();$cron$);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'social_mark_missed_jobs' and active) then
    raise exception 'social_mark_missed_jobs cron job missing or inactive';
  end if;
end $$;
