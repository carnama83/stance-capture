-- Epic J remediation, Sep 2026 — J-02, J-02b, J-03, J-05.
-- Adds a real authorization guard to every unguarded SECURITY DEFINER admin RPC
-- and revokes EXECUTE from anon/PUBLIC. Follows the Epic H H-01 / H-01b pattern.
-- Parameter defaults are reproduced exactly (get_cron_job_history, list_pipeline_jobs).

create or replace function public.assert_admin_caller()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_role   text;
begin
  v_role := case when coalesce(v_claims, '') = '' then null else (v_claims::jsonb ->> 'role') end;

  if v_role = 'service_role' then
    return;
  end if;

  if v_role is null and session_user <> 'authenticator' then
    return;
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;
end
$fn$;

revoke all on function public.assert_admin_caller() from public, anon;
grant execute on function public.assert_admin_caller() to authenticated, service_role;

create or replace function public.get_all_cron_jobs()
returns table(jobid bigint, schedule text, command text, nodename text, nodeport integer,
              database text, username text, active boolean, jobname text)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  return query
  select cj.jobid, cj.schedule, cj.command, cj.nodename, cj.nodeport,
         cj.database, cj.username, cj.active, cj.jobname
  from cron.job cj order by cj.jobid;
end
$fn$;

create or replace function public.get_all_cron_jobs_secure()
returns table(jobid bigint, schedule text, command text, nodename text, nodeport integer,
              database text, username text, active boolean, jobname text)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  return query
  select cj.jobid, cj.schedule, cj.command, cj.nodename, cj.nodeport,
         cj.database, cj.username, cj.active, cj.jobname
  from cron.job cj order by cj.jobid;
end
$fn$;

create or replace function public.get_cron_job_history(
  p_jobid bigint default null::bigint, p_limit integer default 50)
returns table(jobid bigint, runid bigint, job_pid integer, database text, username text,
              command text, status text, return_message text,
              start_time timestamp with time zone, end_time timestamp with time zone,
              duration interval)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  return query
  select jrd.jobid, jrd.runid, jrd.job_pid, jrd.database, jrd.username, jrd.command,
         jrd.status, jrd.return_message, jrd.start_time, jrd.end_time,
         jrd.end_time - jrd.start_time as duration
  from cron.job_run_details jrd
  where p_jobid is null or jrd.jobid = p_jobid
  order by jrd.start_time desc
  limit p_limit;
end
$fn$;

create or replace function public.get_cron_job_history_secure(
  p_jobid bigint default null::bigint, p_limit integer default 50)
returns table(jobid bigint, runid bigint, job_pid integer, database text, username text,
              command text, status text, return_message text,
              start_time timestamp with time zone, end_time timestamp with time zone,
              duration interval)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  return query
  select jrd.jobid, jrd.runid, jrd.job_pid, jrd.database, jrd.username, jrd.command,
         jrd.status, jrd.return_message, jrd.start_time, jrd.end_time,
         jrd.end_time - jrd.start_time as duration
  from cron.job_run_details jrd
  where p_jobid is null or jrd.jobid = p_jobid
  order by jrd.start_time desc
  limit p_limit;
end
$fn$;

create or replace function public.get_cron_job_stats(p_jobid bigint)
returns table(jobid bigint, total_runs bigint, successful_runs bigint, failed_runs bigint,
              avg_duration_seconds numeric, last_run_time timestamp with time zone,
              last_run_status text, next_run_estimate timestamp with time zone)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  return query
  select jrd.jobid,
         count(*) as total_runs,
         count(*) filter (where jrd.status = 'succeeded') as successful_runs,
         count(*) filter (where jrd.status = 'failed') as failed_runs,
         avg(extract(epoch from (jrd.end_time - jrd.start_time)))::numeric as avg_duration_seconds,
         max(jrd.start_time) as last_run_time,
         (select jrd2.status from cron.job_run_details jrd2
           where jrd2.jobid = p_jobid order by jrd2.start_time desc limit 1) as last_run_status,
         null::timestamptz as next_run_estimate
  from cron.job_run_details jrd
  where jrd.jobid = p_jobid
  group by jrd.jobid;
end
$fn$;

create or replace function public.get_cron_job_stats_secure(p_jobid bigint)
returns table(jobid bigint, total_runs bigint, successful_runs bigint, failed_runs bigint,
              avg_duration_seconds numeric, last_run_time timestamp with time zone,
              last_run_status text)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  return query
  select jrd.jobid,
         count(*) as total_runs,
         count(*) filter (where jrd.status = 'succeeded') as successful_runs,
         count(*) filter (where jrd.status = 'failed') as failed_runs,
         avg(extract(epoch from (jrd.end_time - jrd.start_time)))::numeric as avg_duration_seconds,
         max(jrd.start_time) as last_run_time,
         (select jrd2.status from cron.job_run_details jrd2
           where jrd2.jobid = p_jobid order by jrd2.start_time desc limit 1) as last_run_status
  from cron.job_run_details jrd
  where jrd.jobid = p_jobid
  group by jrd.jobid;
end
$fn$;

create or replace function public.create_cron_job(p_jobname text, p_schedule text, p_command text)
returns table(result_jobid bigint, result_success boolean, result_message text)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
declare v_new_jobid bigint;
begin
  perform public.assert_admin_caller();
  if p_jobname is null or p_schedule is null or p_command is null then
    return query select null::bigint, false, 'Missing required parameters'::text;
    return;
  end if;
  select cron.schedule(p_jobname, p_schedule, p_command) into v_new_jobid;
  return query select v_new_jobid, true, 'Job created successfully'::text;
exception
  when insufficient_privilege then raise;
  when others then return query select null::bigint, false, sqlerrm::text;
end
$fn$;

create or replace function public.create_cron_job_secure(p_jobname text, p_schedule text, p_command text)
returns table(result_jobid bigint, result_success boolean, result_message text)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
declare v_new_jobid bigint;
begin
  perform public.assert_admin_caller();
  if p_jobname is null or p_schedule is null or p_command is null then
    return query select null::bigint, false, 'Missing required parameters'::text;
    return;
  end if;
  select cron.schedule(p_jobname, p_schedule, p_command) into v_new_jobid;
  return query select v_new_jobid, true, 'Job created successfully'::text;
exception
  when insufficient_privilege then raise;
  when others then return query select null::bigint, false, sqlerrm::text;
end
$fn$;

create or replace function public.delete_cron_job(p_jobid bigint)
returns table(result_success boolean, result_message text)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  if not exists (select 1 from cron.job cj where cj.jobid = p_jobid) then
    return query select false, 'Job not found'::text;
    return;
  end if;
  perform cron.unschedule(p_jobid);
  return query select true, 'Job deleted successfully'::text;
exception
  when insufficient_privilege then raise;
  when others then return query select false, sqlerrm::text;
end
$fn$;

create or replace function public.delete_cron_job_secure(p_jobid bigint)
returns table(result_success boolean, result_message text)
language plpgsql security definer set search_path = public, cron, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  if not exists (select 1 from cron.job cj where cj.jobid = p_jobid) then
    return query select false, 'Job not found'::text;
    return;
  end if;
  perform cron.unschedule(p_jobid);
  return query select true, 'Job deleted successfully'::text;
exception
  when insufficient_privilege then raise;
  when others then return query select false, sqlerrm::text;
end
$fn$;

create or replace function public.list_pipeline_jobs(
  p_limit integer default 50, p_status text default null::text, p_job_type text default null::text)
returns table(id uuid, job_type text, source_name text, status text,
              started_at timestamp with time zone, finished_at timestamp with time zone,
              duration_ms integer, items_processed integer, error_message text,
              retry_count integer, resolved boolean, resolved_note text)
language plpgsql stable security definer set search_path = public, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  return query
  select pj.id, pj.job_type, ts.name as source_name, pj.status, pj.started_at, pj.finished_at,
         pj.duration_ms, pj.items_processed, pj.error_message, pj.retry_count,
         pj.resolved, pj.resolved_note
  from public.pipeline_jobs pj
  left join public.topic_sources ts on ts.id = pj.source_id
  where (p_status is null or pj.status = p_status)
    and (p_job_type is null or pj.job_type = p_job_type)
  order by pj.started_at desc
  limit p_limit;
end
$fn$;

create or replace function public.admin_claim_ingest_jobs(p_limit integer)
returns setof public.ingestion_queue
language plpgsql security definer set search_path = public, auth, pg_temp
as $fn$
declare
  claimed_ids uuid[];
  v_stale_after interval := interval '15 minutes';
begin
  perform public.assert_admin_caller();

  update public.ingestion_queue q
     set status = 'error'
   where q.status = 'running'
     and q.started_at is not null
     and q.started_at < now() - v_stale_after;

  with upd as (
    update public.ingestion_queue q
       set status = 'running', started_at = now()
     where q.id in (
       select id from public.ingestion_queue
       where status in ('pending','new','error')
       order by created_at asc
       limit greatest(p_limit, 1)
       for update skip locked
     )
     returning q.id
  )
  select coalesce(array_agg(id), '{}') into claimed_ids from upd;

  return query select * from public.ingestion_queue where id = any(claimed_ids);
end
$fn$;

create or replace function public.admin_finish_ingest_job(p_id uuid, p_status text, p_error text)
returns void
language plpgsql security definer set search_path = public, auth, pg_temp
as $fn$
declare v_source_id uuid;
begin
  perform public.assert_admin_caller();

  update public.ingestion_queue q
  set status = p_status,
      finished_at = case when p_status in ('done','error') then now() else q.finished_at end,
      error_msg = case when p_status = 'error' then left(coalesce(p_error,''), 1000) else null end
  where q.id = p_id
  returning q.source_id into v_source_id;

  if v_source_id is null then return; end if;

  update public.topic_sources s
  set last_status = p_status,
      last_error  = case when p_status = 'error' then left(coalesce(p_error,''), 1000) else null end,
      last_polled_at = now(),
      success_count = coalesce(s.success_count, 0) + case when p_status = 'done' then 1 else 0 end,
      failure_count = coalesce(s.failure_count, 0) + case when p_status = 'error' then 1 else 0 end
  where s.id = v_source_id;
end
$fn$;

create or replace function public.admin_pull_back_live_question(p_draft_id uuid)
returns integer
language plpgsql security definer set search_path = public, auth, pg_temp
as $fn$
declare v_deleted int := 0;
begin
  perform public.assert_admin_caller();

  if exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='questions' and column_name='draft_id') then
    delete from public.questions where draft_id = p_draft_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  if exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='questions' and column_name='question_draft_id') then
    delete from public.questions where question_draft_id = p_draft_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  if exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='live_questions' and column_name='draft_id') then
    delete from public.live_questions where draft_id = p_draft_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  if exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='live_questions' and column_name='question_draft_id') then
    delete from public.live_questions where question_draft_id = p_draft_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  raise exception
    'No supported live table/column found. Expected questions/live_questions with draft_id or question_draft_id.';
end
$fn$;

do $rev$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.get_all_cron_jobs()',
    'public.get_all_cron_jobs_secure()',
    'public.get_cron_job_history(bigint, integer)',
    'public.get_cron_job_history_secure(bigint, integer)',
    'public.get_cron_job_stats(bigint)',
    'public.get_cron_job_stats_secure(bigint)',
    'public.create_cron_job(text, text, text)',
    'public.create_cron_job_secure(text, text, text)',
    'public.delete_cron_job(bigint)',
    'public.delete_cron_job_secure(bigint)',
    'public.list_pipeline_jobs(integer, text, text)',
    'public.admin_claim_ingest_jobs(integer)',
    'public.admin_finish_ingest_job(uuid, text, text)',
    'public.admin_pull_back_live_question(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end
$rev$;
