-- admin_ugq_queue richer projection; cover assignment prefers the hosted image.
-- Promoted from Dev (stance-capture-dev) as part of the Dev -> UAT -> Prod sync, 2026-09-21.
-- Function bodies captured verbatim from Dev live catalog via pg_get_functiondef().

-- admin_ugq_queue gains preview_reframe, seven joined questions columns and the
-- pending authority-suggestion join. That CHANGES THE RETURN TYPE, so CREATE OR
-- REPLACE would fail -- it must be dropped and recreated, and its grants replayed.
-- Dev grants: PUBLIC, anon, authenticated, postgres, service_role (all EXECUTE),
-- matching what UAT and Prod already have, so this is status quo, not widening.

DROP FUNCTION IF EXISTS public.admin_ugq_queue(text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_ugq_queue(p_status text, p_sort text, p_limit integer, p_offset integer)
 RETURNS TABLE(id uuid, raw_question text, admin_edited_question text, status text, quality_score integer, rejection_reason text, rejection_note text, source_url text, source_description text, location_label text, constituency_id uuid, suggested_topic_id uuid, auto_topic_id uuid, auto_topic_title text, auto_topic_status text, ai_screen_result jsonb, duplicate_of_question_id uuid, reframed_question_id uuid, created_at timestamp with time zone, reviewed_at timestamp with time zone, user_id uuid, proposer_username text, proposer_tier text, proposer_score integer, proposer_total_proposed integer, proposer_total_published integer, proposer_total_rejected integer, proposer_flagged boolean, preview_reframe jsonb, q_question text, q_slider_low_label text, q_slider_high_label text, q_context_summary text, q_supporting_links text[], q_status text, q_auto_published boolean, q_admin_reviewed_at timestamp with time zone, pending_authority_suggestion_id uuid, pending_authority_name text, pending_authority_domain text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
    SELECT
        p.id,
        p.raw_question,
        p.admin_edited_question,
        p.status,
        p.quality_score,
        p.rejection_reason,
        p.rejection_note,
        p.source_url,
        p.source_description,
        p.location_label,
        p.constituency_id,
        p.suggested_topic_id,
        p.auto_topic_id,
        at.title                          AS auto_topic_title,
        at.status                         AS auto_topic_status,
        p.ai_screen_result,
        p.duplicate_of_question_id,
        p.reframed_question_id,
        p.created_at,
        p.reviewed_at,
        p.user_id,
        pr.username                       AS proposer_username,
        COALESCE(rep.tier, 'new')         AS proposer_tier,
        COALESCE(rep.score, 0)            AS proposer_score,
        COALESCE(rep.total_proposed, 0)   AS proposer_total_proposed,
        COALESCE(rep.total_published, 0)  AS proposer_total_published,
        COALESCE(rep.total_rejected, 0)   AS proposer_total_rejected,
        COALESCE(rep.flagged, false)      AS proposer_flagged,
        p.preview_reframe,
        q.question                        AS q_question,
        q.slider_low_label                AS q_slider_low_label,
        q.slider_high_label               AS q_slider_high_label,
        q.context_summary                 AS q_context_summary,
        q.supporting_links                AS q_supporting_links,
        q.status                          AS q_status,
        q.auto_published                  AS q_auto_published,
        q.admin_reviewed_at               AS q_admin_reviewed_at,
        uas.id                            AS pending_authority_suggestion_id,
        ar.name                           AS pending_authority_name,
        ar.domain                         AS pending_authority_domain
    FROM public.user_question_proposals p
    LEFT JOIN public.profiles pr                  ON pr.user_id = p.user_id
    LEFT JOIN public.user_proposal_reputation rep ON rep.user_id = p.user_id
    LEFT JOIN public.topics at                    ON at.id = p.auto_topic_id
    LEFT JOIN public.questions q                  ON q.id = p.reframed_question_id
    LEFT JOIN public.user_authority_suggestions uas
                                                   ON uas.question_id = q.id
                                                  AND uas.status = 'user_tagged'
    LEFT JOIN public.authority_registry ar        ON ar.id = uas.authority_id
    WHERE public.is_admin()
      AND (p_status = 'all' OR p.status = p_status)
    ORDER BY
        CASE WHEN p_sort = 'quality'    THEN p.quality_score END DESC NULLS LAST,
        CASE WHEN p_sort = 'reputation' THEN COALESCE(rep.score, 0) END DESC NULLS LAST,
        p.created_at DESC
    LIMIT  GREATEST(1, LEAST(p_limit, 200))
    OFFSET GREATEST(0, p_offset);
$function$
;

GRANT EXECUTE ON FUNCTION public.admin_ugq_queue(text, text, integer, integer) TO PUBLIC, anon, authenticated, service_role;

-- assign_question_draft_cover: prefer the self-hosted image, fall back to the
-- remote one. UAT/Prod used ni.image_url only and lost the hosted copy.
CREATE OR REPLACE FUNCTION public.assign_question_draft_cover(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_topic_draft_id  uuid;
  v_cluster_id      uuid;
  v_framing_item_id uuid;
  v_image_url       text;
  v_news_item_id    uuid;
BEGIN
  -- Guard: draft must exist
  SELECT topic_draft_id
  INTO   v_topic_draft_id
  FROM   public.question_drafts
  WHERE  id = p_draft_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('assigned', false, 'source', 'not_found', 'image_url', null);
  END IF;

  -- Rule 1: already set (non-blank) → do nothing
  IF EXISTS (
    SELECT 1 FROM public.question_drafts
    WHERE  id = p_draft_id
      AND  cover_image_url IS NOT NULL
      AND  btrim(cover_image_url) <> ''
  ) THEN
    RETURN jsonb_build_object('assigned', false, 'source', 'already_set', 'image_url', null);
  END IF;

  -- Rule 2: framing news item's image
  SELECT td.news_item_id, td.cluster_id
  INTO   v_framing_item_id, v_cluster_id
  FROM   public.topic_drafts td
  WHERE  td.id = v_topic_draft_id;

  IF v_framing_item_id IS NOT NULL THEN
    -- CHANGED: prefer the mirrored copy, same as assign_question_cover().
    SELECT COALESCE(ni.hosted_image_url, ni.image_url)
    INTO   v_image_url
    FROM   public.news_items ni
    WHERE  ni.id = v_framing_item_id
      AND  ni.image_url IS NOT NULL
      AND  btrim(ni.image_url) <> '';

    IF FOUND AND v_image_url IS NOT NULL THEN
      UPDATE public.question_drafts
      SET    cover_image_url    = v_image_url,
             cover_news_item_id = v_framing_item_id,
             updated_at         = now()
      WHERE  id = p_draft_id;

      RETURN jsonb_build_object(
        'assigned',     true,
        'source',       'framing_item',
        'image_url',    v_image_url,
        'news_item_id', v_framing_item_id
      );
    END IF;
  END IF;

  -- Rule 3: cluster fallback — same cluster, pick newest by published_at
  IF v_cluster_id IS NOT NULL THEN
    -- CHANGED: same COALESCE preference as Rule 2.
    SELECT COALESCE(ni.hosted_image_url, ni.image_url), ni.id
    INTO   v_image_url, v_news_item_id
    FROM   public.topic_drafts td
    JOIN   public.news_items ni ON ni.id = td.news_item_id
    WHERE  td.cluster_id     = v_cluster_id
      AND  td.news_item_id  != COALESCE(v_framing_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND  ni.image_url     IS NOT NULL
      AND  btrim(ni.image_url) <> ''
    ORDER  BY ni.published_at DESC NULLS LAST,
              ni.created_at  DESC
    LIMIT  1;

    IF FOUND AND v_image_url IS NOT NULL THEN
      UPDATE public.question_drafts
      SET    cover_image_url    = v_image_url,
             cover_news_item_id = v_news_item_id,
             updated_at         = now()
      WHERE  id = p_draft_id;

      RETURN jsonb_build_object(
        'assigned',     true,
        'source',       'cluster_fallback',
        'image_url',    v_image_url,
        'news_item_id', v_news_item_id
      );
    END IF;
  END IF;

  -- Rule 4: nothing found — leave null
  RETURN jsonb_build_object('assigned', false, 'source', 'no_image_available', 'image_url', null);
END;
$function$
;

-- assign_question_covers_batch: call assign_question_cover_from_news_item(), which
-- is confirmed present on UAT and Prod. This also retires the reliance on Prod
-- stale 1-arg assign_question_cover() overload (the overload itself is left alone).
CREATE OR REPLACE FUNCTION public.assign_question_covers_batch(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id       uuid;
  v_assigned int := 0;
  v_skipped  int := 0;
  v_result   jsonb;
BEGIN
  FOR v_id IN
    SELECT id FROM public.questions
    WHERE  (cover_image_url IS NULL OR btrim(cover_image_url) = '')
      AND  status = 'active'
    ORDER  BY published_at DESC
    LIMIT  p_limit
  LOOP
    -- CHANGED: call the renamed function by its new, unambiguous name.
    -- Behavior is otherwise identical — same function, same body, just a
    -- name that no longer collides with the legacy 2-arg overload.
    v_result := public.assign_question_cover_from_news_item(v_id);
    IF (v_result->>'assigned')::boolean THEN
      v_assigned := v_assigned + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_assigned, 'skipped', v_skipped);
END;
$function$
;
