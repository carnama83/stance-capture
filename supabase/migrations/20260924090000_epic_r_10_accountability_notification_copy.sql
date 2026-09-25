-- Epic R — R-10 (server half): short, translatable accountability notifications
--
-- Before: update_authority_response_status() wrote the FULL question text
-- (often 200–325 characters) into "An update is available on [title]: …", and
-- the only copy was that English sentence, so the notification could not be
-- shown in the reader's language.
--
-- After:
--   * [title] is the question's short share_headline, or the question cut to
--     120 characters when there is no headline;
--   * metadata also carries question_title and region_id, so the client can
--     render the notification from its own translated template (English and
--     Hindi) — the stored English title/body stay as the fallback.
--
-- Patched in place on top of R-04 (guarded: each target must match exactly
-- once, SECURITY DEFINER and search_path are re-emitted, and it is skipped if
-- R-10 is already present). Requires the R-04 body.

DO $mig$
DECLARE
  v_oid oid := 'public.update_authority_response_status(uuid, uuid, uuid, text, text)'::regprocedure;
  v_src text;
  v_new text;
  v_old_title text := 'SELECT question INTO v_question_title FROM public.questions WHERE id = p_question_id;';
  v_new_title text := '-- Epic R R-10: a short title — the share headline, else the question cut to 120 characters.
    SELECT coalesce(nullif(btrim(share_headline), ''''),
                    CASE WHEN length(question) > 120 THEN left(question, 117) || ''…'' ELSE question END)
    INTO v_question_title FROM public.questions WHERE id = p_question_id;';
  v_old_meta text := 'jsonb_build_object(''authority_id'', p_authority_id, ''response_status'', p_response_status)';
  v_new_meta text := 'jsonb_build_object(''authority_id'', p_authority_id, ''response_status'', p_response_status,
                           ''question_title'', v_question_title, ''region_id'', p_region_id)';
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  IF v_src LIKE '%Epic R R-10%' THEN
    RAISE NOTICE 'update_authority_response_status already has R-10 — skipping';
    RETURN;
  END IF;
  IF v_src NOT LIKE '%Epic R R-04%' THEN
    RAISE EXCEPTION 'R-10: apply the R-04 migration (20260924050000) first';
  END IF;
  IF (length(v_src) - length(replace(v_src, v_old_title, ''))) / length(v_old_title) <> 1 THEN
    RAISE EXCEPTION 'R-10: title statement not found exactly once';
  END IF;
  IF (length(v_src) - length(replace(v_src, v_old_meta, ''))) / length(v_old_meta) <> 1 THEN
    RAISE EXCEPTION 'R-10: metadata expression not found exactly once';
  END IF;

  v_new := replace(replace(v_src, v_old_title, v_new_title), v_old_meta, v_new_meta);

  EXECUTE format($f$CREATE OR REPLACE FUNCTION public.update_authority_response_status(p_question_id uuid, p_authority_id uuid, p_region_id uuid, p_response_status text, p_notes text DEFAULT NULL::text)
 RETURNS authority_responses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS %L$f$, v_new);

  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) NOT LIKE '%Epic R R-10%' THEN
    RAISE EXCEPTION 'R-10: patch did not take';
  END IF;
END
$mig$;
