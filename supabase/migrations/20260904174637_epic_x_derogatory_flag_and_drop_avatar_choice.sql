
begin;

-- Sep 2026: derogatory-language recommendation, independent of framing_flag/
-- status — informational only, shown to the proposer pre-publish with a
-- Re-record shortcut, never blocks Publish. See ugq-screen's
-- checkVideoFraming and VideoPublishChoice.tsx.
alter table public.user_question_proposals
  add column if not exists derogatory_flag boolean,
  add column if not exists derogatory_flag_reason text;

-- Sep 2026: "raw_plus_avatar" dropped from both check constraints — no TTS/
-- avatar synthesis backend exists, so it was never a real choice.
alter table public.user_question_proposals
  drop constraint if exists uqp_video_publish_choice_check;
alter table public.user_question_proposals
  add constraint uqp_video_publish_choice_check
  check (video_publish_choice is null or video_publish_choice = any (
    array['raw_only'::text, 'raw_plus_overlay'::text]
  ));

alter table public.questions
  drop constraint if exists questions_video_publish_choice_check;
alter table public.questions
  add constraint questions_video_publish_choice_check
  check (video_publish_choice is null or video_publish_choice = any (
    array['raw_only'::text, 'raw_plus_overlay'::text]
  ));

commit;
;
