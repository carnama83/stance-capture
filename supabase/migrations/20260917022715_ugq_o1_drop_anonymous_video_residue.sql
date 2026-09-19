-- UGQ-O1, final step: drop the schema residue of the rolled-back
-- anonymous-video feature. The ugq-video-recordings-raw bucket and its four
-- objects of unmasked camera footage are already gone.
--
-- Scope was checked against the code rather than taken from the epic doc,
-- which said "dead columns on two tables". Three columns are genuinely dead:
--
--   questions.video_raw_archival_path                 0 rows, no code, no DB fn
--   user_question_proposals.video_raw_archival_path   4 rows, referenced ONLY by
--                                                     admin-ugq-raw-video-url,
--                                                     which is being deleted;
--                                                     the objects they pointed
--                                                     at no longer exist
--   profiles.anonymous_avatar_config                  1 row, no code, no DB fn
--
-- Three columns that look related are NOT dead and are deliberately kept:
--   video_recorded_anonymous  -- read by ugq-submit / ugq-screen / ugq-publish /
--                                ugq-confirm-publish; it still records that a
--                                proposer chose to stay anonymous, which
--                                outlived the disguise pipeline
--   video_raw_transcript      -- 20 references across frontend and functions
--   video_publish_choice      -- 15 references, including a live UI component
--
-- Dropping those three would have broken working code, which is why this was
-- verified rather than assumed.

alter table public.questions
  drop column if exists video_raw_archival_path;

alter table public.user_question_proposals
  drop column if exists video_raw_archival_path;

alter table public.profiles
  drop column if exists anonymous_avatar_config;

-- One-shot; it has run.
drop function if exists admin.retire_raw_video_bucket();

do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns
  where table_schema = 'public'
    and ((table_name in ('questions','user_question_proposals') and column_name = 'video_raw_archival_path')
      or (table_name = 'profiles' and column_name = 'anonymous_avatar_config'));
  if n <> 0 then
    raise exception 'UGQ-O1: % residual column(s) still present', n;
  end if;

  if exists (select 1 from storage.buckets where id = 'ugq-video-recordings-raw') then
    raise exception 'UGQ-O1: raw video bucket still exists';
  end if;

  -- The columns kept must still be there; dropping one by accident is the
  -- failure mode this whole item was at risk of.
  select count(*) into n from information_schema.columns
  where table_schema = 'public'
    and column_name in ('video_recorded_anonymous','video_raw_transcript','video_publish_choice');
  if n < 4 then
    raise exception 'UGQ-O1: expected the in-use video columns to survive, found only %', n;
  end if;
end $$;
