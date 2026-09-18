-- Epic J J-11 / J-17: register the queue drain. Every 5 minutes; the advisory lock in
-- admin.cron_ingest_worker() prevents overlapping runs if one takes longer than the gap.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ingest-worker-drain') then
    perform cron.unschedule('ingest-worker-drain');
  end if;
  perform cron.schedule('ingest-worker-drain', '*/5 * * * *', 'SELECT admin.cron_ingest_worker()');
end $$;
