-- F-02: public.community_trends had no consumer anywhere - no database function
-- besides its own writer (snapshot_community_trends) and no frontend reference -
-- making it a write-only table. Every sibling Epic F aggregate table has an
-- accessor RPC (question_stance_stats_region -> get_community_pulse /
-- get_regional_comparison, question_stance_stats_history -> get_macro_trends,
-- demographic_breakdowns -> get_demographic_breakdown); community_trends was the
-- only one without. This adds the missing accessor, following the same shape as
-- its siblings: SQL STABLE SECURITY DEFINER, search_path = public, dates DESC,
-- EXECUTE granted to anon / authenticated / service_role (the table is public-read
-- per BR-F01, and contains only region-level aggregates - no PII).
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='get_community_trends'
  ) THEN
    RAISE EXCEPTION 'F-02: get_community_trends already exists - refusing to overwrite';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='community_trends'
  ) THEN
    RAISE EXCEPTION 'F-02: community_trends table not found';
  END IF;
END
$mig$;

CREATE FUNCTION public.get_community_trends(
  p_region_scope text,
  p_region_key   text,
  p_days         integer DEFAULT 30
)
RETURNS TABLE (
  snapshot_date    date,
  region_label     text,
  total_questions  integer,
  total_responses  integer,
  avg_pct_support  numeric,
  avg_pct_neutral  numeric,
  avg_pct_oppose   numeric,
  avg_score        numeric,
  score_stddev     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    ct.snapshot_date,
    ct.region_label,
    ct.total_questions,
    ct.total_responses,
    ct.avg_pct_support,
    ct.avg_pct_neutral,
    ct.avg_pct_oppose,
    ct.avg_score,
    ct.score_stddev
  FROM public.community_trends ct
  WHERE ct.region_scope = p_region_scope
    AND ct.region_key   = p_region_key
    AND ct.snapshot_date >= current_date - greatest(coalesce(p_days, 30), 0)
  ORDER BY ct.snapshot_date DESC;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_community_trends(text, text, integer)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_community_trends(text, text, integer) IS
  'Epic F / F-02: daily macro snapshot series from community_trends for one region scope+key. '
  'Complements get_macro_trends(), which derives the same shape from question_stance_stats_history '
  'at query time; this reads the pre-aggregated daily table written by snapshot_community_trends().';
