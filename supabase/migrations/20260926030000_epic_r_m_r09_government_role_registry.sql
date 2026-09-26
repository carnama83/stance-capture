-- Epic R — M-R09: stable government-role registry (R-FR-18, US-R20, BR-R11, QA-R22)
--
-- A stable layer between the responsible institution (authority_registry) and
-- whoever currently holds an office. The canonical identity is the office /
-- designation (Municipal Commissioner, District Magistrate, Health Secretary),
-- never the person: aggregates, history and URLs will reference
-- government_role_id (M-R10 adds suggestions and user role tags on top).
--
-- 1. government_role_registry — the R-FR-18 columns, plus created_by /
--    updated_by for the R-FR-24 audit rule. valid_from / valid_to bound the
--    current office-holder's tenure. A named holder is allowed only together
--    with a source URL and a verification timestamp (BR-R11).
-- 2. government_role_holder_history — append-only record of previous holders,
--    written only by admin_set_government_role_holder(), so a change of
--    personnel never changes the role id and never loses who held it (QA-R22).
-- 3. Holder fields can be changed only through that function (a trigger
--    rejects direct edits), so the history cannot be bypassed. The same
--    trigger stamps updated_at / updated_by.
-- 4. Admin-only RLS on both tables. The public read path is
--    search_government_roles(): verified roles only, and a holder's name only
--    while the holder is verified, sourced and within their validity dates.
--    region_id follows the Epic R convention of no FK (see expectation_ledgers).

CREATE TABLE IF NOT EXISTS public.government_role_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name text NOT NULL CHECK (length(btrim(role_name)) BETWEEN 2 AND 200),
  authority_id uuid NOT NULL REFERENCES public.authority_registry(id) ON DELETE RESTRICT,
  government_level text NOT NULL CHECK (government_level IN ('local', 'state', 'national', 'international')),
  region_id uuid,
  domain text NOT NULL CHECK (domain IN ('water', 'health', 'policing', 'transport', 'environment', 'education', 'other')),
  role_type text NOT NULL DEFAULT 'administrative'
    CHECK (role_type IN ('elected', 'appointed', 'administrative', 'judicial', 'law_enforcement', 'other')),
  parent_role_id uuid REFERENCES public.government_role_registry(id) ON DELETE SET NULL,
  current_office_holder_name text,
  office_holder_source_url text,
  office_holder_verified_at timestamptz,
  office_holder_verified_by uuid,
  valid_from date,
  valid_to date,
  verification_status text NOT NULL DEFAULT 'suggested'
    CHECK (verification_status IN ('suggested', 'verified', 'stale', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid,
  CONSTRAINT government_role_not_own_parent CHECK (parent_role_id IS NULL OR parent_role_id <> id),
  CONSTRAINT government_role_holder_needs_source CHECK (
    current_office_holder_name IS NULL
    OR (office_holder_source_url ~* '^https?://' AND office_holder_verified_at IS NOT NULL)),
  CONSTRAINT government_role_holder_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS government_role_registry_unique_role
  ON public.government_role_registry (authority_id, lower(btrim(role_name)), coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS government_role_registry_region_idx ON public.government_role_registry (region_id);
CREATE INDEX IF NOT EXISTS government_role_registry_status_idx ON public.government_role_registry (verification_status);

CREATE TABLE IF NOT EXISTS public.government_role_holder_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  government_role_id uuid NOT NULL REFERENCES public.government_role_registry(id) ON DELETE CASCADE,
  office_holder_name text NOT NULL,
  source_url text,
  verified_at timestamptz,
  verified_by uuid,
  valid_from date,
  valid_to date,
  ended_at timestamptz NOT NULL DEFAULT now(),
  ended_by uuid,
  end_reason text NOT NULL CHECK (end_reason IN ('replaced', 'cleared', 'corrected'))
);
CREATE INDEX IF NOT EXISTS government_role_holder_history_role_idx
  ON public.government_role_holder_history (government_role_id, ended_at DESC);

-- ── Trigger: audit stamps + holder fields only via the RPC ──────────────────
CREATE OR REPLACE FUNCTION public.government_role_registry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('app.government_role_holder_rpc', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.current_office_holder_name IS NOT NULL OR NEW.office_holder_verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Set an office-holder with admin_set_government_role_holder(), not on insert'
          USING ERRCODE = 'P0001';
      END IF;
    ELSIF (NEW.current_office_holder_name, NEW.office_holder_source_url, NEW.office_holder_verified_at,
           NEW.office_holder_verified_by, NEW.valid_from, NEW.valid_to)
          IS DISTINCT FROM
          (OLD.current_office_holder_name, OLD.office_holder_source_url, OLD.office_holder_verified_at,
           OLD.office_holder_verified_by, OLD.valid_from, OLD.valid_to) THEN
      RAISE EXCEPTION 'Office-holder fields change only through admin_set_government_role_holder() (keeps the holder history)'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS government_role_registry_guard ON public.government_role_registry;
CREATE TRIGGER government_role_registry_guard
  BEFORE INSERT OR UPDATE ON public.government_role_registry
  FOR EACH ROW EXECUTE FUNCTION public.government_role_registry_guard();

-- ── RLS: admin-only tables ─────────────────────────────────────────────────
ALTER TABLE public.government_role_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.government_role_holder_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS government_role_registry_admin_all ON public.government_role_registry;
CREATE POLICY government_role_registry_admin_all ON public.government_role_registry
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS government_role_holder_history_admin_read ON public.government_role_holder_history;
CREATE POLICY government_role_holder_history_admin_read ON public.government_role_holder_history
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

REVOKE ALL ON public.government_role_registry FROM anon;
REVOKE ALL ON public.government_role_holder_history FROM anon;
-- History is append-only: no client role may write it; only the definer RPC does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.government_role_holder_history FROM authenticated;

-- ── Admin RPC: set, replace, correct or clear the office-holder ────────────
-- p_reason: 'replaced' (a new person took the office), 'corrected' (the stored
-- name was wrong) or, with a NULL name, the holder is cleared. Re-verifying the
-- same person refreshes the source and timestamp without a history row.
CREATE OR REPLACE FUNCTION public.admin_set_government_role_holder(
  p_role_id uuid,
  p_holder_name text,
  p_source_url text DEFAULT NULL,
  p_valid_from date DEFAULT NULL,
  p_valid_to date DEFAULT NULL,
  p_reason text DEFAULT 'replaced'
)
 RETURNS public.government_role_registry
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role public.government_role_registry;
  v_name text := nullif(btrim(coalesce(p_holder_name, '')), '');
  v_url text := nullif(btrim(coalesce(p_source_url, '')), '');
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can set a government office-holder' USING ERRCODE = '42501';
  END IF;
  IF p_reason NOT IN ('replaced', 'corrected') THEN
    RAISE EXCEPTION 'p_reason must be replaced or corrected' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NOT NULL AND (v_url IS NULL OR v_url !~* '^https?://') THEN
    RAISE EXCEPTION 'A named office-holder needs an official source URL (BR-R11)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_role FROM public.government_role_registry WHERE id = p_role_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Government role % not found', p_role_id USING ERRCODE = 'P0002';
  END IF;

  -- The outgoing holder goes to history unless the same person is re-verified.
  IF v_role.current_office_holder_name IS NOT NULL
     AND (v_name IS NULL OR lower(v_name) <> lower(v_role.current_office_holder_name)) THEN
    INSERT INTO public.government_role_holder_history (
      government_role_id, office_holder_name, source_url, verified_at, verified_by,
      valid_from, valid_to, ended_by, end_reason)
    VALUES (
      v_role.id, v_role.current_office_holder_name, v_role.office_holder_source_url,
      v_role.office_holder_verified_at, v_role.office_holder_verified_by,
      v_role.valid_from,
      CASE WHEN p_reason = 'replaced' AND v_role.valid_to IS NULL
           THEN coalesce(p_valid_from, current_date) ELSE v_role.valid_to END,
      auth.uid(),
      CASE WHEN v_name IS NULL THEN 'cleared' ELSE p_reason END);
  END IF;

  PERFORM set_config('app.government_role_holder_rpc', 'on', true);
  UPDATE public.government_role_registry SET
    current_office_holder_name = v_name,
    office_holder_source_url   = CASE WHEN v_name IS NULL THEN NULL ELSE v_url END,
    office_holder_verified_at  = CASE WHEN v_name IS NULL THEN NULL ELSE now() END,
    office_holder_verified_by  = CASE WHEN v_name IS NULL THEN NULL ELSE auth.uid() END,
    valid_from                 = CASE WHEN v_name IS NULL THEN NULL ELSE p_valid_from END,
    valid_to                   = CASE WHEN v_name IS NULL THEN NULL ELSE p_valid_to END
  WHERE id = p_role_id
  RETURNING * INTO v_role;
  PERFORM set_config('app.government_role_holder_rpc', 'off', true);

  RETURN v_role;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_government_role_holder(uuid, text, text, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_government_role_holder(uuid, text, text, date, date, text) TO authenticated, service_role;

-- ── Public read path: verified roles only ─────────────────────────────────
-- A holder's name is returned only while it is verified, sourced and within its
-- validity dates (BR-R11); otherwise the role is shown on its own.
CREATE OR REPLACE FUNCTION public.search_government_roles(
  p_query text DEFAULT NULL,
  p_region_id uuid DEFAULT NULL,
  p_authority_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
)
 RETURNS TABLE (
  id uuid,
  role_name text,
  authority_id uuid,
  authority_name text,
  government_level text,
  region_id uuid,
  domain text,
  role_type text,
  parent_role_id uuid,
  current_office_holder_name text,
  office_holder_verified_at timestamptz
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.role_name, r.authority_id, a.name, r.government_level, r.region_id,
         r.domain, r.role_type, r.parent_role_id,
         CASE WHEN r.current_office_holder_name IS NOT NULL
                   AND r.office_holder_verified_at IS NOT NULL
                   AND r.office_holder_source_url IS NOT NULL
                   AND (r.valid_from IS NULL OR r.valid_from <= current_date)
                   AND (r.valid_to IS NULL OR r.valid_to >= current_date)
              THEN r.current_office_holder_name END,
         CASE WHEN r.current_office_holder_name IS NOT NULL
                   AND r.office_holder_source_url IS NOT NULL
                   AND (r.valid_from IS NULL OR r.valid_from <= current_date)
                   AND (r.valid_to IS NULL OR r.valid_to >= current_date)
              THEN r.office_holder_verified_at END
  FROM public.government_role_registry r
  JOIN public.authority_registry a ON a.id = r.authority_id
  WHERE r.verification_status = 'verified'
    AND (p_region_id IS NULL OR r.region_id = p_region_id)
    AND (p_authority_id IS NULL OR r.authority_id = p_authority_id)
    AND (nullif(btrim(coalesce(p_query, '')), '') IS NULL
         OR r.role_name ILIKE '%' || btrim(p_query) || '%'
         OR a.name ILIKE '%' || btrim(p_query) || '%')
  ORDER BY r.role_name
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.search_government_roles(text, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_government_roles(text, uuid, uuid, integer) TO anon, authenticated, service_role;
