-- Epic J, Sep 2026 — J-11/J-17 (schedule the queue drain) and the two long-standing
-- feature gaps M-J03 (J-FR-33 source test-connection) and M-J04 (J-FR-34 pipeline retry).

-- ── J-11 + J-17: drain the ingestion queue on a schedule ────────────────────
-- Dev had 2,802 rows stuck in 'new' because nothing ever invoked ingest-worker on a
-- timer (J-11) and a single manual run drains only a fraction before hitting the Edge
-- compute ceiling (J-17). Follows the established admin.cron_* shape: advisory lock,
-- vault secrets, PROJECT_URL, result logged to admin.cron_runs.
create or replace function admin.cron_ingest_worker()
returns void
language plpgsql
security definer
set search_path = public, extensions, admin, vault, pg_temp
set statement_timeout = '90s'
as $fn$
declare
  lock_key bigint := hashtext('admin.cron_ingest_worker');
  got_lock boolean;
  v_cron   text;
  v_svc    text;
  v_base   text;
  r        extensions.http_response;
  v_status int;
  v_body   text;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message, finished_at)
    values ('ingest_worker', true, 'skipped: lock busy', now());
    return;
  end if;

  select decrypted_secret into v_cron from vault.decrypted_secrets where name='cron_secret' limit 1;
  select decrypted_secret into v_svc  from vault.decrypted_secrets where name='service_role_key' limit 1;
  select rtrim(decrypted_secret,'/') into v_base from vault.decrypted_secrets where name='PROJECT_URL' limit 1;

  if v_cron is null or v_svc is null or v_base is null or v_base = '' then
    perform pg_advisory_unlock(lock_key);
    raise exception 'cron_ingest_worker: missing vault secret (cron_secret / service_role_key / PROJECT_URL)';
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '75000');
  select * from extensions.http((
    'POST',
    v_base || '/functions/v1/ingest-worker',
    array[
      -- ingest-worker is deployed verify_jwt=true, so the gateway needs a real JWT;
      -- x-cron-secret alone only satisfies the function's own authorize() (Epic J J-15).
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('apikey', v_svc),
      extensions.http_header('x-cron-secret', v_cron),
      extensions.http_header('content-type', 'application/json')
    ]::extensions.http_header[],
    'application/json', '{}'::text)) into r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);

  insert into admin.cron_runs(job, finished_at, ok, http_status, message)
  values ('ingest_worker', now(), (v_status = 200), v_status, v_body);

  perform pg_advisory_unlock(lock_key);
exception when others then
  begin
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('ingest_worker', now(), false, sqlerrm);
  exception when others then
  end;
  perform pg_advisory_unlock(lock_key);
  raise;
end
$fn$;

-- ── J-FR-33 / M-J03: non-destructive source endpoint probe ──────────────────
-- Deliberately does NOT write to ingestion_queue and does NOT touch topic_sources
-- health counters, which is exactly what distinguishes it from the existing Run button.
create or replace function public.test_source_connection(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '30s'
as $fn$
declare
  v_endpoint text;
  v_name     text;
  v_t0       timestamptz;
  r          extensions.http_response;
  v_status   int;
  v_ctype    text;
begin
  perform public.assert_admin_caller();

  select endpoint, name into v_endpoint, v_name
  from public.topic_sources where id = p_source_id;

  if v_endpoint is null then
    return jsonb_build_object('ok', false, 'error', 'source not found');
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '12000');
  v_t0 := clock_timestamp();

  begin
    r := extensions.http_head(v_endpoint);
    v_status := (r).status;

    -- Plenty of feed hosts refuse HEAD; fall back to GET before calling it a failure.
    if v_status in (0, 400, 403, 405, 501) then
      r := extensions.http_get(v_endpoint);
      v_status := (r).status;
    end if;
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'source', v_name,
      'endpoint', v_endpoint,
      'latency_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int,
      'error', sqlerrm);
  end;

  select value into v_ctype from unnest((r).headers) h
  where lower(h.field) = 'content-type' limit 1;

  return jsonb_build_object(
    'ok', (v_status between 200 and 299),
    'source', v_name,
    'endpoint', v_endpoint,
    'status', v_status,
    'content_type', v_ctype,
    'latency_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int,
    'note', 'probe only - nothing written to ingestion_queue or source health counters');
end
$fn$;

revoke all on function public.test_source_connection(uuid) from public, anon;
grant execute on function public.test_source_connection(uuid) to authenticated, service_role;

-- ── J-FR-34 / M-J04: re-invoke the stage behind a failed pipeline job ───────
-- The job_type domain is twelve values, not the original four. Stages that are
-- parameterless batch jobs are dispatched; the rest are refused explicitly rather
-- than guessed at, because they need arguments this function does not have.
create or replace function public.retry_pipeline_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, vault, net, pg_temp
as $fn$
declare
  v_job      public.pipeline_jobs%rowtype;
  v_slug     text;
  v_base     text;
  v_cron     text;
  v_svc      text;
  v_body     jsonb := '{}'::jsonb;
  v_req_id   bigint;
begin
  perform public.assert_admin_caller();

  select * into v_job from public.pipeline_jobs where id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'pipeline job not found');
  end if;

  v_slug := case v_job.job_type
              when 'ingest'                 then 'ingest'
              when 'embed'                  then 'embed'
              when 'extract_entities'       then 'extract-entities'
              when 'cluster'                then 'cluster'
              when 'create_topic_drafts'    then 'create-topic-drafts'
              when 'enrich_images'          then 'enrich-images'
              when 'classify_parent_topics' then 'classify-parent-topics'
              else null
            end;

  if v_slug is null then
    return jsonb_build_object(
      'ok', false,
      'job_type', v_job.job_type,
      'error', case
                 when v_job.job_type = 'generate'
                   then 'the generate stage was retired in Sep 2026 (Epic J J-07) and cannot be retried'
                 else format('job_type %L is not retryable from here: it needs arguments this RPC does not carry', v_job.job_type)
               end);
  end if;

  select rtrim(decrypted_secret,'/') into v_base from vault.decrypted_secrets where name='PROJECT_URL' limit 1;
  select decrypted_secret into v_cron from vault.decrypted_secrets where name='cron_secret' limit 1;
  select decrypted_secret into v_svc  from vault.decrypted_secrets where name='service_role_key' limit 1;
  if v_base is null or v_base = '' then raise exception 'vault secret PROJECT_URL missing'; end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  -- Scope the retry to the original source where the stage supports it.
  if v_job.job_type = 'ingest' and v_job.source_id is not null then
    v_body := jsonb_build_object('source_id', v_job.source_id);
  end if;

  select net.http_post(
      timeout_milliseconds := 45000,
      url     := v_base || '/functions/v1/' || v_slug,
      body    := v_body,
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || v_svc,
                   'apikey',        v_svc,
                   'x-cron-secret', v_cron,
                   'content-type',  'application/json')
    ) into v_req_id;

  update public.pipeline_jobs
     set retry_count = coalesce(retry_count, 0) + 1
   where id = p_job_id;

  return jsonb_build_object(
    'ok', true,
    'job_type', v_job.job_type,
    'dispatched_to', v_slug,
    'source_id', v_job.source_id,
    'request_id', v_req_id,
    'async', true,
    'note', 'stage re-invoked; watch pipeline_jobs for the new run');
end
$fn$;

revoke all on function public.retry_pipeline_job(uuid) from public, anon;
grant execute on function public.retry_pipeline_job(uuid) to authenticated, service_role;
