CREATE OR REPLACE FUNCTION public.update_visibility_rules()
 RETURNS TABLE(updated_question_id uuid, updated_visibility text, updated_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH score_based_rules AS (
    SELECT
      tis.question_id,
      tis.composite_score,
      CASE
        -- New-question override (Sep 2026 fix): a question <48h old always stays
        -- visible regardless of composite_score — matches the design intent
        -- already documented in ai-score-question's own header comment, which
        -- claimed this override existed here but it never did.
        WHEN q.published_at > now() - interval '48 hours'
          THEN 'visible'::question_visibility_enum
        -- No score yet: visible by default (nothing to evaluate)
        WHEN tis.composite_score IS NULL  THEN 'visible'::question_visibility_enum
        -- Score-based suppression — applied immediately, no age or stance gate
        WHEN tis.composite_score < 5.0   THEN 'archived'::question_visibility_enum
        WHEN tis.composite_score < 7.0   THEN 'suppressed'::question_visibility_enum
        ELSE                                  'visible'::question_visibility_enum
      END AS new_visibility,
      CASE
        WHEN q.published_at > now() - interval '48 hours'
          THEN 'New question (<48h) — visible regardless of score'
        WHEN tis.composite_score IS NULL
          THEN 'Not yet scored — visible by default'
        WHEN tis.composite_score < 5.0
          THEN 'Very low composite score (' || ROUND(tis.composite_score, 2)::text || ', <5.0) — archived automatically'
        WHEN tis.composite_score < 7.0
          THEN 'Below threshold composite score (' || ROUND(tis.composite_score, 2)::text || ', <7.0) — suppressed automatically'
        ELSE
          'Composite score ' || ROUND(tis.composite_score, 2)::text || ' (≥7.0) — visible'
      END AS new_reason
    FROM public.topic_impact_scores tis
    INNER JOIN public.questions q ON q.id = tis.question_id
    WHERE q.status = 'active'
  )
  INSERT INTO public.question_visibility_rules (question_id, visibility, reason, last_evaluated_at)
  SELECT
    sbr.question_id,
    sbr.new_visibility,
    sbr.new_reason,
    NOW()
  FROM score_based_rules sbr
  ON CONFLICT (question_id)
  DO UPDATE SET
    visibility        = EXCLUDED.visibility,
    reason            = EXCLUDED.reason,
    last_evaluated_at = EXCLUDED.last_evaluated_at
  WHERE
    question_visibility_rules.visibility != EXCLUDED.visibility
    OR question_visibility_rules.reason  != EXCLUDED.reason
  RETURNING
    question_visibility_rules.question_id,
    question_visibility_rules.visibility::TEXT,
    question_visibility_rules.reason;
END;
$function$;
;
