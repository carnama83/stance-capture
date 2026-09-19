-- =====================================================================
-- 1. public.run_reframe_http() had no authorization check, unlike every sibling
--    run_*_http. Not reachable today (no anon/authenticated EXECUTE) but a future
--    grant would silently open it, and it fires an authenticated HTTP request
--    using the service_role key from Vault.
--    NOTE: it runs with `SET search_path TO ''`, so is_admin_me() MUST be
--    schema-qualified or the guard itself would error at runtime.
--
-- 2. H-16 inside DB functions. H-16 fixed the 5000 ms pg_net default in the cron
--    COMMANDS; the same default applies to net.http_post calls inside functions
--    and none of the five passed timeout_milliseconds. pg_net is async, so a
--    timeout does not stop the Edge Function - the response is simply never
--    recorded, which is exactly the phantom-failure pattern behind H-10/H-16.
--
-- The timeout is inserted as the FIRST argument rather than after `body`,
-- because a first attempt anchored on `body := '{}'::jsonb` and was correctly
-- refused by its own guard: admin_ingest_source passes `body := v_body`.
-- All five calls use named arguments (asserted below), and named arguments are
-- order-independent, so inserting first is safe for every body shape.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.run_reframe_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- search_path is '' here, so every reference must be schema-qualified.
  IF NOT (coalesce(public.is_admin_me(), false) OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = 'insufficient_privilege';
  END IF;

  PERFORM net.http_post(
    url     := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/reframe',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' ||
                   (select decrypted_secret from vault.decrypted_secrets
                     where name = 'service_role_key' limit 1)),
    body    := '{}'::jsonb,
    timeout_milliseconds := 45000);
END;
$function$;

DO $mig$
DECLARE
  r        record;
  def      text;
  newdef   text;
  n        int := 0;
  leftover int;
BEGIN
  FOR r IN
    SELECT p.oid, nsp.nspname, p.proname
    FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE p.prokind = 'f' AND nsp.nspname IN ('public','private','admin')
      AND p.prosrc ~ 'net\.http_post\('
      AND p.prosrc !~ 'timeout_milliseconds'
    ORDER BY nsp.nspname, p.proname
  LOOP
    def := pg_get_functiondef(r.oid);

    IF (SELECT count(*) FROM regexp_matches(def, 'net\.http_post\(', 'g')) <> 1 THEN
      RAISE EXCEPTION '%.%: expected exactly 1 net.http_post call, refusing', r.nspname, r.proname;
    END IF;
    -- named-argument style is what makes a leading insertion safe
    IF def !~ 'url\s*:=' THEN
      RAISE EXCEPTION '%.%: net.http_post does not use named arguments, refusing', r.nspname, r.proname;
    END IF;

    newdef := regexp_replace(def, 'net\.http_post\(',
                'net.http_post(' || chr(10) || '      timeout_milliseconds := 45000,');
    IF newdef = def THEN
      RAISE EXCEPTION '%.%: rewrite produced no change, refusing', r.nspname, r.proname;
    END IF;

    EXECUTE newdef;
    n := n + 1;
  END LOOP;

  SELECT count(*) INTO leftover
  FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
  WHERE p.prokind='f' AND nsp.nspname IN ('public','private','admin')
    AND p.prosrc ~ 'net\.http_post\(' AND p.prosrc !~ 'timeout_milliseconds';
  IF leftover <> 0 THEN
    RAISE EXCEPTION 'post-flight: % function(s) still call net.http_post with no timeout', leftover;
  END IF;

  RAISE NOTICE 'pg_net timeouts added to % function(s)', n;
END
$mig$;
