-- PR 2a.5 — pin search_path on the two question_stances trigger functions that
-- had none.
--
-- Found while testing the new set_question_stance(uuid, integer, uuid), which
-- follows the brief's hardening guidance and runs with `search_path = ''`.
-- The first insert failed:
--
--   ERROR: 42P01: relation "question_stances" does not exist
--   QUERY: (SELECT COUNT(*) FROM question_stances WHERE user_id = NEW.user_id) >= 3
--   CONTEXT: PL/pgSQL function public.trigger_cognitive_state_calculation()
--
-- A trigger function with no search_path of its own INHERITS the search_path of
-- whatever function caused the trigger to fire. trigger_cognitive_state_calculation
-- references question_stances unqualified, so it resolved fine under the old
-- write path (search_path = 'public') and broke the moment a caller tightened
-- its own. Its correctness depended on every future caller staying loose.
--
-- That is the defect, not the empty search_path. Pinning the trigger functions
-- fixes it at the source and keeps the hardened write path.
--
-- ALTER FUNCTION ... SET is deliberate: it changes only the setting and leaves
-- the bodies untouched, so this carries no risk of altering behaviour.
--
-- 'public, pg_temp' matches the five sibling triggers on this table that were
-- already pinned. Anything these functions reference in auth is already
-- schema-qualified and resolves regardless of search_path.

alter function public.trigger_cognitive_state_calculation()
  set search_path to 'public', 'pg_temp';

alter function public.fn_trigger_election_aggregate_refresh()
  set search_path to 'public', 'pg_temp';

comment on function public.trigger_cognitive_state_calculation() is
  'AFTER trigger on question_stances. search_path pinned in PR 2a.5: it references question_stances unqualified and previously inherited search_path from whichever function fired the trigger, so it broke when a caller hardened its own. Do not remove the pin without qualifying every reference in the body.';

notify pgrst, 'reload schema';
