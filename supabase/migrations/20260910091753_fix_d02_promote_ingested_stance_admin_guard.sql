-- Epic D QA defect D-02 (P1, security).
--
-- promote_ingested_stance() is SECURITY DEFINER with EXECUTE granted to anon
-- and authenticated, and performed no authorisation check of its own. Section 9
-- of the Epic asserted it "relies on ingested_stances RLS" — but SECURITY
-- DEFINER bypasses exactly that RLS. Verified in Dev: a non-admin authenticated
-- user (is_admin() = false) promoted an accepted ingested stance and created a
-- question_stances row in a DIFFERENT user's account with source='ingested'.
--
-- Fix: authorise inside the function. Allowed callers are
--   * platform admins (public.is_admin() -> admin_users membership), which is
--     how /admin/ingestion-review calls it — as the logged-in admin;
--   * service_role, for any server-side ingestion pipeline;
--   * a direct server-side connection with no PostgREST JWT context
--     (migrations, psql, pg_cron) — PostgREST always sets request.jwt.claims,
--     so anon/authenticated web traffic can never take this branch.
-- Everything else raises 42501. Function body is otherwise unchanged.
create or replace function public.promote_ingested_stance(p_ingested_stance_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_row    public.ingested_stances%ROWTYPE;
  v_claims text := current_setting('request.jwt.claims', true);
  v_role   text;
BEGIN
  -- ── Authorisation guard (D-02) ──────────────────────────────────────────
  v_role := CASE WHEN coalesce(v_claims, '') = '' THEN NULL
                 ELSE (v_claims::jsonb ->> 'role') END;

  IF NOT (
        public.is_admin()
     OR v_role = 'service_role'
     OR (v_role IS NULL AND session_user <> 'authenticator')
  ) THEN
    RAISE EXCEPTION 'Not authorised: admin privileges are required to promote an ingested stance'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.ingested_stances
  WHERE id = p_ingested_stance_id AND status = 'accepted';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Cannot promote an unattributed stance — no user_id to write to
  -- question_stances. Return false without touching status so the row
  -- remains promotable once attribution is resolved. (F-05 fix preserved.)
  IF v_row.attributed_user_id IS NULL THEN
    RAISE NOTICE 'promote_ingested_stance: % has no attributed_user_id — skipping promotion', p_ingested_stance_id;
    RETURN false;
  END IF;

  -- Idempotency guard: already promoted on a previous run — return true
  -- without re-inserting. This path is now rare since the pipeline filters
  -- on promoted_at IS NULL, but guards against direct RPC calls.
  IF v_row.promoted_at IS NOT NULL THEN
    RETURN true;
  END IF;

  -- Conflict guard: do not overwrite an existing native stance
  IF EXISTS (
    SELECT 1 FROM public.question_stances
    WHERE user_id    = v_row.attributed_user_id
      AND question_id = v_row.question_id
  ) THEN
    UPDATE public.ingested_stances
    SET status = 'conflict', reviewed_at = now()
    WHERE id = p_ingested_stance_id;
    RETURN false;
  END IF;

  -- Promote: write to question_stances
  INSERT INTO public.question_stances
    (user_id, question_id, score, source)
  VALUES
    (v_row.attributed_user_id, v_row.question_id,
     v_row.stance_value::smallint, 'ingested')
  ON CONFLICT (user_id, question_id) DO NOTHING;

  -- Stamp promoted_at and update reviewed_at
  UPDATE public.ingested_stances
  SET
    promoted_at  = now(),
    reviewed_at  = now()
  WHERE id = p_ingested_stance_id;

  RETURN true;
END;
$function$;
