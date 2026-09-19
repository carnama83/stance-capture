-- languages has RLS enabled but zero policies, so with no permissive
-- policy every non-bypass role (including 'authenticated', used by admin
-- sessions) gets zero rows from it. admin_rendition_review_queue INNER
-- JOINs languages, so that silently emptied the entire review queue for
-- every admin regardless of question_renditions/questions visibility --
-- reproduced directly: SET ROLE authenticated + the real admin's JWT
-- claims returns 0 rows from the view even though question_renditions and
-- questions are correctly visible to that role.
-- languages is non-sensitive reference data (language codes/display
-- names) -- same classification as questions_public_read, which already
-- allows USING (true).
CREATE POLICY languages_public_read ON public.languages
  FOR SELECT
  USING (true);
;
