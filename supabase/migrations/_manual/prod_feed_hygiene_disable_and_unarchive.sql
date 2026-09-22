-- =============================================================================================
-- PROD-ONLY operational change, 21-22 Sep 2026.  NOT A MIGRATION.  Safe to re-run.
--
--   supabase db execute --project-ref yzxzpnomcarnxixhjlba --file supabase/migrations/_manual/prod_feed_hygiene_disable_and_unarchive.sql
--
-- WHY THIS IS NOT A MIGRATION. Everything here is deliberately Prod-specific. A shared
-- migration would disable feed hygiene on Dev and UAT too, where it should keep running, and
-- would un-archive question ids that do not exist outside Prod. That is exactly the kind of
-- environment-specific state the _manual folder exists for (see epic_i_prod_execution_test.sql).
-- This file is the written record of a change ALREADY APPLIED by hand; re-running it simply
-- re-asserts the same state.
--
-- WHAT HAPPENED. Prod's homepage was blank for everyone. Root cause was content state, not code:
--
--   1. Prod has only ever had 2 questions (published 2026-08-15 and 2026-09-09).
--   2. cron job 18 `feed-hygiene-6h` (SELECT public.apply_feed_hygiene(false), every 6h) was
--      ACTIVE and archives any question with no activity after 7 days. It had run 479 times,
--      all succeeded. It archived both questions, on 2026-09-10 and 2026-09-19.
--   3. Every content-PRODUCING cron on Prod is inactive - epicb_ingest_hourly,
--      epicb_cluster_hourly, epicb_generate_hourly, ingest_hourly,
--      run-ingestion-pipeline-every-15m - matching the documented pre-launch posture
--      (real news sources disabled, 0 pipeline runs).
--
-- So consumption ran while production did not, inventory drained to zero, and it could not
-- self-heal: apply_feed_hygiene's restore path ('Feed hygiene: restored - question is now
-- trending') needs traffic that a blank homepage cannot generate.
--
-- TWO CODE BUGS WERE FIXED SEPARATELY and are NOT part of this file - both are real migrations
-- applied to all three environments:
--   20260922030000  the anon feed's country branch matched an exact country string only, so
--                   Global-audience questions were invisible to signed-out readers.
--   20260922040000  five authed feed RPCs read public.questions directly and ignored
--                   question_visibility_rules, so they served archived questions to signed-in
--                   users while the anon feed correctly hid them.
--
-- VERIFY BEFORE ASSUMING THIS FILE IS STILL ACCURATE. If the ingestion pipelines are ever
-- switched back on, RE-ENABLE feed hygiene (reversal below) - leaving it off indefinitely lets
-- dead questions accumulate in the feed forever, which is the problem it was built to solve.
--
-- REVERSAL
--   Re-enable the hygiene cron:
--     select cron.alter_job(job_id := 18, active := true);
--   Re-archive the two questions (only meaningful with hygiene off):
--     update public.question_visibility_rules
--        set visibility = 'archived'
--      where question_id in ('abd88819-0f54-4270-8376-2ffb01a34640',
--                            'de370c5b-824b-4b8d-b66a-d4ae10907261');
-- =============================================================================================

-- ── 1. Stop the automated archiving ──────────────────────────────────────────────────────────
-- alter_job rather than cron.unschedule: the job DEFINITION is retained, so re-enabling is a
-- one-call reversal. This also matches how Prod's other switched-off jobs are held (active =
-- false, still listed in cron.job).
--
-- Checked at the time: apply_feed_hygiene, ensure_question_visibility, set_question_visibility
-- and update_visibility_rules are the only writers of question_visibility_rules, none is a
-- trigger, and the only other active cron in that family - lifecycle-reactivation-engine
-- (*/15, update_all_question_states()) - calls none of them. Job 18 was the sole automated
-- writer, so disabling it genuinely stops auto-archiving rather than just slowing it down.
do $disable_hygiene$
declare
  v_jobid integer;
begin
  select jobid into v_jobid from cron.job where jobname = 'feed-hygiene-6h';

  if v_jobid is null then
    raise notice 'feed-hygiene-6h not present - nothing to disable';
  else
    perform cron.alter_job(job_id := v_jobid, active := false);
    raise notice 'feed-hygiene-6h (jobid %) set active = false', v_jobid;
  end if;
end
$disable_hygiene$;

-- ── 2. Restore the two questions feed hygiene had retired ────────────────────────────────────
-- PINNED TO THE TWO EXPLICIT IDS, deliberately. The original hand-run used
-- `where visibility <> 'visible'`, which was correct at the time because those were the only
-- two rows. As a re-runnable script that predicate would be actively dangerous: it would
-- un-archive every question archived for any reason at any point in the future. Naming the ids
-- keeps a re-run idempotent and incapable of surprising anyone.
--
-- Both were confirmed to resolve wording before restoring - published_renditions >= 1 and
-- wording_for(id,'en') returns a row - otherwise they would have been un-archived and still
-- not rendered, which looks identical to the fault being unfixed.
--
-- The reason string is rewritten too. Left alone it still read 'Feed hygiene: no activity after
-- 7 days (auto)', which would credit the hygiene job with a state a human chose.
update public.question_visibility_rules
   set visibility        = 'visible',
       reason            = 'Manually restored 21 Sep 2026: archived by feed hygiene while the ingestion pipelines were off, leaving Prod with no visible questions. feed-hygiene-6h (jobid 18) disabled on Prod at the same time.',
       last_evaluated_at = now()
 where question_id in ('abd88819-0f54-4270-8376-2ffb01a34640',
                       'de370c5b-824b-4b8d-b66a-d4ae10907261')
   and visibility is distinct from 'visible';

-- ── 3. Report the resulting state ────────────────────────────────────────────────────────────
-- Read-only. Expected on Prod as of 22 Sep 2026: hygiene_active = f, non_visible_rules = 0,
-- v_live_questions = 2, anon_us_tab = 1, anon_india_tab = 1, anon_global_tab = 2.
-- anon_us_tab is 1 and not 2 because the other question's audience is India and Prod currently
-- has no Global-audience question - that is the region rule working, not a regression.
do $report$
declare
  v_hygiene   boolean;
  v_nonvis    integer;
  v_live      integer;
  v_us        integer;
  v_india     integer;
  v_global    integer;
begin
  select active into v_hygiene from cron.job where jobname = 'feed-hygiene-6h';
  select count(*) into v_nonvis from public.question_visibility_rules where visibility <> 'visible';
  select count(*) into v_live   from public.v_live_questions;
  select count(*) into v_us     from public.get_live_questions_localized('en', 50, 0, 'United States', null);
  select count(*) into v_india  from public.get_live_questions_localized('en', 50, 0, 'India', null);
  select count(*) into v_global from public.get_live_questions_localized('en', 50, 0, 'Global', null);

  raise notice 'feed-hygiene-6h active : %', coalesce(v_hygiene::text, '(job absent)');
  raise notice 'non-visible rules      : %', v_nonvis;
  raise notice 'v_live_questions       : %', v_live;
  raise notice 'anon United States tab : %', v_us;
  raise notice 'anon India tab         : %', v_india;
  raise notice 'anon Global tab        : %', v_global;

  if v_hygiene then
    raise warning 'feed-hygiene-6h is ACTIVE - questions will be archived again after 7 days of no activity';
  end if;

  if v_live = 0 then
    raise warning 'v_live_questions is 0 - the Prod homepage is blank for every visitor';
  end if;
end
$report$;
