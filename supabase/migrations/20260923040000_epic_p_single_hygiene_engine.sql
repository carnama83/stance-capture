-- Epic P v1.4, step 2: one visibility engine, a launch-safe archive rule,
-- and admin decisions that stick (P-08, P-09, P-12 panel/skipped).
--
-- P-08  The archive rule was: older than 7 days, not trending, fewer than 2
--       responses in the last 24h. At pre-launch traffic that archives the
--       whole catalogue (Dev: 115 of 123 active questions; Prod: both of its
--       questions, leaving the homepage empty), and archived was terminal.
--       New rule, agreed with the product owner 23 Sep 2026: archive only
--       when a question is at least 30 days old, has fewer than 5 responses
--       IN TOTAL, is not trending, AND scores below 7.0. A good question that
--       simply has no traffic yet stays up.
--
-- P-09  Two engines wrote question_visibility_rules with different policies
--       (apply_feed_hygiene on a 6h cron; update_visibility_rules from an
--       admin button) and each could undo the other and any admin override.
--       apply_feed_hygiene is now the only engine. It computes a TARGET state
--       for every question it owns and converges to it, so it is idempotent
--       and self-healing: a question that stops meeting a rule is restored
--       automatically (which also performs the one-time cleanup of rows the
--       old rule archived). update_visibility_rules becomes a thin wrapper
--       so existing callers keep working.
--
--       question_visibility_rules.set_by records who owns a row:
--         'hygiene' - automation may change it
--         'admin'   - set via set_question_visibility; automation never
--                     touches it again
--       manual_only rows are also never touched.
--
-- Thresholds now live in app_config_trending (hygiene_* keys, editable on
-- /admin/scoring-config) with the values below as fallbacks.

-- ── 1. Provenance ─────────────────────────────────────────────────────────
alter table public.question_visibility_rules
  add column if not exists set_by text not null default 'hygiene';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'question_visibility_rules_set_by_chk') then
    alter table public.question_visibility_rules
      add constraint question_visibility_rules_set_by_chk check (set_by in ('hygiene', 'admin'));
  end if;
end $$;

-- Existing rows: anything written by an admin action is admin-owned; rows
-- written by either automatic engine stay 'hygiene'.
update public.question_visibility_rules
   set set_by = 'admin'
 where set_by = 'hygiene'
   and (reason like 'Set via Impact Dashboard%' or reason = 'ensure_question_visibility default'
        or (reason is not null
            and reason not like 'Feed hygiene:%'
            and reason not like 'Composite score %'
            and reason not like 'New question (<48h)%'
            and reason not like 'Not yet scored%'
            and reason not like 'Very low composite score%'
            and reason not like 'Below threshold composite score%'));

-- ── 2. Thresholds (only inserted when missing; never overwrite an edit) ────
insert into public.app_config_trending (key, value, description) values
  ('hygiene_suppress_after_hours',     24,  'Feed hygiene: a question can be suppressed once it is older than this many hours'),
  ('hygiene_low_engagement_threshold', 5,   'Feed hygiene: suppress only when total responses are below this'),
  ('hygiene_min_composite_score',      7.0, 'Feed hygiene: suppress/archive only when the AI composite score is below this'),
  ('hygiene_archive_after_days',       30,  'Feed hygiene: archive only when the question is older than this many days'),
  ('hygiene_archive_max_responses',    5,   'Feed hygiene: archive only when total responses are below this'),
  ('hygiene_boost_trending_score',     20,  'Feed hygiene: a question with trending_score above this (or is_trending) is always kept visible')
on conflict (key) do nothing;

-- ── 3. The single engine ──────────────────────────────────────────────────
create or replace function public.apply_feed_hygiene(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now timestamptz := now();

  v_suppress_hours   numeric;
  v_low_engagement   numeric;
  v_min_score        numeric;
  v_archive_days     numeric;
  v_archive_max_resp numeric;
  v_boost_score      numeric;

  v_suppressed int := 0;
  v_archived   int := 0;
  v_restored   int := 0;
begin
  -- Admin, service_role or internal (the feed-hygiene-6h cron) only.
  perform public.assert_admin_caller();

  select
    coalesce(max(value) filter (where key = 'hygiene_suppress_after_hours'),     24),
    coalesce(max(value) filter (where key = 'hygiene_low_engagement_threshold'), 5),
    coalesce(max(value) filter (where key = 'hygiene_min_composite_score'),      7.0),
    coalesce(max(value) filter (where key = 'hygiene_archive_after_days'),       30),
    coalesce(max(value) filter (where key = 'hygiene_archive_max_responses'),    5),
    coalesce(max(value) filter (where key = 'hygiene_boost_trending_score'),     20)
  into v_suppress_hours, v_low_engagement, v_min_score, v_archive_days, v_archive_max_resp, v_boost_score
  from public.app_config_trending
  where key like 'hygiene\_%';

  -- One statement: compute the plan, write it unless dry run, count it.
  -- A data-modifying CTE runs even though the final SELECT does not read it.
  with plan as (
  select question_id, current_vis, target_vis, reason
  from (
    select
      q.id as question_id,
      vr.visibility as current_vis,
      case
        when q.is_trending or coalesce(q.trending_score, 0) > v_boost_score
          then 'visible'::question_visibility_enum
        when tis.composite_score is not null and tis.composite_score < v_min_score
         and coalesce(qe.responses_total, 0) < v_archive_max_resp
         and q.published_at < v_now - make_interval(days => v_archive_days::int)
          then 'archived'::question_visibility_enum
        when tis.composite_score is not null and tis.composite_score < v_min_score
         and coalesce(qe.responses_total, 0) < v_low_engagement
         and q.published_at < v_now - make_interval(hours => v_suppress_hours::int)
          then 'suppressed'::question_visibility_enum
        else 'visible'::question_visibility_enum
      end as target_vis,
      case
        when q.is_trending or coalesce(q.trending_score, 0) > v_boost_score
          then 'Feed hygiene: kept visible - question is trending (auto)'
        when tis.composite_score is not null and tis.composite_score < v_min_score
         and coalesce(qe.responses_total, 0) < v_archive_max_resp
         and q.published_at < v_now - make_interval(days => v_archive_days::int)
          then format('Feed hygiene: score %s < %s and %s responses after %s days (auto)',
                      round(tis.composite_score, 2), v_min_score, coalesce(qe.responses_total, 0), v_archive_days)
        when tis.composite_score is not null and tis.composite_score < v_min_score
         and coalesce(qe.responses_total, 0) < v_low_engagement
         and q.published_at < v_now - make_interval(hours => v_suppress_hours::int)
          then format('Feed hygiene: score %s < %s and %s responses after %s hours (auto)',
                      round(tis.composite_score, 2), v_min_score, coalesce(qe.responses_total, 0), v_suppress_hours)
        else 'Feed hygiene: restored - no longer meets a hide rule (auto)'
      end as reason
    from public.questions q
    left join public.question_visibility_rules vr on vr.question_id = q.id
    left join public.question_engagement_metrics qe on qe.question_id = q.id
    left join public.topic_impact_scores tis on tis.question_id = q.id
    where q.status = 'active'
      -- Automation owns only rows it wrote; admin and manual_only rows are left alone.
      and (vr.question_id is null
           or (vr.set_by = 'hygiene' and vr.visibility in ('visible', 'suppressed', 'archived')))
  ) s
  -- Only real transitions. A missing rule already means visible.
  where s.target_vis is distinct from coalesce(s.current_vis, 'visible'::question_visibility_enum)
  ),
  written as (
    insert into public.question_visibility_rules (question_id, visibility, reason, last_evaluated_at, set_by)
    select question_id, target_vis, reason, v_now, 'hygiene'
    from plan
    where not p_dry_run
    on conflict (question_id) do update
      set visibility        = excluded.visibility,
          reason            = excluded.reason,
          last_evaluated_at = excluded.last_evaluated_at
      where question_visibility_rules.set_by = 'hygiene'
        and question_visibility_rules.visibility <> 'manual_only'
    returning 1
  )
  select count(*) filter (where target_vis = 'suppressed'),
         count(*) filter (where target_vis = 'archived'),
         count(*) filter (where target_vis = 'visible')
    into v_suppressed, v_archived, v_restored
    from plan;

  return jsonb_build_object(
    'ran_at',    v_now,
    'dry_run',   p_dry_run,
    'suppressed', v_suppressed,
    'archived',   v_archived,
    'boosted',    v_restored,   -- "restored to visible"; key kept for existing callers
    'rules', jsonb_build_object(
      'suppress_after_hours',     v_suppress_hours,
      'low_engagement_threshold', v_low_engagement,
      'min_composite_score',      v_min_score,
      'archive_after_days',       v_archive_days,
      'archive_max_responses',    v_archive_max_resp,
      'boost_trending_score',     v_boost_score
    )
  );
end
$fn$;

revoke execute on function public.apply_feed_hygiene(boolean) from public, anon;
grant execute on function public.apply_feed_hygiene(boolean) to authenticated, service_role;

-- ── 4. The retired second engine, kept as a compatibility wrapper ─────────
-- Callers (the impact dashboard until its next deploy, bootstrap_epic_p_data)
-- get the rows this run changed, in the old shape. Rows changed in this call
-- carry last_evaluated_at = now(), the transaction timestamp.
create or replace function public.update_visibility_rules()
returns table(updated_question_id uuid, updated_visibility text, updated_reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.assert_admin_caller();
  perform public.apply_feed_hygiene(false);
  return query
    select vr.question_id, vr.visibility::text, vr.reason
    from public.question_visibility_rules vr
    where vr.last_evaluated_at = now()
      and vr.set_by = 'hygiene';
end
$fn$;

revoke execute on function public.update_visibility_rules() from public, anon;
grant execute on function public.update_visibility_rules() to authenticated, service_role;

-- ── 5. Admin overrides are admin-owned ────────────────────────────────────
create or replace function public.set_question_visibility(
  p_question_id uuid,
  p_visibility question_visibility_enum,
  p_reason text default null::text)
returns question_visibility_rules
language plpgsql
security definer
set search_path = public, auth, extensions
as $fn$
declare
  v_row public.question_visibility_rules;
begin
  perform public._ensure_admin_or_service();

  v_row := public.ensure_question_visibility(p_question_id, p_visibility);

  -- Epic P P-09: an admin decision is never overwritten by automation.
  update public.question_visibility_rules
     set reason            = coalesce(p_reason, reason),
         set_by            = 'admin',
         last_evaluated_at = now()
   where question_id = p_question_id
  returning * into v_row;

  return v_row;
end
$fn$;

-- ── 6. Hygiene panel shows every hidden question and who hid it ──────────
create or replace view public.v_hygiene_suppressed as
 select q.id as question_id,
    q.question,
    q.published_at,
    q.is_trending,
    q.trending_score,
    vr.visibility,
    vr.reason,
    vr.last_evaluated_at,
    qe.responses_total,
    qe.responses_last_24h,
    tis.composite_score,
    vr.set_by
   from questions q
     join question_visibility_rules vr on vr.question_id = q.id
     left join question_engagement_metrics qe on qe.question_id = q.id
     left join topic_impact_scores tis on tis.question_id = q.id
  where vr.visibility <> 'visible'::question_visibility_enum
    and (is_moderator() or is_admin())
  order by vr.last_evaluated_at desc;
