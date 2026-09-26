-- Epic R — M-R11: versioned ledgers + append-only response events
-- (R-FR-22, R-FR-23, BR-R12, BR-R13, QA-R24, QA-R25)
--
-- Both keep the existing "current" tables that every reader already uses —
-- expectation_ledgers (one current row per question/region) and
-- authority_responses (one current status per question/authority/region) —
-- and add the immutable history beneath them.
--
-- 1. expectation_ledger_versions: every publish (first or later) appends an
--    immutable version row — version number, snapshot time, snapshot_summary,
--    role_summary, counts, collection window, publisher, and a
--    threshold_config_snapshot of the expectation_* settings in force — so any
--    version is reproducible (BR-R12). expectation_ledgers.current_version
--    points at the latest. Versions cannot be updated or deleted. They are
--    public only while the ledger itself is published (archiving hides them).
-- 2. authority_response_events: append-only status history per question /
--    institution / region, with effective_at (when it happened), recorded_at
--    (when it was entered), source URL, optional office (M-R09 role), internal
--    notes and actor. The only permitted change is voiding an event, with a
--    reason. authority_responses is now DERIVED from the latest valid event,
--    through the existing update_authority_response_status() so change-only
--    notifications (R-04) and their copy (R-10) are reused; its
--    status_updated_at carries the event's effective date. Status changes that
--    still arrive through the old RPC are captured as events by a trigger, so
--    no path skips the history; existing rows are backfilled as events.
--    'no_response' is an ordinary status that later events can follow; the UI
--    shows it as "No response recorded as of <date>" (BR-R13).
--    Events are admin-only (notes are internal); the public history is
--    get_authority_response_history(), without notes or voided events.

-- ── 1. Ledger versions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expectation_ledger_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  region_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  snapshot_at timestamptz NOT NULL,
  snapshot_summary jsonb,
  role_summary jsonb,
  threshold_config_snapshot jsonb NOT NULL,
  participation_count integer,
  optin_count integer,
  collection_window_start timestamptz,
  collection_window_end timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, region_id, version)
);

ALTER TABLE public.expectation_ledgers ADD COLUMN IF NOT EXISTS current_version integer;

CREATE OR REPLACE FUNCTION public.expectation_ledger_config_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'expectation_threshold_pct', coalesce(max(value) FILTER (WHERE key = 'expectation_threshold_pct'), 65),
    'expectation_min_respondents', coalesce(max(value) FILTER (WHERE key = 'expectation_min_respondents'), 100),
    'expectation_persistence_hours', coalesce(max(value) FILTER (WHERE key = 'expectation_persistence_hours'), 72),
    'expectation_role_min_taggers', coalesce(max(value) FILTER (WHERE key = 'expectation_role_min_taggers'), 5))
  FROM public.app_config_trending;
$function$;
REVOKE ALL ON FUNCTION public.expectation_ledger_config_snapshot() FROM PUBLIC, anon, authenticated;

-- AFTER, not BEFORE: publish_expectation_ledger() upserts (INSERT … ON
-- CONFLICT DO UPDATE), and BEFORE INSERT triggers fire even when the insert
-- turns into an update, which would record a version for the discarded insert
-- attempt. AFTER triggers fire only for the operation that happened. The row
-- already carries the frozen role_summary (BEFORE trigger, M-R10).
CREATE OR REPLACE FUNCTION public.expectation_ledgers_record_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next integer;
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM 'published'
          OR NEW.published_at IS DISTINCT FROM OLD.published_at
          OR NEW.snapshot_summary IS DISTINCT FROM OLD.snapshot_summary
          OR NEW.participation_count IS DISTINCT FROM OLD.participation_count) THEN
    SELECT coalesce(max(version), 0) + 1 INTO v_next
      FROM public.expectation_ledger_versions
     WHERE question_id = NEW.question_id AND region_id = NEW.region_id;
    INSERT INTO public.expectation_ledger_versions (
      question_id, region_id, version, snapshot_at, snapshot_summary, role_summary,
      threshold_config_snapshot, participation_count, optin_count,
      collection_window_start, collection_window_end, published_by)
    VALUES (
      NEW.question_id, NEW.region_id, v_next, coalesce(NEW.published_at, now()), NEW.snapshot_summary, NEW.role_summary,
      public.expectation_ledger_config_snapshot(), NEW.participation_count, NEW.optin_count,
      NEW.time_window_start, NEW.time_window_end, NEW.published_by);
    -- Only current_version changes here, so this does not record another version.
    UPDATE public.expectation_ledgers
       SET current_version = v_next
     WHERE question_id = NEW.question_id AND region_id = NEW.region_id;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS expectation_ledgers_record_version ON public.expectation_ledgers;
CREATE TRIGGER expectation_ledgers_record_version
  AFTER INSERT OR UPDATE ON public.expectation_ledgers
  FOR EACH ROW EXECUTE FUNCTION public.expectation_ledgers_record_version();

-- Immutable: no update or delete (only a DB-owner maintenance session may delete).
CREATE OR REPLACE FUNCTION public.expectation_ledger_versions_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.epic_r_maintenance', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Published ledger versions are immutable (BR-R12); publish again to create a new version'
    USING ERRCODE = 'P0001';
END;
$function$;

DROP TRIGGER IF EXISTS expectation_ledger_versions_immutable ON public.expectation_ledger_versions;
CREATE TRIGGER expectation_ledger_versions_immutable
  BEFORE UPDATE OR DELETE ON public.expectation_ledger_versions
  FOR EACH ROW EXECUTE FUNCTION public.expectation_ledger_versions_immutable();

ALTER TABLE public.expectation_ledger_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expectation_ledger_versions_public_read ON public.expectation_ledger_versions;
CREATE POLICY expectation_ledger_versions_public_read ON public.expectation_ledger_versions
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.expectation_ledgers l
                 WHERE l.question_id = expectation_ledger_versions.question_id
                   AND l.region_id = expectation_ledger_versions.region_id
                   AND l.status = 'published'));
DROP POLICY IF EXISTS expectation_ledger_versions_admin_read ON public.expectation_ledger_versions;
CREATE POLICY expectation_ledger_versions_admin_read ON public.expectation_ledger_versions
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.expectation_ledger_versions FROM anon, authenticated;
GRANT SELECT ON public.expectation_ledger_versions TO anon, authenticated;

-- Backfill: existing published ledgers become version 1 (config as of now).
INSERT INTO public.expectation_ledger_versions (
  question_id, region_id, version, snapshot_at, snapshot_summary, role_summary,
  threshold_config_snapshot, participation_count, optin_count,
  collection_window_start, collection_window_end, published_by)
SELECT l.question_id, l.region_id, 1, coalesce(l.published_at, l.created_at), l.snapshot_summary, l.role_summary,
       public.expectation_ledger_config_snapshot() || jsonb_build_object('backfilled', true),
       l.participation_count, l.optin_count, l.time_window_start, l.time_window_end, l.published_by
FROM public.expectation_ledgers l
WHERE l.status = 'published'
  AND NOT EXISTS (SELECT 1 FROM public.expectation_ledger_versions v
                  WHERE v.question_id = l.question_id AND v.region_id = l.region_id);
UPDATE public.expectation_ledgers l SET current_version = 1
WHERE l.current_version IS NULL
  AND EXISTS (SELECT 1 FROM public.expectation_ledger_versions v
              WHERE v.question_id = l.question_id AND v.region_id = l.region_id AND v.version = 1);

-- ── 2. Response events ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.authority_response_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  authority_id uuid NOT NULL REFERENCES public.authority_registry(id) ON DELETE CASCADE,
  government_role_id uuid REFERENCES public.government_role_registry(id) ON DELETE SET NULL,
  region_id uuid,
  response_status text NOT NULL CHECK (response_status IN
    ('unacknowledged', 'under_review', 'action_announced', 'action_completed', 'no_response')),
  effective_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_url text CHECK (source_url IS NULL OR source_url ~* '^https?://'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  recorded_by uuid DEFAULT auth.uid(),
  origin text NOT NULL DEFAULT 'event' CHECK (origin IN ('event', 'legacy', 'backfill')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  CONSTRAINT authority_response_events_void_reason CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS authority_response_events_key_idx
  ON public.authority_response_events (question_id, authority_id, region_id, effective_at DESC);

-- Append-only: the only permitted change is voiding (once, with a reason).
CREATE OR REPLACE FUNCTION public.authority_response_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.epic_r_maintenance', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Response events are append-only (BR-R13); void an event instead' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.voided_at IS NOT NULL
     OR NEW.voided_at IS NULL
     OR (NEW.question_id, NEW.authority_id, NEW.government_role_id, NEW.region_id, NEW.response_status,
         NEW.effective_at, NEW.recorded_at, NEW.source_url, NEW.evidence, NEW.notes, NEW.recorded_by, NEW.origin)
        IS DISTINCT FROM
        (OLD.question_id, OLD.authority_id, OLD.government_role_id, OLD.region_id, OLD.response_status,
         OLD.effective_at, OLD.recorded_at, OLD.source_url, OLD.evidence, OLD.notes, OLD.recorded_by, OLD.origin) THEN
    RAISE EXCEPTION 'Response events are append-only (BR-R13); the only permitted change is voiding once, with a reason'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS authority_response_events_append_only ON public.authority_response_events;
CREATE TRIGGER authority_response_events_append_only
  BEFORE UPDATE OR DELETE ON public.authority_response_events
  FOR EACH ROW EXECUTE FUNCTION public.authority_response_events_append_only();

ALTER TABLE public.authority_response_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_response_events_admin_read ON public.authority_response_events;
CREATE POLICY authority_response_events_admin_read ON public.authority_response_events
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.authority_response_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.authority_response_events FROM authenticated;

-- Status changes made through the old RPC (or any other path) become events.
CREATE OR REPLACE FUNCTION public.authority_responses_capture_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.response_event_derive', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.response_status IS DISTINCT FROM OLD.response_status THEN
    INSERT INTO public.authority_response_events (
      question_id, authority_id, region_id, response_status, effective_at, recorded_at, notes, recorded_by, origin)
    VALUES (
      NEW.question_id, NEW.authority_id, NEW.region_id, NEW.response_status,
      coalesce(NEW.status_updated_at, now()), now(), NEW.notes, coalesce(NEW.updated_by, auth.uid()), 'legacy');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS authority_responses_capture_event ON public.authority_responses;
CREATE TRIGGER authority_responses_capture_event
  AFTER INSERT OR UPDATE OF response_status ON public.authority_responses
  FOR EACH ROW EXECUTE FUNCTION public.authority_responses_capture_event();

-- Backfill the current rows as the first event of each history.
INSERT INTO public.authority_response_events (
  question_id, authority_id, region_id, response_status, effective_at, recorded_at, notes, recorded_by, origin)
SELECT r.question_id, r.authority_id, r.region_id, r.response_status,
       coalesce(r.status_updated_at, now()), now(), r.notes, r.updated_by, 'backfill'
FROM public.authority_responses r
WHERE NOT EXISTS (SELECT 1 FROM public.authority_response_events e
                  WHERE e.question_id = r.question_id AND e.authority_id = r.authority_id
                    AND e.region_id IS NOT DISTINCT FROM r.region_id);

-- Re-derive the current status for one key from its latest valid event.
-- Changes go through update_authority_response_status() (change-only
-- notifications, R-04/R-10); the projection then carries the event's date.
CREATE OR REPLACE FUNCTION public.derive_authority_response(p_question_id uuid, p_authority_id uuid, p_region_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_latest public.authority_response_events;
  v_current text;
BEGIN
  SELECT * INTO v_latest
    FROM public.authority_response_events e
   WHERE e.question_id = p_question_id AND e.authority_id = p_authority_id
     AND e.region_id IS NOT DISTINCT FROM p_region_id AND e.voided_at IS NULL
   ORDER BY e.effective_at DESC, e.recorded_at DESC
   LIMIT 1;

  SELECT response_status INTO v_current
    FROM public.authority_responses r
   WHERE r.question_id = p_question_id AND r.authority_id = p_authority_id
     AND r.region_id IS NOT DISTINCT FROM p_region_id;

  PERFORM set_config('app.response_event_derive', 'on', true);
  IF v_latest.id IS NULL THEN
    DELETE FROM public.authority_responses r
     WHERE r.question_id = p_question_id AND r.authority_id = p_authority_id
       AND r.region_id IS NOT DISTINCT FROM p_region_id;
  ELSE
    IF v_current IS DISTINCT FROM v_latest.response_status THEN
      PERFORM public.update_authority_response_status(p_question_id, p_authority_id, p_region_id,
                                                      v_latest.response_status, v_latest.notes);
    END IF;
    UPDATE public.authority_responses r
       SET status_updated_at = v_latest.effective_at
     WHERE r.question_id = p_question_id AND r.authority_id = p_authority_id
       AND r.region_id IS NOT DISTINCT FROM p_region_id;
  END IF;
  PERFORM set_config('app.response_event_derive', 'off', true);

  RETURN v_latest.response_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.derive_authority_response(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Admin: record an event and re-derive the current status.
CREATE OR REPLACE FUNCTION public.admin_record_authority_response_event(
  p_question_id uuid,
  p_authority_id uuid,
  p_region_id uuid,
  p_response_status text,
  p_effective_at timestamptz DEFAULT NULL,
  p_source_url text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_government_role_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_before text;
  v_after text;
  v_event uuid;
  v_effective timestamptz := coalesce(p_effective_at, now());
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can record a response event' USING ERRCODE = '42501';
  END IF;
  IF v_effective > now() + interval '1 hour' THEN
    RAISE EXCEPTION 'A response event cannot be dated in the future' USING ERRCODE = '22023';
  END IF;
  IF p_government_role_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.government_role_registry g
        WHERE g.id = p_government_role_id AND g.authority_id = p_authority_id) THEN
    RAISE EXCEPTION 'That office does not belong to this institution' USING ERRCODE = '22023';
  END IF;

  SELECT response_status INTO v_before FROM public.authority_responses r
   WHERE r.question_id = p_question_id AND r.authority_id = p_authority_id
     AND r.region_id IS NOT DISTINCT FROM p_region_id;

  INSERT INTO public.authority_response_events (
    question_id, authority_id, government_role_id, region_id, response_status,
    effective_at, source_url, notes, recorded_by, origin)
  VALUES (
    p_question_id, p_authority_id, p_government_role_id, p_region_id, p_response_status,
    v_effective, nullif(btrim(coalesce(p_source_url, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(), 'event')
  RETURNING id INTO v_event;

  v_after := public.derive_authority_response(p_question_id, p_authority_id, p_region_id);
  RETURN jsonb_build_object('event_id', v_event, 'previous_status', v_before,
                            'current_status', v_after, 'status_changed', v_before IS DISTINCT FROM v_after);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_record_authority_response_event(uuid, uuid, uuid, text, timestamptz, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_authority_response_event(uuid, uuid, uuid, text, timestamptz, text, text, uuid) TO authenticated, service_role;

-- Admin: void an event (a correction) and re-derive.
CREATE OR REPLACE FUNCTION public.admin_void_authority_response_event(p_event_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_e public.authority_response_events;
  v_after text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can void a response event' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for voiding the event' USING ERRCODE = '22023';
  END IF;
  UPDATE public.authority_response_events
     SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   WHERE id = p_event_id AND voided_at IS NULL
  RETURNING * INTO v_e;
  IF v_e.id IS NULL THEN
    RAISE EXCEPTION 'Event not found or already voided' USING ERRCODE = 'P0002';
  END IF;
  v_after := public.derive_authority_response(v_e.question_id, v_e.authority_id, v_e.region_id);
  RETURN jsonb_build_object('current_status', v_after);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_void_authority_response_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_authority_response_event(uuid, text) TO authenticated, service_role;

-- Public history: valid events, without internal notes.
CREATE OR REPLACE FUNCTION public.get_authority_response_history(p_question_id uuid, p_region_id uuid DEFAULT NULL)
 RETURNS TABLE (
  id uuid,
  authority_id uuid,
  authority_name text,
  government_role_name text,
  region_id uuid,
  response_status text,
  effective_at timestamptz,
  recorded_at timestamptz,
  source_url text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.authority_id, a.name, g.role_name, e.region_id, e.response_status,
         e.effective_at, e.recorded_at, e.source_url
  FROM public.authority_response_events e
  JOIN public.authority_registry a ON a.id = e.authority_id
  LEFT JOIN public.government_role_registry g ON g.id = e.government_role_id AND g.verification_status = 'verified'
  WHERE e.question_id = p_question_id
    AND e.voided_at IS NULL
    AND (p_region_id IS NULL OR e.region_id = p_region_id)
  ORDER BY e.effective_at DESC, e.recorded_at DESC
  LIMIT 200;
$function$;
REVOKE ALL ON FUNCTION public.get_authority_response_history(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_authority_response_history(uuid, uuid) TO anon, authenticated, service_role;
