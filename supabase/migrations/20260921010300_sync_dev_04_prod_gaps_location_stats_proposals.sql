-- Prod-only gaps: location_id writes, WhatsApp regional stances, preview_reframe.
-- Promoted from Dev (stance-capture-dev) as part of the Dev -> UAT -> Prod sync, 2026-09-21.
-- Function bodies captured verbatim from Dev live catalog via pg_get_functiondef().

-- These four already match on Dev and UAT; only Prod is behind. Applying to both
-- is a no-op on UAT and closes the gap on Prod.

-- location_id was never resolved/written on Prod, so questions published there
-- landed with a NULL location_id.
CREATE OR REPLACE FUNCTION public.admin_create_question_draft(p_topic_draft_id uuid, p_question text, p_summary text, p_tags text[], p_location_label text, p_ai_version text, p_ai_input jsonb, p_ai_output jsonb, p_scope text DEFAULT NULL::text, p_guardrail_flags text[] DEFAULT '{}'::text[], p_qa_passed boolean DEFAULT NULL::boolean, p_audience_location_label text DEFAULT NULL::text, p_audience_reason text DEFAULT NULL::text, p_parent_topic_id uuid DEFAULT NULL::uuid, p_parent_topic_confidence numeric DEFAULT NULL::numeric, p_parent_topic_reason text DEFAULT NULL::text)
 RETURNS question_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_drafts;
begin
  perform public.assert_admin_caller();
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_publish_question_draft(p_draft_id uuid)
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
$function$
;

-- Regional stance aggregates on Prod excluded anonymous WhatsApp forward-chain
-- stances entirely; this unions them in across every region tier.
CREATE OR REPLACE FUNCTION public.refresh_question_stance_stats_region(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_total     integer;
  v_agree     integer;
  v_disagree  integer;
  v_neutral   integer;
  v_avg       numeric;
begin
  -- 1) GLOBAL aggregate (no join needed) — unchanged
  select count(*)::int,
         count(*) filter (where qs.score > 0)::int,
         count(*) filter (where qs.score < 0)::int,
         count(*) filter (where qs.score = 0)::int,
         avg(qs.score)::numeric
  into v_total, v_agree, v_disagree, v_neutral, v_avg
  from public.question_stances qs
  where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id);

  if v_total = 0 then
    delete from public.question_stance_stats_region
    where question_id = p_question_id;
    return;
  else
    insert into public.question_stance_stats_region (
      question_id, region_scope, region_key, region_label,
      total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
    )
    values (
      p_question_id, 'global', 'global', 'Global',
      v_total,
      (v_agree::numeric    * 100.0) / v_total,
      (v_disagree::numeric * 100.0) / v_total,
      (v_neutral::numeric  * 100.0) / v_total,
      v_avg, now()
    )
    on conflict (question_id, region_scope, region_key)
    do update set
      total_responses = excluded.total_responses,
      pct_agree       = excluded.pct_agree,
      pct_disagree    = excluded.pct_disagree,
      pct_neutral     = excluded.pct_neutral,
      avg_score       = excluded.avg_score,
      updated_at      = excluded.updated_at;
  end if;

  -- CITY
  insert into public.question_stance_stats_region (
    question_id, region_scope, region_key, region_label,
    total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
  )
  with urd as (
    select uls.user_id,
           max(case when l.type = 'city'::location_tier_enum    then l.name end) as city_label,
           max(case when l.type = 'county'::location_tier_enum  then l.name end) as county_label,
           max(case when l.type = 'state'::location_tier_enum   then l.name end) as state_label,
           max(case when l.type = 'country'::location_tier_enum then l.name end) as country_label
    from public.user_location_settings uls
    join public.locations l on l.id = uls.location_id
    group by uls.user_id
  ),
  combined as (
    select qs.score, urd.city_label as region_label
    from public.question_stances qs
    join urd on urd.user_id = qs.user_id
    where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)
      and urd.city_label is not null

    union all

    select qs.score, lal.city_label as region_label
    from public.question_stances qs
    join public.whatsapp_forward_chains wfc on wfc.id = qs.forward_chain_id
    join public.location_ancestor_labels(wfc.location_id) lal on true
    where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)
      and qs.user_id is null
      and wfc.location_id is not null
      and lal.city_label is not null
  )
  select
    p_question_id, 'city', region_label, region_label,
    count(*)::int,
    (count(*) filter (where score > 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score < 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score = 0)::numeric * 100.0) / count(*),
    avg(score)::numeric,
    now()
  from combined
  group by region_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- COUNTY
  insert into public.question_stance_stats_region (
    question_id, region_scope, region_key, region_label,
    total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
  )
  with urd as (
    select uls.user_id,
           max(case when l.type = 'city'::location_tier_enum    then l.name end) as city_label,
           max(case when l.type = 'county'::location_tier_enum  then l.name end) as county_label,
           max(case when l.type = 'state'::location_tier_enum   then l.name end) as state_label,
           max(case when l.type = 'country'::location_tier_enum then l.name end) as country_label
    from public.user_location_settings uls
    join public.locations l on l.id = uls.location_id
    group by uls.user_id
  ),
  combined as (
    select qs.score, urd.county_label as region_label
    from public.question_stances qs
    join urd on urd.user_id = qs.user_id
    where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)
      and urd.county_label is not null

    union all

    select qs.score, lal.county_label as region_label
    from public.question_stances qs
    join public.whatsapp_forward_chains wfc on wfc.id = qs.forward_chain_id
    join public.location_ancestor_labels(wfc.location_id) lal on true
    where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)
      and qs.user_id is null
      and wfc.location_id is not null
      and lal.county_label is not null
  )
  select
    p_question_id, 'county', region_label, region_label,
    count(*)::int,
    (count(*) filter (where score > 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score < 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score = 0)::numeric * 100.0) / count(*),
    avg(score)::numeric,
    now()
  from combined
  group by region_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- STATE
  insert into public.question_stance_stats_region (
    question_id, region_scope, region_key, region_label,
    total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
  )
  with urd as (
    select uls.user_id,
           max(case when l.type = 'city'::location_tier_enum    then l.name end) as city_label,
           max(case when l.type = 'county'::location_tier_enum  then l.name end) as county_label,
           max(case when l.type = 'state'::location_tier_enum   then l.name end) as state_label,
           max(case when l.type = 'country'::location_tier_enum then l.name end) as country_label
    from public.user_location_settings uls
    join public.locations l on l.id = uls.location_id
    group by uls.user_id
  ),
  combined as (
    select qs.score, urd.state_label as region_label
    from public.question_stances qs
    join urd on urd.user_id = qs.user_id
    where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)
      and urd.state_label is not null

    union all

    select qs.score, lal.state_label as region_label
    from public.question_stances qs
    join public.whatsapp_forward_chains wfc on wfc.id = qs.forward_chain_id
    join public.location_ancestor_labels(wfc.location_id) lal on true
    where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)
      and qs.user_id is null
      and wfc.location_id is not null
      and lal.state_label is not null
  )
  select
    p_question_id, 'state', region_label, region_label,
    count(*)::int,
    (count(*) filter (where score > 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score < 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score = 0)::numeric * 100.0) / count(*),
    avg(score)::numeric,
    now()
  from combined
  group by region_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- COUNTRY
  insert into public.question_stance_stats_region (
    question_id, region_scope, region_key, region_label,
    total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
  )
  with urd as (
    select uls.user_id,
           max(case when l.type = 'city'::location_tier_enum    then l.name end) as city_label,
           max(case when l.type = 'county'::location_tier_enum  then l.name end) as county_label,
           max(case when l.type = 'state'::location_tier_enum   then l.name end) as state_label,
           max(case when l.type = 'country'::location_tier_enum then l.name end) as country_label
    from public.user_location_settings uls
    join public.locations l on l.id = uls.location_id
    group by uls.user_id
  ),
  combined as (
    select qs.score, urd.country_label as region_label
    from public.question_stances qs
    join urd on urd.user_id = qs.user_id
    where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)
      and urd.country_label is not null

    union all

    select qs.score, lal.country_label as region_label
    from public.question_stances qs
    join public.whatsapp_forward_chains wfc on wfc.id = qs.forward_chain_id
    join public.location_ancestor_labels(wfc.location_id) lal on true
    where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)
      and qs.user_id is null
      and wfc.location_id is not null
      and lal.country_label is not null
  )
  select
    p_question_id, 'country', region_label, region_label,
    count(*)::int,
    (count(*) filter (where score > 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score < 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score = 0)::numeric * 100.0) / count(*),
    avg(score)::numeric,
    now()
  from combined
  group by region_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;
end;
$function$
;

-- get_my_proposals gains preview_reframe. RETURN TYPE CHANGE -> drop and recreate.
-- The preview_reframe column already exists on user_question_proposals in both
-- targets, so only the projection changes.
DROP FUNCTION IF EXISTS public.get_my_proposals();

CREATE OR REPLACE FUNCTION public.get_my_proposals()
 RETURNS TABLE(id uuid, raw_question text, status text, rejection_reason text, created_at timestamp with time zone, reframed_question_id uuid, response_count bigint, preview_reframe jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
    select
        p.id,
        p.raw_question,
        p.status,
        p.rejection_reason,
        p.created_at,
        p.reframed_question_id,
        coalesce((
            select count(*) from public.question_stances qs
            where qs.question_id = p.reframed_question_id
        ), 0)::bigint as response_count,
        p.preview_reframe
    from public.user_question_proposals p
    where p.user_id = auth.uid()
    order by p.created_at desc;
$function$
;

GRANT EXECUTE ON FUNCTION public.get_my_proposals() TO PUBLIC, anon, authenticated, service_role;
