CREATE OR REPLACE FUNCTION public.calculate_question_impact_score(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  v_url text := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/ai-score-question';
  v_svc text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_resp extensions.http_response;
  v_response JSONB;
  v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.questions WHERE id = p_question_id) THEN
    RAISE EXCEPTION 'Question % not found', p_question_id;
  END IF;

  IF v_svc IS NULL THEN
    RAISE EXCEPTION 'vault secret service_role_key missing';
  END IF;

  v_resp := extensions.http((
    'POST',
    v_url,
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || v_svc)
    ]::extensions.http_header[],
    'application/json',
    json_build_object('question_id', p_question_id)::text
  ));

  IF v_resp.status < 200 OR v_resp.status >= 300 THEN
    RAISE EXCEPTION 'ai-score-question http failed: status=% body=%', v_resp.status, left(coalesce(v_resp.content,''), 500);
  END IF;

  v_response := v_resp.content::jsonb;

  IF v_response->>'error' IS NOT NULL THEN
    RAISE EXCEPTION 'AI scoring failed: %', v_response->>'error';
  END IF;

  v_result := v_response;

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'AI scoring failed for question %: %', p_question_id, SQLERRM;
    RETURN jsonb_build_object(
      'error', SQLERRM,
      'question_id', p_question_id
    );
END;
$function$;
;
