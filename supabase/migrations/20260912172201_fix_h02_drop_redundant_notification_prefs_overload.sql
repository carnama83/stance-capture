-- H-02 (P3): public.upsert_my_notification_preferences() existed in two overloads,
-- a 6-argument and a 13-argument form, with EVERY argument defaulted on BOTH. Any call
-- supplying fewer than 7 arguments therefore matched both candidates and failed outright:
--   function public.upsert_my_notification_preferences(p_weekly_digest_enabled => boolean) is not unique
-- Verified on this environment. Exactly the same defect shape as Epic G's G-03 on
-- list_comment_reports, which had three all-defaulted overloads.
--
-- The live path was unaffected: src/hooks/useNotificationPreferences.ts sends all 13
-- named arguments, which resolves uniquely to the 13-arg form. So this was latent - but
-- it makes the function uncallable for any partial update, which is the natural way to
-- use a preferences upsert, and the 6-arg form was unreachable dead code.
--
-- Confirmed before dropping: the 6-arg overload has no database callers (no function,
-- view or matview references it) and `src/` has exactly one call site, the 13-arg one.
-- The 13-arg form is a strict superset of the 6-arg parameter list, so nothing is lost.

DO $mig$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'upsert_my_notification_preferences';

  IF v_n <> 2 THEN
    RAISE EXCEPTION 'H-02: expected exactly 2 overloads, found % - refusing', v_n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='upsert_my_notification_preferences' AND p.pronargs = 13
  ) THEN
    RAISE EXCEPTION 'H-02: the 13-arg overload the frontend calls is missing - refusing to drop anything';
  END IF;
END
$mig$;

DROP FUNCTION IF EXISTS public.upsert_my_notification_preferences(boolean,boolean,boolean,integer,integer,text);

DO $mig$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'upsert_my_notification_preferences';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'H-02: expected 1 overload after the drop, found %', v_n;
  END IF;
END
$mig$;
