drop function if exists public.get_my_proposals();

-- Sep 2026, NEW: get_my_proposals() was missing preview_reframe entirely —
-- MyProposalsPage.tsx has always expected this column back (drives its
-- "Ready to publish" inline card), so that card never actually appeared in
-- production. Fixed here as part of the My Proposals detail-view work.
create or replace function public.get_my_proposals()
returns table(
  id uuid, raw_question text, status text, rejection_reason text,
  created_at timestamptz, reframed_question_id uuid, response_count bigint,
  preview_reframe jsonb
)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
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
$function$;

-- Sep 2026, NEW: single-proposal detail for /profile/proposals/:id — same
-- auth.uid() ownership filter as get_my_proposals (a caller can only ever
-- see their own row; no match returns an empty set, not an error). Joins
-- the live question + its Hindi rendition (when one exists and has cleared
-- review — transform_status='published' is the community-proposer pass
-- outcome, see generate-question-renditions) so a published proposal's
-- detail view doesn't need a second round-trip to QuestionDetailPage's own
-- RPC just to show what's live.
create or replace function public.get_my_proposal(p_id uuid)
returns table(
  id uuid,
  raw_question text,
  status text,
  rejection_reason text,
  rejection_note text,
  created_at timestamptz,
  updated_at timestamptz,
  source_url text,
  location_label text,
  input_mode text,
  video_recording_path text,
  video_duration_seconds integer,
  framing_flag_reason text,
  video_resubmit_count smallint,
  preview_reframe jsonb,
  reframed_question_id uuid,
  response_count bigint,
  live_question text,
  live_slider_low_label text,
  live_slider_high_label text,
  live_cover_image_url text,
  hindi_rendition_text text,
  hindi_rendition_status text
)
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
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
