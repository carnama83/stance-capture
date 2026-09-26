-- Epic R — M-R10: government-role suggestions + user role tags
-- (R-FR-19, R-FR-20, US-R17..R19, US-R21, US-R22, BR-R10, BR-R11, QA-R21, QA-R27)
--
-- Builds on the M-R09 registry. Three layers, all office-first:
--
-- 1. question_role_suggestions (R-FR-19): which REGISTRY role is relevant to a
--    question and an expected action. Written by the admin-triggered Edge
--    Function suggest-government-roles (which may only rank roles that already
--    exist in the registry for the question's mapped institutions — it never
--    invents offices or names) or added by hand; every row starts 'suggested'
--    and is shown to users only once an admin confirms it AND the role is
--    verified (US-R21). Admin-only table.
-- 2. expectation_role_tags (R-FR-20): a user's optional association between
--    one of their expectations and one or more verified offices. Owner-only
--    reads; written only through set_my_expectation_role_tags(), which requires
--    the user to hold that expectation and the role to be verified. Tags are
--    withdrawn (withdrawn_at), never deleted, and are withdrawn automatically
--    when the expectation itself is withdrawn (set_my_question_expectations
--    hard-deletes deselected types). Non-action expectations (no_action,
--    unsure, no_accountability_expected) cannot carry a role.
-- 3. Public output is aggregate only (US-R19): get_expectation_role_signal()
--    returns per-office rates only when the region's expectation signal has
--    crossed threshold (same gate as get_expectation_signal) and only for
--    offices chosen by at least expectation_role_min_taggers people (default 5).
--    Published ledgers freeze the same aggregate in expectation_ledgers.
--    role_summary (US-R22) via a trigger, with the office-holder included only
--    if verified and current at publish time (BR-R11).
--
-- Notifications are unaffected: accountability fan-out already selects
-- DISTINCT user_id, so role tags cannot multiply notifications (QA-R27).

-- ── 1. Suggestions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.question_role_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  expectation_type text NOT NULL CHECK (expectation_type IN (
    'investigation', 'compensation', 'policy_reform', 'transparency', 'infrastructure_fix',
    'accountability', 'legal_action', 'criminal_prosecution', 'departmental_suspension',
    'independent_investigation', 'compensation_only', 'administrative_transfer')),
  government_role_id uuid NOT NULL REFERENCES public.government_role_registry(id) ON DELETE CASCADE,
  suggested_by text NOT NULL DEFAULT 'admin' CHECK (suggested_by IN ('ai', 'admin')),
  confidence_score numeric CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  rationale text,
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (question_id, expectation_type, government_role_id)
);
CREATE INDEX IF NOT EXISTS question_role_suggestions_question_idx ON public.question_role_suggestions (question_id, status);

CREATE OR REPLACE FUNCTION public.question_role_suggestions_review_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  ELSIF TG_OP = 'INSERT' AND NEW.status <> 'suggested' THEN
    NEW.reviewed_by := coalesce(NEW.reviewed_by, auth.uid());
    NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS question_role_suggestions_review_stamp ON public.question_role_suggestions;
CREATE TRIGGER question_role_suggestions_review_stamp
  BEFORE INSERT OR UPDATE ON public.question_role_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.question_role_suggestions_review_stamp();

ALTER TABLE public.question_role_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS question_role_suggestions_admin_all ON public.question_role_suggestions;
CREATE POLICY question_role_suggestions_admin_all ON public.question_role_suggestions
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.question_role_suggestions FROM anon;

-- ── 2. User role tags ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expectation_role_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  expectation_type text NOT NULL,
  government_role_id uuid NOT NULL REFERENCES public.government_role_registry(id) ON DELETE RESTRICT,
  region_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS expectation_role_tags_one_active
  ON public.expectation_role_tags (user_id, question_id, expectation_type, government_role_id)
  WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS expectation_role_tags_question_idx
  ON public.expectation_role_tags (question_id, region_id) WHERE withdrawn_at IS NULL;

ALTER TABLE public.expectation_role_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expectation_role_tags_owner_read ON public.expectation_role_tags;
CREATE POLICY expectation_role_tags_owner_read ON public.expectation_role_tags
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE ALL ON public.expectation_role_tags FROM anon;
-- The RPC below is the only write path.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.expectation_role_tags FROM authenticated;

-- Withdrawing an expectation withdraws the offices tagged on it.
CREATE OR REPLACE FUNCTION public.expectation_role_tags_follow_expectation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.expectation_role_tags
     SET withdrawn_at = now()
   WHERE user_id = OLD.user_id
     AND question_id = OLD.question_id
     AND expectation_type = OLD.expectation_type
     AND withdrawn_at IS NULL;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS expectation_role_tags_follow_expectation ON public.question_expectations;
CREATE TRIGGER expectation_role_tags_follow_expectation
  AFTER DELETE ON public.question_expectations
  FOR EACH ROW EXECUTE FUNCTION public.expectation_role_tags_follow_expectation();

-- Set the caller's offices for one of their expectations (replaces the set).
CREATE OR REPLACE FUNCTION public.set_my_expectation_role_tags(
  p_question_id uuid,
  p_expectation_type text,
  p_role_ids uuid[]
)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_region uuid;
  v_roles uuid[];
  v_bad int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to tag a government office' USING ERRCODE = '42501';
  END IF;
  IF p_expectation_type IN ('no_action', 'unsure', 'no_accountability_expected') THEN
    RAISE EXCEPTION 'This expectation does not take a government office' USING ERRCODE = '22023';
  END IF;

  SELECT min(region_id::text)::uuid INTO v_region
    FROM public.question_expectations
   WHERE user_id = v_uid AND question_id = p_question_id AND expectation_type = p_expectation_type;
  IF NOT EXISTS (SELECT 1 FROM public.question_expectations
                  WHERE user_id = v_uid AND question_id = p_question_id AND expectation_type = p_expectation_type) THEN
    RAISE EXCEPTION 'Select this expectation before tagging an office' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(DISTINCT r), '{}') INTO v_roles FROM unnest(coalesce(p_role_ids, '{}')) AS r;
  IF cardinality(v_roles) > 10 THEN
    RAISE EXCEPTION 'At most 10 offices per expectation' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_bad FROM unnest(v_roles) AS r
   WHERE NOT EXISTS (SELECT 1 FROM public.government_role_registry g WHERE g.id = r AND g.verification_status = 'verified');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Only verified government offices can be tagged' USING ERRCODE = '22023';
  END IF;

  UPDATE public.expectation_role_tags
     SET withdrawn_at = now()
   WHERE user_id = v_uid AND question_id = p_question_id AND expectation_type = p_expectation_type
     AND withdrawn_at IS NULL AND government_role_id <> ALL (v_roles);

  INSERT INTO public.expectation_role_tags (user_id, question_id, expectation_type, government_role_id, region_id)
  SELECT v_uid, p_question_id, p_expectation_type, r, v_region
    FROM unnest(v_roles) AS r
   WHERE NOT EXISTS (SELECT 1 FROM public.expectation_role_tags t
                      WHERE t.user_id = v_uid AND t.question_id = p_question_id
                        AND t.expectation_type = p_expectation_type AND t.government_role_id = r
                        AND t.withdrawn_at IS NULL);

  RETURN v_roles;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_my_expectation_role_tags(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_expectation_role_tags(uuid, text, uuid[]) TO authenticated, service_role;

-- ── 3. What a user may pick: confirmed suggestions for verified offices ────
-- Also returns the verified offices the caller has already tagged (is_suggested
-- = false for ones found by search), so the UI can name them without a lookup.
CREATE OR REPLACE FUNCTION public.get_expectation_role_options(p_question_id uuid, p_expectation_types text[])
 RETURNS TABLE (
  expectation_type text,
  government_role_id uuid,
  role_name text,
  authority_name text,
  current_office_holder_name text,
  office_holder_verified_at timestamptz,
  is_suggested boolean
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  WITH picked AS (
    SELECT s.expectation_type, s.government_role_id, true AS is_suggested, coalesce(s.confidence_score, 0) AS rank
    FROM public.question_role_suggestions s
    WHERE s.question_id = p_question_id
      AND s.status = 'confirmed'
      AND s.expectation_type = ANY (coalesce(p_expectation_types, '{}'))
    UNION ALL
    SELECT t.expectation_type, t.government_role_id, false, -1
    FROM public.expectation_role_tags t
    WHERE t.user_id = auth.uid()
      AND t.question_id = p_question_id
      AND t.withdrawn_at IS NULL
      AND t.expectation_type = ANY (coalesce(p_expectation_types, '{}'))
      AND NOT EXISTS (SELECT 1 FROM public.question_role_suggestions s2
                      WHERE s2.question_id = t.question_id AND s2.expectation_type = t.expectation_type
                        AND s2.government_role_id = t.government_role_id AND s2.status = 'confirmed')
  )
  SELECT p.expectation_type, r.id, r.role_name, a.name,
         CASE WHEN r.current_office_holder_name IS NOT NULL AND r.office_holder_verified_at IS NOT NULL
                   AND r.office_holder_source_url IS NOT NULL
                   AND (r.valid_from IS NULL OR r.valid_from <= current_date)
                   AND (r.valid_to IS NULL OR r.valid_to >= current_date)
              THEN r.current_office_holder_name END,
         CASE WHEN r.current_office_holder_name IS NOT NULL AND r.office_holder_source_url IS NOT NULL
                   AND (r.valid_from IS NULL OR r.valid_from <= current_date)
                   AND (r.valid_to IS NULL OR r.valid_to >= current_date)
              THEN r.office_holder_verified_at END,
         p.is_suggested
  FROM picked p
  JOIN public.government_role_registry r ON r.id = p.government_role_id AND r.verification_status = 'verified'
  JOIN public.authority_registry a ON a.id = r.authority_id
  ORDER BY p.expectation_type, p.is_suggested DESC, p.rank DESC, r.role_name;
$function$;

REVOKE ALL ON FUNCTION public.get_expectation_role_options(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expectation_role_options(uuid, text[]) TO anon, authenticated, service_role;

-- ── 4. Aggregate role signal (public) ─────────────────────────────────────
-- Shared by the live signal RPC and the ledger freeze. Rates are the share of
-- people holding that expectation (in the region) who tagged the office.
CREATE OR REPLACE FUNCTION public.expectation_role_aggregate(p_question_id uuid, p_region_id uuid, p_include_holder boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT coalesce(max(value) FILTER (WHERE key = 'expectation_role_min_taggers'), 5) AS min_taggers
    FROM public.app_config_trending
  ), holders AS (
    SELECT qe.expectation_type, count(DISTINCT qe.user_id) AS respondents
    FROM public.question_expectations qe
    WHERE qe.question_id = p_question_id AND qe.region_id IS NOT DISTINCT FROM p_region_id
    GROUP BY qe.expectation_type
  ), tags AS (
    SELECT t.expectation_type, t.government_role_id, count(DISTINCT t.user_id) AS taggers
    FROM public.expectation_role_tags t
    JOIN public.question_expectations qe
      ON qe.user_id = t.user_id AND qe.question_id = t.question_id AND qe.expectation_type = t.expectation_type
    WHERE t.question_id = p_question_id AND t.withdrawn_at IS NULL
      AND qe.region_id IS NOT DISTINCT FROM p_region_id
    GROUP BY t.expectation_type, t.government_role_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'expectation_type', tg.expectation_type,
           'government_role_id', r.id,
           'role_name', r.role_name,
           'authority_name', a.name,
           'tagger_count', tg.taggers,
           'pct_of_expectation_respondents', round(100.0 * tg.taggers / nullif(h.respondents, 0), 2),
           'current_office_holder_name',
             CASE WHEN p_include_holder AND r.current_office_holder_name IS NOT NULL
                       AND r.office_holder_verified_at IS NOT NULL AND r.office_holder_source_url IS NOT NULL
                       AND (r.valid_from IS NULL OR r.valid_from <= current_date)
                       AND (r.valid_to IS NULL OR r.valid_to >= current_date)
                  THEN r.current_office_holder_name END,
           'office_holder_verified_at',
             CASE WHEN p_include_holder AND r.current_office_holder_name IS NOT NULL
                       AND r.office_holder_verified_at IS NOT NULL AND r.office_holder_source_url IS NOT NULL
                       AND (r.valid_from IS NULL OR r.valid_from <= current_date)
                       AND (r.valid_to IS NULL OR r.valid_to >= current_date)
                  THEN r.office_holder_verified_at END)
         ORDER BY tg.expectation_type, tg.taggers DESC, r.role_name), '[]'::jsonb)
  FROM tags tg
  JOIN holders h ON h.expectation_type = tg.expectation_type
  JOIN public.government_role_registry r ON r.id = tg.government_role_id AND r.verification_status = 'verified'
  JOIN public.authority_registry a ON a.id = r.authority_id
  CROSS JOIN cfg
  WHERE tg.taggers >= cfg.min_taggers;
$function$;

REVOKE ALL ON FUNCTION public.expectation_role_aggregate(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expectation_role_aggregate(uuid, uuid, boolean) TO service_role;

-- Live signal: nothing unless the region's expectation signal has crossed.
CREATE OR REPLACE FUNCTION public.get_expectation_role_signal(p_question_id uuid, p_region_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM public.region_expectation_strength s
           WHERE s.question_id = p_question_id
             AND s.region_id IS NOT DISTINCT FROM p_region_id
             AND s.signal_crossed)
         THEN public.expectation_role_aggregate(p_question_id, p_region_id, true)
         END;
$function$;

REVOKE ALL ON FUNCTION public.get_expectation_role_signal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expectation_role_signal(uuid, uuid) TO anon, authenticated, service_role;

-- ── 5. Ledger freeze (US-R22) ─────────────────────────────────────────────
ALTER TABLE public.expectation_ledgers ADD COLUMN IF NOT EXISTS role_summary jsonb;

CREATE OR REPLACE FUNCTION public.expectation_ledgers_freeze_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    NEW.role_summary := public.expectation_role_aggregate(NEW.question_id, NEW.region_id, true);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expectation_ledgers_freeze_roles ON public.expectation_ledgers;
CREATE TRIGGER expectation_ledgers_freeze_roles
  BEFORE INSERT OR UPDATE ON public.expectation_ledgers
  FOR EACH ROW EXECUTE FUNCTION public.expectation_ledgers_freeze_roles();

-- ── 6. AI suggestion prompt (Edge Function fallback has the same text) ─────
INSERT INTO public.ai_prompts (prompt_key, label, description, system_prompt, user_prompt_template, is_active, notes)
SELECT 'government_role_suggestion',
       'Government-role suggestions (Epic R M-R10)',
       'Ranks which existing registry offices are relevant to each expected action on a question.',
       $prompt$You help a civic platform suggest which EXISTING government offices are relevant to an expected action on a civic issue. You never invent offices, never name people, and never tell anyone to contact, pressure or target an official (BR-R10).

You receive: the question and its context, the region, the responsible institutions, a numbered list of candidate offices (each with its institution, level, domain and role type), and the expected actions to consider.

For each expected action, pick the candidate offices that have a genuine responsibility for carrying out or deciding that action in this place — for example the office that orders an inquiry for "investigation", the office that approves payouts for "compensation", the office that maintains the asset for "infrastructure_fix". Skip an action if no candidate fits. Do not pick an office just because it is senior.

Return ONLY valid JSON, no markdown:
{"suggestions": [{"expectation_type": "<one of the given actions>", "role_index": <number from the list>, "confidence": <0.0-1.0>, "rationale": "<one neutral sentence on the office's responsibility for this action>"}]}

At most 3 offices per action. Confidence reflects how clearly the office is responsible, not how important it is. Rationales state duties, never blame.$prompt$,
       '(built in code by suggest-government-roles)',
       true,
       'Seeded by migration 20260926040000; the Edge Function fallback has the same text.'
WHERE NOT EXISTS (SELECT 1 FROM public.ai_prompts WHERE prompt_key = 'government_role_suggestion');
