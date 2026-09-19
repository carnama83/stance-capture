-- stub_question_renditions() is an AFTER INSERT trigger function on `questions`,
-- never meant to be called directly. Adding SECURITY DEFINER to it (so it can
-- read the RLS-locked language_regions table) made get_advisors flag it as
-- anon/authenticated-executable via /rest/v1/rpc/stub_question_renditions —
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Revoking
-- direct EXECUTE closes that without affecting trigger firing: triggers run
-- as an implicit invocation tied to the table event, not mediated by the
-- caller's EXECUTE privilege on the function.
revoke execute on function public.stub_question_renditions() from public, anon, authenticated;
