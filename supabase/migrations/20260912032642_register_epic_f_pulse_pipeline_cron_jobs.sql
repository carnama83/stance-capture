-- F-01: three of the five pipeline jobs documented in Epic F section 7.5 were never
-- registered in cron.job, leaving community_trends, demographic_breakdowns,
-- topic_region_trends and topic_pulse_metrics_mv permanently empty.
--
-- Ordering follows the Epic's own rules:
--   BR-F03: snapshot_stance_stats_daily() (02:00) must run BEFORE snapshot_community_trends().
--   Section 7.5: refresh_topic_pulse_metrics() must run AFTER refresh_topic_region_trends().
-- The hourly pair is offset from trending-refresh-hourly (:00) to avoid overlap.
DO $mig$
DECLARE
  v_missing text;
BEGIN
  -- refuse if any target function is absent
  SELECT string_agg(fn, ', ') INTO v_missing
  FROM (VALUES ('snapshot_community_trends'), ('refresh_topic_region_trends'), ('refresh_topic_pulse_metrics')) t(fn)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = t.fn
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'F-01: missing target function(s): %', v_missing;
  END IF;

  -- prerequisite must already be scheduled, else BR-F03 ordering is meaningless
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%snapshot_stance_stats_daily%') THEN
    RAISE EXCEPTION 'F-01: snapshot_stance_stats_daily() is not scheduled - refusing (BR-F03 prerequisite)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-trends-daily') THEN
    PERFORM cron.schedule('community-trends-daily', '0 3 * * *',
                          'SELECT public.snapshot_community_trends()');
    RAISE NOTICE 'scheduled community-trends-daily';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'topic-region-trends-hourly') THEN
    PERFORM cron.schedule('topic-region-trends-hourly', '10 * * * *',
                          'SELECT public.refresh_topic_region_trends()');
    RAISE NOTICE 'scheduled topic-region-trends-hourly';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'topic-pulse-metrics-hourly') THEN
    PERFORM cron.schedule('topic-pulse-metrics-hourly', '20 * * * *',
                          'SELECT public.refresh_topic_pulse_metrics()');
    RAISE NOTICE 'scheduled topic-pulse-metrics-hourly';
  END IF;
END
$mig$;
