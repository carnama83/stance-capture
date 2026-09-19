alter table public.user_question_proposals
  add column if not exists proposal_language text;

comment on column public.user_question_proposals.proposal_language is
  'ISO language code detected from raw_question/video_raw_transcript by ugq-screen at screening time (e.g. en, hi). Null until first screened.';
;
