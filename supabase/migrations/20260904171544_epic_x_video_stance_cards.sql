-- Epic X: Video Stance Cards — deployment migration
-- Verified against live dev schema (essnvhvezxjcoqxvuxuq) on 2026-09-04
-- before writing this: exact current constraint definitions for
-- uqp_input_mode_check, uqp_status_check, and questions_content_type_check
-- were pulled from pg_constraint, not assumed.
--
-- This extends the EXISTING UGQ pipeline (user_question_proposals ->
-- questions) rather than adding parallel tables — input_mode already had a
-- 'voice' branch with the identical "path + duration, pure metadata"
-- pattern; video reuses that shape and adds only what voice doesn't need
-- (video_raw_transcript for the framing gate, framing_flag/reason,
-- video_publish_choice).

begin;

-- ============================================================
-- 1. user_question_proposals
-- ============================================================

-- input_mode: add 'video' alongside the existing 'text' | 'voice'.
alter table public.user_question_proposals
  drop constraint if exists uqp_input_mode_check;
alter table public.user_question_proposals
  add constraint uqp_input_mode_check
  check (input_mode = any (array['text'::text, 'voice'::text, 'video'::text]));

-- status: add 'resubmit_requested' for the framing gate's "please re-record"
-- outcome, alongside every existing value (unchanged).
alter table public.user_question_proposals
  drop constraint if exists uqp_status_check;
alter table public.user_question_proposals
  add constraint uqp_status_check
  check (status = any (array[
    'proposed'::text, 'screening'::text, 'in_review'::text, 'approved'::text,
    'reframing'::text, 'reframed'::text, 'published'::text, 'rejected'::text,
    'withdrawn'::text, 'resubmit_requested'::text
  ]));

alter table public.user_question_proposals
  add column if not exists video_recording_path text,
  add column if not exists video_duration_seconds integer,
  -- UNEDITED transcript of the raw audio track, captured client-side before
  -- the proposer reviews/edits raw_question. Deliberately separate from
  -- raw_question: the proposer's edits to raw_question can diverge from
  -- what's actually in the audio track, and the framing gate has to judge
  -- what respondents will hear, not what ended up in the polished text.
  add column if not exists video_raw_transcript text,
  add column if not exists framing_flag text,
  add column if not exists framing_flag_reason text,
  add column if not exists video_resubmit_count smallint not null default 0,
  -- Set at ugq-confirm-publish time (the proposer's actual publish click),
  -- not at capture time — see that function's header comment. Nullable
  -- because it's genuinely unset until then, and never used for text/voice.
  add column if not exists video_publish_choice text;

alter table public.user_question_proposals
  drop constraint if exists uqp_framing_flag_check;
alter table public.user_question_proposals
  add constraint uqp_framing_flag_check
  check (framing_flag is null or framing_flag = any (array['clean'::text, 'leading'::text, 'rejected'::text]));

alter table public.user_question_proposals
  drop constraint if exists uqp_video_publish_choice_check;
alter table public.user_question_proposals
  add constraint uqp_video_publish_choice_check
  check (video_publish_choice is null or video_publish_choice = any (
    array['raw_only'::text, 'raw_plus_overlay'::text, 'raw_plus_avatar'::text]
  ));

-- Supports the admin review queue filtering to "needs re-record" quickly.
create index if not exists idx_uqp_framing_flag_leading
  on public.user_question_proposals (created_at)
  where framing_flag = 'leading';


-- ============================================================
-- 2. questions — carry video fields through to the published row
-- ============================================================

alter table public.questions
  drop constraint if exists questions_content_type_check;
alter table public.questions
  add constraint questions_content_type_check
  check (content_type = any (array[
    'incident'::text, 'policy'::text, 'election'::text, 'general'::text, 'video'::text
  ]));

alter table public.questions
  add column if not exists video_recording_path text,
  add column if not exists video_duration_seconds integer,
  add column if not exists video_publish_choice text;

alter table public.questions
  drop constraint if exists questions_video_publish_choice_check;
alter table public.questions
  add constraint questions_video_publish_choice_check
  check (video_publish_choice is null or video_publish_choice = any (
    array['raw_only'::text, 'raw_plus_overlay'::text, 'raw_plus_avatar'::text]
  ));


-- ============================================================
-- 3. Storage bucket
-- ============================================================
-- Mirrors ugq-voice-recordings exactly: private, no client-side
-- storage.objects RLS policies. That bucket has none today — uploads go
-- through an edge function using the service role key, not direct
-- client-to-storage writes with RLS. Video follows the same pattern for
-- consistency, even though (unlike voice) the raw clip does eventually need
-- to be watchable by respondents once published — that read path should be
-- a signed URL issued by an edge function at request time, not a public
-- bucket URL, so a published clip isn't a permanently scrapable direct link.
insert into storage.buckets (id, name, public)
values ('ugq-video-recordings', 'ugq-video-recordings', false)
on conflict (id) do nothing;

commit;
