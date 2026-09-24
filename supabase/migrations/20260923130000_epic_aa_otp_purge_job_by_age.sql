-- Epic AA (AA-05 / AA-17 follow-up), 23 Sep 2026.
--
-- Prod has a pg_cron job, whatsapp-phone-verifications-purge (30 3 * * *), that
-- Dev and UAT never had. It ran:
--     DELETE FROM public.whatsapp_phone_verifications WHERE expires_at < now()
-- A code expires 10 minutes after it is created, so every night this deleted
-- all but the last 10 minutes of rows. The AA-05 OTP rate limits count rows
-- created in the last 10 minutes (per phone) and the last hour (per IP, and
-- globally), so each nightly run silently reset those counters.
--
-- Align it with the AA-17 rule used by whatsapp-claim-anonymous-stances: remove
-- rows of any state once they are over 24 hours old. Only the command changes;
-- the schedule and the job itself are kept. Where the job does not exist
-- (Dev, UAT) this does nothing.
do $job$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'whatsapp-phone-verifications-purge';
  if v_jobid is null then
    raise notice 'whatsapp-phone-verifications-purge not present; nothing to change';
    return;
  end if;
  perform cron.alter_job(
    job_id  := v_jobid,
    command := $cmd$DELETE FROM public.whatsapp_phone_verifications WHERE created_at < now() - interval '24 hours'$cmd$
  );
end
$job$;
