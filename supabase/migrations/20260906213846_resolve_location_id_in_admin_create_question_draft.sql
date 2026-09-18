-- Sep 2026, NEW: resolves location_id at draft-creation time so
-- stub_question_renditions() (which now gates on location_id, not
-- text_mentions_india()) has something to work with once this draft is
-- eventually published. audience_location_label preferred over
-- location_label since it's the "who this is for" field — the more
-- semantically correct signal for language relevance specifically.
create or replace function public.admin_create_question_draft(p_topic_draft_id uuid, p_question text, p_summary text, p_tags text[], p_location_label text, p_ai_version text, p_ai_input jsonb, p_ai_output jsonb, p_scope text DEFAULT NULL::text, p_guardrail_flags text[] DEFAULT '{}'::text[], p_qa_passed boolean DEFAULT NULL::boolean, p_audience_location_label text DEFAULT NULL::text, p_audience_reason text DEFAULT NULL::text, p_parent_topic_id uuid DEFAULT NULL::uuid, p_parent_topic_confidence numeric DEFAULT NULL::numeric, p_parent_topic_reason text DEFAULT NULL::text)
 RETURNS question_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_drafts;
begin
  insert into public.question_drafts(
    topic_draft_id,
    question,
    summary,
    tags,
    location_label,
    status,
    ai_version,
    ai_input,
    ai_output,
    scope,
    guardrail_flags,
    qa_passed,
    audience_location_label,
    audience_reason,
    location_id,
    created_by
  )
  values (
    p_topic_draft_id,
    p_question,
    p_summary,
    coalesce(p_tags, '{}'),
    p_location_label,
    'draft',
    p_ai_version,
    p_ai_input,
    p_ai_output,
    p_scope,
    coalesce(p_guardrail_flags, '{}'),
    p_qa_passed,
    p_audience_location_label,
    p_audience_reason,
    public.resolve_location_id(coalesce(p_audience_location_label, p_location_label)),
    auth.uid()
  )
  returning * into v_row;

  -- Write parent classification back to topic_drafts if provided
  IF p_parent_topic_id IS NOT NULL THEN
    UPDATE public.topic_drafts
    SET
      parent_topic_id         = p_parent_topic_id,
      parent_topic_confidence = p_parent_topic_confidence,
      parent_topic_reason     = p_parent_topic_reason,
      updated_at              = now()
    WHERE id = p_topic_draft_id;
  END IF;

  return v_row;
end;
$function$;
;
