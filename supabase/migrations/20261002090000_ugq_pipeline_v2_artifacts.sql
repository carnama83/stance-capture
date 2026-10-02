-- UGQ pipeline v2 (Phase 1, Oct 2026): the research artifacts behind a
-- proposal's preview. ugq-screen's v2 pipeline (UGQ_PIPELINE=v2) researches a
-- proposal ONCE and keeps the evidence here, so regenerate and admin review can
-- reuse it instead of searching the web again. preview_reframe keeps its
-- existing shape and stays the only field publish/admin/translation read.
--
--   extracted_events    — what the proposer referred to: intent, actor, events
--                         (with date/location hints), which ones were kept for
--                         the question (max 3) and how many more were named.
--   fact_sheet          — per-event research: identity status (matched /
--                         not_found / ambiguous), evidence state (VERIFIED /
--                         PARTIALLY_VERIFIED / CONFLICTING / UNVERIFIED), facts
--                         with the source each came from.
--   verification_result — the validator's verdict on the final question and
--                         the repair history (targeted repair, full rewrite).
--   pipeline_metrics    — per-stage latency, tokens, searches and estimated cost.
--
-- All four are nullable and only written by v2; v1 rows leave them null.
-- Readable by the proposer through the existing uqp_select_own_or_admin policy
-- (same as preview_reframe) — they hold public research, nothing private.

alter table public.user_question_proposals
  add column if not exists extracted_events jsonb,
  add column if not exists fact_sheet jsonb,
  add column if not exists verification_result jsonb,
  add column if not exists pipeline_metrics jsonb;

comment on column public.user_question_proposals.extracted_events is
  'UGQ pipeline v2: proposer intent, actor and referenced events (kept <= 3 + more_count).';
comment on column public.user_question_proposals.fact_sheet is
  'UGQ pipeline v2: per-event identity status, evidence state and sourced facts; reused by regenerate.';
comment on column public.user_question_proposals.verification_result is
  'UGQ pipeline v2: validator verdict on the final preview and repair history.';
comment on column public.user_question_proposals.pipeline_metrics is
  'UGQ pipeline v2: per-stage latency, tokens, searches and estimated cost.';
