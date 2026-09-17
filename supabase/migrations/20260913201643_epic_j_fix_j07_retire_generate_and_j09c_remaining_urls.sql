-- Epic J remediation, Sep 2026 — J-07 (retire generate) + J-09 (remaining hardcoded hosts).

-- ── J-07: formally retire the generate stage ────────────────────────────────
-- generate/index.ts and generate/logic.ts are both marked '//Obsolete--', the
-- deployment has not changed since Jun 2026, and it queries a prompt_key
-- ('question_generation') that does not exist. Question generation is now done by
-- create-topic-drafts / admin-create-question-draft / the UGQ chain, which read
-- their own live prompt keys. Unwire it from the pipeline rather than leaving a
-- dead stage that silently succeeds.
--
-- The Edge Function itself is left deployed but unreferenced; deleting it is a
-- separate, irreversible step.

create or replace function public.run_ingestion_pipeline()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();

  perform public.run_ingest_http();
  perform public.run_cluster_http();
  -- generate stage retired Sep 2026 (Epic J, J-07): the deployed function is marked
  -- obsolete and reads a prompt key that no longer exists, so it produced nothing.
end
$fn$;

create or replace function public.run_generate_http()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  raise notice 'run_generate_http() is retired (Epic J J-07, Sep 2026): the generate Edge Function is obsolete and reads a prompt_key that does not exist. This is now a no-op.';
end
$fn$;

create or replace function admin.cron_generate()
returns void
language plpgsql
security definer
set search_path = public, extensions, admin, private
set statement_timeout = '60s'
as $fn$
begin
  insert into admin.cron_runs(job, finished_at, ok, message)
  values ('generate', now(), true,
          'skipped: generate stage retired Sep 2026 (Epic J J-07) — obsolete function, non-existent prompt_key');
end
$fn$;

-- ── J-09 (remaining): Epic EL + Epic E functions with the Dev host baked in ──
-- Same one-line hazard as Epic J's own pipeline; fixed here so no function in the
-- database still pins an environment. Bodies otherwise unchanged.

create or replace function admin.cron_aggregate_election_stances()
returns void
language plpgsql security definer
set search_path = public, extensions, admin, vault, pg_temp
set statement_timeout = '60s'
as $fn$
DECLARE
  lock_key bigint := hashtext('admin.cron_aggregate_election_stances');
  got_lock boolean; v_cron_secret text; v_service_role text; v_base text;
  r extensions.http_response; v_status int; v_body text;
BEGIN
  got_lock := pg_try_advisory_lock(lock_key);
  IF NOT got_lock THEN
    INSERT INTO admin.cron_runs(job, ok, message, finished_at)
    VALUES ('aggregate_election_stances', true, 'skipped: lock busy', now());
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_cron_secret  FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT rtrim(decrypted_secret,'/') INTO v_base FROM vault.decrypted_secrets WHERE name = 'PROJECT_URL' LIMIT 1;
  IF v_base IS NULL OR v_base = '' THEN
    PERFORM pg_advisory_unlock(lock_key);
    RAISE EXCEPTION 'Missing vault secret: PROJECT_URL';
  END IF;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  SELECT * FROM extensions.http((
    'POST', v_base || '/functions/v1/aggregate-election-stances',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || v_service_role),
      extensions.http_header('apikey',         v_service_role),
      extensions.http_header('x-cron-secret',  v_cron_secret),
      extensions.http_header('content-type',   'application/json')
    ]::extensions.http_header[],
    'application/json', '{}'::text)) INTO r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);
  INSERT INTO admin.cron_runs(job, finished_at, ok, http_status, message)
  VALUES ('aggregate_election_stances', now(), (v_status = 200), v_status, v_body);
  PERFORM pg_advisory_unlock(lock_key);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(lock_key);
  INSERT INTO admin.cron_runs(job, finished_at, ok, message)
  VALUES ('aggregate_election_stances', now(), false, SQLERRM);
END;
$fn$;

create or replace function admin.cron_detect_election_anomalies()
returns void
language plpgsql security definer
set search_path = public, extensions, admin, vault, pg_temp
set statement_timeout = '60s'
as $fn$
DECLARE
  lock_key bigint := hashtext('admin.cron_detect_election_anomalies');
  got_lock boolean; v_cron_secret text; v_service_role text; v_base text;
  r extensions.http_response; v_status int; v_body text;
BEGIN
  got_lock := pg_try_advisory_lock(lock_key);
  IF NOT got_lock THEN
    INSERT INTO admin.cron_runs(job, ok, message, finished_at)
    VALUES ('detect_election_anomalies', true, 'skipped: lock busy', now());
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_cron_secret  FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT rtrim(decrypted_secret,'/') INTO v_base FROM vault.decrypted_secrets WHERE name = 'PROJECT_URL' LIMIT 1;
  IF v_base IS NULL OR v_base = '' THEN
    PERFORM pg_advisory_unlock(lock_key);
    RAISE EXCEPTION 'Missing vault secret: PROJECT_URL';
  END IF;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  SELECT * FROM extensions.http((
    'POST', v_base || '/functions/v1/detect-election-anomalies',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || v_service_role),
      extensions.http_header('apikey',         v_service_role),
      extensions.http_header('x-cron-secret',  v_cron_secret),
      extensions.http_header('content-type',   'application/json')
    ]::extensions.http_header[],
    'application/json', '{}'::text)) INTO r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);
  INSERT INTO admin.cron_runs(job, finished_at, ok, http_status, message)
  VALUES ('detect_election_anomalies', now(), (v_status = 200), v_status, v_body);
  PERFORM pg_advisory_unlock(lock_key);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(lock_key);
  INSERT INTO admin.cron_runs(job, finished_at, ok, message)
  VALUES ('detect_election_anomalies', now(), false, SQLERRM);
END;
$fn$;

create or replace function admin.cron_enforce_silence()
returns void
language plpgsql security definer
set search_path = public, extensions, admin, vault, pg_temp
set statement_timeout = '60s'
as $fn$
DECLARE
  lock_key bigint := hashtext('admin.cron_enforce_silence');
  got_lock boolean; v_cron_secret text; v_service_role text; v_base text;
  r extensions.http_response; v_status int; v_body text;
BEGIN
  got_lock := pg_try_advisory_lock(lock_key);
  IF NOT got_lock THEN
    INSERT INTO admin.cron_runs(job, ok, message, finished_at)
    VALUES ('enforce_silence', true, 'skipped: lock busy', now());
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_cron_secret  FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT rtrim(decrypted_secret,'/') INTO v_base FROM vault.decrypted_secrets WHERE name = 'PROJECT_URL' LIMIT 1;
  IF v_base IS NULL OR v_base = '' THEN
    PERFORM pg_advisory_unlock(lock_key);
    RAISE EXCEPTION 'Missing vault secret: PROJECT_URL';
  END IF;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  SELECT * FROM extensions.http((
    'POST', v_base || '/functions/v1/enforce-election-silence',
    ARRAY[
      extensions.http_header('authorization',  'Bearer ' || v_service_role),
      extensions.http_header('apikey',          v_service_role),
      extensions.http_header('x-cron-secret',   v_cron_secret),
      extensions.http_header('content-type',    'application/json')
    ]::extensions.http_header[],
    'application/json', '{}'::text)) INTO r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);
  INSERT INTO admin.cron_runs(job, finished_at, ok, http_status, message)
  VALUES ('enforce_silence', now(), (v_status = 200), v_status, v_body);
  PERFORM pg_advisory_unlock(lock_key);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(lock_key);
  INSERT INTO admin.cron_runs(job, finished_at, ok, message)
  VALUES ('enforce_silence', now(), false, SQLERRM);
END;
$fn$;

create or replace function admin.cron_notify_election_updates()
returns void
language plpgsql security definer
set search_path = public, extensions, admin, vault, pg_temp
set statement_timeout = '60s'
as $fn$
DECLARE
  lock_key bigint := hashtext('admin.cron_notify_election_updates');
  got_lock boolean; v_cron_secret text; v_service_role text; v_base text;
  r extensions.http_response; v_status int; v_body text;
BEGIN
  got_lock := pg_try_advisory_lock(lock_key);
  IF NOT got_lock THEN
    INSERT INTO admin.cron_runs(job, ok, message, finished_at)
    VALUES ('notify_election_updates', true, 'skipped: lock busy', now());
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_cron_secret  FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT rtrim(decrypted_secret,'/') INTO v_base FROM vault.decrypted_secrets WHERE name = 'PROJECT_URL' LIMIT 1;
  IF v_base IS NULL OR v_base = '' THEN
    PERFORM pg_advisory_unlock(lock_key);
    RAISE EXCEPTION 'Missing vault secret: PROJECT_URL';
  END IF;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  SELECT * FROM extensions.http((
    'POST', v_base || '/functions/v1/notify-election-updates',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || v_service_role),
      extensions.http_header('apikey',         v_service_role),
      extensions.http_header('x-cron-secret',  v_cron_secret),
      extensions.http_header('content-type',   'application/json')
    ]::extensions.http_header[],
    'application/json', '{}'::text)) INTO r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);
  INSERT INTO admin.cron_runs(job, finished_at, ok, http_status, message)
  VALUES ('notify_election_updates', now(), (v_status = 200), v_status, v_body);
  PERFORM pg_advisory_unlock(lock_key);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(lock_key);
  INSERT INTO admin.cron_runs(job, finished_at, ok, message)
  VALUES ('notify_election_updates', now(), false, SQLERRM);
END;
$fn$;

create or replace function public.calculate_question_impact_score(p_question_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, vault
set statement_timeout = '60s'
as $fn$
DECLARE
  v_base text;
  v_url text;
  v_svc text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_resp extensions.http_response;
  v_response JSONB;
  v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.questions WHERE id = p_question_id) THEN
    RAISE EXCEPTION 'Question % not found', p_question_id;
  END IF;

  IF v_svc IS NULL THEN
    RAISE EXCEPTION 'vault secret service_role_key missing';
  END IF;

  v_base := rtrim((select decrypted_secret from vault.decrypted_secrets where name='PROJECT_URL' limit 1), '/');
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'vault secret PROJECT_URL missing';
  END IF;
  v_url := v_base || '/functions/v1/ai-score-question';

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  v_resp := extensions.http((
    'POST', v_url,
    ARRAY[extensions.http_header('authorization', 'Bearer ' || v_svc)]::extensions.http_header[],
    'application/json',
    json_build_object('question_id', p_question_id)::text));

  IF v_resp.status < 200 OR v_resp.status >= 300 THEN
    RAISE EXCEPTION 'ai-score-question http failed: status=% body=%', v_resp.status, left(coalesce(v_resp.content,''), 500);
  END IF;

  v_response := v_resp.content::jsonb;

  IF v_response->>'error' IS NOT NULL THEN
    RAISE EXCEPTION 'AI scoring failed: %', v_response->>'error';
  END IF;

  v_result := v_response;
  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'AI scoring failed for question %: %', p_question_id, SQLERRM;
    RETURN jsonb_build_object('error', SQLERRM, 'question_id', p_question_id);
END;
$fn$;
