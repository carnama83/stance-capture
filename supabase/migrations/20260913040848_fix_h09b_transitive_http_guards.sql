-- DEV backport, part 1 of 3: H-09b transitive confused-deputy.
--
-- Same four SECURITY DEFINER functions as Prod and UAT, anon-EXECUTE-able with
-- no authorization check at all, each terminating in a function that reads the
-- service_role key from Vault and fires an authenticated HTTP request:
--   run_ingestion_pipeline()                  -> ingest + cluster + generate
--   calculate_question_impact_scores_batch()  -> ..._impact_score
--   score_unscored_questions(int)             -> ..._batch -> ..._impact_score
--   bootstrap_epic_p_data()                   -> ..._batch -> ..._impact_score
-- Verified byte-identical to Prod's versions before rewriting. Three of the four
-- also had NO pinned search_path.
--
-- Scheduler safety, checked first: of these four only score_unscored_questions is
-- on an ACTIVE Dev cron (jobid 8, 'impact-score-backlog-hourly', :30 hourly).
-- pg_cron runs as postgres and session_user is the real login role even inside
-- SECURITY DEFINER, so the guard admits it. EXECUTE is retained for
-- `authenticated` because PostgREST connects as that role and is_admin_me() is
-- what actually authorizes the admin UI.

CREATE OR REPLACE FUNCTION public.run_ingestion_pipeline()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
begin
  if not (coalesce(public.is_admin_me(), false) or session_user = 'postgres') then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;

  perform public.run_ingest_http();
  perform public.run_cluster_http();
  perform public.run_generate_http();
end;
$function$;

CREATE OR REPLACE FUNCTION public.score_unscored_questions(p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids uuid[];
  v_result jsonb;
BEGIN
  IF NOT (coalesce(public.is_admin_me(), false) OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = 'insufficient_privilege';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 25 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 25 (got %) - this makes one AI call per question', p_limit;
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

CREATE OR REPLACE FUNCTION public.calculate_question_impact_scores_batch(p_question_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_question_id UUID;
  v_results JSONB := '[]'::jsonb;
  v_score JSONB;
  v_count INT := 0;
  v_errors INT := 0;
BEGIN
  IF NOT (coalesce(public.is_admin_me(), false) OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = 'insufficient_privilege';
  END IF;

  IF p_question_ids IS NULL OR array_length(p_question_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'question_ids array cannot be empty';
  END IF;

  FOREACH v_question_id IN ARRAY p_question_ids
  LOOP
    BEGIN
      v_score := public.calculate_question_impact_score(v_question_id);
      v_results := v_results || v_score;
      v_count := v_count + 1;
    EXCEPTION
      -- H-01b lesson: an authorization failure must never be swallowed and
      -- reported as a per-question "error" alongside a 200.
      WHEN insufficient_privilege THEN
        RAISE;
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        RAISE NOTICE 'Error scoring question %: %', v_question_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total_processed', v_count,
    'total_errors', v_errors,
    'scores', v_results,
    'timestamp', NOW()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bootstrap_epic_p_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
DECLARE
  v_question_ids UUID[];
  v_scoring_result JSONB;
  v_visibility_count INT;
  v_top_questions UUID[];
BEGIN
  IF NOT (coalesce(public.is_admin_me(), false) OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Not authorized' USING errcode = 'insufficient_privilege';
  END IF;

  SELECT array_agg(q.id ORDER BY tis.updated_at ASC NULLS FIRST)
  INTO v_question_ids
  FROM public.questions q
  LEFT JOIN public.topic_impact_scores tis ON tis.question_id = q.id
  WHERE q.status = 'active';

  IF v_question_ids IS NULL OR array_length(v_question_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active questions found to score');
  END IF;

  v_scoring_result := public.calculate_question_impact_scores_batch(v_question_ids);

  SELECT COUNT(*) INTO v_visibility_count
  FROM public.update_visibility_rules();

  SELECT array_agg(question_id ORDER BY composite_score DESC)
  INTO v_top_questions
  FROM (
    SELECT q.id as question_id, tis.composite_score
    FROM public.questions q
    JOIN public.topic_impact_scores tis ON tis.question_id = q.id
    JOIN public.question_visibility_rules qvr ON qvr.question_id = q.id
    WHERE q.status = 'active' AND qvr.visibility = 'visible'
    ORDER BY tis.composite_score DESC
    LIMIT 7
  ) top_q;

  IF v_top_questions IS NOT NULL AND array_length(v_top_questions, 1) >= 5 THEN
    PERFORM public.publish_curated_set(CURRENT_DATE, v_top_questions);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'questions_scored', v_scoring_result->'total_processed',
    'visibility_rules_updated', v_visibility_count,
    'curated_questions', COALESCE(array_length(v_top_questions, 1), 0),
    'timestamp', NOW()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.run_ingestion_pipeline()                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.score_unscored_questions(integer)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.calculate_question_impact_scores_batch(uuid[])  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bootstrap_epic_p_data()                         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.run_ingestion_pipeline()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.score_unscored_questions(integer)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_question_impact_scores_batch(uuid[])  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_epic_p_data()                         TO authenticated;
