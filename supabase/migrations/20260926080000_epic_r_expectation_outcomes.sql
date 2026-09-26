-- Epic R — expectation outcomes (R-FR-15: "expectation_outcomes links
-- expectation_ledgers to authority_responses ... Time-based progression
-- tracked. No editorial bias — admin-entered status only, no AI inference of
-- response quality.")
--
-- Response status (R-FR-17) and its history (R-FR-23, authority_response_events)
-- already exist; what was missing is the link between what respondents
-- expected and what followed. An outcome says: this recorded action (a
-- response event) corresponds to this expected action type in this published
-- ledger version.
--
-- 1. expectation_outcomes: (question, region, ledger_version) → a published
--    expectation_ledger_versions row; expectation_type → one of the action
--    types in that version's snapshot; response_event_id → an
--    action_announced / action_completed event for the same question and
--    region. Linking a later event (announced → completed) to the same type is
--    the progression. There is deliberately no public free text and no
--    met / not-met verdict: everything shown publicly is structured (type,
--    authority, status, date, source), so the platform records and does not
--    judge (BR-R08). Internal notes are admin-only.
-- 2. Append-only like response events (BR-R13): the only permitted change is
--    voiding once, with a reason; DELETE only in a DB-owner maintenance session.
--    Not added to the audit log: like response events it is already an
--    immutable record carrying recorded_by / voided_by.
-- 3. admin_record_expectation_outcome() / admin_void_expectation_outcome():
--    admin-only writes. get_expectation_outcomes(): public read for a
--    published ledger, excluding voided outcomes and outcomes whose event was
--    voided, without internal notes.

CREATE TABLE IF NOT EXISTS public.expectation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  region_id uuid NOT NULL,
  ledger_version integer NOT NULL,
  expectation_type text NOT NULL,
  response_event_id uuid NOT NULL REFERENCES public.authority_response_events(id) ON DELETE CASCADE,
  notes text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid DEFAULT auth.uid(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  FOREIGN KEY (question_id, region_id, ledger_version)
    REFERENCES public.expectation_ledger_versions (question_id, region_id, version) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS expectation_outcomes_ledger_idx
  ON public.expectation_outcomes (question_id, region_id);
CREATE INDEX IF NOT EXISTS expectation_outcomes_event_idx
  ON public.expectation_outcomes (response_event_id);
-- One valid link per (event, type, version).
CREATE UNIQUE INDEX IF NOT EXISTS expectation_outcomes_one_valid_link
  ON public.expectation_outcomes (response_event_id, expectation_type, ledger_version)
  WHERE voided_at IS NULL;

CREATE OR REPLACE FUNCTION public.expectation_outcomes_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.epic_r_maintenance', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Expectation outcomes are append-only; void an outcome instead' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.voided_at IS NOT NULL
     OR NEW.voided_at IS NULL
     OR (NEW.question_id, NEW.region_id, NEW.ledger_version, NEW.expectation_type, NEW.response_event_id,
         NEW.notes, NEW.recorded_at, NEW.recorded_by)
        IS DISTINCT FROM
        (OLD.question_id, OLD.region_id, OLD.ledger_version, OLD.expectation_type, OLD.response_event_id,
         OLD.notes, OLD.recorded_at, OLD.recorded_by) THEN
    RAISE EXCEPTION 'Expectation outcomes are append-only; the only permitted change is voiding once, with a reason'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expectation_outcomes_append_only ON public.expectation_outcomes;
CREATE TRIGGER expectation_outcomes_append_only
  BEFORE UPDATE OR DELETE ON public.expectation_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.expectation_outcomes_append_only();

ALTER TABLE public.expectation_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expectation_outcomes_admin_read ON public.expectation_outcomes;
CREATE POLICY expectation_outcomes_admin_read ON public.expectation_outcomes
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.expectation_outcomes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.expectation_outcomes FROM authenticated;

-- ── Admin: link an action event to an expected action ─────────────────────
-- p_ledger_version defaults to the ledger's current version.
CREATE OR REPLACE FUNCTION public.admin_record_expectation_outcome(
  p_response_event_id uuid,
  p_expectation_type text,
  p_ledger_version integer DEFAULT NULL,
  p_notes text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_e public.authority_response_events;
  v_version integer;
  v_snapshot jsonb;
  v_id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can record an expectation outcome' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_e FROM public.authority_response_events WHERE id = p_response_event_id;
  IF v_e.id IS NULL OR v_e.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Response event not found or voided' USING ERRCODE = 'P0002';
  END IF;
  IF v_e.response_status NOT IN ('action_announced', 'action_completed') THEN
    RAISE EXCEPTION 'Only an announced or completed action can be linked as an outcome' USING ERRCODE = '22023';
  END IF;
  IF v_e.region_id IS NULL THEN
    RAISE EXCEPTION 'The response event has no region, so it has no ledger to link to' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(p_ledger_version, l.current_version) INTO v_version
    FROM public.expectation_ledgers l
   WHERE l.question_id = v_e.question_id AND l.region_id = v_e.region_id AND l.status = 'published';
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'No published ledger for this question and region' USING ERRCODE = 'P0002';
  END IF;

  SELECT v.snapshot_summary INTO v_snapshot
    FROM public.expectation_ledger_versions v
   WHERE v.question_id = v_e.question_id AND v.region_id = v_e.region_id AND v.version = v_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ledger version % does not exist', v_version USING ERRCODE = 'P0002';
  END IF;

  -- Only an action that respondents actually expected in that version.
  IF p_expectation_type IN ('no_action', 'unsure', 'no_accountability_expected') THEN
    RAISE EXCEPTION 'That expectation is not an action' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_snapshot, '[]'::jsonb)) s
                  WHERE s ->> 'expectation_type' = p_expectation_type) THEN
    RAISE EXCEPTION 'Respondents did not select that expectation in ledger version %', v_version USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.expectation_outcomes (
      question_id, region_id, ledger_version, expectation_type, response_event_id, notes, recorded_by)
    VALUES (
      v_e.question_id, v_e.region_id, v_version, p_expectation_type, v_e.id,
      nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That action is already linked to this expectation' USING ERRCODE = '23505';
  END;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_record_expectation_outcome(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_expectation_outcome(uuid, text, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_void_expectation_outcome(p_outcome_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can void an expectation outcome' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for voiding the outcome' USING ERRCODE = '22023';
  END IF;
  UPDATE public.expectation_outcomes
     SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   WHERE id = p_outcome_id AND voided_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outcome not found or already voided' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_void_expectation_outcome(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_expectation_outcome(uuid, text) TO authenticated, service_role;

-- ── Public read (ledger page) ──────────────────────────────────────────────
-- Only for a published ledger; no internal notes; voided outcomes and outcomes
-- whose event was voided are left out. ledger_snapshot_at lets the page show
-- how long after publication each action followed.
CREATE OR REPLACE FUNCTION public.get_expectation_outcomes(p_question_id uuid, p_region_id uuid)
 RETURNS TABLE (
  id uuid,
  expectation_type text,
  ledger_version integer,
  ledger_snapshot_at timestamptz,
  authority_name text,
  government_role_name text,
  response_status text,
  effective_at timestamptz,
  source_url text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id, o.expectation_type, o.ledger_version, v.snapshot_at, a.name, g.role_name,
         e.response_status, e.effective_at, e.source_url
  FROM public.expectation_outcomes o
  JOIN public.expectation_ledgers l
    ON l.question_id = o.question_id AND l.region_id = o.region_id AND l.status = 'published'
  JOIN public.expectation_ledger_versions v
    ON v.question_id = o.question_id AND v.region_id = o.region_id AND v.version = o.ledger_version
  JOIN public.authority_response_events e ON e.id = o.response_event_id AND e.voided_at IS NULL
  JOIN public.authority_registry a ON a.id = e.authority_id
  LEFT JOIN public.government_role_registry g ON g.id = e.government_role_id AND g.verification_status = 'verified'
  WHERE o.question_id = p_question_id
    AND o.region_id = p_region_id
    AND o.voided_at IS NULL
  ORDER BY o.expectation_type, e.effective_at, e.recorded_at
  LIMIT 500;
$function$;
REVOKE ALL ON FUNCTION public.get_expectation_outcomes(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expectation_outcomes(uuid, uuid) TO anon, authenticated, service_role;
