-- PR 0.2 — the three staged-commit paths record provenance instead of throwing.
--
-- All three INSERT INTO public.question_stances without rendition_id. That
-- column is NOT NULL with no default, and every one of the seven triggers on
-- question_stances is AFTER, so nothing populates it. Each of these raises
-- 23502 on a first commit.
--
-- Two properties of the current failure worth keeping in mind:
--
--   * Stuck, not lost. The exception fires inside an unhandled FOR loop, so the
--     function aborts and the whole transaction rolls back. committed stays
--     false and the staged row survives, so nothing is destroyed -- but the
--     abort also rolls back rows earlier in the same batch that WOULD have
--     committed via the UPDATE branch. One unprovenanced row poisons the batch.
--
--   * Only first commits fail. The UPDATE branch never touches rendition_id,
--     so re-commits already succeed.
--
-- This migration does two things: threads r.rendition_id into the INSERT, and
-- converts the batch-killing abort into a per-row skip. A staged row with no
-- rendition is left uncommitted with a WARNING (Supabase logs, alertable) and
-- replays unchanged once PR 2a.2 makes staging capture renditions.
--
-- The re-commit branch deliberately does NOT update rendition_id. The existing
-- row already carries real provenance for that respondent; overwriting it with
-- a staged value that may be NULL, or captured from a different display, would
-- be the same fabrication this PR exists to remove.
--
-- Signatures are reproduced exactly so CREATE OR REPLACE replaces rather than
-- creating a second overload.

-- ── 1 of 3 ──────────────────────────────────────────────────────────────────
create or replace function public.commit_staged_stance(
  p_ref        text,
  p_user_id    uuid default null,
  p_phone_hash text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM public.question_stances_pending
     WHERE forward_chain_id = p_ref AND committed = false
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.question_stances qs
       WHERE qs.forward_chain_id = r.forward_chain_id AND qs.question_id = r.question_id
    ) THEN
      -- A first commit creates a new measurement, so it must carry the wording
      -- the respondent actually answered. No rendition means no honest answer
      -- to that question: skip, leave pending, replay later.
      IF r.rendition_id IS NULL THEN
        RAISE WARNING 'commit_staged_stance: pending row % (question %) has no rendition_id; left uncommitted',
          r.id, r.question_id;
        CONTINUE;
      END IF;

      INSERT INTO public.question_stances
        (question_id, score, source, forward_chain_id, user_id, whatsapp_phone_hash, rendition_id)
      VALUES
        (r.question_id, r.score, r.source, r.forward_chain_id, p_user_id, p_phone_hash, r.rendition_id);
    ELSE
      -- Re-commit: identity and score only. rendition_id is left alone on purpose.
      UPDATE public.question_stances qs
         SET user_id             = coalesce(p_user_id, qs.user_id),
             whatsapp_phone_hash = coalesce(p_phone_hash, qs.whatsapp_phone_hash),
             score               = r.score,
             updated_at          = now()
       WHERE qs.forward_chain_id = r.forward_chain_id AND qs.question_id = r.question_id;
    END IF;

    -- Mark staged row committed (kept for funnel analysis).
    UPDATE public.question_stances_pending
       SET committed = true, committed_at = now()
     WHERE id = r.id;
  END LOOP;
END;
$function$;

-- ── 2 of 3 ──────────────────────────────────────────────────────────────────
create or replace function public.commit_staged_stances_for_device(
  p_device_id  text,
  p_phone_hash text)
returns table(question_id uuid, score smallint)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  r record;
BEGIN
  IF p_device_id IS NULL OR p_phone_hash IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT qsp.*
    FROM public.question_stances_pending qsp
    JOIN public.whatsapp_forward_chains wfc ON wfc.id = qsp.forward_chain_id
    WHERE wfc.responder_device_id = p_device_id
      AND qsp.committed = false
  LOOP
    -- NOTE: qs.question_id must stay qualified below -- the RETURNS TABLE output
    -- parameter is also named question_id, so a bare reference is ambiguous
    -- (error 42702) between the table column and the PL/pgSQL OUT parameter.
    IF NOT EXISTS (
      SELECT 1 FROM public.question_stances qs
      WHERE qs.forward_chain_id = r.forward_chain_id AND qs.question_id = r.question_id
    ) THEN
      IF r.rendition_id IS NULL THEN
        RAISE WARNING 'commit_staged_stances_for_device: pending row % (question %) has no rendition_id; left uncommitted',
          r.id, r.question_id;
        CONTINUE;
      END IF;

      INSERT INTO public.question_stances
        (question_id, score, source, forward_chain_id, user_id, whatsapp_phone_hash, rendition_id)
      VALUES
        (r.question_id, r.score, r.source, r.forward_chain_id, NULL, p_phone_hash, r.rendition_id);
    ELSE
      UPDATE public.question_stances qs
         SET whatsapp_phone_hash = coalesce(p_phone_hash, qs.whatsapp_phone_hash),
             score               = r.score,
             updated_at          = now()
       WHERE qs.forward_chain_id = r.forward_chain_id AND qs.question_id = r.question_id;
    END IF;

    UPDATE public.question_stances_pending
       SET committed = true, committed_at = now()
     WHERE id = r.id;

    question_id := r.question_id;
    score := r.score;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ── 3 of 3 ──────────────────────────────────────────────────────────────────
create or replace function public.commit_staged_stances_for_device_by_user(
  p_device_id text,
  p_user_id   uuid)
returns table(question_id uuid, score smallint)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  r record;
BEGIN
  IF p_device_id IS NULL OR p_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Unlike attach_user_to_node/commit_staged_stance (which trust p_user_id as
  -- given, with no ownership check), this checks the caller actually IS who
  -- they're claiming to commit stances for. Called from client-side code
  -- (OAuthCallbackPage.tsx, using the user's own fresh session), so this is a
  -- real check, not decorative.
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  FOR r IN
    SELECT qsp.*
    FROM public.question_stances_pending qsp
    JOIN public.whatsapp_forward_chains wfc ON wfc.id = qsp.forward_chain_id
    WHERE wfc.responder_device_id = p_device_id
      AND qsp.committed = false
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.question_stances qs
      WHERE qs.forward_chain_id = r.forward_chain_id AND qs.question_id = r.question_id
    ) THEN
      -- Skipping leaves the forward-chain identity update below untouched too.
      -- That is intentional: chain attribution and the stance commit should
      -- land together, and both replay when the row is retried.
      IF r.rendition_id IS NULL THEN
        RAISE WARNING 'commit_staged_stances_for_device_by_user: pending row % (question %) has no rendition_id; left uncommitted',
          r.id, r.question_id;
        CONTINUE;
      END IF;

      INSERT INTO public.question_stances
        (question_id, score, source, forward_chain_id, user_id, whatsapp_phone_hash, rendition_id)
      VALUES
        (r.question_id, r.score, r.source, r.forward_chain_id, p_user_id, NULL, r.rendition_id);
    ELSE
      UPDATE public.question_stances qs
         SET user_id    = coalesce(p_user_id, qs.user_id),
             score      = r.score,
             updated_at = now()
       WHERE qs.forward_chain_id = r.forward_chain_id AND qs.question_id = r.question_id;
    END IF;

    UPDATE public.question_stances_pending
       SET committed = true, committed_at = now()
     WHERE id = r.id;

    -- Keep whatsapp_forward_chains.responder_user_id consistent with what
    -- attach_user_to_node already sets for the single-ref path.
    UPDATE public.whatsapp_forward_chains
       SET responder_user_id = p_user_id
     WHERE id = r.forward_chain_id;

    question_id := r.question_id;
    score := r.score;
    RETURN NEXT;
  END LOOP;
END;
$function$;

notify pgrst, 'reload schema';
