-- Deterministic location lookups (follow-up to Epic R's region fix, 20260926060000)
--
-- The seven "unordered LIMIT 1 on user_location_settings" functions flagged
-- earlier turned out to be deterministic on inspection (a unique-key lookup,
-- an existence check, a per-level max(), a level-ordered pick, whole-set reads).
-- Two real defects were found on the same path, and one tie remained:
--
-- 1. set_user_location_cascade_by_iso() — what Settings > Location called —
--    resolved the code across ALL location types with an unordered LIMIT 1.
--    13 county codes are shared by two places (e.g. US-VA-RICHMOND is both
--    Richmond and Richmond City), so a save could store the other one; and no
--    city has an iso_code, so every city save failed. Settings now saves by
--    location id (set_user_location_cascade, as Signup does). The by-ISO
--    function is kept for its other caller (claim_oauth_ip_location, country
--    codes, which are unique) but now matches only the requested level and
--    refuses an ambiguous code instead of guessing.
-- 2. set_user_location_by_iso() (both overloads; no client caller) had the
--    same unordered pick within a level; it now refuses an ambiguous code too.
--    It also compared the enum column to text (type = p_precision::text),
--    which Postgres rejects (location_tier_enum = text), so it could never
--    have succeeded; the comparison is now type::text.
-- 3. get_since_last_visit_summary() ordered the user's rows by level only; two
--    rows at the same level (possible through the non-cascade setter) tied.
--    location id is now the tie-breaker, as in user_primary_region().
--
-- Guarded in-place patches: each anchor must match exactly once, and a patch
-- already applied is skipped.

DO $patch$
DECLARE
  r record;
  v_def text;
  v_new text;
  v_n int;
BEGIN
  -- 1. set_user_location_cascade_by_iso: level filter + refuse ambiguity.
  FOR r IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname = 'set_user_location_cascade_by_iso' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def ~ 'l2\.type::text = p_precision::text' THEN
      RAISE NOTICE 'set_user_location_cascade_by_iso already patched';
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(v_def,
      'where\s+lower\(l\.iso_code\)\s*=\s*lower\(trim\(p_iso_code\)\)\s+limit\s+1;', 'gi');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'set_user_location_cascade_by_iso: lookup anchor matched % times', v_n;
    END IF;
    v_new := regexp_replace(v_def,
      'where\s+lower\(l\.iso_code\)\s*=\s*lower\(trim\(p_iso_code\)\)\s+limit\s+1;',
      'where lower(l.iso_code) = lower(trim(p_iso_code))
    and l.type::text = p_precision::text
    -- Only an unambiguous code at the requested level; never guess.
    and (select count(*) from public.locations l2
          where lower(l2.iso_code) = lower(trim(p_iso_code))
            and l2.type::text = p_precision::text) = 1;', 'i');
    SELECT count(*) INTO v_n FROM regexp_matches(v_new,
      '''No location found for iso_code %, precision %''', 'g');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'set_user_location_cascade_by_iso: message anchor matched % times', v_n;
    END IF;
    v_new := replace(v_new, '''No location found for iso_code %, precision %''',
      '''No single location found for iso_code %, precision % (missing or ambiguous; set the location by id)''');
    EXECUTE v_new;
  END LOOP;

  -- 2. set_user_location_by_iso (every overload): refuse ambiguity.
  FOR r IN SELECT p.oid, pg_get_function_identity_arguments(p.oid) args FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'set_user_location_by_iso' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def ~ 'l2\.type::text = p_precision::text' THEN
      RAISE NOTICE 'set_user_location_by_iso(%) already patched', r.args;
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(v_def,
      'where\s+iso_code\s*=\s*p_iso_code\s+and\s+type\s*=\s*p_precision::text\s+limit\s+1;', 'gi');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'set_user_location_by_iso(%): anchor matched % times', r.args, v_n;
    END IF;
    v_new := regexp_replace(v_def,
      'where\s+iso_code\s*=\s*p_iso_code\s+and\s+type\s*=\s*p_precision::text\s+limit\s+1;',
      'where iso_code = p_iso_code
    and type::text = p_precision::text
    -- Only an unambiguous code at the requested level; never guess.
    and (select count(*) from public.locations l2
          where l2.iso_code = p_iso_code and l2.type::text = p_precision::text) = 1;', 'i');
    EXECUTE v_new;
  END LOOP;

  -- 3. get_since_last_visit_summary: location id breaks ties within a level.
  FOR r IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname = 'get_since_last_visit_summary' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def ~ 'else\s+5\s+end\s*,\s*l\.id\s+limit\s+1;' THEN
      RAISE NOTICE 'get_since_last_visit_summary already patched';
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(v_def,
      '(when\s+''country''\s+then\s+4\s+else\s+5\s+end)(\s+limit\s+1;)', 'gi');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'get_since_last_visit_summary: anchor matched % times', v_n;
    END IF;
    v_new := regexp_replace(v_def,
      '(when\s+''country''\s+then\s+4\s+else\s+5\s+end)(\s+limit\s+1;)', '\1, l.id\2', 'i');
    EXECUTE v_new;
  END LOOP;
END
$patch$;
