CREATE OR REPLACE FUNCTION public.calculate_question_impact_score(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_response JSONB;
BEGIN
  -- Validate
  IF NOT EXISTS (SELECT 1 FROM public.questions WHERE id = p_question_id) THEN
    RAISE EXCEPTION 'Question % not found', p_question_id;
  END IF;

  -- Call Edge Function for AI scoring
  -- Fix (Sep 2026): extensions.http() takes an http_request composite argument
  -- directly (do not cast the request tuple to json), and returns an
  -- http_response record whose .content field holds the raw body text —
  -- that's what needs parsing as json, not the record itself.
  SELECT
    (extensions.http((
      'POST',
      current_setting('app.settings.supabase_url') || '/functions/v1/ai-score-question',
      ARRAY[
        extensions.http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
        extensions.http_header('Content-Type', 'application/json')
      ],
      'application/json',
      json_build_object('question_id', p_question_id)::text
    ))).content::json
  INTO v_response;

  -- Check if Edge Function returned error
  IF v_response->>'error' IS NOT NULL THEN
    RAISE EXCEPTION 'AI scoring failed: %', v_response->>'error';
  END IF;

  -- Parse response
  v_result := v_response;

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    -- If Edge Function fails, log error and return NULL
    RAISE WARNING 'AI scoring failed for question %: %', p_question_id, SQLERRM;
    RETURN jsonb_build_object(
      'error', SQLERRM,
      'question_id', p_question_id
    );
END;
$function$;
;
