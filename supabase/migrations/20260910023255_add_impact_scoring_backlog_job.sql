-- Epic C follow-up (Sep 2026): scheduled impact scoring.
--
-- Context: C-6 made questions without a topic_impact_scores row visible in the
-- three-tier feed instead of excluding them outright, but nothing was ever
-- scoring them — Dev had 7 of 115 scored, Prod 1 of 2. composite_score is the
-- feed's ranking input, so an unscored corpus means effectively unranked tiers.
--
-- IMPORTANT COST NOTE: calculate_question_impact_score() performs a SYNCHRONOUS
-- HTTP POST to the ai-score-question edge function — one LLM call per question,
-- blocking inside the transaction. Measured on Dev at ~2.4s per question
-- (3 questions in 7.09s, 0 errors). A naive "score everything unscored" sweep
-- would therefore be ~100 sequential AI calls in one transaction: a statement
-- timeout and an unnecessary token burst. Hence the hard per-run cap below.
--
-- Oldest-unscored-first, so a backlog drains deterministically and newly
-- published questions are picked up once the backlog clears.
CREATE OR REPLACE FUNCTION public.score_unscored_questions(p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 25 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 25 (got %) — this makes one AI call per question', p_limit;
  END IF;

  SELECT array_agg(id) INTO v_ids
  FROM (
    SELECT q.id
    FROM public.questions q
    LEFT JOIN public.topic_impact_scores t ON t.question_id = q.id
    WHERE q.status = 'active'
      AND t.question_id IS NULL
    ORDER BY q.published_at ASC
    LIMIT p_limit
  ) s;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('scored', 0, 'note', 'no unscored active questions', 'ran_at', now());
  END IF;

  v_result := public.calculate_question_impact_scores_batch(v_ids);

  RETURN jsonb_build_object(
    'ran_at', now(),
    'requested', array_length(v_ids, 1),
    'processed', v_result->'total_processed',
    'errors', v_result->'total_errors',
    'remaining_unscored', (
      SELECT count(*) FROM public.questions q
      LEFT JOIN public.topic_impact_scores t ON t.question_id = q.id
      WHERE q.status = 'active' AND t.question_id IS NULL
    )
  );
END;
$function$;
