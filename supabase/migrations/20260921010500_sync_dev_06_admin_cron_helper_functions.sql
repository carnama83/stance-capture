-- admin cron helper functions that exist on Dev but not Prod.
-- Promoted from Dev (stance-capture-dev) as part of the Dev -> UAT -> Prod sync, 2026-09-21.
-- Function bodies captured verbatim from Dev live catalog via pg_get_functiondef().

-- Creating these does NOT schedule anything -- they are entry points only, inert
-- until a cron job references them. cron_ingest_worker backs the ingest-worker-drain
-- job Prod is still missing; cron_invoke_notification backs the notification jobs.

CREATE OR REPLACE FUNCTION admin.cron_ingest_worker()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
 SET statement_timeout TO '90s'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION admin.cron_invoke_notification(p_slug text, p_job text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'private', 'pg_temp'
 SET statement_timeout TO '240s'
AS $function$
declare
  lock_key bigint := hashtext('admin.cron_invoke_notification:' || p_slug);
  got_lock boolean;
  v_key    text;
  v_url    text;
  r        extensions.http_response;
  v_status int;
  v_body   text;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message, finished_at)
    values (p_job, true, 'skipped: lock busy', now());
    return;
  end if;

  begin
    v_key := coalesce(private.get_secret('SERVICE_ROLE_KEY'), private.get_secret('service_role_key'));
    v_url := coalesce(private.get_secret('PROJECT_URL'),      private.get_secret('SUPABASE_URL'));

    if v_url is null then
      v_url := 'https://' || current_setting('app.settings.project_ref', true) || '.supabase.co';
    end if;

    if v_key is null then
      insert into admin.cron_runs(job, finished_at, ok, message)
      values (p_job, now(), false, 'no service_role key available');
      perform pg_advisory_unlock(lock_key);
      return;
    end if;

    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '180000');

    select * into r from extensions.http((
      'POST',
      rtrim(v_url, '/') || '/functions/v1/' || p_slug,
      ARRAY[
        extensions.http_header('authorization', 'Bearer ' || v_key),
        extensions.http_header('apikey', v_key),
        extensions.http_header('content-type', 'application/json')
      ]::extensions.http_header[],
      'application/json',
      '{}'::text
    ));

    v_status := (r).status;
    v_body   := left(coalesce((r).content::text, ''), 2000);

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values (p_job, now(), (v_status = 200), v_status, v_body);

    if v_status <> 200 then
      raise warning '% non-200: % %', p_job, v_status, left(v_body, 200);
    end if;

  exception when others then
    -- A failing notification job must never abort the cron worker.
    insert into admin.cron_runs(job, finished_at, ok, message)
    values (p_job, now(), false, sqlerrm);
  end;

  perform pg_advisory_unlock(lock_key);
end;
$function$
;

-- Dev grants EXECUTE on cron_invoke_notification to postgres ONLY. A fresh CREATE
-- defaults to PUBLIC EXECUTE, which would widen access to a SECURITY DEFINER
-- function, so revoke it explicitly to match Dev.
REVOKE ALL ON FUNCTION admin.cron_invoke_notification(text, text) FROM PUBLIC;

-- cron_ingest_worker is PUBLIC+postgres on Dev; the CREATE default already matches.
