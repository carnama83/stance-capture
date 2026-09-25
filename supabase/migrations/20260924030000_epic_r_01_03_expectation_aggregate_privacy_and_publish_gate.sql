-- Epic R — R-01 + R-03 (Dev reconciliation, 24 Sep 2026)
--
-- R-01: question_expectation_summary and region_expectation_strength run with
-- the owner's rights (no security_invoker) and were granted to anon and
-- authenticated with no minimum-count suppression. With one respondent per
-- question/region, an anonymous REST GET returned that person's exact
-- selections and microsecond answer times. Browser roles lose direct access to
-- both views; two RPCs replace them:
--   * get_expectation_signal()          — public; returns data ONLY when the
--                                          signal threshold is crossed, and
--                                          never per-type timestamps.
--   * admin_get_expectation_preview()   — admin-only; full preview for the
--                                          ledger publish panel.
--
-- R-03: publish_expectation_ledger() published whenever any data existed —
-- a 1-participant ledger was published on Dev. It now refuses unless
-- region_expectation_strength.signal_crossed for (question, region).

-- ── R-01: close the views ─────────────────────────────────────────────────
REVOKE ALL ON public.question_expectation_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.region_expectation_strength  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.question_expectation_summary TO service_role;
GRANT SELECT ON public.region_expectation_strength  TO service_role;

COMMENT ON VIEW public.question_expectation_summary IS
  'Owner-rights aggregate of question_expectations. NOT readable by anon/authenticated '
  '(Epic R R-01): small cells would expose individual selections. Browser access goes '
  'through get_expectation_signal() (threshold-gated) or admin_get_expectation_preview().';

-- ── R-01: public, threshold-gated signal ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_expectation_signal(p_question_id uuid, p_region_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- NULL unless the signal has crossed threshold for this question/region
  -- (p_region_id NULL = the no-location bucket, matching the old client query).
  SELECT jsonb_build_object(
           'signal_crossed', true,
           'total_respondents', s.total_respondents,
           'dominant_expectation_type', s.dominant_expectation_type,
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

REVOKE ALL ON FUNCTION public.get_expectation_signal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expectation_signal(uuid, uuid) TO anon, authenticated, service_role;

-- ── R-01: admin preview for the ledger publish panel ──────────────────────
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
    'thresholds', (
      SELECT jsonb_build_object(
        'threshold_pct', coalesce(max(value) FILTER (WHERE key = 'expectation_threshold_pct'), 65),
        'min_respondents', coalesce(max(value) FILTER (WHERE key = 'expectation_min_respondents'), 100),
        'persistence_hours', coalesce(max(value) FILTER (WHERE key = 'expectation_persistence_hours'), 72))
      FROM public.app_config_trending),
    'rows', v_rows);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_expectation_preview(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_expectation_preview(uuid, uuid) TO authenticated, service_role;

-- ── R-03: threshold gate in publish_expectation_ledger (guarded patch) ────
DO $mig$
DECLARE
  v_oid oid := 'public.publish_expectation_ledger(uuid, uuid)'::regprocedure;
  v_src text;
  v_new text;
  -- Line-ending agnostic: Dev's body is CRLF, other environments may be LF.
  v_anchor text := '(\n[ \t]*SELECT\s+jsonb_agg\()';
  v_gate text := $g$    -- Epic R R-03: publish only once the signal has crossed threshold
    -- (BR-R02 / US-R11). A below-threshold ledger would put a handful of
    -- individual responses on a public, shareable page.
    IF NOT EXISTS (
        SELECT 1 FROM public.region_expectation_strength s
        WHERE s.question_id = p_question_id
          AND s.region_id = p_region_id
          AND s.signal_crossed
    ) THEN
        RAISE EXCEPTION 'Signal threshold not met for question % / region % — a ledger can only be published once the expectation signal has crossed threshold', p_question_id, p_region_id
            USING ERRCODE = 'P0001';
    END IF;

$g$;
  v_secdef boolean;
  v_cfg text[];
BEGIN
  SELECT prosrc, prosecdef, proconfig INTO v_src, v_secdef, v_cfg FROM pg_proc WHERE oid = v_oid;
  IF v_src LIKE '%Epic R R-03%' THEN
    RAISE NOTICE 'publish_expectation_ledger already gated — skipping';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, v_anchor, 'g')) <> 1 THEN
    RAISE EXCEPTION 'R-03 patch: anchor not found exactly once in publish_expectation_ledger';
  END IF;
  IF NOT v_secdef OR v_cfg IS DISTINCT FROM ARRAY['search_path=public, auth'] THEN
    RAISE EXCEPTION 'R-03 patch: unexpected prosecdef/proconfig (%, %)', v_secdef, v_cfg;
  END IF;
  v_new := regexp_replace(v_src, v_anchor, E'\n' || replace(v_gate, '\', '\\') || E'\\1');
  EXECUTE format($f$CREATE OR REPLACE FUNCTION public.publish_expectation_ledger(p_question_id uuid, p_region_id uuid)
 RETURNS expectation_ledgers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS %L$f$, v_new);
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) NOT LIKE '%Epic R R-03%' THEN
    RAISE EXCEPTION 'R-03 patch: gate missing after replace';
  END IF;
END
$mig$;
