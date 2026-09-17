-- Epic J, Sep 2026 — J-19: admin_claim_ingest_jobs starved new work behind failures.
--
-- The claim set was ('pending','new','error') ordered by created_at asc. On Dev, ~20 rows
-- created in a one-second window on 17 Aug fail every time and are marginally OLDER than
-- the oldest 'new' row, so they were re-claimed on every single cycle, failed again,
-- returned to 'error', and were claimed again. 2,802 'new' rows behind them had NEVER been
-- claimed once (started_at IS NULL on all of them, including rows from 17 Aug).
-- That, not Edge compute capacity, is why the backlog never moved (J-17).
--
-- Fix: new/pending work is claimed first, and an 'error' row is only retried after a
-- one-hour backoff. Failures still retry, but they can no longer block fresh work.
create or replace function public.admin_claim_ingest_jobs(p_limit integer)
returns setof public.ingestion_queue
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  claimed_ids uuid[];
  v_stale_after interval := interval '15 minutes';
  v_retry_after interval := interval '1 hour';
begin
  perform public.assert_admin_caller();

  -- Requeue jobs that hung without a finish signal.
  update public.ingestion_queue q
     set status = 'error'
   where q.status = 'running'
     and q.started_at is not null
     and q.started_at < now() - v_stale_after;

  with upd as (
    update public.ingestion_queue q
       set status = 'running', started_at = now()
     where q.id in (
       select id
       from public.ingestion_queue
       where status in ('pending','new')
          or (status = 'error'
              and (finished_at is null or finished_at < now() - v_retry_after))
       -- Fresh work first; a failing row can no longer starve the queue behind it.
       order by (status = 'error'), created_at asc
       limit greatest(p_limit, 1)
       for update skip locked
     )
     returning q.id
  )
  select coalesce(array_agg(id), '{}') into claimed_ids from upd;

  return query select * from public.ingestion_queue where id = any(claimed_ids);
end
$fn$;

revoke all on function public.admin_claim_ingest_jobs(integer) from public, anon;
grant execute on function public.admin_claim_ingest_jobs(integer) to authenticated, service_role;
