alter table public.question_renditions
  add column if not exists context_summary text;

comment on column public.question_renditions.context_summary is
  'Translated background/context text for this language, mirroring questions.context_summary. Best-effort — translated alongside rendered_text by generate-question-renditions, but not itself gated by axis_equivalence_check (that check is scoped to the stance axis, not supplementary background). Null when the source question has no context_summary, or before this rendition has been (re)processed since this column was added.';

-- get_question_localized: context_summary/summary were the last remaining
-- fields NOT resolved through question_renditions (question + slider labels
-- already were) — a known, documented gap (see QuestionDetailPage.tsx's
-- fetchQuestionById comment). This closes it for context_summary; `summary`
-- is a different, shorter field used elsewhere (IncidentSummaryCard etc.)
-- and is out of scope here.
create or replace function public.get_question_localized(p_question_id uuid, p_language_code text DEFAULT 'en'::text)
 returns table(id uuid, topic_id uuid, question text, summary text, context_summary text, supporting_links text[], content_type text, tags text[], location_label text, published_at timestamp with time zone, status text, phase text, cover_image_url text, state question_state, archive_reason text, archived_at timestamp without time zone, context_version integer, slider_low_label text, slider_high_label text, source text, source_meta jsonb)
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
    q.source_meta
  from public.questions q
  left join public.question_renditions r
    on r.question_id = q.id
   and r.language_code = p_language_code
   and r.transform_status = 'published'
  where q.id = p_question_id
  limit 1;
$function$;
;
