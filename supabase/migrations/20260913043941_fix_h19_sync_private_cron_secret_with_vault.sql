-- H-19 (CORRECTED ROOT CAUSE): Dev's cron secret exists in TWO stores that had
-- diverged. The rotation updated Vault and the Edge env var but not
-- private.secrets, and admin.cron_generate_renditions() is the only caller that
-- reads private.get_secret('CRON_SECRET') rather than Vault. It therefore sent a
-- pre-rotation secret and the Edge function rejected it - 401 "Unauthorized",
-- every minute since 2026-09-12 03:18.
--
-- Evidence that Vault (and therefore the Edge env var) is the CORRECT value:
-- posting Vault's cron_secret to enrich-images - which gates purely on
-- x-cron-secret === CRON_SECRET, fail-closed - returns 200, while the same
-- request with a deliberately wrong secret returns 401. So the user's Edge secret
-- was right all along; only this second store was stale.
--
-- Two wrong diagnoses were made before this one, both corrected by measurement:
--   1. "the Edge secret is wrong" - refuted by the enrich-images 200.
--   2. "the stale value is the correct one with a trailing newline" - refuted:
--      its last byte is ASCII 61 ('='), btrim changes nothing, and the trimmed
--      value still does not equal Vault's. They are simply different secrets
--      (43 chars unpadded base64url vs 44 chars padded base64).
--
-- Copies Vault's value across rather than taking a pasted literal, so the secret
-- is never written into a migration, a log, or a transcript.
DO $h19$
DECLARE
  v_vault text;
  v_before text;
  n int;
BEGIN
  SELECT decrypted_secret INTO v_vault FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  IF v_vault IS NULL OR length(v_vault) < 32 THEN
    RAISE EXCEPTION 'vault cron_secret missing or implausibly short (%), refusing', coalesce(length(v_vault), -1);
  END IF;

  SELECT val INTO v_before FROM private.secrets WHERE key = 'CRON_SECRET';
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'private.secrets has no CRON_SECRET row - unexpected, refusing to create one blindly';
  END IF;
  IF v_before = v_vault THEN
    RAISE NOTICE 'already in sync, nothing to do';
    RETURN;
  END IF;

  UPDATE private.secrets SET val = v_vault WHERE key = 'CRON_SECRET';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected to update exactly 1 row, updated %', n;
  END IF;

  -- post-flight: the two stores must now agree
  IF (SELECT val FROM private.secrets WHERE key='CRON_SECRET') IS DISTINCT FROM v_vault THEN
    RAISE EXCEPTION 'post-flight: private.secrets still does not match vault';
  END IF;

  RAISE NOTICE 'private.secrets.CRON_SECRET synced with vault';
END
$h19$;
