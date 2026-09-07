-- Backfill 15 functions that exist on UAT but were missing on prod's older
-- baseline (14 from a full pg_proc diff, plus get_related_questions_localized
-- using the ALREADY-FIXED 16-column version, not the broken 14-column one
-- that was found on dev and corrected earlier in this migration series).
--
-- run_enrich_images_http() had UAT's project URL hardcoded in the source we
-- copied from — rewritten to prod's own URL so prod's cron doesn't call UAT's
-- edge function (same class of bug caught during the earlier dev->UAT sync).

CREATE OR REPLACE FUNCTION public.admin_claim_rendition_job_by_id(p_rendition_id uuid)
 RETURNS SETOF question_renditions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  claimed_id uuid;
  v_stale_after interval := interval '10 minutes';
begin
  with upd as (
    update public.question_renditions r
       set claimed_at = now()
     where r.id = (
       select id
       from public.question_renditions
       where id = p_rendition_id
         and transform_status = 'pending'
         and (claimed_at is null or claimed_at < now() - v_stale_after)
       for update skip locked
     )
     returning r.id
  )
  select id into claimed_id from upd;

  return query
    select * from public.question_renditions where id = claimed_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_live_questions_localized(p_language_code text DEFAULT 'en'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_region_label text DEFAULT 'Global'::text, p_exclude_country_label text DEFAULT NULL::text)
 RETURNS SETOF v_live_questions
 LANGUAGE sql
 STABLE
AS $function$
  select
    v.id,
    coalesce(r.rendered_text, v.question)              as question,
    v.summary,
    v.tags,
    v.location_label,
    v.published_at,
    v.status,
    v.cover_image_url,
    v.phase,
    v.topic_title,
    v.origin_location_label,
    v.audience_location_label,
    coalesce(r.slider_low_label, v.slider_low_label)   as slider_low_label,
    coalesce(r.slider_high_label, v.slider_high_label) as slider_high_label,
    v.content_type,
    v.video_recording_path
  from public.v_live_questions v
  left join public.question_renditions r
    on r.question_id = v.id
   and r.language_code = p_language_code
   and r.transform_status = 'published'
  where
    (p_region_label <> 'Global' and v.audience_location_label = p_region_label)
    or (p_region_label = 'Global' and p_exclude_country_label is not null and v.audience_location_label <> p_exclude_country_label)
    or (p_region_label = 'Global' and p_exclude_country_label is null)
  order by v.published_at desc
  limit  greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

CREATE OR REPLACE FUNCTION public.get_my_proposal(p_id uuid)
 RETURNS TABLE(id uuid, raw_question text, status text, rejection_reason text, rejection_note text, created_at timestamp with time zone, updated_at timestamp with time zone, source_url text, location_label text, input_mode text, video_recording_path text, video_duration_seconds integer, framing_flag_reason text, video_resubmit_count smallint, preview_reframe jsonb, reframed_question_id uuid, response_count bigint, live_question text, live_slider_low_label text, live_slider_high_label text, live_cover_image_url text, hindi_rendition_text text, hindi_rendition_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
    select
        p.id, p.raw_question, p.status, p.rejection_reason, p.rejection_note,
        p.created_at, p.updated_at, p.source_url, p.location_label, p.input_mode,
        p.video_recording_path, p.video_duration_seconds, p.framing_flag_reason,
        p.video_resubmit_count, p.preview_reframe, p.reframed_question_id,
        coalesce((
            select count(*) from public.question_stances qs
            where qs.question_id = p.reframed_question_id
        ), 0)::bigint as response_count,
        q.question, q.slider_low_label, q.slider_high_label, q.cover_image_url,
        qr.rendered_text, qr.transform_status
    from public.user_question_proposals p
    left join public.questions q on q.id = p.reframed_question_id
    left join public.question_renditions qr
      on qr.question_id = p.reframed_question_id and qr.language_code = 'hi'
    where p.id = p_id and p.user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_question_localized(p_question_id uuid, p_language_code text DEFAULT 'en'::text)
 RETURNS TABLE(id uuid, topic_id uuid, question text, summary text, context_summary text, supporting_links text[], content_type text, tags text[], location_label text, published_at timestamp with time zone, status text, phase text, cover_image_url text, state question_state, archive_reason text, archived_at timestamp without time zone, context_version integer, slider_low_label text, slider_high_label text, source text, source_meta jsonb, video_recording_path text, video_publish_choice text)
 LANGUAGE sql
 STABLE
AS $function$
  select
    q.id,
    q.topic_id,
    coalesce(r.rendered_text, q.question)              as question,
    q.summary,
    coalesce(r.context_summary, q.context_summary)     as context_summary,
    q.supporting_links,
    q.content_type,
    q.tags,
    q.location_label,
    q.published_at,
    q.status,
    q.phase,
    q.cover_image_url,
    q.state,
    q.archive_reason,
    q.archived_at,
    q.context_version,
    coalesce(r.slider_low_label, q.slider_low_label)   as slider_low_label,
    coalesce(r.slider_high_label, q.slider_high_label) as slider_high_label,
    q.source,
    q.source_meta,
    q.video_recording_path,
    q.video_publish_choice
  from public.questions q
  left join public.question_renditions r
    on r.question_id = q.id
   and r.language_code = p_language_code
   and r.transform_status = 'published'
  where q.id = p_question_id
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.location_ancestors(p_location_id uuid)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with recursive chain(id, parent_id, depth) as (
    select l.id, l.parent_id, 0 from public.locations l where l.id = p_location_id
    union all
    select l.id, l.parent_id, c.depth + 1
    from public.locations l join chain c on l.id = c.parent_id
    where c.depth < 6
  )
  select id from chain;
$function$;

CREATE OR REPLACE FUNCTION public.language_applies_to_location(p_language_code text, p_location_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.language_regions lr
    where lr.language_code = p_language_code
      and (
        lr.region_id in (select id from public.location_ancestors(p_location_id))
        or (
          p_location_id in (select id from public.location_ancestors(lr.region_id))
          and not exists (select 1 from public.locations gl where gl.id = p_location_id and gl.type = 'global')
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.location_ancestor_labels(p_location_id uuid)
 RETURNS TABLE(city_label text, county_label text, state_label text, country_label text, country_code text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cur_id       uuid := p_location_id;
  v_type         text;
  v_name         text;
  v_iso          text;
  v_parent       uuid;
  v_city         text;
  v_county       text;
  v_state        text;
  v_country      text;
  v_country_code text;
BEGIN
  IF p_location_id IS NULL THEN
    RETURN;
  END IF;

  WHILE v_cur_id IS NOT NULL LOOP
    SELECT l.type::text, l.name, l.iso_code, l.parent_id
      INTO v_type, v_name, v_iso, v_parent
    FROM public.locations l
    WHERE l.id = v_cur_id;

    EXIT WHEN v_type IS NULL;

    IF v_type = 'city' THEN
      v_city := v_name;
    ELSIF v_type = 'county' THEN
      v_county := v_name;
    ELSIF v_type = 'state' THEN
      v_state := v_name;
    ELSIF v_type = 'country' THEN
      v_country := v_name;
      v_country_code := v_iso;
    END IF;

    EXIT WHEN v_type = 'country';
    v_cur_id := v_parent;
  END LOOP;

  city_label    := v_city;
  county_label  := v_county;
  state_label   := v_state;
  country_label := v_country;
  country_code  := v_country_code;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_ip_geo_location(p_country_code text, p_state_name text DEFAULT NULL::text, p_city_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_country_id uuid;
  v_state_id   uuid;
  v_city_id    uuid;
BEGIN
  IF p_country_code IS NULL OR length(trim(p_country_code)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT l.id INTO v_country_id
  FROM public.locations l
  WHERE l.type = 'country' AND lower(l.iso_code) = lower(trim(p_country_code))
  LIMIT 1;

  IF v_country_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_state_name IS NULL OR length(trim(p_state_name)) = 0 THEN
    RETURN v_country_id;
  END IF;

  SELECT l.id INTO v_state_id
  FROM public.locations l
  WHERE l.type = 'state'
    AND l.parent_id = v_country_id
    AND lower(l.name) = lower(trim(p_state_name))
  LIMIT 1;

  IF v_state_id IS NULL THEN
    RETURN v_country_id;
  END IF;

  IF p_city_name IS NULL OR length(trim(p_city_name)) = 0 THEN
    RETURN v_state_id;
  END IF;

  SELECT l.id INTO v_city_id
  FROM public.locations l
  WHERE l.type = 'city'
    AND lower(l.name) = lower(trim(p_city_name))
    AND (
      l.parent_id = v_state_id
      OR l.parent_id IN (
        SELECT c.id FROM public.locations c
        WHERE c.type = 'county' AND c.parent_id = v_state_id
      )
    )
  LIMIT 1;

  RETURN coalesce(v_city_id, v_state_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_location_id(p_label text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_first_segment text;
begin
  if p_label is null or btrim(p_label) = '' then
    return null;
  end if;

  select id into v_id from public.locations
  where lower(name) = lower(btrim(p_label))
  order by case type when 'city' then 1 when 'county' then 2 when 'state' then 3
                      when 'country' then 4 else 5 end
  limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from public.locations
  where lower(iso_code) = lower(btrim(p_label))
  limit 1;
  if v_id is not null then return v_id; end if;

  v_first_segment := btrim(split_part(p_label, ',', 1));
  if v_first_segment <> btrim(p_label) and v_first_segment <> '' then
    select id into v_id from public.locations
    where lower(name) = lower(v_first_segment)
    limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  select id into v_id from public.locations
  where similarity(name, btrim(p_label)) > 0.4
  order by similarity(name, btrim(p_label)) desc
  limit 1;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_web_stance(p_ref text, p_question_id uuid, p_score smallint, p_device_id text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_state_name text DEFAULT NULL::text, p_city_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF p_device_id IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM whatsapp_forward_chains
    WHERE responder_device_id = p_device_id AND question_id = p_question_id
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    v_my_ref := v_existing;
    UPDATE question_stances_pending
       SET score = p_score, updated_at = now()
     WHERE forward_chain_id = v_my_ref AND question_id = p_question_id;
    UPDATE question_stances
       SET score = p_score, updated_at = now()
     WHERE forward_chain_id = v_my_ref AND question_id = p_question_id;
    IF v_location_id IS NOT NULL THEN
      UPDATE whatsapp_forward_chains
         SET location_id = coalesce(location_id, v_location_id)
       WHERE id = v_my_ref;
    END IF;
  ELSE
    IF p_ref IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM whatsapp_forward_chains WHERE id = p_ref
    ) THEN
      p_ref := NULL;
    END IF;

    SELECT depth INTO v_parent_depth FROM whatsapp_forward_chains WHERE id = p_ref;
    v_parent_depth := coalesce(v_parent_depth, 0);
    v_my_ref := 'w_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

    INSERT INTO whatsapp_forward_chains
      (id, question_id, root_phone_hash, parent_forward_chain_id, depth, responder_device_id, channel, location_id)
    VALUES
      (v_my_ref, p_question_id, NULL, p_ref, v_parent_depth + 1, p_device_id, 'web', v_location_id);

    INSERT INTO question_stances_pending (question_id, score, source, forward_chain_id, responder_device_id)
    VALUES (p_question_id, p_score, 'web_forward', v_my_ref, p_device_id);

    IF p_ref IS NOT NULL THEN
      UPDATE whatsapp_forward_chains
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

CREATE OR REPLACE FUNCTION public.run_enrich_images_http()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_url    text := 'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/enrich-images';
  v_cron   text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1);
  v_svc    text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1);
  r        extensions.http_response;
  v_status int;
  v_body   text;
begin
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');

  r := extensions.http((
    'POST',
    v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('apikey', v_svc),
      extensions.http_header('x-cron-secret', v_cron),
      extensions.http_header('content-type', 'application/json')
    ]::extensions.http_header[],
    'application/json',
    '{}'
  ));

  v_status := (r).status;
  v_body   := coalesce((r).content::text, '');

  if v_status <> 200 then
    raise exception 'enrich-images non-200 (%): %', v_status, left(v_body, 500);
  end if;

  return v_body::jsonb;
end;
$function$;

CREATE OR REPLACE FUNCTION public.stub_question_renditions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.question_renditions (question_id, language_code, transform_status, generation_reason)
  select
    new.id,
    l.language_code,
    'pending',
    case when new.source = 'community' then 'community_proposer' else 'editorial_pipeline' end
  from public.languages l
  where l.is_active_for_ugq = true
    and l.language_code <> new.canonical_language
    and (
      new.source = 'community'
      or (new.location_id is not null and public.language_applies_to_location(l.language_code, new.location_id))
    )
  on conflict (question_id, language_code) do nothing;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.text_mentions_india(p_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  keywords text[] := array[
    'india','bharat','hindustan',
    'andhra pradesh','arunachal pradesh','assam','bihar','chhattisgarh','goa','gujarat',
    'haryana','himachal pradesh','jharkhand','karnataka','kerala','madhya pradesh',
    'maharashtra','manipur','meghalaya','mizoram','nagaland','odisha','punjab','rajasthan',
    'sikkim','tamil nadu','telangana','tripura','uttar pradesh','uttarakhand','west bengal',
    'andaman and nicobar islands','chandigarh','dadra and nagar haveli and daman and diu',
    'delhi','jammu and kashmir','ladakh','lakshadweep','puducherry',
    'mumbai','bengaluru','bangalore','hyderabad','ahmedabad','chennai','kolkata','surat',
    'pune','jaipur','lucknow','kanpur','nagpur','indore','bhopal','visakhapatnam','patna',
    'vadodara','ghaziabad','ludhiana','agra','nashik','faridabad','meerut','rajkot',
    'varanasi','srinagar','amritsar','noida','gurugram','gurgaon'
  ];
  kw text;
  tok text;
  lower_text text;
begin
  if p_text is null or btrim(p_text) = '' then
    return false;
  end if;

  lower_text := lower(p_text);

  foreach kw in array keywords loop
    if lower_text like '%' || kw || '%' then
      return true;
    end if;
  end loop;

  for tok in select regexp_split_to_table(lower_text, '[^a-z]+') loop
    if length(tok) < 3 then
      continue;
    end if;
    foreach kw in array keywords loop
      if position(' ' in kw) = 0 and similarity(tok, kw) > 0.55 then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$function$;

-- get_related_questions_localized: fixed 16-column version (already deployed
-- to dev and UAT earlier in this migration series). Prod never had this
-- function at all, so it gets the corrected version directly.
CREATE OR REPLACE FUNCTION public.get_related_questions_localized(p_question_id uuid, p_tags text[], p_location_label text DEFAULT NULL::text, p_limit integer DEFAULT 4, p_language_code text DEFAULT 'en'::text)
 RETURNS SETOF v_live_questions
 LANGUAGE sql
 STABLE
AS $function$
  select
    v.id,
    coalesce(r.rendered_text, v.question)              as question,
    v.summary,
    v.tags,
    v.location_label,
    v.published_at,
    v.status,
    v.cover_image_url,
    v.phase,
    v.topic_title,
    v.origin_location_label,
    v.audience_location_label,
    coalesce(r.slider_low_label, v.slider_low_label)   as slider_low_label,
    coalesce(r.slider_high_label, v.slider_high_label) as slider_high_label,
    v.content_type,
    v.video_recording_path
  from public.v_live_questions v
  left join public.question_renditions r
    on r.question_id = v.id
   and r.language_code = p_language_code
   and r.transform_status = 'published'
  where v.id <> p_question_id
    and v.status = 'active'
    and v.tags && p_tags
    and (
      p_location_label is null
      or btrim(p_location_label) = ''
      or v.location_label = btrim(p_location_label)
    )
  order by v.published_at desc
  limit greatest(coalesce(p_limit, 4), 1);
$function$;
