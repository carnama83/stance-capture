-- Close the last two Dev->UAT/Prod gaps: view security mode and two language FKs.
--
-- Both found by a constraint/reloptions-level comparison after Dev was brought up.
-- Dev is the reference for both; UAT and Prod are behind.
--
-- 1) admin_rendition_review_queue was the ONLY view of the 14 using security_invoker
--    on Dev where UAT/Prod differed - they had no reloptions, so it ran with the
--    view owner's rights and bypassed the caller's RLS. anon and authenticated both
--    hold SELECT on it, and it exposes unpublished and flagged rendition text plus
--    internal reviewer notes (review_notes, axis_equivalence_notes). No user PII, but
--    pre-publication content and moderation commentary.
--
--    Verified safe before applying. question_renditions RLS is:
--      question_renditions_admin_write  [ALL]    USING is_admin_me()
--      question_renditions_public_read  [SELECT] USING lifecycle_status = 'published'
--    So under security_invoker an admin still sees the whole queue (admin_write grants
--    ALL, which covers SELECT), while a non-admin is reduced to published rows. This
--    restricts the leak without breaking the admin UI.
--
-- 2) profiles.preferred_language_code and questions.canonical_language reference
--    languages(language_code) on Dev but had no FK on UAT/Prod - no referential
--    integrity on either column, despite both being NOT NULL DEFAULT 'en'.
--    Verified zero violating rows on Prod before applying.
--
-- Idempotent: the ALTER VIEW is a no-op if already set, and each FK is guarded.
-- FKs are added VALIDATED deliberately - an environment holding orphan language codes
-- must fail loudly rather than carry an unenforced constraint.

ALTER VIEW public.admin_rendition_review_queue SET (security_invoker = true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'profiles_preferred_language_code_fkey'
       AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_preferred_language_code_fkey
      FOREIGN KEY (preferred_language_code)
      REFERENCES public.languages(language_code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'questions_canonical_language_fkey'
       AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_canonical_language_fkey
      FOREIGN KEY (canonical_language)
      REFERENCES public.languages(language_code);
  END IF;
END
$$;

-- Assert the end state so a partial apply cannot pass silently.
DO $$
DECLARE
  v_secinv boolean;
  v_fks    integer;
BEGIN
  SELECT 'security_invoker=true' = ANY(c.reloptions) INTO v_secinv
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'admin_rendition_review_queue';

  SELECT count(*) INTO v_fks
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND c.contype = 'f'
     AND pg_get_constraintdef(c.oid) ILIKE '%languages%';

  IF NOT coalesce(v_secinv, false) THEN
    RAISE EXCEPTION 'admin_rendition_review_queue is not security_invoker';
  END IF;
  IF v_fks < 5 THEN
    RAISE EXCEPTION 'expected >= 5 FKs referencing languages, found %', v_fks;
  END IF;

  RAISE NOTICE 'sync_dev_09 OK: security_invoker set, language FKs = %', v_fks;
END
$$;
