-- Anonymous-video feature — schema changes.
--
-- Lets a UGQ video proposal/question record, permanently, whether it was
-- captured while the proposer was anonymous (profiles.display_handle_mode =
-- 'random_id') at the moment of recording, plus where the true unmasked
-- recording lives when it was. See VideoRecorderPanel.tsx and the edge
-- functions under supabase/functions/ugq-* for how these are read/written.
--
-- video_recorded_anonymous is a PERMANENT SNAPSHOT taken once, at
-- capture/submit time (ugq-submit, ugq-resubmit-video) — it is never
-- recalculated later. Switching display_handle_mode afterward must not
-- change what a previously-recorded video shows: a video recorded
-- anonymously stays anonymous forever, and one recorded identified stays
-- identified forever, regardless of later toggles.
--
-- video_raw_archival_path points at the true, unmasked recording in the
-- SEPARATE ugq-video-recordings-raw bucket (created below) — populated only
-- when video_recorded_anonymous is true. No public-facing function ever
-- reads from that bucket; admin-ugq-raw-video-url is the only reader,
-- gated to moderator access, for abuse investigation only.

alter table public.user_question_proposals
  add column if not exists video_recorded_anonymous boolean not null default false,
  add column if not exists video_raw_archival_path text null;

alter table public.questions
  add column if not exists video_recorded_anonymous boolean not null default false,
  add column if not exists video_raw_archival_path text null;

-- The user's chosen anonymous-avatar look (hair/skin/top color, etc.) — a
-- small, user-selected JSON config, persistent across all of their
-- anonymous videos, entirely decoupled from their real appearance (never
-- derived from camera input). Null until first needed; a sensible random
-- default is assigned client-side the first time a user records a video
-- while anonymous (see VideoRecorderPanel.tsx) rather than at registration,
-- since most users may never record a video at all.
alter table public.profiles
  add column if not exists anonymous_avatar_config jsonb null;

-- Private bucket for the true, unmasked recording behind an anonymous video
-- submission — mirrors the existing ugq-video-recordings bucket's
-- private/no-public-access pattern, but is a STRUCTURALLY SEPARATE bucket
-- so no existing or future public-facing function can accidentally serve
-- it. Only ugq-upload-video (service role, write) and
-- admin-ugq-raw-video-url (service role, moderator-gated read) ever touch
-- this bucket.
insert into storage.buckets (id, name, public)
values ('ugq-video-recordings-raw', 'ugq-video-recordings-raw', false)
on conflict (id) do nothing;
