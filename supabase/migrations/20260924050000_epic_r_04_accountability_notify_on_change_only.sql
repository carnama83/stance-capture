-- Epic R — R-04: accountability notifications only on a real status change
--
-- Before: update_authority_response_status() notified every staker on every
-- call. Re-saving an unchanged status (e.g. to edit the internal notes) sent a
-- duplicate "status is now …" notification (measured on Dev: 1 → 2). Every
-- regional notification also linked to /ledger/<q>/<region> even when no
-- ledger was published, so it opened "Ledger not yet published".
--
-- After:
--   * notify only when the status differs from the stored one (a first
--     record counts as a change);
--   * status_updated_at moves only on a real change, so the public "updated"
--     date means what it says; notes/updated_by still save on every call;
--   * link to the ledger only when a PUBLISHED ledger exists for that
--     question/region, otherwise to the question page.
--
-- The whole body is replaced, guarded: it applies only if the target's
-- current body (CR-stripped, whitespace-collapsed) hashes to the known
-- pre-fix version, and is skipped if the fix is already present.

DO $mig$
DECLARE
  v_oid oid := 'public.update_authority_response_status(uuid, uuid, uuid, text, text)'::regprocedure;
  v_src text;
  v_hash text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  IF v_src LIKE '%Epic R R-04%' THEN
    RAISE NOTICE 'update_authority_response_status already has R-04 — skipping';
    RETURN;
  END IF;
  v_hash := md5(regexp_replace(replace(v_src, E'\r', ''), '\s+', ' ', 'g'));
  IF v_hash <> 'a8f10131a67532c97209cddcda6b3f7d' THEN
    RAISE EXCEPTION 'R-04: update_authority_response_status body differs from the known pre-fix version (hash %) — review before replacing', v_hash;
  END IF;

  EXECUTE $def$
CREATE OR REPLACE FUNCTION public.update_authority_response_status(p_question_id uuid, p_authority_id uuid, p_region_id uuid, p_response_status text, p_notes text DEFAULT NULL::text)
 RETURNS authority_responses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_result public.authority_responses;
    v_prev_status text;
    v_question_title text;
    v_status_label text;
    v_notification_body text;
    v_href text;
BEGIN
    IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Only admins can update authority response status';
    END IF;

    -- Epic R R-04: remember the stored status so an unchanged re-save does
    -- not notify stakers again. NULL = no record yet (a first record counts
    -- as a change).
    SELECT ar.response_status INTO v_prev_status
    FROM public.authority_responses ar
    WHERE ar.question_id = p_question_id
      AND ar.authority_id = p_authority_id
      AND ar.region_id IS NOT DISTINCT FROM p_region_id;

    IF p_region_id IS NULL THEN
        INSERT INTO public.authority_responses (
            question_id, authority_id, region_id, response_status, status_updated_at, updated_by, notes
        ) VALUES (
            p_question_id, p_authority_id, NULL, p_response_status, now(), auth.uid(), p_notes
        )
        ON CONFLICT (question_id, authority_id) WHERE region_id IS NULL
        DO UPDATE SET
            response_status = EXCLUDED.response_status,
            status_updated_at = CASE
                WHEN authority_responses.response_status IS DISTINCT FROM EXCLUDED.response_status
                THEN now() ELSE authority_responses.status_updated_at END,
            updated_by = auth.uid(),
            notes = EXCLUDED.notes
        RETURNING * INTO v_result;
    ELSE
        INSERT INTO public.authority_responses (
            question_id, authority_id, region_id, response_status, status_updated_at, updated_by, notes
        ) VALUES (
            p_question_id, p_authority_id, p_region_id, p_response_status, now(), auth.uid(), p_notes
        )
        ON CONFLICT (question_id, authority_id, region_id) WHERE region_id IS NOT NULL
        DO UPDATE SET
            response_status = EXCLUDED.response_status,
            status_updated_at = CASE
                WHEN authority_responses.response_status IS DISTINCT FROM EXCLUDED.response_status
                THEN now() ELSE authority_responses.status_updated_at END,
            updated_by = auth.uid(),
            notes = EXCLUDED.notes
        RETURNING * INTO v_result;
    END IF;

    -- Epic R R-04: an unchanged status is a notes/actor edit, not news.
    IF v_prev_status IS NOT DISTINCT FROM p_response_status THEN
        RETURN v_result;
    END IF;

    -- BR-R08 exact copy shape: "An update is available on [title]: status is
    -- now [Status label]." — status_label capitalises only the first letter
    -- (matches QA-R18's "Action announced", not "Action Announced").
    SELECT question INTO v_question_title FROM public.questions WHERE id = p_question_id;
    v_status_label := replace(p_response_status, '_', ' ');
    v_status_label := upper(left(v_status_label, 1)) || substring(v_status_label from 2);
    v_notification_body := format('An update is available on %s: status is now %s.', v_question_title, v_status_label);

    -- Epic R R-04: link to the ledger only when one is published for this
    -- region; otherwise the question page (never a "not yet published" page).
    IF p_region_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.expectation_ledgers el
        WHERE el.question_id = p_question_id
          AND el.region_id = p_region_id
          AND el.status = 'published'
    ) THEN
        v_href := '/ledger/' || p_question_id || '/' || p_region_id;
    ELSE
        v_href := '/q/' || p_question_id;
    END IF;

    INSERT INTO public.user_notifications (user_id, notification_type, title, body, href, question_id, metadata)
    SELECT DISTINCT
        qe.user_id,
        'accountability_update',
        'Accountability update',
        v_notification_body,
        v_href,
        p_question_id,
        jsonb_build_object('authority_id', p_authority_id, 'response_status', p_response_status)
    FROM public.question_expectations qe
    WHERE qe.question_id = p_question_id
        AND qe.region_id IS NOT DISTINCT FROM p_region_id;

    RETURN v_result;
END;
$function$
$def$;

  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) NOT LIKE '%Epic R R-04%' THEN
    RAISE EXCEPTION 'R-04: replacement did not take';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'R-04: SECURITY DEFINER lost';
  END IF;
END
$mig$;
