-- UAT ONLY: register the two crons Dev runs that neither UAT nor Prod schedules.
-- Promoted from Dev (stance-capture-dev) as part of the Dev -> UAT -> Prod sync, 2026-09-21.

-- DELIBERATELY SCOPED TO UAT. sync_campaign_results calls external ad APIs and
-- ugq_stance_milestones runs every 15 minutes; switching either on in production is a
-- launch decision, not a sync step. Both backing functions
-- (admin.cron_sync_campaign_results, admin.cron_ugq_milestones) already exist in all
-- three environments with identical bodies -- only the schedules are absent.
--
-- This file ships on every branch so the three trees stay identical, so it CANNOT rely
-- on a comment to stay out of production. The guard below keys off the vault PROJECT_URL
-- secret, which embeds the project ref. On Dev, Prod, or any other project this is a
-- no-op. app.settings.project_ref is NULL on these projects, so it is not usable here.

DO $$
DECLARE
  v_is_uat boolean;
BEGIN
  SELECT coalesce(decrypted_secret LIKE '%kodyqyqcuzmygtbzpebt%', false)
  INTO   v_is_uat
  FROM   vault.decrypted_secrets
  WHERE  name = 'PROJECT_URL'
  LIMIT  1;

  IF NOT coalesce(v_is_uat, false) THEN
    RAISE NOTICE 'sync_dev_07: not the UAT project - skipping cron registration';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync_campaign_results') THEN
    PERFORM cron.schedule('sync_campaign_results', '0 6 * * *',
                          'SELECT admin.cron_sync_campaign_results();');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ugq_stance_milestones') THEN
    PERFORM cron.schedule('ugq_stance_milestones', '*/15 * * * *',
                          'SELECT admin.cron_ugq_milestones();');
  END IF;
END
$$;
