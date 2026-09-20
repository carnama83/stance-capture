-- PR 0.5 — anonymous staging captures the rendition the visitor actually read.
--
-- This is the half of PR 0 that was blocked on PR 2a. question_stances_pending
-- gained a rendition_id column in PR 0.1, but nothing could fill it: the feed
-- RPCs did not return a rendition until PR 2a.1. They do now, so the staging
-- writer can record what was on screen.
--
-- Until this lands, every newly staged row has a NULL rendition and is skipped
-- (not lost) by the commit paths. After it lands, staged rows carry provenance
-- and commit normally.
--
-- Backward compatible on purpose. The new parameters are defaulted and appended,
-- and PostgREST binds by parameter name, so a frontend build that predates this
-- migration keeps working -- it simply omits p_rendition_id and its rows stay
-- pending until re-answered. That matters because the SQL migration and the
-- Vercel deploy are not atomic.
--
-- Also fixes a live bug found while changing the signature: src/lib/webStance.ts
-- declared recordWebStance(questionId, score) but Index.tsx called it with a
-- third argument, ipGeoRef.current. The extra argument was silently discarded,
-- so p_country_code / p_state_name / p_city_name were never sent from the
-- homepage and resolve_ip_geo_location() always received NULLs -- homepage
-- staged stances have never resolved a location. The TypeScript side of that
-- fix ships with this migration.
--
-- On the revise path, score and rendition_id are updated TOGETHER. Moving a
-- score to new wording while leaving the old rendition attached would produce a
-- measurement whose score and instrument disagree -- the precise mismatch this
-- work exists to prevent.

drop function if exists public.record_web_stance(text, uuid, smallint, text, text, text, text);

create function public.record_web_stance(
  p_ref           text,
  p_question_id   uuid,
  p_score         smallint,
  p_device_id     text default null,
  p_country_code  text default null,
  p_state_name    text default null,
  p_city_name     text default null,
  p_rendition_id  uuid default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_my_ref       text;
  v_parent_depth int := 0;
  v_existing     text;
  v_dist         record;
  v_location_id  uuid;
BEGIN
  IF p_score < -2 OR p_score > 2 THEN
    RAISE EXCEPTION 'score out of range (-2..2)';
  END IF;

  v_location_id := public.resolve_ip_geo_location(p_country_code, p_state_name, p_city_name);

  -- Dedup: has THIS browser already staged an answer to THIS question?
  IF p_device_id IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.whatsapp_forward_chains
    WHERE responder_device_id = p_device_id AND question_id = p_question_id
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    -- Same browser revising — keep their ref, update the staged score AND the
    -- rendition it was chosen against. These move together or not at all.
    v_my_ref := v_existing;
    UPDATE public.question_stances_pending
       SET score        = p_score,
           rendition_id = coalesce(p_rendition_id, rendition_id),
           updated_at   = now()
     WHERE forward_chain_id = v_my_ref AND question_id = p_question_id;

    -- If they'd already committed, update the live stance too (re-answer after
    -- opt-in). Same rule: a new score against new wording is a new measurement,
    -- so the rendition travels with it.
    UPDATE public.question_stances
       SET score        = p_score,
           rendition_id = coalesce(p_rendition_id, rendition_id),
           updated_at   = now()
     WHERE forward_chain_id = v_my_ref AND question_id = p_question_id;

    IF v_location_id IS NOT NULL THEN
      UPDATE public.whatsapp_forward_chains
         SET location_id = coalesce(location_id, v_location_id)
       WHERE id = v_my_ref;
    END IF;
  ELSE
    -- New node: mint this responder's OWN ref, parented to p_ref.
    IF p_ref IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_forward_chains WHERE id = p_ref
    ) THEN
      p_ref := NULL;
    END IF;

    SELECT depth INTO v_parent_depth FROM public.whatsapp_forward_chains WHERE id = p_ref;
    v_parent_depth := coalesce(v_parent_depth, 0);
    v_my_ref := 'w_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

    INSERT INTO public.whatsapp_forward_chains
      (id, question_id, root_phone_hash, parent_forward_chain_id, depth, responder_device_id, channel, location_id)
    VALUES
      (v_my_ref, p_question_id, NULL, p_ref, v_parent_depth + 1, p_device_id, 'web', v_location_id);

    -- STAGE (not counted) — promoted to question_stances on opt-in, carrying
    -- the rendition captured here.
    INSERT INTO public.question_stances_pending
      (question_id, score, source, forward_chain_id, responder_device_id, rendition_id)
    VALUES
      (p_question_id, p_score, 'web_forward', v_my_ref, p_device_id, p_rendition_id);

    IF p_ref IS NOT NULL THEN
      UPDATE public.whatsapp_forward_chains
         SET child_stance_count = child_stance_count + 1
       WHERE id = p_ref;
    END IF;
  END IF;

  SELECT * INTO v_dist FROM public.get_question_distribution(p_question_id);

  RETURN json_build_object(
    'my_ref', v_my_ref,
    'committed', false,
    'distribution', json_build_object(
      'responses',  coalesce(v_dist.responses, 0),
      'pct_high',   coalesce(v_dist.support_pct, 0),
      'pct_middle', coalesce(v_dist.neutral_pct, 0),
      'pct_low',    coalesce(v_dist.oppose_pct, 0)
    )
  );
END;
$function$;

comment on function public.record_web_stance(text, uuid, smallint, text, text, text, text, uuid) is
  'Stages an anonymous web-forward stance. Captures p_rendition_id -- the rendition whose wording the visitor actually read -- so the commit paths have honest provenance to promote. Callers that omit it stage a NULL rendition, which the commit paths skip rather than committing with an inferred value.';

notify pgrst, 'reload schema';
