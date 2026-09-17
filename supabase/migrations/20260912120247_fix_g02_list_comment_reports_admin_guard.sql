-- G-02 (P0): public.list_comment_reports() is SECURITY DEFINER with a pure-SQL body
-- that contains NO admin check, and EXECUTE is held by PUBLIC (hence anon). Because
-- SECURITY DEFINER bypasses the RLS that section 9 / section 17 cite as the mitigation,
-- ANY caller - including a fully unauthenticated `anon` request carrying only the
-- public anon key - could read the entire moderation queue: reported comment bodies,
-- the comment author's user_id, the REPORTER's user_id (de-anonymising reporters) and
-- toxicity scores. Verified empirically on Dev as a third-party authenticated user and
-- as anon, while direct reads of comment_reports / toxicity_scores correctly returned
-- 0 rows - i.e. RLS is fine, the function was the hole. Same defect shape as D-02.
--
-- G-03 (P3) is fixed at the same time: three overloads existed (4-, 7- and 8-arg) with
-- EVERY argument defaulted on all three, so any call with 0-7 arguments failed with
-- "function ... is not unique". Only the 8-arg form was callable, and it is the only one
-- any caller uses (src/routes/admin/moderation/index.tsx sends all 8 named args). The
-- 4- and 7-arg versions were unreachable dead code AND two more unguarded entry points,
-- so they are dropped rather than guarded. Confirmed first that no database function,
-- view or matview references them.
--
-- The guard is injected into THIS environment's own body via pg_get_functiondef(), so
-- LANGUAGE / STABLE / SECURITY DEFINER / search_path / the RETURNS TABLE signature are
-- all preserved exactly, and the migration aborts rather than half-applying.

DROP FUNCTION IF EXISTS public.list_comment_reports(integer,integer,text,text);
DROP FUNCTION IF EXISTS public.list_comment_reports(integer,integer,text,text,numeric,timestamptz,timestamptz);

DO $mig$
DECLARE v_def text; v_new text; v_n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='list_comment_reports' AND p.pronargs=8;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'G-02: 8-arg list_comment_reports() not found';
  END IF;
  IF position('SECURITY DEFINER' in v_def) = 0 THEN
    RAISE EXCEPTION 'G-02: target is not SECURITY DEFINER - refusing';
  END IF;
  IF position('is_admin' in v_def) > 0 THEN
    RAISE EXCEPTION 'G-02: already guarded';
  END IF;

  -- the body carries exactly one "  WHERE" clause; anything else means drift
  v_n := (length(v_def) - length(replace(v_def, '  WHERE', ''))) / length('  WHERE');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'G-02: expected exactly 1 "  WHERE" anchor, found % - refusing', v_n;
  END IF;

  v_new := replace(v_def, '  WHERE', '  WHERE' || E'\n' || '    public.is_admin() AND');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'G-02: body unchanged';
  END IF;

  EXECUTE v_new;

  -- is_admin() is SECURITY INVOKER, so inside this definer function it reads
  -- admin_users with the definer's privileges while auth.uid() still resolves to
  -- the CALLER - which is exactly the semantics this guard needs.
END
$mig$;

-- Defence in depth: PUBLIC held EXECUTE (shown as "=X/postgres" in proacl), which is
-- how anon reached it. Revoke from PUBLIC/anon so an unauthenticated call is refused at
-- the permission layer rather than merely returning an empty set.
REVOKE EXECUTE ON FUNCTION public.list_comment_reports(integer,integer,text,text,numeric,timestamptz,timestamptz,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.list_comment_reports(integer,integer,text,text,numeric,timestamptz,timestamptz,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_comment_reports(integer,integer,text,text,numeric,timestamptz,timestamptz,text) IS
  'Epic G / G-02: admin-only moderation queue. Guarded by public.is_admin(); non-admins receive an empty set and anon is refused EXECUTE. Do not re-grant to anon or PUBLIC.';
