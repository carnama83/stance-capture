-- Epic R — R-07: no single "winner" in the expectation signal (BR-R09, R-FR-03)
--
-- Before: region_expectation_strength evaluated only the ONE top-ranked type
-- per question/region (row_number() = 1, ties broken arbitrarily), measured
-- the collection span on that type alone, and returned it as
-- dominant_expectation_type — which the UI then rendered as the winner.
-- Expectations are multi-select, so selection rates are independent and
-- several types can meet the threshold at once.
--
-- After:
--   * qualifying_expectation_types = every type whose selection rate meets
--     threshold_pct (ordered by rate, then name, deterministically);
--   * signal_crossed = at least one qualifying type (min_qualifying_types = 1)
--     AND total respondents >= min_respondents AND the collection span >=
--     persistence hours, where the span is first-to-last response across ALL
--     of the question/region's responses — the same window a ledger publishes;
--   * existing columns keep their names and types (dominant_expectation_type
--     is kept only for compatibility; nothing user-facing reads it any more);
--   * get_expectation_signal() / admin_get_expectation_preview() return the
--     qualifying list and the threshold instead of a dominant type.

CREATE OR REPLACE VIEW public.region_expectation_strength AS
 WITH cfg AS (
         SELECT COALESCE(max(app_config_trending.value) FILTER (WHERE app_config_trending.key = 'expectation_threshold_pct'::text), 65::numeric) AS threshold_pct,
            COALESCE(max(app_config_trending.value) FILTER (WHERE app_config_trending.key = 'expectation_min_respondents'::text), 100::numeric) AS min_respondents,
            COALESCE(max(app_config_trending.value) FILTER (WHERE app_config_trending.key = 'expectation_persistence_hours'::text), 72::numeric) AS persistence_hours
           FROM app_config_trending
        ), span AS (
         SELECT qe.question_id,
            qe.region_id,
            min(qe.created_at) AS first_response_at,
            max(qe.created_at) AS last_response_at
           FROM question_expectations qe
          GROUP BY qe.question_id, qe.region_id
        ), agg AS (
         SELECT s.question_id,
            s.region_id,
            (array_agg(s.expectation_type ORDER BY s.pct_of_respondents DESC NULLS LAST, s.response_count DESC, s.expectation_type))[1] AS top_type,
            max(s.pct_of_respondents) AS top_pct,
            max(s.total_respondents) AS total_respondents,
            COALESCE(array_agg(s.expectation_type ORDER BY s.pct_of_respondents DESC NULLS LAST, s.expectation_type)
              FILTER (WHERE s.pct_of_respondents >= cfg_1.threshold_pct), '{}'::text[]) AS qualifying
           FROM question_expectation_summary s
             CROSS JOIN cfg cfg_1
          GROUP BY s.question_id, s.region_id
        )
 SELECT a.question_id,
    a.region_id,
    a.top_type AS dominant_expectation_type,
    a.top_pct AS signal_strength_score,
    a.total_respondents,
    cardinality(a.qualifying) >= 1
      AND a.total_respondents::numeric >= cfg.min_respondents
      AND (EXTRACT(epoch FROM sp.last_response_at - sp.first_response_at) / 3600.0) >= cfg.persistence_hours AS signal_crossed,
    a.qualifying AS qualifying_expectation_types,
    sp.first_response_at,
    sp.last_response_at
   FROM agg a
     CROSS JOIN cfg
     JOIN span sp ON sp.question_id = a.question_id AND NOT (sp.region_id IS DISTINCT FROM a.region_id);

COMMENT ON VIEW public.region_expectation_strength IS
  'Epic R signal evaluation per question/region. qualifying_expectation_types = every type '
  'at or above threshold_pct (multi-select: rates are independent, BR-R09). NOT readable by '
  'anon/authenticated (R-01); use get_expectation_signal() / admin_get_expectation_preview().';

-- Public signal: the qualifying set and the threshold, never a single winner.
CREATE OR REPLACE FUNCTION public.get_expectation_signal(p_question_id uuid, p_region_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- NULL unless the signal has crossed threshold for this question/region
  -- (p_region_id NULL = the no-location bucket). Epic R R-01 + R-07.
  SELECT jsonb_build_object(
           'signal_crossed', true,
           'total_respondents', s.total_respondents,
           'qualifying_expectation_types', to_jsonb(s.qualifying_expectation_types),
           'threshold_pct', (SELECT coalesce(max(value) FILTER (WHERE key = 'expectation_threshold_pct'), 65)
                             FROM public.app_config_trending),
           'breakdown', (
             SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'expectation_type', q.expectation_type,
                      'response_count', q.response_count,
                      'pct_of_respondents', q.pct_of_respondents)
                    ORDER BY q.pct_of_respondents DESC, q.expectation_type), '[]'::jsonb)
             FROM public.question_expectation_summary q
             WHERE q.question_id = p_question_id
               AND q.region_id IS NOT DISTINCT FROM p_region_id))
  FROM public.region_expectation_strength s
  WHERE s.question_id = p_question_id
    AND s.region_id IS NOT DISTINCT FROM p_region_id
    AND s.signal_crossed
$function$;

-- Admin preview: add the qualifying set and the evaluated window.
CREATE OR REPLACE FUNCTION public.admin_get_expectation_preview(p_question_id uuid, p_region_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_strength record;
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can preview expectation data' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_strength
  FROM public.region_expectation_strength s
  WHERE s.question_id = p_question_id
    AND s.region_id IS NOT DISTINCT FROM p_region_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'expectation_type', q.expectation_type,
           'response_count', q.response_count,
           'pct_of_respondents', q.pct_of_respondents,
           'total_respondents', q.total_respondents,
           'first_response_at', q.first_response_at,
           'last_response_at', q.last_response_at)
         ORDER BY q.pct_of_respondents DESC, q.expectation_type), '[]'::jsonb)
  INTO v_rows
  FROM public.question_expectation_summary q
  WHERE q.question_id = p_question_id
    AND q.region_id IS NOT DISTINCT FROM p_region_id;

  RETURN jsonb_build_object(
    'signal_crossed', coalesce(v_strength.signal_crossed, false),
    'total_respondents', coalesce(v_strength.total_respondents, 0),
    'signal_strength_score', v_strength.signal_strength_score,
    'qualifying_expectation_types', coalesce(to_jsonb(v_strength.qualifying_expectation_types), '[]'::jsonb),
    'first_response_at', v_strength.first_response_at,
    'last_response_at', v_strength.last_response_at,
    'thresholds', (
      SELECT jsonb_build_object(
        'threshold_pct', coalesce(max(value) FILTER (WHERE key = 'expectation_threshold_pct'), 65),
        'min_respondents', coalesce(max(value) FILTER (WHERE key = 'expectation_min_respondents'), 100),
        'persistence_hours', coalesce(max(value) FILTER (WHERE key = 'expectation_persistence_hours'), 72))
      FROM public.app_config_trending),
    'rows', v_rows);
END;
$function$;

-- CREATE OR REPLACE keeps existing grants; restate the intended ones explicitly.
REVOKE ALL ON public.region_expectation_strength FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.region_expectation_strength TO service_role;
REVOKE ALL ON FUNCTION public.get_expectation_signal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expectation_signal(uuid, uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_expectation_preview(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_expectation_preview(uuid, uuid) TO authenticated, service_role;
