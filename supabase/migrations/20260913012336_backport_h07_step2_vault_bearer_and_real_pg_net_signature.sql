-- Backport of H-07 (run_reframe_http) and Step 2 / 2b (admin_ingest_source) from Prod.
-- These were the last two Dev functions carrying a hardcoded 'demo123'.
--
-- H-07: run_reframe_http sent `x-cron-secret` and NO Authorization header. Where `reframe` is
--   verify_jwt:true the platform rejects that with UNAUTHORIZED_NO_AUTH_HEADER before the body
--   runs - on Prod that meant 16/16 invocations in 24h were 401s and the job had never once
--   executed. Now sends a service_role bearer from Vault and no secret is stored in the body.
--   search_path pinned to '' (strictest): every reference is schema-qualified, and
--   jsonb_build_object / the ::jsonb cast resolve from pg_catalog, always implicitly searched.
--
--   ENVIRONMENT DIFFERENCE, deliberate: Prod's version reads
--   private.get_secret('service_role_key'), which there returns a 219-char LEGACY JWT, because
--   Prod's reframe authCheck decodes JWT claims. On DEV private.get_secret('service_role_key')
--   is NULL - Dev has no JWT-format service key at all - so this reads Vault's
--   service_role_key, the modern 41-char sb_secret_ value. Dev's reframe Edge Function must
--   therefore gate on an exact match against its own SUPABASE_SERVICE_ROLE_KEY rather than on
--   JWT claims. Recorded here so the divergence is not mistaken for drift.
--
-- Step 2/2b: admin_ingest_source had TWO independent faults.
--   (a) No Authorization header, same platform-gate problem as above.
--   (b) It had NEVER worked: it probed for net.http_post(text,jsonb,text),
--       net.http_post(text,text,jsonb) and net.http_request(text,text,jsonb,text), none of which
--       exist - pg_net provides only http_post(url, body jsonb, params jsonb, headers jsonb,
--       timeout int) and http_get(...) - so it always fell through to
--       'pg_net HTTP client functions not available'. The Sources admin UI "Ingest now" button
--       has been failing loudly all along, and fixing (a) alone would not have revived it.
--   Also: declared STABLE while enqueuing a pg_net row (a write) -> VOLATILE; body built as text
--   -> jsonb; returns {"request_id":N,"async":true} because pg_net is ASYNC and returns a request
--   id, not a response. src/ callers only check `error`, so the shape change is safe.
--   The 'demo123' fallback is removed: app.cron_secret is unset here, so the literal was ALWAYS
--   what got sent; it now reads Vault.

do $pre$
declare n int;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'expected pg_net signature not present - refusing';
  end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname in ('run_reframe_http','admin_ingest_source')
     and p.prosrc like '%demo123%';
  if n <> 2 then raise exception 'expected both targets to carry demo123, found % - refusing', n; end if;
  if (select decrypted_secret from vault.decrypted_secrets where name='service_role_key') is null then
    raise exception 'vault service_role_key missing - refusing'; end if;
  if (select decrypted_secret from vault.decrypted_secrets where name='cron_secret') is null then
    raise exception 'vault cron_secret missing - refusing'; end if;
end $pre$;

CREATE OR REPLACE FUNCTION public.run_reframe_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  PERFORM net.http_post(
    url     := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/reframe',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' ||
                   (select decrypted_secret from vault.decrypted_secrets
                     where name = 'service_role_key' limit 1)),
    body    := '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_ingest_source(p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'admin', 'auth', 'net', 'vault'
AS $function$
declare
  v_url    text  := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/ingest';
  v_body   jsonb := jsonb_build_object('source_id', p_source_id);
  v_cron   text  := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1);
  v_svc    text  := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1);
  v_req_id bigint;
begin
  if not coalesce(public.is_admin_me(), false) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  select net.http_post(
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
$function$;

do $post$
declare src text; vol "char"; n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname in ('public','admin') and p.prosrc like '%demo123%';
  if n <> 0 then raise exception 'post: % function(s) still carry demo123', n; end if;

  select p.prosrc into src from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='run_reframe_http';
  if src like '%x-cron-secret%' then raise exception 'post: reframe still sends x-cron-secret'; end if;
  if src not like '%Authorization%' then raise exception 'post: reframe has no Authorization header'; end if;
  if src not like '%essnvhvezxjcoqxvuxuq%' then raise exception 'post: reframe lost the Dev ref'; end if;

  select p.prosrc, p.provolatile into src, vol from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='admin_ingest_source';
  if src like '%pg_net HTTP client functions not available%' then
    raise exception 'post: dead pg_net probe survived'; end if;
  if vol <> 'v' then raise exception 'post: admin_ingest_source is not VOLATILE (is %)', vol; end if;
  if src not like '%is_admin_me%' then raise exception 'post: admin guard lost'; end if;
  if src not like '%essnvhvezxjcoqxvuxuq%' then raise exception 'post: admin_ingest_source lost the Dev ref'; end if;

  -- grants from the H-09 backport must survive
  if has_function_privilege('anon','public.admin_ingest_source(uuid)','EXECUTE')
     or has_function_privilege('anon','public.run_reframe_http()','EXECUTE') then
    raise exception 'post: anon regained EXECUTE'; end if;
  if not has_function_privilege('authenticated','public.admin_ingest_source(uuid)','EXECUTE') then
    raise exception 'post: authenticated lost EXECUTE - Sources admin UI would break'; end if;
end $post$;
