-- H-01 (P0, SECURITY): the pg_cron control RPCs were callable by ANYONE, including
-- fully unauthenticated callers holding only the public anon key.
--
--   toggle_cron_job(bigint)            - no auth check at all
--   trigger_cron_job_now(bigint)       - no auth check at all
--   update_cron_schedule(bigint,text)  - no auth check at all
--
-- All three are SECURITY DEFINER with NO pinned search_path and EXECUTE held by PUBLIC
-- (hence anon). Verified live on Dev over the public REST endpoint as anon: each one
-- executed and reached its internal 'Job not found' branch for a non-existent jobid
-- (HTTP 200), proving the body ran with no authorization check. A real jobid would have
-- let an anonymous caller pause or resume any scheduled job, rewrite its schedule, or -
-- worst - trigger_cron_job_now reads the job's `command` out of cron.job and EXECUTEs it
-- as the definer, so any visitor could run destructive maintenance jobs on demand
-- (execute_pending_deletions(), the whatsapp purge DELETEs, the whole ingestion pipeline).
--
-- The contrast that proves it: get_cron_audit_logs() DOES gate on is_cron_admin() and
-- correctly refused anon with 'Permission denied: Admin access required'.
--
-- Two related problems fixed here:
--  * is_cron_admin() was not an admin check. Its body was
--      RETURN auth.uid() IS NOT NULL;
--    with a "-- TODO: Add proper admin_users check later" comment, so every authenticated
--    user was treated as a cron admin - and get_cron_audit_logs() returns joined
--    auth.users.email, leaking addresses to any logged-in user. Now checks admin_users.
--  * The *_secure variants (toggle_cron_job_secure, update_cron_schedule_secure,
--    trigger_cron_job_now_secure) only checked `auth.uid() IS NULL`, i.e. authentication
--    not authorization, so the name overpromised. They have ZERO referents in src/ and no
--    database callers (both verified before this migration), and the admin UI actually
--    calls the unguarded non-secure names, so they are dropped as dead duplicates rather
--    than kept as a second weaker entry point.
--
-- Gate style matches take_moderation_action()/M-H01, minus moderators: operating the
-- scheduler is an admin capability, not a moderation one, so this is admin_users only.

DROP FUNCTION IF EXISTS public.toggle_cron_job_secure(bigint);
DROP FUNCTION IF EXISTS public.update_cron_schedule_secure(bigint,text);
DROP FUNCTION IF EXISTS public.trigger_cron_job_now_secure(bigint);

-- is_cron_admin(): make it an actual admin check and pin search_path.
CREATE OR REPLACE FUNCTION public.is_cron_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $fn$
BEGIN
  -- H-01: previously `RETURN auth.uid() IS NOT NULL`, which made every authenticated
  -- user a cron admin. Scheduler access is admin-only.
  RETURN auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid());
END
$fn$;

-- Inject the admin guard into each of the three live control RPCs, patching THIS
-- environment's own body so return types / volatility / language are preserved exactly.
DO $mig$
DECLARE
  r        record;
  v_def    text;
  v_new    text;
  v_n      int;
  v_guard  text := E'BEGIN\n'
                || E'  -- H-01: admin-only. Added Sep 2026; this function previously had no\n'
                || E'  -- authorization check and was EXECUTE-able by anon.\n'
                || E'  IF auth.uid() IS NULL THEN\n'
                || E'    RAISE EXCEPTION ''Not authenticated'';\n'
                || E'  END IF;\n'
                || E'  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN\n'
                || E'    RAISE EXCEPTION ''Not authorized'';\n'
                || E'  END IF;\n';
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('toggle_cron_job','trigger_cron_job_now','update_cron_schedule')
  LOOP
    v_def := pg_get_functiondef(r.oid);

    IF position('SECURITY DEFINER' in v_def) = 0 THEN
      RAISE EXCEPTION 'H-01: % is not SECURITY DEFINER - refusing', r.sig;
    END IF;
    IF position('admin_users' in v_def) > 0 THEN
      RAISE EXCEPTION 'H-01: % already carries an admin_users check', r.sig;
    END IF;

    -- exactly one top-level BEGIN expected in these bodies
    v_n := (length(v_def) - length(replace(v_def, E'BEGIN\n', ''))) / length(E'BEGIN\n');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'H-01: expected exactly 1 "BEGIN" anchor in %, found % - refusing', r.sig, v_n;
    END IF;

    v_new := replace(v_def, E'BEGIN\n', v_guard);
    IF v_new = v_def THEN
      RAISE EXCEPTION 'H-01: body of % unchanged', r.sig;
    END IF;

    -- pin search_path at the same time (all three had none)
    IF position('SET search_path' in v_new) = 0 THEN
      v_new := replace(v_new, 'SECURITY DEFINER', E'SECURITY DEFINER\n SET search_path TO ''public'', ''auth'', ''cron''');
    END IF;

    EXECUTE v_new;
    RAISE NOTICE 'H-01: guarded %', r.sig;
  END LOOP;
END
$mig$;

-- Close the anonymous vector at the permission layer as well as in the body.
REVOKE EXECUTE ON FUNCTION public.toggle_cron_job(bigint)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trigger_cron_job_now(bigint)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_cron_schedule(bigint,text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_cron_audit_logs(integer)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_cron_admin()                     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.toggle_cron_job(bigint)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trigger_cron_job_now(bigint)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_cron_schedule(bigint,text)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cron_audit_logs(integer)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_cron_admin()                      TO authenticated, service_role;
