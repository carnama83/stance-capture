-- Removes a dead debug function. Verified on Dev immediately before applying:
-- 0 database callers (SQL comments stripped before matching), 0 cron.job callers,
-- 0 view callers, no EXECUTE grant to anon or authenticated. It calls http((
-- unqualified rather than extensions.http((, which is how it evaded two earlier
-- security sweeps. Already dropped from UAT and Prod.
DROP FUNCTION IF EXISTS public.run_create_drafts_http_debug();
