-- Epic J remediation, Sep 2026 — J-09 (hardcoded environment binding).
-- FOUR functions hardcoded the Dev project host, not the two originally recorded:
-- admin_ingest_source, run_ingest_http, run_cluster_http, run_generate_http.
-- Each now derives the host from the vault PROJECT_URL secret, so the same body is
-- safe to promote to UAT and Prod.
--
-- Their bespoke guard (is_admin_me() OR session_user='postgres') is also replaced with
-- assert_admin_caller(). The old guard could not recognise a service_role caller coming
-- through PostgREST (session_user is 'authenticator' there, and auth.uid() is null for a
-- service_role JWT), which is how admin-run-pipeline invokes run_ingest_http.

create or replace function public.admin_ingest_source(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, admin, auth, net, vault, pg_temp
as $fn$
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
$fn$;

create or replace function public.run_ingest_http()
returns void
language plpgsql
security definer
set search_path = public, auth, vault, extensions, pg_temp
as $fn$
declare
  v_base text;
  v_url  text;
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_resp extensions.http_response;
begin
  perform public.assert_admin_caller();

  v_base := rtrim((select decrypted_secret from vault.decrypted_secrets where name='PROJECT_URL' limit 1), '/');
  if v_base is null or v_base = '' then raise exception 'vault secret PROJECT_URL missing'; end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  v_url := v_base || '/functions/v1/ingest';

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  v_resp := extensions.http((
    'POST', v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('x-cron-secret', v_cron)
    ]::extensions.http_header[],
    'application/json', '{}'::text));

  if v_resp.status < 200 or v_resp.status >= 300 then
    raise exception 'ingest http failed: status=% body=%', v_resp.status, left(coalesce(v_resp.content,''), 500);
  end if;
end
$fn$;

create or replace function public.run_cluster_http()
returns void
language plpgsql
security definer
set search_path = public, auth, vault, net, pg_temp
as $fn$
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
$fn$;

create or replace function public.run_generate_http()
returns void
language plpgsql
security definer
set search_path = public, auth, vault, extensions, pg_temp
as $fn$
declare
  v_base text;
  v_url  text;
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_resp extensions.http_response;
begin
  perform public.assert_admin_caller();

  v_base := rtrim((select decrypted_secret from vault.decrypted_secrets where name='PROJECT_URL' limit 1), '/');
  if v_base is null or v_base = '' then raise exception 'vault secret PROJECT_URL missing'; end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  v_url := v_base || '/functions/v1/generate';

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  v_resp := extensions.http((
    'POST', v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('x-cron-secret', v_cron)
    ]::extensions.http_header[],
    'application/json', '{}'::text));

  if v_resp.status < 200 or v_resp.status >= 300 then
    raise exception 'generate http failed: status=% body=%', v_resp.status, left(coalesce(v_resp.content,''), 500);
  end if;
end
$fn$;

revoke all on function public.run_ingest_http()   from public, anon;
revoke all on function public.run_cluster_http()  from public, anon;
revoke all on function public.run_generate_http() from public, anon;
revoke all on function public.admin_ingest_source(uuid) from public, anon;
grant execute on function public.run_ingest_http()   to authenticated, service_role;
grant execute on function public.run_cluster_http()  to authenticated, service_role;
grant execute on function public.run_generate_http() to authenticated, service_role;
grant execute on function public.admin_ingest_source(uuid) to authenticated, service_role;
