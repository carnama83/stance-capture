-- H-01b: the H-01 guard worked but its exception was being swallowed.
--
-- All three cron control RPCs end with a catch-all:
--     EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT ... SQLERRM ...
-- which converts ANY failure into a normal result row. That caught the new authorization
-- RAISE too, so a non-admin call was correctly prevented (verified: active=null,
-- success=false, and the target job untouched) but came back as HTTP 200 carrying
-- 'Error: Not authorized' as data rather than as an error. A security control that
-- returns 200 is easy for a client - or an automated check - to read as success.
--
-- Fix: raise the guard with SQLSTATE insufficient_privilege (42501) and re-raise that
-- class ahead of the catch-all, so authorization failures propagate as real errors while
-- genuine runtime errors keep the existing lenient behaviour the admin UI expects.

DO $mig$
DECLARE
  r     record;
  v_def text;
  v_new text;
  v_n   int;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('toggle_cron_job','trigger_cron_job_now','update_cron_schedule')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;

    IF position('admin_users' in v_def) = 0 THEN
      RAISE EXCEPTION 'H-01b: % is missing the H-01 admin guard - apply H-01 first', r.sig;
    END IF;
    IF position('insufficient_privilege' in v_def) > 0 THEN
      RAISE EXCEPTION 'H-01b: % already re-raises insufficient_privilege', r.sig;
    END IF;

    -- 1) give both guard raises a distinguishable SQLSTATE
    v_n := (length(v_new) - length(replace(v_new, 'RAISE EXCEPTION ''Not authorized'';', ''))) / length('RAISE EXCEPTION ''Not authorized'';');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'H-01b: expected 1 "Not authorized" raise in %, found %', r.sig, v_n;
    END IF;
    v_new := replace(v_new,
      'RAISE EXCEPTION ''Not authorized'';',
      'RAISE EXCEPTION ''Not authorized'' USING ERRCODE = ''insufficient_privilege'';');

    v_n := (length(v_new) - length(replace(v_new, 'RAISE EXCEPTION ''Not authenticated'';', ''))) / length('RAISE EXCEPTION ''Not authenticated'';');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'H-01b: expected 1 "Not authenticated" raise in %, found %', r.sig, v_n;
    END IF;
    v_new := replace(v_new,
      'RAISE EXCEPTION ''Not authenticated'';',
      'RAISE EXCEPTION ''Not authenticated'' USING ERRCODE = ''insufficient_privilege'';');

    -- 2) re-raise that class ahead of the catch-all
    v_n := (length(v_new) - length(replace(v_new, E'EXCEPTION WHEN OTHERS THEN', ''))) / length(E'EXCEPTION WHEN OTHERS THEN');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'H-01b: expected 1 catch-all in %, found % - refusing', r.sig, v_n;
    END IF;
    v_new := replace(v_new,
      E'EXCEPTION WHEN OTHERS THEN',
      E'EXCEPTION\n  WHEN insufficient_privilege THEN\n    RAISE;   -- H-01b: never swallow an authorization failure\n  WHEN OTHERS THEN');

    IF v_new = v_def THEN
      RAISE EXCEPTION 'H-01b: body of % unchanged', r.sig;
    END IF;

    EXECUTE v_new;
    RAISE NOTICE 'H-01b: hardened %', r.sig;
  END LOOP;
END
$mig$;
