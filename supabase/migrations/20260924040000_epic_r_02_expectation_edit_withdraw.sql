-- Epic R — R-02: expectations can be edited and withdrawn (R-FR-21, BR-R14, QA-R23)
--
-- Before: question_expectations had only SELECT-own and INSERT-own policies,
-- so a selection could never be changed or withdrawn, and the post-stance
-- prompt was suppressed forever by a device-local localStorage flag.
--
-- Model:
--   * question_expectations stays the CURRENT active set. The aggregate views
--     read it, so a withdrawn selection drops out of every aggregate at once.
--   * question_expectation_revisions is an append-only private history: one row
--     per change, holding the full set after that change ({} = withdrawn).
--   * set_my_question_expectations(question, types[]) is the only write path
--     for browser roles. It replaces the caller's set in one transaction, keeps
--     unchanged rows (and their created_at, which the collection-span threshold
--     uses), and logs a revision when the set actually changes.

-- ── Revision history ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.question_expectation_revisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  region_id uuid,
  expectation_types text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS question_expectation_revisions_user_question_idx
  ON public.question_expectation_revisions (user_id, question_id, created_at DESC);

COMMENT ON TABLE public.question_expectation_revisions IS
  'Epic R R-02: append-only history of each user''s expectation set per question. '
  'expectation_types = the full set after the change; {} = withdrawn. Private: owner '
  'SELECT only; written only by set_my_question_expectations().';

ALTER TABLE public.question_expectation_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own expectation revisions" ON public.question_expectation_revisions;
CREATE POLICY "Users can view their own expectation revisions" ON public.question_expectation_revisions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.question_expectation_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.question_expectation_revisions TO authenticated;
GRANT ALL ON public.question_expectation_revisions TO service_role;

-- Baseline: record every existing set once, so history starts complete.
INSERT INTO public.question_expectation_revisions (user_id, question_id, region_id, expectation_types, created_at)
SELECT qe.user_id, qe.question_id, min(qe.region_id::text)::uuid,
       array_agg(qe.expectation_type ORDER BY qe.expectation_type), min(qe.created_at)
FROM public.question_expectations qe
WHERE NOT EXISTS (
  SELECT 1 FROM public.question_expectation_revisions r
  WHERE r.user_id = qe.user_id AND r.question_id = qe.question_id)
GROUP BY qe.user_id, qe.question_id;

-- ── Single write path ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_my_question_expectations(p_question_id uuid, p_types text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_types text[];
  v_prev text[];
  v_region uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to record an expectation' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT t ORDER BY t), '{}')
  INTO v_types
  FROM unnest(coalesce(p_types, '{}')) AS t
  WHERE t IS NOT NULL AND btrim(t) <> '';

  IF cardinality(v_types) > 15 THEN
    RAISE EXCEPTION 'Too many expectation types' USING ERRCODE = '22023';
  END IF;

  -- Serialise concurrent saves by the same user on the same question.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_question_id::text, 0));

  SELECT coalesce(array_agg(expectation_type ORDER BY expectation_type), '{}'), min(region_id::text)::uuid
  INTO v_prev, v_region
  FROM public.question_expectations
  WHERE user_id = v_uid AND question_id = p_question_id;

  IF v_types = v_prev THEN
    RETURN v_types;  -- no change: nothing to write, no revision
  END IF;

  -- BR-R01: expectations are captured after a stance. Withdrawing is always allowed.
  IF cardinality(v_types) > 0 AND NOT EXISTS (
      SELECT 1 FROM public.question_stances s
      WHERE s.user_id = v_uid AND s.question_id = p_question_id) THEN
    RAISE EXCEPTION 'Take a stance on this question before adding an expectation' USING ERRCODE = 'P0001';
  END IF;

  -- Region is fixed at first submission (US-R02 "region at time of submission");
  -- a first submission takes the user's current location, like the old client did.
  IF cardinality(v_prev) = 0 THEN
    SELECT uls.location_id INTO v_region
    FROM public.user_location_settings uls
    WHERE uls.user_id = v_uid
    LIMIT 1;
  END IF;

  DELETE FROM public.question_expectations
  WHERE user_id = v_uid AND question_id = p_question_id
    AND expectation_type <> ALL (v_types);

  -- The expectation_type CHECK constraint rejects unknown slugs (23514).
  INSERT INTO public.question_expectations (user_id, question_id, expectation_type, region_id)
  SELECT v_uid, p_question_id, t, v_region FROM unnest(v_types) AS t
  ON CONFLICT (user_id, question_id, expectation_type) DO NOTHING;

  INSERT INTO public.question_expectation_revisions (user_id, question_id, region_id, expectation_types)
  VALUES (v_uid, p_question_id, v_region, v_types);

  RETURN v_types;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_my_question_expectations(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_question_expectations(uuid, text[]) TO authenticated, service_role;

-- ── Close the direct write path (every change must be audited) ────────────
DROP POLICY IF EXISTS "Users can insert their own expectations" ON public.question_expectations;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.question_expectations FROM PUBLIC, anon, authenticated;
