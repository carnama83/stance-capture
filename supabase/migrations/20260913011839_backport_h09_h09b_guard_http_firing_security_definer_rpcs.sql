-- H-09 / H-09b backport from Prod. See Prod migrations
-- fix_h09_pattern_guard_http_firing_security_definer_rpcs and
-- fix_h09b_close_pgsql_http_confused_deputies_missed_by_first_audit.
--
-- Confused deputy: SECURITY DEFINER functions in the REST-exposed `public` schema that fire HTTP
-- held EXECUTE for PUBLIC/anon with no authorization check, while sending a working
-- 'Authorization: Bearer <service_role_key>' from Vault. An anonymous caller invokes the RPC and
-- the DATABASE mints a credential they cannot construct.
--
-- Dev has DRIFTED from Prod, so this is driven off Dev's catalog and the four rewritten bodies
-- are Dev's own - note the essnvhvezxjcoqxvuxuq URLs; Prod's yzxzpnomcarnxixhjlba must not leak in.
--
-- Detection widened: the earlier sweep matched only `net.http_` and `extensions.http(`, which
-- missed public.run_create_drafts_http_debug because it calls UNQUALIFIED `http((...))`. That is
-- the same class of gap that made the first H-09 audit incomplete. The dynamic revoke below now
-- matches all three call shapes.

do $pre$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='is_admin_me') then
    raise exception 'public.is_admin_me() missing - guard would not compile';
  end if;
end $pre$;

CREATE OR REPLACE FUNCTION public.run_cluster_http()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp', 'net'
AS $function$
declare
  v_url  text := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/cluster';
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
begin
  if not (coalesce(public.is_admin_me(), false) or session_user = 'postgres') then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || v_svc,
      'x-cron-secret', v_cron,
      'content-type', 'application/json'),
    body := '{}'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_create_drafts_http()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'net', 'pg_temp'
AS $function$
declare
  _cron_secret text;
  _service_role text;
  _base_url text := 'https://essnvhvezxjcoqxvuxuq.supabase.co';
  _req_id bigint;
begin
  if not (coalesce(public.is_admin_me(), false) or session_user = 'postgres') then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;
  select decrypted_secret into _cron_secret  from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into _service_role from vault.decrypted_secrets where name = 'service_role_key';
  if _cron_secret  is null then raise exception 'Missing vault secret: cron_secret'; end if;
  if _service_role is null then raise exception 'Missing vault secret: service_role_key'; end if;
  select net.http_post(
    url := _base_url || '/functions/v1/create-topic-drafts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _service_role,
      'apikey', _service_role,
      'x-cron-secret', _cron_secret,
      'Content-Type', 'application/json'),
    body := '{}'::jsonb) into _req_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_enrich_images_http()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_url    text := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/enrich-images';
  v_cron   text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1);
  v_svc    text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1);
  r        extensions.http_response;
  v_status int;
  v_body   text;
begin
  if not (coalesce(public.is_admin_me(), false) or session_user = 'postgres') then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.run_generate_http()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
declare
  v_url text := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/generate';
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_resp extensions.http_response;
begin
  if not (coalesce(public.is_admin_me(), false) or session_user = 'postgres') then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;
  v_resp := extensions.http((
    'POST', v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('x-cron-secret', v_cron)
    ]::extensions.http_header[],
    '{}'::text, 'application/json'));
  if v_resp.status < 200 or v_resp.status >= 300 then
    raise exception 'generate http failed: status=% body=%',
      v_resp.status, left(coalesce(v_resp.content,''), 500);
  end if;
end;
$function$;

-- ---------- grants ----------
-- admin-UI callers keep `authenticated`; the in-body guard is the control
revoke execute on function public.run_cluster_http()        from public, anon;
revoke execute on function public.run_create_drafts_http()  from public, anon;
revoke execute on function public.run_enrich_images_http()  from public, anon;
revoke execute on function public.run_generate_http()       from public, anon;
revoke execute on function public.admin_ingest_source(uuid) from public, anon;

-- no src/ callers
revoke execute on function public.run_ingest_http()                     from public, anon, authenticated;
revoke execute on function public.run_ingestion_pipeline_job()          from public, anon, authenticated;
revoke execute on function public.run_reframe_http()                    from public, anon, authenticated;
revoke execute on function public.calculate_question_impact_score(uuid) from public, anon, authenticated;
revoke execute on function public.run_create_drafts_http_debug()        from public, anon, authenticated;

-- admin.* : dynamic, all three HTTP call shapes
do $g$
declare r record;
begin
  for r in select p.oid::regprocedure as sig
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='admin' and p.prokind='f'
             and (p.prosrc ~* 'net\.http_(post|get)'
                  or p.prosrc ~* 'extensions\.http\('
                  or p.prosrc ~* '(^|[^._a-z])http\(\(')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $g$;

-- ---------- post-flight ----------
do $post$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname in ('public','admin') and p.prokind='f' and p.prosecdef
    and (p.prosrc ~* 'net\.http_(post|get)' or p.prosrc ~* 'extensions\.http\('
         or p.prosrc ~* '(^|[^._a-z])http\(\(')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'post: % HTTP-firing fn(s) still anon-executable', n; end if;

  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname in ('public','admin') and p.prokind='f' and p.prosecdef
    and (p.prosrc ~* 'net\.http_(post|get)' or p.prosrc ~* 'extensions\.http\('
         or p.prosrc ~* '(^|[^._a-z])http\(\(')
    and not has_function_privilege('postgres', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'post: postgres lost EXECUTE on % fn(s)', n; end if;

  if not has_function_privilege('authenticated','public.run_cluster_http()','EXECUTE')
     or not has_function_privilege('authenticated','public.run_create_drafts_http()','EXECUTE')
     or not has_function_privilege('authenticated','public.run_enrich_images_http()','EXECUTE')
     or not has_function_privilege('authenticated','public.run_generate_http()','EXECUTE')
     or not has_function_privilege('authenticated','public.admin_ingest_source(uuid)','EXECUTE') then
    raise exception 'post: an admin-UI function lost authenticated EXECUTE';
  end if;

  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public'
    and p.proname in ('run_cluster_http','run_create_drafts_http','run_enrich_images_http','run_generate_http')
    and p.prosrc like '%is_admin_me%';
  if n <> 4 then raise exception 'post: only % of 4 admin-UI functions carry the guard', n; end if;

  -- the FOUR FUNCTIONS THIS MIGRATION REWROTE must target Dev, not Prod.
  -- (8 other pre-existing functions hardcode the Prod ref - a separate, pre-existing defect,
  --  all currently dormant; deliberately not asserted here.)
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public'
    and p.proname in ('run_cluster_http','run_create_drafts_http','run_enrich_images_http','run_generate_http')
    and (p.prosrc like '%yzxzpnomcarnxixhjlba%' or p.prosrc not like '%essnvhvezxjcoqxvuxuq%');
  if n <> 0 then raise exception 'post: % rewritten fn(s) do not target the Dev project', n; end if;
end $post$;
