drop function if exists public.get_question_localized(uuid, text);

create or replace function public.get_question_localized(p_question_id uuid, p_language_code text DEFAULT 'en'::text)
 returns table(id uuid, topic_id uuid, question text, summary text, context_summary text, supporting_links text[], content_type text, tags text[], location_label text, published_at timestamp with time zone, status text, phase text, cover_image_url text, state question_state, archive_reason text, archived_at timestamp without time zone, context_version integer, slider_low_label text, slider_high_label text, source text, source_meta jsonb, video_recording_path text, video_publish_choice text)
 language sql
 stable
as $function$
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
;
