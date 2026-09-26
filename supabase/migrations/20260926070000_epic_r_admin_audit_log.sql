-- Epic R — admin audit log (R-FR-24, M-R12, §security: "Every admin mutation
-- records actor and timestamp")
--
-- Until now only updated_by / published_by / approved_by columns recorded who
-- changed an Epic R admin surface, and only the latest change. This adds one
-- append-only log of every insert, update and delete on those surfaces.
--
-- 1. epic_r_audit_log: occurred_at, actor (auth.uid()), actor_kind (admin /
--    service / user / system), table_name, row_key, action, and changes —
--    for an UPDATE only the columns that changed ({col: {old, new}}), for an
--    INSERT the new row, for a DELETE the old row. Admin-only read; no client
--    writes; rows cannot be updated or deleted (only a DB-owner maintenance
--    session may delete, as for M-R11).
-- 2. epic_r_audit_capture(): one AFTER trigger function, attached to each
--    admin surface with two arguments — the key columns, and columns to ignore
--    in diffs (system bookkeeping such as updated_at). An UPDATE that changes
--    nothing but ignored columns is not logged.
-- 3. Surfaces: authority_registry, question_authority_map,
--    government_role_registry, question_role_suggestions,
--    pending_authority_suggestions, expectation_ledgers (current_version
--    ignored), authority_responses, authority_briefs, and questions — only when
--    content_type changes. Not logged again: tables that are already an
--    immutable record (expectation_ledger_versions, authority_response_events,
--    government_role_holder_history) and user-owned rows (expectations, tags).
-- 4. admin_get_audit_log(): admin-only read with actor e-mail, filterable by
--    table and action, newest first, paged by id (rows written in one
--    transaction share occurred_at, so a timestamp cursor could skip some).

CREATE TABLE IF NOT EXISTS public.epic_r_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin', 'service', 'user', 'system')),
  table_name text NOT NULL,
  row_key jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changes jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS epic_r_audit_log_time_idx ON public.epic_r_audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS epic_r_audit_log_table_idx ON public.epic_r_audit_log (table_name, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.epic_r_audit_log_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.epic_r_maintenance', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The Epic R audit log is append-only' USING ERRCODE = 'P0001';
END;
$function$;

DROP TRIGGER IF EXISTS epic_r_audit_log_immutable ON public.epic_r_audit_log;
CREATE TRIGGER epic_r_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.epic_r_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.epic_r_audit_log_immutable();

ALTER TABLE public.epic_r_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS epic_r_audit_log_admin_read ON public.epic_r_audit_log;
CREATE POLICY epic_r_audit_log_admin_read ON public.epic_r_audit_log
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.epic_r_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.epic_r_audit_log FROM authenticated;

-- TG_ARGV[0]: key columns (comma-separated); TG_ARGV[1]: columns ignored in
-- diffs; TG_ARGV[2] (optional): record only these columns.
CREATE OR REPLACE FUNCTION public.epic_r_audit_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_keys text[] := string_to_array(coalesce(TG_ARGV[0], 'id'), ',');
  v_ignore text[] := coalesce(string_to_array(nullif(TG_ARGV[1], ''), ','), '{}') || ARRAY['updated_at'];
  v_only text[] := string_to_array(nullif(coalesce(TG_ARGV[2], ''), ''), ',');
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_row jsonb := coalesce(v_new, v_old);
  v_key jsonb := '{}'::jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_col text;
  v_uid uuid := auth.uid();
  v_kind text;
BEGIN
  FOREACH v_col IN ARRAY v_keys LOOP
    v_key := v_key || jsonb_build_object(v_col, v_row -> v_col);
  END LOOP;

  IF v_only IS NOT NULL THEN
    SELECT jsonb_object_agg(k, v) INTO v_new FROM jsonb_each(v_new) AS e(k, v) WHERE k = ANY (v_only);
    SELECT jsonb_object_agg(k, v) INTO v_old FROM jsonb_each(v_old) AS e(k, v) WHERE k = ANY (v_only);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR v_col IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_col <> ALL (v_ignore) AND (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col) THEN
        v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_object('old', v_old -> v_col, 'new', v_new -> v_col));
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_changes := v_new;
  ELSE
    v_changes := v_old;
  END IF;

  v_kind := CASE
    WHEN v_uid IS NOT NULL AND public.is_admin(v_uid) THEN 'admin'
    WHEN v_uid IS NOT NULL THEN 'user'
    WHEN coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' THEN 'service'
    ELSE 'system' END;

  INSERT INTO public.epic_r_audit_log (actor, actor_kind, table_name, row_key, action, changes)
  VALUES (v_uid, v_kind, TG_TABLE_NAME, v_key, TG_OP, v_changes);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.epic_r_audit_capture() FROM PUBLIC, anon, authenticated;

-- Attach to each surface: (key columns, ignored columns).
DO $att$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('authority_registry', 'id', ''),
    ('question_authority_map', 'question_id,authority_id', ''),
    ('government_role_registry', 'id', 'updated_by'),
    ('question_role_suggestions', 'id', ''),
    ('pending_authority_suggestions', 'id', ''),
    ('expectation_ledgers', 'question_id,region_id', 'current_version'),
    ('authority_responses', 'id', ''),
    ('authority_briefs', 'id', '')
  ) AS t(tbl, keys, ign)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      RAISE EXCEPTION 'audit: table % not found', r.tbl;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS epic_r_audit ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER epic_r_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.epic_r_audit_capture(%L, %L)',
      r.tbl, r.keys, r.ign);
  END LOOP;
END
$att$;

-- questions: only the Epic R column (content_type), and only when it changes.
-- The diff is limited to content_type so unrelated columns written in the same
-- statement (counters, timestamps) are not copied into the log.
DROP TRIGGER IF EXISTS epic_r_audit_content_type ON public.questions;
CREATE TRIGGER epic_r_audit_content_type
  AFTER UPDATE OF content_type ON public.questions
  FOR EACH ROW
  WHEN (OLD.content_type IS DISTINCT FROM NEW.content_type)
  EXECUTE FUNCTION public.epic_r_audit_capture('id', '', 'content_type');

-- ── Admin read ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_audit_log(
  p_table text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_before_id bigint DEFAULT NULL,
  p_limit integer DEFAULT 100
)
 RETURNS TABLE (
  id bigint,
  occurred_at timestamptz,
  actor uuid,
  actor_email text,
  actor_kind text,
  table_name text,
  row_key jsonb,
  action text,
  changes jsonb
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can read the audit log' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.id, l.occurred_at, l.actor, u.email::text, l.actor_kind, l.table_name, l.row_key, l.action, l.changes
  FROM public.epic_r_audit_log l
  LEFT JOIN auth.users u ON u.id = l.actor
  WHERE (p_table IS NULL OR l.table_name = p_table)
    AND (p_action IS NULL OR l.action = p_action)
    AND (p_before_id IS NULL OR l.id < p_before_id)
  ORDER BY l.id DESC
  LIMIT least(greatest(coalesce(p_limit, 100), 1), 500);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_get_audit_log(text, text, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_audit_log(text, text, bigint, integer) TO authenticated, service_role;
