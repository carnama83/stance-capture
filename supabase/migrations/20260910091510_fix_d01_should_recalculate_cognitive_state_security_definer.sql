-- Epic D QA defect D-01 (P0) — same class as Epic C bug C-10.
--
-- should_recalculate_cognitive_state() runs as the calling role (authenticated)
-- and reads public.user_stance_summary, on which `authenticated` holds every
-- privilege EXCEPT SELECT. A user's 3rd stance creates their
-- user_cognitive_states row; from the 4th stance onward every INSERT and every
-- score-changing UPDATE on question_stances aborted with 42501, rolling back
-- the whole stance write.
--
-- Fix follows the C-10 remedy: make the function SECURITY DEFINER rather than
-- granting SELECT on the view. The view aggregates ALL users' stances with no
-- auth.uid() filter and is not security_invoker, so a GRANT would expose every
-- user's stance profile to any authenticated user.
--
-- search_path is pinned because the function is now SECURITY DEFINER.
alter function public.should_recalculate_cognitive_state(uuid)
  security definer
  set search_path = public, pg_temp;
