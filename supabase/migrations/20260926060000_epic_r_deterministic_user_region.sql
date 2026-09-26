-- Epic R — deterministic user region for expectations
--
-- A user has one user_location_settings row per level of their location
-- (set_user_location_cascade writes city → county → state → country). Epic R
-- picked "the" region with an unordered LIMIT 1 in two places — the client's
-- fetchUserRegionId() (which region's signal and ledger link to show) and
-- set_my_question_expectations() (which region an expectation is counted in)
-- — so the two could disagree and a user might never see their own region's
-- signal.
--
-- Both now use one definition: the most specific level the user has (city,
-- then county, then state, then country, then none). This matches what the
-- unordered reads happened to return in every test so far, so existing
-- expectations keep their region.
--
-- 1. user_primary_region(user) — the single definition (internal).
-- 2. get_my_primary_region() — the caller's own region, for the client.
-- 3. set_my_question_expectations() — guarded patch of each environment's own
--    body: the first-submission region lookup now calls user_primary_region().
--    The anchor must match exactly once; skipped if already applied;
--    SECURITY DEFINER and search_path are kept (pg_get_functiondef).

CREATE OR REPLACE FUNCTION public.user_primary_region(p_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT uls.location_id
  FROM public.user_location_settings uls
  WHERE uls.user_id = p_user_id
  ORDER BY CASE uls.precision::text
             WHEN 'city' THEN 1 WHEN 'county' THEN 2 WHEN 'state' THEN 3
             WHEN 'country' THEN 4 ELSE 5 END,
           uls.location_id
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.user_primary_region(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_primary_region(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_primary_region()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE public.user_primary_region(auth.uid()) END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_primary_region() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_primary_region() TO authenticated, service_role;

DO $mig$
DECLARE
  v_oid oid := 'public.set_my_question_expectations(uuid, text[])'::regprocedure;
  v_def text;
  v_anchor text := 'SELECT\s+uls\.location_id\s+INTO\s+v_region\s+FROM\s+public\.user_location_settings\s+uls\s+WHERE\s+uls\.user_id\s*=\s*v_uid\s+LIMIT\s+1\s*;';
BEGIN
  v_def := pg_get_functiondef(v_oid);
  IF v_def LIKE '%user_primary_region%' THEN
    RAISE NOTICE 'set_my_question_expectations already uses user_primary_region — skipping';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_anchor, 'gi')) <> 1 THEN
    RAISE EXCEPTION 'region lookup anchor not found exactly once in set_my_question_expectations';
  END IF;
  v_def := regexp_replace(v_def, v_anchor,
    '-- Epic R: most specific level (user_primary_region), not an unordered LIMIT 1' || E'\n' ||
    '    v_region := public.user_primary_region(v_uid);', 'i');
  EXECUTE v_def;
  IF pg_get_functiondef(v_oid) NOT LIKE '%user_primary_region%' THEN
    RAISE EXCEPTION 'region lookup patch did not take';
  END IF;
END
$mig$;
