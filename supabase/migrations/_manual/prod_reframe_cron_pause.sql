-- Prod-only, applied manually 2 Oct 2026 (UTC). NOT a migration — do not run on Dev/UAT.
--
-- Why: the shared Anthropic API key (same key on Dev, UAT and Prod) ran out of
-- credits at 04:13 UTC on 1 Oct 2026, right after a manual news-pipeline run on
-- Prod created 66 question_drafts. 50 of them are still status='draft'. The
-- hourly reframe job (job 21) would send all of them to Claude as soon as the
-- balance is topped up. Paused at the owner's request so the top-up isn't spent
-- on that backlog automatically.
--
-- Effect: nothing reframes news drafts on Prod until the job is resumed. User
-- questions (UGQ), translations and every other cron job are unaffected.

select cron.alter_job(job_id := jobid, active := false)
from cron.job where jobname = 'epicqf_reframe_hourly';

-- To resume (only once the owner decides what to do with the draft backlog):
-- select cron.alter_job(job_id := jobid, active := true)
-- from cron.job where jobname = 'epicqf_reframe_hourly';
