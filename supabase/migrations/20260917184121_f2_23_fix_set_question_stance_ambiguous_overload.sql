-- P0 introduced by f2_06: STANCE SUBMISSION WAS BROKEN.
--
-- f2_06 added an optional p_language_code to set_question_stance. CREATE OR
-- REPLACE with a new parameter does NOT replace a function -- it creates a
-- second overload. Both survived:
--
--   set_question_stance(uuid, integer)
--   set_question_stance(uuid, integer, text DEFAULT NULL)
--
-- Every frontend caller sends exactly {p_question_id, p_score}, which matches
-- both, so PostgREST returned "Could not choose the best candidate function"
-- and nobody could record a stance at all.
--
-- The commit message for f2_06 claimed the parameter was "OPTIONAL and
-- additive, so all five existing frontend call sites keep working unchanged".
-- That was wrong, and nothing caught it because every test in the F2 build
-- either inserted into question_stances directly or called the 3-arg form
-- explicitly. The first real click on the stance slider found it immediately.
--
-- Dropping the 2-arg version is the fix: the 3-arg version defaults
-- p_language_code to NULL and then falls back to the respondent's
-- preferred_language_code, which is exactly what the old behaviour needed to
-- become. Two-argument calls resolve to it unambiguously once the overload is
-- gone.

drop function if exists public.set_question_stance(uuid, integer);

do $$
declare n integer;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'set_question_stance';
  if n <> 1 then
    raise exception 'set_question_stance must have exactly one signature, found %', n;
  end if;
end $$;

comment on function public.set_question_stance(uuid, integer, text) is
  'Canonical stance write path. p_language_code is optional and falls back to the respondent''s preferred_language_code; it records which rendition the answer was given against (UGQ-ML-09). DO NOT add another overload -- PostgREST resolves by argument names and a second signature makes every 2-argument call ambiguous, which silently broke stance submission once already (f2_23).';
