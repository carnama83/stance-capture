-- BUG C-5 (Epic C QA, Sep 2026)
-- admin_mark_question_updated() updated phase/context/links but never incremented
-- context_version. QuestionDetailPage gates the entire QuestionContextUpdates panel
-- on context_version > 1, and questions default to 1 — so an admin phase update
-- produced no visible context history, despite the admin UI stating it "bumps
-- context_version". C-FR-19 and QA-C24 both specify the bump.
-- Only the UPDATE's column list changes; overwrite semantics are left as-is.
CREATE OR REPLACE FUNCTION public.admin_mark_question_updated(p_question_id uuid, p_new_phase text, p_new_context text, p_supporting_links text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_phase text;
  v_old_status text;
  v_users_affected integer;
  v_result jsonb;
  v_admin_id uuid;
  v_response_count integer;
  v_age_days numeric;
BEGIN
  IF NOT is_admin_me() THEN
    RAISE EXCEPTION 'Only admins can update question phases';
  END IF;

  v_admin_id := auth.uid();

  IF p_new_phase NOT IN ('initial', 'update', 'resolution', 'follow_up') THEN
    RAISE EXCEPTION 'Invalid phase: %', p_new_phase;
  END IF;

  SELECT
    phase,
    status::TEXT,
    COALESCE((SELECT COUNT(*) FROM public.question_stances WHERE question_id = p_question_id), 0),
    EXTRACT(EPOCH FROM (NOW() - published_at)) / 86400
  INTO v_old_phase, v_old_status, v_response_count, v_age_days
  FROM public.questions
  WHERE id = p_question_id;

  IF v_old_phase IS NULL THEN
    RAISE EXCEPTION 'Question % does not exist', p_question_id;
  END IF;

  -- C-5: context_version now incremented so the detail-page context panel appears.
  UPDATE public.questions
  SET
    phase = p_new_phase,
    context_summary = p_new_context,
    supporting_links = p_supporting_links,
    context_version = COALESCE(context_version, 1) + 1,
    last_context_refresh_at = NOW()
  WHERE id = p_question_id;

  INSERT INTO public.question_context_updates (
    question_id, updated_by, old_phase, new_phase, new_context, supporting_links, updated_at
  ) VALUES (
    p_question_id, v_admin_id, v_old_phase, p_new_phase, p_new_context, p_supporting_links, NOW()
  );

  INSERT INTO public.question_state_history (
    question_id, old_state, new_state, reason, response_count, response_rate, age_days, created_at, created_by
  ) VALUES (
    p_question_id,
    v_old_status::question_state,
    v_old_status::question_state,
    'admin_phase_update:' || v_old_phase || '->' || p_new_phase,
    v_response_count,
    0,
    COALESCE(v_age_days, 0),
    NOW(),
    v_admin_id
  );

  SELECT COUNT(DISTINCT uti.user_id)
  INTO v_users_affected
  FROM public.user_topic_interactions uti
  JOIN public.questions q ON q.topic_id = uti.topic_id
  WHERE q.id = p_question_id
    AND uti.last_question_phase_seen IS DISTINCT FROM p_new_phase;

  v_result := jsonb_build_object(
    'success', true,
    'question_id', p_question_id,
    'old_phase', v_old_phase,
    'new_phase', p_new_phase,
    'users_affected', v_users_affected,
    'updated_by', v_admin_id,
    'message', format(
      'Question updated from %s to %s. %s users will see it reopened.',
      v_old_phase, p_new_phase, v_users_affected
    )
  );

  RETURN v_result;
END;
$function$;
