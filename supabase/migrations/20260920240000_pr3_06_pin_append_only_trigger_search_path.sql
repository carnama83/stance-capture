-- PR 3 — pin the append-only trigger's search_path.
--
-- question_renditions_enforce_append_only is the guard that makes a published
-- rendition immutable, and pr3_03 just widened it to cover summary. It is the
-- one function in that set with no pinned search_path.
--
-- It is NOT urgent and it is NOT a live defect: the function is not SECURITY
-- DEFINER, so it runs as the caller, and its body resolves no unqualified
-- object -- it reads OLD/NEW, compares, and raises. There is nothing for a
-- hostile search_path to redirect.
--
-- It is pinned anyway because this codebase has a recurring defect shape where
-- a trigger inherits the caller's search_path and resolves something
-- unexpected, and pr2a_05 already pinned two trigger functions for that reason.
-- The cost is one ALTER; the alternative is leaving the immutability guard as
-- the last unpinned function in the rendition write path, where the next person
-- to add a table lookup to it inherits the problem silently.
--
-- ALTER FUNCTION, not CREATE OR REPLACE: the body is correct and was verified
-- against a live tamper attempt in pr3_03. Re-stating it here would be a second
-- copy to keep in sync for no benefit.

alter function public.question_renditions_enforce_append_only()
  set search_path to 'public';

notify pgrst, 'reload schema';
