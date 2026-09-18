-- Epic J remediation, Sep 2026 — J-09 (continued).
-- A schema-wide, case-insensitive sweep for 'https://<ref>.supabase.co' found 11 more
-- functions with the Dev host baked in, including the whole admin schema. These six are
-- Epic J's own pipeline; each now derives the host from the vault PROJECT_URL secret.
-- Bodies, search_path settings, statement_timeout and return types are otherwise unchanged.

create or replace function admin.cron_ingest()
returns void
language plpgsql
security definer
set search_path = public, extensions, admin, vault, pg_temp
set statement_timeout = '60s'
as $fn$
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
$fn$;

create or replace function admin.cron_cluster()
returns void
language plpgsql
security definer
set search_path = public, extensions, admin, private
set statement_timeout = '60s'
as $fn$
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
$fn$;

create or replace function admin.cron_generate()
returns void
language plpgsql
security definer
set search_path = public, extensions, admin, private
set statement_timeout = '60s'
as $fn$
declare
  lock_key  bigint := hashtext('admin.cron_generate');
  got_lock  boolean;
  secret    text := private.get_secret('CRON_SECRET');
  v_base    text;
  r         extensions.http_response;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message) values ('generate', true, 'skipped: lock busy');
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
      v_base || '/functions/v1/generate',
      ARRAY[
        extensions.http_header('x-cron-secret', secret),
        extensions.http_header('content-type','application/json')
      ],
      '{}'
    )) into r;

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values ('generate', now(), (r.status = 200), r.status, left(coalesce(r.content::text,''), 2000));

    if r.status <> 200 then
      raise warning 'generate non-200: % %', r.status, left(coalesce(r.content::text,''),200);
    end if;

  exception when others then
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('generate', now(), false, sqlerrm);
    perform pg_advisory_unlock(lock_key);
    raise;
  end;

  perform pg_advisory_unlock(lock_key);
end;
$fn$;

create or replace function public.run_create_drafts_http()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault, net, pg_temp
as $fn$
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
$fn$;

create or replace function public.run_enrich_images_http()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
set statement_timeout = '60s'
as $fn$
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
$fn$;

-- search_path is '' on this one, so every reference stays fully schema-qualified.
create or replace function public.run_reframe_http()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _base_url text;
begin
  perform public.assert_admin_caller();

  select rtrim(decrypted_secret, '/') into _base_url
  from vault.decrypted_secrets where name = 'PROJECT_URL' limit 1;
  if _base_url is null or _base_url = '' then
    raise exception 'Missing vault secret: PROJECT_URL';
  end if;

  perform net.http_post(
    url     := _base_url || '/functions/v1/reframe',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' ||
                   (select decrypted_secret from vault.decrypted_secrets
                     where name = 'service_role_key' limit 1)),
    body    := '{}'::jsonb,
    timeout_milliseconds := 45000);
end;
$fn$;

revoke all on function public.run_create_drafts_http() from public, anon;
revoke all on function public.run_enrich_images_http() from public, anon;
revoke all on function public.run_reframe_http()       from public, anon;
grant execute on function public.run_create_drafts_http() to authenticated, service_role;
grant execute on function public.run_enrich_images_http() to authenticated, service_role;
grant execute on function public.run_reframe_http()       to authenticated, service_role;
