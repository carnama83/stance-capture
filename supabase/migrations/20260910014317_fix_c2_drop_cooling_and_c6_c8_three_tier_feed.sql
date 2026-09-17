-- Epic C QA, Sep 2026 — three changes.
--
-- C-2: drop the dead cooling engine. update_question_lifecycle() was the only code
-- that ever wrote state='cooling'. It is unscheduled, has no callers (checked in
-- src/ and in every other public/admin function), and is BROKEN anyway — it
-- references questions.region_level, a column that does not exist. No live UI
-- consumes state='cooling': the V5 homepage replaced the Continuing Conversation
-- band with "Worth revisiting", built from phase changes plus
-- get_reopened_questions_for_user. Product decision: drop cooling from the spec
-- rather than maintain a state nothing reads.
DROP FUNCTION IF EXISTS public.update_question_lifecycle();

-- C-6 + C-8: both live in get_three_tier_curated_feed_v2. Applied surgically to the
-- function's OWN source so this is portable across environments whose bodies are
-- not byte-identical. Every step RAISEs if its pattern does not match.
DO $mig$
DECLARE src text; newsrc text; total int; lefts int;
BEGIN
  SELECT prosrc INTO src FROM pg_proc
   WHERE proname='get_three_tier_curated_feed_v2' AND pronamespace='public'::regnamespace;
  IF src IS NULL THEN RAISE EXCEPTION 'function not found'; END IF;
  newsrc := src;

  -- C-6 (a): impact scores must not gate visibility outright.
  newsrc := replace(newsrc,
    'JOIN topic_impact_scores tis ON tis.question_id = q.id',
    'LEFT JOIN topic_impact_scores tis ON tis.question_id = q.id');

  -- C-6 (b): treat "no score yet" as not-yet-ranked rather than excluded.
  newsrc := replace(newsrc,
    'AND tis.composite_score >= 5.5',
    'AND (tis.composite_score IS NULL OR tis.composite_score >= 5.5)');
  newsrc := replace(newsrc,
    'AND tis.composite_score >= 5.0',
    'AND (tis.composite_score IS NULL OR tis.composite_score >= 5.0)');

  -- C-6 (c): unscored questions sort last rather than first.
  newsrc := replace(newsrc,
    'ORDER BY tis.composite_score DESC',
    'ORDER BY tis.composite_score DESC NULLS LAST');

  IF newsrc = src THEN RAISE EXCEPTION 'C-6: no impact-score pattern matched'; END IF;

  -- guard: every join on topic_impact_scores must now be a LEFT JOIN
  SELECT count(*) INTO total FROM regexp_matches(newsrc, 'JOIN topic_impact_scores', 'g');
  SELECT count(*) INTO lefts FROM regexp_matches(newsrc, 'LEFT JOIN topic_impact_scores', 'g');
  IF total <> lefts THEN
    RAISE EXCEPTION 'C-6: % join(s) on topic_impact_scores, only % are LEFT', total, lefts;
  END IF;

  -- C-8: resolve location for p_user_id instead of reading the auth.uid()-scoped
  -- view, which made the parameter silently resolve to the caller.
  src := newsrc;
  newsrc := regexp_replace(newsrc,
    'SELECT\s*\n\s*city_label,\s*\n\s*state_label,\s*\n\s*country_label\s*\n\s*INTO v_city, v_state, v_country\s*\n\s*FROM user_region_dimensions\s*\n\s*WHERE user_id = p_user_id;',
    'SELECT' || chr(10) ||
    '        max(CASE WHEN l.type = ''city''::location_tier_enum THEN l.name END),' || chr(10) ||
    '        max(CASE WHEN l.type = ''state''::location_tier_enum THEN l.name END),' || chr(10) ||
    '        max(CASE WHEN l.type = ''country''::location_tier_enum THEN l.name END)' || chr(10) ||
    '      INTO v_city, v_state, v_country' || chr(10) ||
    '      FROM public.user_location_settings uls' || chr(10) ||
    '      LEFT JOIN public.locations l ON l.id = uls.location_id' || chr(10) ||
    '      WHERE uls.user_id = p_user_id;',
    'g');

  IF newsrc = src THEN RAISE EXCEPTION 'C-8: user_region_dimensions lookup did not match'; END IF;
  IF newsrc ilike '%user_region_dimensions%' THEN
    RAISE EXCEPTION 'C-8: a user_region_dimensions read remains'; END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.get_three_tier_curated_feed_v2('
    'p_user_id uuid DEFAULT NULL::uuid, p_date date DEFAULT CURRENT_DATE, '
    'p_ip_country text DEFAULT NULL::text) '
    'RETURNS TABLE(tier text, tier_label text, question_id uuid, question text, '
    'summary text, tags text[], location_label text, composite_score numeric, '
    'tier_position integer) '
    'LANGUAGE plpgsql SECURITY DEFINER AS %L', newsrc);
END $mig$;
