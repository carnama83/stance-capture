-- Sep 2026, NEW: re-resolves location_id independently at publish time
-- (not just copying the draft's stored value) — an admin may edit the
-- free-text location fields between draft creation and publish, and
-- re-resolving here catches that instead of trusting a possibly-stale
-- draft-time value. Uses the same v_audience_label/v_origin_label
-- precedence already computed just above in this function for
-- audience_location_label/origin_location_label themselves.
create or replace function public.admin_publish_question_draft(p_draft_id uuid)
 RETURNS questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin  boolean;
  v_draft     public.question_drafts%rowtype;
  v_topic     public.topic_drafts%rowtype;
  v_question  public.questions%rowtype;
  v_topic_id  uuid;

  -- Phase 4B: audience variables
  v_origin_label    text;
  v_audience_label  text;
  v_audience_reason text;

  -- Sep 2026, NEW: resolved location for language-relevance gating.
  v_location_id uuid;

  -- Epic AG: audience fit copy count (for logging)
  v_fit_rows_copied integer;

  -- Share/WhatsApp dedup fix: short, distinct link-preview blurb, separate
  -- from summary/core_tension (which now lives only in the WhatsApp body).
  v_context_summary text;
begin
  -- 1) Admin gate
  select public.is_admin_me() into v_is_admin;
  if not coalesce(v_is_admin, false) then
    raise exception 'not authorized'
      using errcode = '42501';
  end if;

  -- 2) Load the question draft
  select *
  into v_draft
  from public.question_drafts
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'draft not found'
      using errcode = 'P0002';
  end if;

  if v_draft.status is distinct from 'approved' then
    raise exception 'draft must be approved before publishing'
      using errcode = '22023';
  end if;

  -- 3) Load linked topic_draft for news_item + location (if present)
  begin
    select *
    into v_topic
    from public.topic_drafts
    where id = v_draft.topic_draft_id;
  exception
    when no_data_found then
      null;
  end;

  -- 3.5) Ensure canonical topic exists + write back topic_id on draft
  v_topic_id := public.ensure_topic_for_topic_draft(v_draft.topic_draft_id);

  update public.question_drafts
  set topic_id = v_topic_id
  where id = v_draft.id;

  -- 3.6) Resolve audience fields
  v_origin_label := COALESCE(
    v_draft.origin_location_label,
    v_draft.location_label,
    v_topic.location_label
  );

  IF v_draft.audience_location_label IS NOT NULL THEN
    v_audience_label  := v_draft.audience_location_label;
    v_audience_reason := v_draft.audience_reason;
  ELSE
    SELECT audience_label, reason
    INTO   v_audience_label, v_audience_reason
    FROM   public.infer_audience_location(
             v_draft.question,
             v_draft.summary,
             v_draft.tags,
             v_origin_label
           )
    LIMIT 1;
  END IF;

  -- 3.65) Sep 2026, NEW: resolve location_id fresh at publish time (not
  -- just copying v_draft.location_id) — see header note.
  v_location_id := public.resolve_location_id(coalesce(v_audience_label, v_origin_label));

  -- 3.7) Share/WhatsApp dedup fix — derive a short, distinct link-preview blurb
  -- from the topic's source summary (ai_input->>'topic_summary'), NOT from
  -- v_draft.summary. v_draft.summary is core_tension text and lands in
  -- questions.summary (shown in the WhatsApp message body). context_summary is
  -- what api/s/[slug].js shows as the unfurled card description — keeping
  -- them on separate source fields is what stops the same sentence appearing
  -- twice when a WhatsApp broadcast unfurls its own link.
  -- Deliberately NOT using ai_input->'news_item'->>'summary': it's missing on
  -- ~20% of drafts and occasionally raw RSS boilerplate with unescaped HTML
  -- entities — topic_summary is always present and is clean pipeline prose.
  -- Truncated to a clean word boundary at 160 chars; NULL-safe — both
  -- consumers fall back to `summary` if this ends up null.
  v_context_summary := NULLIF(trim(v_draft.ai_input->>'topic_summary'), '');
  IF v_context_summary IS NOT NULL AND length(v_context_summary) > 160 THEN
    v_context_summary := regexp_replace(left(v_context_summary, 160), '\s+\S*$', '') || '…';
  END IF;

  -- 4) Insert live question — now includes slider_low_label, slider_high_label,
  --    share_headline, context_summary, and location_id.
  insert into public.questions (
    question_draft_id,
    topic_draft_id,
    topic_id,
    news_item_id,
    question,
    summary,
    tags,
    location_label,
    status,
    created_by,
    published_at,
    cover_image_url,
    cover_news_item_id,
    -- Phase 4B additions
    origin_location_label,
    audience_location_label,
    audience_reason,
    -- Dynamic slider labels
    slider_low_label,
    slider_high_label,
    -- Short, distinct link-preview headline
    share_headline,
    -- Short, distinct link-preview description (separate from summary/body text)
    context_summary,
    -- Sep 2026, NEW
    location_id
  )
  values (
    v_draft.id,
    v_draft.topic_draft_id,
    v_topic_id,
    coalesce(v_topic.news_item_id, null),
    v_draft.question,
    v_draft.summary,
    coalesce(v_draft.tags, '{}'),
    coalesce(v_draft.location_label, v_topic.location_label),
    'active',
    auth.uid(),
    now(),
    v_draft.cover_image_url,
    v_draft.cover_news_item_id,
    -- Phase 4B additions
    v_origin_label,
    v_audience_label,
    v_audience_reason,
    -- Dynamic slider labels — null-safe: UI falls back to generic labels
    v_draft.slider_low_label,
    v_draft.slider_high_label,
    -- null-safe: api/s/[slug].js falls back to the full question if this is null
    v_draft.share_headline,
    -- null-safe: both consumers fall back to `summary` if this is null
    v_context_summary,
    v_location_id
  )
  returning * into v_question;

  -- 5) Assign cover image if missing
  if v_question.cover_image_url is null then
    perform public.assign_question_cover(v_question.id, false);
    select * into v_question
    from public.questions
    where id = v_question.id;
  end if;

  -- ── 6) Epic AG: Copy audience fit rows draft → published question ──────────
  -- Copies all rows from question_draft_audience_fit for this draft into
  -- question_audience_fit for the new live question_id.
  -- ON CONFLICT DO UPDATE preserves admin_override rows (reviewed_by_admin=true)
  -- and updates ai_pipeline rows in case of republish.
  -- Draft rows are intentionally preserved for audit — not deleted.
  INSERT INTO public.question_audience_fit (
    question_id,
    audience_segment_id,
    relevance_tier,
    reason,
    source,
    reviewed_by_admin,
    created_at,
    updated_at
  )
  SELECT
    v_question.id,          -- new live question id
    qdaf.audience_segment_id,
    qdaf.relevance_tier,
    qdaf.reason,
    qdaf.source,
    qdaf.reviewed_by_admin,
    now(),
    now()
  FROM public.question_draft_audience_fit qdaf
  WHERE qdaf.question_draft_id = p_draft_id
  ON CONFLICT (question_id, audience_segment_id)
    DO UPDATE SET
      relevance_tier    = EXCLUDED.relevance_tier,
      reason            = EXCLUDED.reason,
      -- Only overwrite source/reviewed_by_admin if the incoming row
      -- is an admin_override — never downgrade an admin_override to ai_pipeline
      source            = CASE
                            WHEN EXCLUDED.source = 'admin_override' THEN 'admin_override'
                            WHEN question_audience_fit.source = 'admin_override' THEN 'admin_override'
                            ELSE EXCLUDED.source
                          END,
      reviewed_by_admin = GREATEST(
                            question_audience_fit.reviewed_by_admin,
                            EXCLUDED.reviewed_by_admin
                          ),
      updated_at        = now();

  GET DIAGNOSTICS v_fit_rows_copied = ROW_COUNT;

  -- If no draft fit rows exist (pre-Epic questions republished, or AI skipped),
  -- insert a fallback general row so the question always has at least one fit entry.
  IF v_fit_rows_copied = 0 THEN
    INSERT INTO public.question_audience_fit (
      question_id,
      audience_segment_id,
      relevance_tier,
      reason,
      source,
      reviewed_by_admin
    )
    SELECT
      v_question.id,
      id,
      'general',
      'No audience fit data on draft — fallback general assigned at publish.',
      'ai_pipeline',
      false
    FROM public.audience_segments
    WHERE key    = 'general'
      AND status = 'active'
    LIMIT 1
    ON CONFLICT (question_id, audience_segment_id) DO NOTHING;
  END IF;
  -- ── End Epic AG ────────────────────────────────────────────────────────────

  return v_question;
end;
$function$;
;
