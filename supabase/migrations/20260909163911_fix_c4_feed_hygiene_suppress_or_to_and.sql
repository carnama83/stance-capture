-- BUG C-4 (Epic C QA, Sep 2026)
-- apply_feed_hygiene() suppressed a question if EITHER its response count was low
-- OR its composite score was below threshold. On a low-traffic platform the
-- response arm is true for virtually every question, so the OR suppressed 100%
-- of eligible content (112/112 on Dev; 1 of Prod's 2 questions already archived).
-- BR-C09 documents the rule as AND, not OR. This flips only that operator, in
-- both the live and dry-run predicates. The deliberately-tuned 24h window and
-- 7.0 score threshold are left exactly as they were.
CREATE OR REPLACE FUNCTION public.apply_feed_hygiene(p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_suppressed   integer := 0;
  v_archived     integer := 0;
  v_boosted      integer := 0;
  v_skipped      integer := 0;

  v_low_engagement_threshold  integer := 5;    -- responses_total to be considered "engaged"
  v_suppress_age_hours        integer := 24;   -- suppress after 24h if low engagement (was 72)
  v_archive_age_days          integer := 7;    -- archive after 7d if not trending
  v_min_composite_score       numeric := 7.0;  -- suppress if composite score below this (was 5.0)

  v_now timestamptz := now();
BEGIN

  -- Suppress: old + low engagement AND low composite score (C-4: was OR)
  IF NOT p_dry_run THEN
    WITH to_suppress AS (
      SELECT q.id AS question_id
      FROM questions q
      LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
      LEFT JOIN question_engagement_metrics qe ON qe.question_id = q.id
      LEFT JOIN topic_impact_scores tis ON tis.question_id = q.id
      WHERE
        q.status = 'active'
        AND (vr.visibility IS NULL OR vr.visibility = 'visible')
        AND q.is_trending = false
        AND q.published_at < (v_now - make_interval(hours => v_suppress_age_hours))
        AND (
          (qe.responses_total IS NULL OR qe.responses_total < v_low_engagement_threshold)
          AND
          (tis.composite_score IS NOT NULL AND tis.composite_score < v_min_composite_score)
        )
    )
    INSERT INTO question_visibility_rules (question_id, visibility, reason, last_evaluated_at)
    SELECT
      ts.question_id,
      'suppressed',
      'Feed hygiene: low engagement or score below ' || v_min_composite_score::text || ' after ' || v_suppress_age_hours::text || ' hours (auto)',
      v_now
    FROM to_suppress ts
    ON CONFLICT (question_id) DO UPDATE
      SET visibility = 'suppressed',
          reason = EXCLUDED.reason,
          last_evaluated_at = v_now;

    GET DIAGNOSTICS v_suppressed = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_suppressed
    FROM questions q
    LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
    LEFT JOIN question_engagement_metrics qe ON qe.question_id = q.id
    LEFT JOIN topic_impact_scores tis ON tis.question_id = q.id
    WHERE
      q.status = 'active'
      AND (vr.visibility IS NULL OR vr.visibility = 'visible')
      AND q.is_trending = false
      AND q.published_at < (v_now - make_interval(hours => v_suppress_age_hours))
      AND (
        (qe.responses_total IS NULL OR qe.responses_total < v_low_engagement_threshold)
        AND
        (tis.composite_score IS NOT NULL AND tis.composite_score < v_min_composite_score)
      );
  END IF;

  -- Archive: old + not trending + not engaged (unchanged)
  IF NOT p_dry_run THEN
    WITH to_archive AS (
      SELECT q.id AS question_id
      FROM questions q
      LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
      LEFT JOIN question_engagement_metrics qe ON qe.question_id = q.id
      WHERE
        q.status = 'active'
        AND (vr.visibility IS NULL OR vr.visibility IN ('visible', 'suppressed'))
        AND q.is_trending = false
        AND q.published_at < (v_now - make_interval(days => v_archive_age_days))
        AND (qe.responses_last_24h IS NULL OR qe.responses_last_24h < 2)
    )
    INSERT INTO question_visibility_rules (question_id, visibility, reason, last_evaluated_at)
    SELECT
      ta.question_id,
      'archived',
      format('Feed hygiene: no activity after %s days (auto)', v_archive_age_days),
      v_now
    FROM to_archive ta
    ON CONFLICT (question_id) DO UPDATE
      SET visibility = 'archived',
          reason = EXCLUDED.reason,
          last_evaluated_at = v_now;

    GET DIAGNOSTICS v_archived = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_archived
    FROM questions q
    LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
    LEFT JOIN question_engagement_metrics qe ON qe.question_id = q.id
    WHERE
      q.status = 'active'
      AND (vr.visibility IS NULL OR vr.visibility IN ('visible', 'suppressed'))
      AND q.is_trending = false
      AND q.published_at < (v_now - make_interval(days => v_archive_age_days))
      AND (qe.responses_last_24h IS NULL OR qe.responses_last_24h < 2);
  END IF;

  -- Boost: trending questions that were suppressed (unchanged)
  IF NOT p_dry_run THEN
    WITH to_boost AS (
      SELECT q.id AS question_id
      FROM questions q
      JOIN question_visibility_rules vr ON vr.question_id = q.id
      WHERE
        q.status = 'active'
        AND vr.visibility = 'suppressed'
        AND (q.is_trending = true OR q.trending_score > 20)
    )
    UPDATE question_visibility_rules vr
    SET
      visibility = 'visible',
      reason = 'Feed hygiene: restored — question is now trending',
      last_evaluated_at = v_now
    FROM to_boost tb
    WHERE vr.question_id = tb.question_id;

    GET DIAGNOSTICS v_boosted = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_boosted
    FROM questions q
    JOIN question_visibility_rules vr ON vr.question_id = q.id
    WHERE
      q.status = 'active'
      AND vr.visibility = 'suppressed'
      AND (q.is_trending = true OR q.trending_score > 20);
  END IF;

  RETURN jsonb_build_object(
    'ran_at',      v_now,
    'dry_run',     p_dry_run,
    'suppressed',  v_suppressed,
    'archived',    v_archived,
    'boosted',     v_boosted,
    'skipped',     v_skipped,
    'rules', jsonb_build_object(
      'suppress_after_hours',     v_suppress_age_hours,
      'archive_after_days',       v_archive_age_days,
      'min_composite_score',      v_min_composite_score,
      'low_engagement_threshold', v_low_engagement_threshold
    )
  );
END;
$function$;
