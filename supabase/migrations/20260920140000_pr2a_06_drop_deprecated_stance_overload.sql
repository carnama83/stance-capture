-- PR 2a.6 — drop the deprecated stance overload and the old resolver name.
--
-- ############################################################################
-- #  DEPLOY ORDERING: THIS MIGRATION MUST RUN **AFTER** THE FRONTEND SHIPS.  #
-- ############################################################################
--
-- Supabase migrations and Vercel deploys are not atomic. Every client build
-- that predates PR 2a.2 calls set_question_stance WITHOUT p_rendition_id, and
-- PostgREST binds overloads by the JSON body's key set — so the moment the
-- three-argument text form is gone, those clients get a 404 on every stance
-- write. That is precisely the window the additive migration in PR 2a.3 was
-- written to avoid, and this is the migration that closes it.
--
-- In each environment: deploy the frontend, confirm zero traffic on the old
-- form, then apply this. On a rollback of the frontend, re-create the old form
-- from PR 2a.3 before rolling back the app.
--
-- WHAT IS BEING REMOVED AND WHY
--
-- set_question_stance(uuid, integer, text) resolved a rendition server-side
-- from a language, via a function that filters lifecycle_status = 'published'.
-- A superseded rendition was therefore unreachable, so a respondent who read
-- R82 and submitted after R103 was published had their answer recorded against
-- R103 — wording they never saw. It also derived the language from the profile
-- rather than from what was displayed, so a reader using ?lang=hi with an
-- English profile was attributed to the English rendition.
--
-- resolve_response_rendition(uuid, text) was renamed to
-- select_rendition_to_display() in PR 2a.4 to make reuse in a write path
-- visibly wrong. The old name was kept alive only for its remaining callers.
--
-- ALL CALLERS ARE MIGRATED — verified rather than assumed:
--
--   Index.tsx                      p_rendition_id from the feed row
--   QuestionDetailPage.tsx         p_rendition_id from get_question_localized
--   QuickTakesCard.tsx             p_rendition_id from get_for_you_feed
--   InlineQuestionStanceEditor     p_rendition_id from a prop
--   useStanceSubmission.ts         p_rendition_id, required
--   MyStancesPage.tsx              p_rendition_id from the displayed rendition
--   embed-submit                   select_rendition_to_display
--   whatsapp-flow-endpoint         select_rendition_to_display (legacy path)
--   record-stance-reveal-switch    no resolver at all; client or existing row
--
-- and no SQL function references either name once this runs.
--
-- Guarded: if the uuid overload is missing, this refuses rather than leaving
-- the database with no stance write path at all.

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_question_stance'
      and pg_get_function_identity_arguments(p.oid) = 'p_question_id uuid, p_score integer, p_rendition_id uuid'
  ) then
    raise exception
      'pr2a_06: the (uuid, integer, uuid) overload is missing — dropping the text overload would leave no stance write path. Apply pr2a_04 first.';
  end if;
end $$;

drop function if exists public.set_question_stance(uuid, integer, text);
drop function if exists public.resolve_response_rendition(uuid, text);

notify pgrst, 'reload schema';
