-- Tighten EXECUTE on four SECURITY DEFINER functions to the strictest state across
-- the three environments. Found by the first-ever grants comparison (22 Sep 2026).
--
-- No environment was canonical - each was the loose one somewhere:
--
--   function                     Dev              UAT              Prod
--   admin_list_proposers()       strict           PUBLIC+anon      PUBLIC+anon
--   admin_moderate_proposer(..)  strict           PUBLIC+anon      PUBLIC+anon
--   stub_question_renditions()   svc_role only    svc_role only    PUBLIC+anon+auth
--   clear_my_dob()               PUBLIC+anon      PUBLIC+anon      strict
--
-- IMPORTANT: the looseness is carried by a grant to PUBLIC ("=X/postgres" in proacl),
-- not only by a direct anon grant. has_function_privilege('anon', ...) reports true for
-- either, so a REVOKE ... FROM anon alone would be a silent no-op and leave the function
-- callable by anon through PUBLIC. Each function below is therefore revoked from PUBLIC
-- and anon first, then granted back explicitly to the roles that should keep it. That
-- makes the end state deterministic regardless of where the environment started, and
-- idempotent on re-run.
--
-- Why each is safe:
--   admin_list_proposers / admin_moderate_proposer - called by the admin UI as an
--     authenticated admin; `authenticated` is retained, so the UI is unaffected. Both
--     already self-gate internally, so this is defence in depth, not a closed door.
--   stub_question_renditions - a TRIGGER function. Trigger firing does not check
--     EXECUTE against the invoking role, so removing anon/authenticated does not affect
--     the trigger. It only blocks direct PostgREST RPC calls, which is the point: this
--     was one of the anon-callable unguarded writers on Prod.
--   clear_my_dob - called by signed-in users; `authenticated` is retained.

REVOKE ALL ON FUNCTION public.admin_list_proposers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_proposers() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_moderate_proposer(uuid, text, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_moderate_proposer(uuid, text, timestamp with time zone) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.stub_question_renditions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stub_question_renditions() TO service_role;

REVOKE ALL ON FUNCTION public.clear_my_dob() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_my_dob() TO authenticated, service_role;

-- Assert the end state so a partial apply cannot pass silently.
DO $$
DECLARE
  r record;
  v_bad text := '';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
           has_function_privilege('service_role', p.oid, 'EXECUTE')  AS svc_x
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('admin_list_proposers', 'admin_moderate_proposer',
                         'stub_question_renditions', 'clear_my_dob')
  LOOP
    IF r.anon_x THEN
      v_bad := v_bad || format(' %s still executable by anon;', r.proname);
    END IF;
    IF NOT r.svc_x THEN
      v_bad := v_bad || format(' %s lost service_role;', r.proname);
    END IF;
    IF r.proname = 'stub_question_renditions' AND r.auth_x THEN
      v_bad := v_bad || ' stub_question_renditions still executable by authenticated;';
    END IF;
    IF r.proname <> 'stub_question_renditions' AND NOT r.auth_x THEN
      v_bad := v_bad || format(' %s lost authenticated;', r.proname);
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'sync_dev_10 end state wrong:%', v_bad;
  END IF;

  RAISE NOTICE 'sync_dev_10 OK: all four functions tightened';
END
$$;
