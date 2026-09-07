-- Backfill 15 functions that exist on dev but were never migrated to UAT.
-- Found via a full public-schema pg_proc diff between dev and UAT while
-- confirming overall repo/schema parity. These predate migration tracking
-- (created directly on dev, same root cause as the 14 untracked tables
-- backfilled earlier) so the 24-migration replay never picked them up.
--
-- Highest severity: get_unclustered_candidates, bootstrap_whatsapp_account,
-- claim_whatsapp_signin_token, claim_whatsapp_stances_for_profile, and
-- verify_whatsapp_otp_for_signin are called directly by edge functions
-- (cluster, whatsapp-flow-webhook, whatsapp-signin-redeem,
-- whatsapp-otp-verify) that were just deployed to UAT — without these RPCs
-- those functions fail at runtime on every invocation.

CREATE OR REPLACE FUNCTION public.get_unclustered_candidates(p_since timestamp with time zone, p_limit integer)
 RETURNS TABLE(id uuid, source_id uuid, title text, summary text, raw jsonb, normalized jsonb, url text, embedding vector, created_at timestamp with time zone, entities jsonb, embed_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select
    iq.id, iq.source_id, iq.title, iq.summary, iq.raw, iq.normalized,
    iq.url, iq.embedding, iq.created_at, iq.entities, iq.embed_status
  from public.ingestion_queue iq
  where iq.created_at >= p_since
    and iq.embedding is not null
    and iq.embed_status = 'done'
    and not exists (
      select 1 from public.topic_cluster_items tci
      where tci.ingestion_id = iq.id
    )
  order by iq.created_at desc
  limit p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_stances_for_profile(p_user_id uuid, p_phone_hash text)
 RETURNS TABLE(claimed integer, history_backfilled integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_history_count integer := 0;
  v_claimed_count  integer := 0;
  v_stance_id      uuid;
BEGIN
  IF p_user_id IS NULL OR p_phone_hash IS NULL THEN
    RAISE EXCEPTION 'claim_whatsapp_stances_for_profile: user_id and phone_hash are both required';
  END IF;

  UPDATE public.stance_history
  SET user_id = p_user_id
  WHERE whatsapp_phone_hash = p_phone_hash
    AND user_id IS NULL;
  GET DIAGNOSTICS v_history_count = ROW_COUNT;

  FOR v_stance_id IN
    SELECT id FROM public.question_stances
    WHERE whatsapp_phone_hash = p_phone_hash
      AND user_id IS NULL
  LOOP
    BEGIN
      UPDATE public.question_stances
      SET user_id = p_user_id
      WHERE id = v_stance_id
        AND user_id IS NULL;
      IF FOUND THEN
        v_claimed_count := v_claimed_count + 1;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  RETURN QUERY SELECT v_claimed_count, v_history_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bootstrap_whatsapp_account(p_user_id uuid, p_phone_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
BEGIN
  IF p_user_id IS NULL OR p_phone_hash IS NULL THEN
    RAISE EXCEPTION 'bootstrap_whatsapp_account: user_id and phone_hash are both required';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'bootstrap_whatsapp_account: no auth.users row (or no email) for %', p_user_id;
  END IF;

  INSERT INTO public.users (id, email, status, created_at, last_seen_at)
  VALUES (p_user_id, v_email, 'active'::public.user_status_enum, now(), now())
  ON CONFLICT (id) DO UPDATE
    SET email        = excluded.email,
        last_seen_at = now();

  INSERT INTO public.profiles (user_id, random_id, display_handle_mode, verified_phone_hash)
  VALUES (p_user_id, public.generate_random_id(), 'random_id'::public.display_handle_mode_enum, p_phone_hash)
  ON CONFLICT (user_id) DO NOTHING;

  BEGIN
    PERFORM public.claim_whatsapp_stances_for_profile(p_user_id, p_phone_hash);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'bootstrap_whatsapp_account: claim_whatsapp_stances_for_profile failed for %: %', p_user_id, SQLERRM;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_whatsapp_signin_token(p_token text)
 RETURNS TABLE(user_id uuid, device_id text, question_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.whatsapp_signin_tokens t
  SET used_at = now()
  WHERE t.token = p_token
    AND t.used_at IS NULL
    AND t.expires_at > now()
  RETURNING t.user_id, t.device_id, t.question_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_whatsapp_otp_for_signin(p_verification_token uuid, p_otp text)
 RETURNS TABLE(otp_valid boolean, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record;
  v_user_id uuid;
BEGIN
  SELECT * INTO v_rec
  FROM public.whatsapp_phone_verifications
  WHERE verification_token = p_verification_token
    AND used = false
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND OR v_rec.otp_code != p_otp THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.whatsapp_phone_verifications
  SET used = true
  WHERE id = v_rec.id;

  SELECT p.user_id INTO v_user_id
  FROM public.profiles p
  WHERE p.verified_phone_hash = v_rec.phone_hash;

  RETURN QUERY SELECT true, v_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_card_regeneration(p_question_id uuid, p_lease_seconds integer DEFAULT 30)
 RETURNS TABLE(claimed boolean, image_url text, stats_updated_at timestamp with time zone, render_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claimed boolean := false;
BEGIN
  INSERT INTO public.whatsapp_card_cache AS wcc (question_id, regenerating_since, cached_total_responses)
  VALUES (p_question_id, now(), 0)
  ON CONFLICT (question_id) DO UPDATE
    SET regenerating_since = now()
    WHERE wcc.regenerating_since IS NULL
       OR wcc.regenerating_since < now() - make_interval(secs => p_lease_seconds)
  RETURNING true INTO v_claimed;

  RETURN QUERY
  SELECT COALESCE(v_claimed, false), wcc.image_url, wcc.stats_updated_at, wcc.render_version
  FROM public.whatsapp_card_cache AS wcc
  WHERE wcc.question_id = p_question_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_question_cover_from_news_item(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_news_item_id uuid;
  v_topic_id     uuid;
  v_cluster_id   uuid;
  v_image_url    text;
  v_cover_ni_id  uuid;
BEGIN
  SELECT news_item_id, topic_id
  INTO   v_news_item_id, v_topic_id
  FROM   public.questions
  WHERE  id = p_question_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('assigned', false, 'source', 'not_found', 'image_url', null);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.questions
    WHERE  id = p_question_id
      AND  cover_image_url IS NOT NULL
      AND  btrim(cover_image_url) <> ''
  ) THEN
    RETURN jsonb_build_object('assigned', false, 'source', 'already_set', 'image_url', null);
  END IF;

  IF v_news_item_id IS NOT NULL THEN
    SELECT COALESCE(ni.hosted_image_url, ni.image_url)
    INTO   v_image_url
    FROM   public.news_items ni
    WHERE  ni.id = v_news_item_id
      AND  ni.image_url IS NOT NULL
      AND  btrim(ni.image_url) <> '';

    IF FOUND AND v_image_url IS NOT NULL THEN
      UPDATE public.questions
      SET    cover_image_url    = v_image_url,
             cover_news_item_id = v_news_item_id,
             updated_at         = now()
      WHERE  id = p_question_id;

      RETURN jsonb_build_object(
        'assigned',     true,
        'source',       'question_news_item',
        'image_url',    v_image_url,
        'news_item_id', v_news_item_id
      );
    END IF;
  END IF;

  IF v_topic_id IS NOT NULL THEN
    SELECT t.cluster_id
    INTO   v_cluster_id
    FROM   public.topics t
    WHERE  t.id = v_topic_id;

    IF v_cluster_id IS NOT NULL THEN
      SELECT COALESCE(ni.hosted_image_url, ni.image_url), ni.id
      INTO   v_image_url, v_cover_ni_id
      FROM   public.topic_drafts td
      JOIN   public.news_items ni ON ni.id = td.news_item_id
      WHERE  td.cluster_id     = v_cluster_id
        AND  ni.image_url     IS NOT NULL
        AND  btrim(ni.image_url) <> ''
      ORDER  BY ni.published_at DESC NULLS LAST,
                ni.created_at  DESC
      LIMIT  1;

      IF FOUND AND v_image_url IS NOT NULL THEN
        UPDATE public.questions
        SET    cover_image_url    = v_image_url,
               cover_news_item_id = v_cover_ni_id,
               updated_at         = now()
        WHERE  id = p_question_id;

        RETURN jsonb_build_object(
          'assigned',     true,
          'source',       'cluster_fallback',
          'image_url',    v_image_url,
          'news_item_id', v_cover_ni_id
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('assigned', false, 'source', 'no_image_available', 'image_url', null);
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_expectation_ledger(p_question_id uuid, p_region_id uuid)
 RETURNS expectation_ledgers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_snapshot jsonb;
    v_participation int;
    v_window_start timestamptz;
    v_window_end timestamptz;
    v_optin_count int;
    v_result public.expectation_ledgers;
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Only admins can publish expectation ledgers';
    END IF;

    IF p_region_id IS NULL THEN
        RAISE EXCEPTION 'expectation_ledgers requires a named region_id — the no-location bucket cannot be published';
    END IF;

    SELECT
        jsonb_agg(
            jsonb_build_object(
                'expectation_type', s.expectation_type,
                'response_count', s.response_count,
                'pct_of_respondents', s.pct_of_respondents
            )
            ORDER BY s.pct_of_respondents DESC
        ),
        MAX(s.total_respondents),
        MIN(s.first_response_at),
        MAX(s.last_response_at)
    INTO v_snapshot, v_participation, v_window_start, v_window_end
    FROM public.question_expectation_summary s
    WHERE s.question_id = p_question_id
        AND s.region_id = p_region_id;

    IF v_snapshot IS NULL THEN
        RAISE EXCEPTION 'No expectation data found for question % / region %', p_question_id, p_region_id;
    END IF;

    SELECT COUNT(*) INTO v_optin_count
    FROM public.collective_action_optins o
    WHERE o.question_id = p_question_id
        AND o.region_id = p_region_id;

    INSERT INTO public.expectation_ledgers (
        question_id, region_id, status, snapshot_summary,
        participation_count, time_window_start, time_window_end,
        optin_count, published_at, published_by
    ) VALUES (
        p_question_id, p_region_id, 'published', v_snapshot,
        v_participation, v_window_start, v_window_end,
        v_optin_count, now(), auth.uid()
    )
    ON CONFLICT (question_id, region_id) DO UPDATE SET
        status = 'published',
        snapshot_summary = EXCLUDED.snapshot_summary,
        participation_count = EXCLUDED.participation_count,
        time_window_start = EXCLUDED.time_window_start,
        time_window_end = EXCLUDED.time_window_end,
        optin_count = EXCLUDED.optin_count,
        published_at = now(),
        published_by = auth.uid()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_authority_response_status(p_question_id uuid, p_authority_id uuid, p_region_id uuid, p_response_status text, p_notes text DEFAULT NULL::text)
 RETURNS authority_responses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_result public.authority_responses;
    v_question_title text;
    v_status_label text;
    v_notification_body text;
    v_href text;
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Only admins can update authority response status';
    END IF;

    IF p_region_id IS NULL THEN
        INSERT INTO public.authority_responses (
            question_id, authority_id, region_id, response_status, status_updated_at, updated_by, notes
        ) VALUES (
            p_question_id, p_authority_id, NULL, p_response_status, now(), auth.uid(), p_notes
        )
        ON CONFLICT (question_id, authority_id) WHERE region_id IS NULL
        DO UPDATE SET
            response_status = EXCLUDED.response_status,
            status_updated_at = now(),
            updated_by = auth.uid(),
            notes = EXCLUDED.notes
        RETURNING * INTO v_result;
    ELSE
        INSERT INTO public.authority_responses (
            question_id, authority_id, region_id, response_status, status_updated_at, updated_by, notes
        ) VALUES (
            p_question_id, p_authority_id, p_region_id, p_response_status, now(), auth.uid(), p_notes
        )
        ON CONFLICT (question_id, authority_id, region_id) WHERE region_id IS NOT NULL
        DO UPDATE SET
            response_status = EXCLUDED.response_status,
            status_updated_at = now(),
            updated_by = auth.uid(),
            notes = EXCLUDED.notes
        RETURNING * INTO v_result;
    END IF;

    SELECT question INTO v_question_title FROM public.questions WHERE id = p_question_id;
    v_status_label := replace(p_response_status, '_', ' ');
    v_status_label := upper(left(v_status_label, 1)) || substring(v_status_label from 2);
    v_notification_body := format('An update is available on %s: status is now %s.', v_question_title, v_status_label);

    INSERT INTO public.user_notifications (user_id, notification_type, title, body, href, question_id, metadata)
    SELECT DISTINCT
        qe.user_id,
        'accountability_update',
        'Accountability update',
        v_notification_body,
        CASE WHEN p_region_id IS NULL
            THEN '/q/' || p_question_id
            ELSE '/ledger/' || p_question_id || '/' || p_region_id
        END,
        p_question_id,
        jsonb_build_object('authority_id', p_authority_id, 'response_status', p_response_status)
    FROM public.question_expectations qe
    WHERE qe.question_id = p_question_id
        AND qe.region_id IS NOT DISTINCT FROM p_region_id;

    RETURN v_result;
END;
$function$;

-- NOTE: get_related_questions_localized intentionally NOT backfilled here.
-- Confirmed by direct invocation that it is currently BROKEN on dev itself
-- (42P13 "return type mismatch... too few columns" — its SELECT list has 14
-- columns but v_live_questions now has 16, since content_type/
-- video_recording_path were added later and this function's body was never
-- updated to match). Backfilling would just copy a pre-existing dev bug,
-- not close a real UAT gap. Flagged separately; needs a fix on dev first.

CREATE OR REPLACE FUNCTION public.admin_claim_rendition_jobs(p_limit integer DEFAULT 20)
 RETURNS SETOF question_renditions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  claimed_ids uuid[];
  v_stale_after interval := interval '10 minutes';
begin
  with upd as (
    update public.question_renditions r
       set claimed_at = now()
     where r.id in (
       select id
       from public.question_renditions
       where transform_status = 'pending'
         and (claimed_at is null or claimed_at < now() - v_stale_after)
       order by created_at asc
       limit greatest(p_limit, 1)
       for update skip locked
     )
     returning r.id
  )
  select coalesce(array_agg(id), '{}') into claimed_ids
  from upd;

  return query
    select *
    from public.question_renditions
    where id = any(claimed_ids);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_edit_and_publish_rendition(p_rendition_id uuid, p_rendered_text text, p_slider_low_label text DEFAULT NULL::text, p_slider_high_label text DEFAULT NULL::text)
 RETURNS question_renditions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_row public.question_renditions;
begin
  perform public._ensure_admin_or_service();

  if p_rendered_text is null or btrim(p_rendered_text) = '' then
    raise exception 'rendered_text cannot be empty';
  end if;

  update public.question_renditions
     set rendered_text = p_rendered_text,
         slider_low_label = coalesce(p_slider_low_label, slider_low_label),
         slider_high_label = coalesce(p_slider_high_label, slider_high_label),
         transform_status = 'published',
         axis_equivalence_check = 'pass',
         axis_equivalence_notes = 'Manually edited and approved by reviewer.',
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_rendition_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_flag_rendition(p_rendition_id uuid, p_review_notes text)
 RETURNS question_renditions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_row public.question_renditions;
begin
  perform public._ensure_admin_or_service();

  if p_review_notes is null or btrim(p_review_notes) = '' then
    raise exception 'review_notes required when flagging a rendition';
  end if;

  update public.question_renditions
     set transform_status = 'flagged',
         review_notes = p_review_notes,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_rendition_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_publish_rendition(p_rendition_id uuid)
 RETURNS question_renditions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_row public.question_renditions;
begin
  perform public._ensure_admin_or_service();

  update public.question_renditions
     set transform_status = 'published',
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_rendition_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_regenerate_rendition(p_rendition_id uuid)
 RETURNS question_renditions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_row public.question_renditions;
begin
  perform public._ensure_admin_or_service();

  update public.question_renditions
     set transform_status = 'pending',
         claimed_at = null,
         review_notes = null
   where id = p_rendition_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  return v_row;
end;
$function$;

-- Cleanup: two stale overloads on UAT that dev already superseded/dropped
-- (found by the same diff — harmless since nothing calls them, but removing
-- keeps the two projects' function signatures identical).
DROP FUNCTION IF EXISTS public.assign_question_cover(uuid);
DROP FUNCTION IF EXISTS public.get_trending_questions_homepage(uuid, text, text, uuid, integer, integer);
