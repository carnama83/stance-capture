-- Vault PROJECT_URL guards: fail loudly instead of building a malformed URL.
-- Promoted from Dev (stance-capture-dev) as part of the Dev -> UAT -> Prod sync, 2026-09-21.
-- Function bodies captured verbatim from Dev live catalog via pg_get_functiondef().

-- Each of these differed from UAT/Prod by exactly one thing: Dev hoists the
-- PROJECT_URL vault lookup into a variable, checks it for NULL/empty, releases the
-- advisory lock where one is held, and raises a clear exception. The HTTP call,
-- headers, timeouts and run logging are otherwise identical.
-- Return types are unchanged, so CREATE OR REPLACE preserves existing grants.

CREATE OR REPLACE FUNCTION admin.cron_aggregate_election_stances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION admin.cron_cluster()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'private'
 SET statement_timeout TO '60s'
AS $function$
declare
  lock_key  bigint := hashtext('admin.cron_cluster');
  got_lock  boolean;
  secret    text := private.get_secret('CRON_SECRET');
  v_base    text;
  r         extensions.http_response;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message) values ('cluster', true, 'skipped: lock busy');
    return;
  end if;

  select rtrim(decrypted_secret, '/') into v_base from vault.decrypted_secrets where name = 'PROJECT_URL' limit 1;
  if v_base is null or v_base = '' then
    perform pg_advisory_unlock(lock_key);
    raise exception 'Missing vault secret: PROJECT_URL';
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
    select * from extensions.http((
      'POST',
      v_base || '/functions/v1/cluster',
      ARRAY[
        extensions.http_header('x-cron-secret', secret),
        extensions.http_header('content-type','application/json')
      ],
      '{}'
    )) into r;

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values ('cluster', now(), (r.status = 200), r.status, left(coalesce(r.content::text,''), 2000));

    if r.status <> 200 then
      raise warning 'cluster non-200: % %', r.status, left(coalesce(r.content::text,''),200);
    end if;

  exception when others then
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('cluster', now(), false, sqlerrm);
    perform pg_advisory_unlock(lock_key);
    raise;
  end;

  perform pg_advisory_unlock(lock_key);
end;
$function$
;

CREATE OR REPLACE FUNCTION admin.cron_detect_election_anomalies()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION admin.cron_enforce_silence()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION admin.cron_ingest()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
declare
  lock_key        bigint := hashtext('admin.cron_ingest');
  got_lock        boolean;
  v_cron_secret   text;
  v_service_role  text;
  v_base          text;
  r               extensions.http_response;
  v_status        int;
  v_body          text;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message, finished_at)
    values ('ingest', true, 'skipped: lock busy', now());
    return;
  end if;

  select decrypted_secret into v_cron_secret  from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  select decrypted_secret into v_service_role from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select rtrim(decrypted_secret, '/') into v_base from vault.decrypted_secrets where name = 'PROJECT_URL' limit 1;

  if v_cron_secret  is null or v_cron_secret  = '' then raise exception 'Missing vault secret: cron_secret'; end if;
  if v_service_role is null or v_service_role = '' then raise exception 'Missing vault secret: service_role_key'; end if;
  if v_base is null or v_base = '' then raise exception 'Missing vault secret: PROJECT_URL'; end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  select * from extensions.http((
    'POST',
    v_base || '/functions/v1/ingest',
    array[
      extensions.http_header('authorization', 'Bearer ' || v_service_role),
      extensions.http_header('apikey', v_service_role),
      extensions.http_header('x-cron-secret', v_cron_secret),
      extensions.http_header('content-type','application/json')
    ]::extensions.http_header[],
    'application/json',
    '{}'::text
  )) into r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);

  insert into admin.cron_runs(job, finished_at, ok, http_status, message)
  values ('ingest', now(), (v_status = 200), v_status, v_body);

  if v_status <> 200 then
    raise warning 'ingest non-200: % %', v_status, left(v_body, 200);
  end if;

  perform pg_advisory_unlock(lock_key);

exception when others then
  begin
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('ingest', now(), false, sqlerrm);
  exception when others then
  end;
  perform pg_advisory_unlock(lock_key);
  raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION admin.cron_notify_election_updates()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION admin.cron_generate()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'private'
 SET statement_timeout TO '60s'
AS $function$
begin
  insert into admin.cron_runs(job, finished_at, ok, message)
  values ('generate', now(), true,
          'skipped: generate stage retired Sep 2026 (Epic J J-07) — obsolete function, non-existent prompt_key');
end
$function$
;

CREATE OR REPLACE FUNCTION public.admin_ingest_source(p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'admin', 'auth', 'net', 'vault', 'pg_temp'
AS $function$
declare
  v_base   text;
  v_url    text;
  v_body   jsonb := jsonb_build_object('source_id', p_source_id);
  v_cron   text  := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1);
  v_svc    text  := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1);
  v_req_id bigint;
begin
  perform public.assert_admin_caller();

  v_base := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'PROJECT_URL' limit 1), '/');
  if v_base is null or v_base = '' then raise exception 'vault secret PROJECT_URL missing'; end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  v_url := v_base || '/functions/v1/ingest';

  select net.http_post(
      timeout_milliseconds := 45000,
      url     := v_url,
      body    := v_body,
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || v_svc,
                   'apikey',        v_svc,
                   'x-cron-secret', v_cron,
                   'content-type',  'application/json')
    )
  into v_req_id;

  return jsonb_build_object('request_id', v_req_id, 'async', true);
end
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_question_impact_score(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
 SET statement_timeout TO '60s'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.run_cluster_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'vault', 'net', 'pg_temp'
AS $function$
declare
  v_base text;
  v_url  text;
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
begin
  perform public.assert_admin_caller();

  v_base := rtrim((select decrypted_secret from vault.decrypted_secrets where name='PROJECT_URL' limit 1), '/');
  if v_base is null or v_base = '' then raise exception 'vault secret PROJECT_URL missing'; end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  v_url := v_base || '/functions/v1/cluster';

  perform net.http_post(
    timeout_milliseconds := 45000,
    url := v_url,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || v_svc,
      'x-cron-secret', v_cron,
      'content-type', 'application/json'),
    body := '{}'::jsonb);
end
$function$
;

CREATE OR REPLACE FUNCTION public.run_create_drafts_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'net', 'pg_temp'
AS $function$
declare
  _cron_secret text;
  _service_role text;
  _base_url text;
  _req_id bigint;
begin
  perform public.assert_admin_caller();

  select decrypted_secret into _cron_secret  from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into _service_role from vault.decrypted_secrets where name = 'service_role_key';
  select rtrim(decrypted_secret, '/') into _base_url from vault.decrypted_secrets where name = 'PROJECT_URL' limit 1;

  if _cron_secret  is null then raise exception 'Missing vault secret: cron_secret'; end if;
  if _service_role is null then raise exception 'Missing vault secret: service_role_key'; end if;
  if _base_url is null or _base_url = '' then raise exception 'Missing vault secret: PROJECT_URL'; end if;

  select net.http_post(
      timeout_milliseconds := 45000,
    url := _base_url || '/functions/v1/create-topic-drafts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _service_role,
      'apikey', _service_role,
      'x-cron-secret', _cron_secret,
      'Content-Type', 'application/json'),
    body := '{}'::jsonb) into _req_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_enrich_images_http()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_base   text;
  v_url    text;
  v_cron   text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1);
  v_svc    text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1);
  r        extensions.http_response;
  v_status int;
  v_body   text;
begin
  perform public.assert_admin_caller();

  v_base := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'PROJECT_URL' limit 1), '/');
  if v_base is null or v_base = '' then raise exception 'vault secret PROJECT_URL missing'; end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  v_url := v_base || '/functions/v1/enrich-images';

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  r := extensions.http((
    'POST', v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('apikey', v_svc),
      extensions.http_header('x-cron-secret', v_cron),
      extensions.http_header('content-type', 'application/json')
    ]::extensions.http_header[],
    'application/json', '{}'));
  v_status := (r).status;
  v_body   := coalesce((r).content::text, '');
  if v_status <> 200 then
    raise exception 'enrich-images non-200 (%): %', v_status, left(v_body, 500);
  end if;
  return v_body::jsonb;
end;
$function$
;
