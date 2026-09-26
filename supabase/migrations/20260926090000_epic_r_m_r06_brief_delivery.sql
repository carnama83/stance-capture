-- Epic R — M-R06 brief delivery (R-FR-14: "Admin-approved before any
-- delivery"; status draft / approved / delivered).
--
-- Until now "Mark delivered" was a bare status flag: nothing was sent and
-- nothing recorded how, when or to whom. Decided 26 Sep 2026: the platform
-- never contacts an institution itself. An admin delivers an approved brief
-- through the institution's official channel (email, portal, letter, in
-- person, RTI) and records each delivery here; "delivered" is derived from
-- those records.
--
-- 1. authority_brief_deliveries: one row per delivery — channel, recipient,
--    date, reference, evidence URL, internal notes. Admin-only. Append-only
--    like response events: the only change is voiding once, with a reason;
--    DELETE only in a DB-owner maintenance session.
-- 2. authority_briefs guard: status 'delivered' only while a valid delivery
--    exists (and then it must stay 'delivered'); only an approved brief can be
--    delivered; an approved or delivered brief's text is frozen, so what was
--    delivered is what was approved (regenerating inserts a new draft).
--    Existing 'delivered' rows with no delivery record go back to 'approved'.
-- 3. admin_record_brief_delivery() / admin_void_brief_delivery(): admin-only;
--    they re-derive the brief's status.
-- 4. Public:
--    get_authority_brief(id): the approved text of one brief, for the
--      printable page an admin sends (/brief/:id). Link-only: the id is a
--      random uuid and there is no listing. Drafts are never returned.
--    get_brief_deliveries(question, region): for a published ledger, which
--      institution a brief was delivered to, when and by which channel —
--      no recipient, reference, evidence or notes, and no brief text.

CREATE TABLE IF NOT EXISTS public.authority_brief_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES public.authority_briefs(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'official_portal', 'letter', 'in_person', 'rti', 'other')),
  recipient text NOT NULL CHECK (btrim(recipient) <> ''),
  delivered_at timestamptz NOT NULL,
  reference text,
  evidence_url text CHECK (evidence_url IS NULL OR evidence_url ~* '^https?://'),
  notes text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid DEFAULT auth.uid(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text
);
CREATE INDEX IF NOT EXISTS authority_brief_deliveries_brief_idx
  ON public.authority_brief_deliveries (brief_id, delivered_at);

CREATE OR REPLACE FUNCTION public.authority_brief_deliveries_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.epic_r_maintenance', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Brief deliveries are append-only; void a delivery instead' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.voided_at IS NOT NULL
     OR NEW.voided_at IS NULL
     OR (NEW.brief_id, NEW.channel, NEW.recipient, NEW.delivered_at, NEW.reference, NEW.evidence_url,
         NEW.notes, NEW.recorded_at, NEW.recorded_by)
        IS DISTINCT FROM
        (OLD.brief_id, OLD.channel, OLD.recipient, OLD.delivered_at, OLD.reference, OLD.evidence_url,
         OLD.notes, OLD.recorded_at, OLD.recorded_by) THEN
    RAISE EXCEPTION 'Brief deliveries are append-only; the only permitted change is voiding once, with a reason'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS authority_brief_deliveries_append_only ON public.authority_brief_deliveries;
CREATE TRIGGER authority_brief_deliveries_append_only
  BEFORE UPDATE OR DELETE ON public.authority_brief_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.authority_brief_deliveries_append_only();

ALTER TABLE public.authority_brief_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_brief_deliveries_admin_read ON public.authority_brief_deliveries;
CREATE POLICY authority_brief_deliveries_admin_read ON public.authority_brief_deliveries
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.authority_brief_deliveries FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.authority_brief_deliveries FROM authenticated;

-- ── Brief guard ──────────────────────────────────────────────────────────
-- Existing 'delivered' flags carry no record of any delivery.
UPDATE public.authority_briefs b SET status = 'approved'
 WHERE b.status = 'delivered'
   AND NOT EXISTS (SELECT 1 FROM public.authority_brief_deliveries d WHERE d.brief_id = b.id AND d.voided_at IS NULL);

CREATE OR REPLACE FUNCTION public.authority_briefs_delivery_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_delivered boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.authority_brief_deliveries d
                  WHERE d.brief_id = NEW.id AND d.voided_at IS NULL) INTO v_delivered;
  IF NEW.status = 'delivered' AND NOT v_delivered THEN
    RAISE EXCEPTION 'A brief is delivered only once a delivery is recorded (admin_record_brief_delivery)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_delivered AND NEW.status <> 'delivered' THEN
    RAISE EXCEPTION 'This brief has a recorded delivery; void the delivery first' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'delivered')
     AND NEW.brief_text IS DISTINCT FROM OLD.brief_text THEN
    RAISE EXCEPTION 'An approved brief cannot be edited; generate a new draft instead' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS authority_briefs_delivery_guard ON public.authority_briefs;
CREATE TRIGGER authority_briefs_delivery_guard
  BEFORE INSERT OR UPDATE ON public.authority_briefs
  FOR EACH ROW EXECUTE FUNCTION public.authority_briefs_delivery_guard();

-- Re-derive one brief's status from its deliveries.
CREATE OR REPLACE FUNCTION public.sync_authority_brief_status(p_brief_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  UPDATE public.authority_briefs b
     SET status = CASE WHEN EXISTS (SELECT 1 FROM public.authority_brief_deliveries d
                                     WHERE d.brief_id = b.id AND d.voided_at IS NULL)
                       THEN 'delivered' ELSE 'approved' END
   WHERE b.id = p_brief_id
  RETURNING b.status INTO v_status;
  RETURN v_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_authority_brief_status(uuid) FROM PUBLIC, anon, authenticated;

-- ── Admin: record / void a delivery ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_record_brief_delivery(
  p_brief_id uuid,
  p_channel text,
  p_recipient text,
  p_delivered_at timestamptz DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_evidence_url text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_status text;
  v_text text;
  v_when timestamptz := coalesce(p_delivered_at, now());
  v_id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can record a brief delivery' USING ERRCODE = '42501';
  END IF;
  SELECT status, brief_text INTO v_status, v_text FROM public.authority_briefs WHERE id = p_brief_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Brief not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('approved', 'delivered') OR nullif(btrim(coalesce(v_text, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Only an approved brief can be delivered' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_recipient, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Say who the brief was delivered to' USING ERRCODE = '22023';
  END IF;
  IF v_when > now() + interval '1 hour' THEN
    RAISE EXCEPTION 'A delivery cannot be dated in the future' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.authority_brief_deliveries (
    brief_id, channel, recipient, delivered_at, reference, evidence_url, notes, recorded_by)
  VALUES (
    p_brief_id, p_channel, btrim(p_recipient), v_when,
    nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_evidence_url, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.sync_authority_brief_status(p_brief_id);
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_record_brief_delivery(uuid, text, text, timestamptz, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_brief_delivery(uuid, text, text, timestamptz, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_void_brief_delivery(p_delivery_id uuid, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_brief uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can void a brief delivery' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for voiding the delivery' USING ERRCODE = '22023';
  END IF;
  UPDATE public.authority_brief_deliveries
     SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   WHERE id = p_delivery_id AND voided_at IS NULL
  RETURNING brief_id INTO v_brief;
  IF v_brief IS NULL THEN
    RAISE EXCEPTION 'Delivery not found or already voided' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.sync_authority_brief_status(v_brief);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_void_brief_delivery(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_brief_delivery(uuid, text) TO authenticated, service_role;

-- ── Public reads ─────────────────────────────────────────────────────────
-- One approved brief by id (the printable page an admin sends). Never a draft.
CREATE OR REPLACE FUNCTION public.get_authority_brief(p_brief_id uuid)
 RETURNS TABLE (
  id uuid,
  question_id uuid,
  region_id uuid,
  question_text text,
  region_name text,
  authority_name text,
  brief_text text,
  approved_at timestamptz,
  ledger_published boolean
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.id, b.question_id, b.region_id, q.question, loc.name, a.name, b.brief_text, b.approved_at,
         EXISTS (SELECT 1 FROM public.expectation_ledgers l
                  WHERE l.question_id = b.question_id AND l.region_id = b.region_id AND l.status = 'published')
  FROM public.authority_briefs b
  JOIN public.questions q ON q.id = b.question_id
  JOIN public.authority_registry a ON a.id = b.authority_id
  LEFT JOIN public.locations loc ON loc.id = b.region_id
  WHERE b.id = p_brief_id
    AND b.status IN ('approved', 'delivered')
    AND nullif(btrim(coalesce(b.brief_text, '')), '') IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.get_authority_brief(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_authority_brief(uuid) TO anon, authenticated, service_role;

-- Deliveries for a published ledger: institution, date, channel only.
CREATE OR REPLACE FUNCTION public.get_brief_deliveries(p_question_id uuid, p_region_id uuid)
 RETURNS TABLE (
  id uuid,
  authority_name text,
  channel text,
  delivered_at timestamptz
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.id, a.name, d.channel, d.delivered_at
  FROM public.authority_brief_deliveries d
  JOIN public.authority_briefs b ON b.id = d.brief_id AND b.status = 'delivered'
  JOIN public.authority_registry a ON a.id = b.authority_id
  JOIN public.expectation_ledgers l
    ON l.question_id = b.question_id AND l.region_id = b.region_id AND l.status = 'published'
  WHERE b.question_id = p_question_id
    AND b.region_id = p_region_id
    AND d.voided_at IS NULL
  ORDER BY d.delivered_at, d.recorded_at
  LIMIT 100;
$function$;
REVOKE ALL ON FUNCTION public.get_brief_deliveries(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_brief_deliveries(uuid, uuid) TO anon, authenticated, service_role;
