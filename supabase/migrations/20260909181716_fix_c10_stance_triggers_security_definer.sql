-- BUG C-10 (Epic C QA, Sep 2026) — P0
-- Inserting a stance failed for every real user: the two AFTER INSERT triggers on
-- question_stances ran as the submitting role, but 'authenticated'/'anon' hold only
-- SELECT on question_engagement_metrics and question_trending_metrics, so the whole
-- INSERT rolled back with "permission denied for table question_engagement_metrics".
-- Both submission paths were affected (direct REST insert from the homepage hero, and
-- set_question_stance()). Only the FIRST stance on a question failed, since the
-- triggers are AFTER INSERT only.
--
-- Fix: run these two trigger functions as owner, matching their siblings
-- trg_question_stances_refresh_stats / _region which are already SECURITY DEFINER.
-- Preferred over granting INSERT/UPDATE on the aggregate tables to authenticated,
-- which would let any signed-in user write metrics directly.
-- search_path is pinned, as it must be for SECURITY DEFINER functions.
ALTER FUNCTION public.trigger_update_engagement_on_stance()
  SECURITY DEFINER
  SET search_path = public, pg_temp;

ALTER FUNCTION public.trigger_update_trending_on_new_response()
  SECURITY DEFINER
  SET search_path = public, pg_temp;
