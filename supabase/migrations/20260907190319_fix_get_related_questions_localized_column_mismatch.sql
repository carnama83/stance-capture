-- get_related_questions_localized was declared RETURNS SETOF v_live_questions
-- but its SELECT list only produced 14 columns, while v_live_questions has
-- since grown to 16 (content_type, video_recording_path were added by a
-- later migration and this function's body was never updated to match).
-- Confirmed broken by direct invocation (42P13 "return type mismatch...
-- too few columns"). Fix: append the two missing columns, passed straight
-- through from the view, in the same position v_live_questions has them.
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
