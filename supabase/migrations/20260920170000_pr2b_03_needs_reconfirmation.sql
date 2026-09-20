-- PR 2b.3 — needs-reconfirmation, derived rather than stored.
--
-- DECISION RECORDED: derived. A stance needs reconfirmation exactly when the
-- rendition it was recorded against has been invalidated. That is already a
-- fact of the data, so a boolean column would be a second copy of it — one that
-- can drift, needs backfilling, and has to be maintained by every write path.
-- The derived form cannot disagree with reality.
--
-- The cost is a join instead of a flag, which at this scale is nothing.
--
-- NOT the same predicate as stance_counts_toward_aggregate(). That one
-- deliberately coalesces a missing rendition to TRUE (counts), because legacy
-- rows with no provenance should still aggregate. Reconfirmation is the
-- opposite case: a legacy row with no rendition has nothing to re-read, so it
-- must NOT be dragged into the flow. Same underlying column, opposite default —
-- which is exactly why this is a separate, named function rather than a NOT.

create or replace function public.stance_needs_reconfirmation(p_rendition_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select r.lifecycle_status = 'invalidated'
     from public.question_renditions r
     where r.id = p_rendition_id),
    false);
$function$;

comment on function public.stance_needs_reconfirmation(uuid) is
  'True when a stance recorded against this rendition must be re-answered, i.e. the rendition was withdrawn as defective. Defaults to FALSE for a missing/NULL rendition — deliberately the opposite of stance_counts_toward_aggregate(), which defaults to TRUE so legacy unprovenanced rows still aggregate. A row with no rendition has no wording to re-read.';

-- Reader-facing view. Inherits question_stances RLS, so a signed-in user sees
-- only their own rows.
create or replace view public.v_my_stances_needing_reconfirmation
with (security_invoker = true) as
select
  qs.user_id,
  qs.question_id,
  qs.score        as previous_score,
  qs.rendition_id as answered_rendition_id,
  r.invalidated_at,
  r.language_code as answered_language_code
from public.question_stances qs
join public.question_renditions r on r.id = qs.rendition_id
where r.lifecycle_status = 'invalidated';

comment on view public.v_my_stances_needing_reconfirmation is
  'Stances whose instrument was withdrawn. previous_score is retained for audit and MUST NOT be pre-populated into the UI when the replacement wording is shown — a score is inseparable from the rendition it was chosen against, and carrying it across would fabricate a measurement against text the respondent never read.';

-- D3: in-app notification. Requires a new notification_type.
alter table public.user_notifications
  drop constraint if exists user_notifications_type_chk;

alter table public.user_notifications
  add constraint user_notifications_type_chk check (notification_type = any (array[
    'stance_change','weekly_digest','topic_follow','reminder','new_local_topic',
    'election_update','ugq_submitted','ugq_published','ugq_rejected','ugq_milestone',
    'ugq_flagged','ugq_unflagged','ugq_resubmit_requested','campaign_approved',
    'campaign_rejected','campaign_budget_alert','campaign_sync_failed',
    'campaign_completed','accountability_update',
    'stance_needs_reconfirmation'
  ]));

-- invalidate_rendition() also notifies. Body otherwise unchanged from pr2b_02.
create or replace function public.invalidate_rendition(
  p_rendition_id uuid,
  p_reason text default null)
returns table(affected_rendition_id uuid, previous_status text, new_status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_root public.question_renditions;
begin
  perform public._ensure_admin_or_service();

  select * into v_root from public.question_renditions where id = p_rendition_id;
  if v_root.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;
  if v_root.rendition_type = 'original' then
    raise exception
      'Rendition % is the source-language original. Invalidating it would leave the question with no authoritative wording; withdraw the question instead.',
      p_rendition_id;
  end if;

  return query
  with recursive lineage as (
    select r.id, r.lifecycle_status
    from public.question_renditions r
    where r.id = p_rendition_id
    union all
    select c.id, c.lifecycle_status
    from public.question_renditions c
    join lineage l on c.derived_from_rendition_id = l.id
  ),
  updated as (
    update public.question_renditions r
       set lifecycle_status = case
             when r.id = p_rendition_id            then 'invalidated'
             when r.lifecycle_status = 'published' then 'invalidated'
             else 'draft'
           end,
           invalidated_at = case
             when r.id = p_rendition_id or r.lifecycle_status = 'published' then now()
           end,
           axis_equivalence_check = case
             when r.id = p_rendition_id then r.axis_equivalence_check
             else null
           end,
           review_notes = coalesce(p_reason, r.review_notes)
      from lineage l
     where r.id = l.id
       and r.lifecycle_status <> 'invalidated'
    returning r.id, l.lifecycle_status as prev, r.lifecycle_status as now_status
  )
  select u.id, u.prev, u.now_status from updated u;

  perform public.refresh_question_stats_all(v_root.question_id);

  -- D3 — tell the people whose answers just stopped counting.
  --
  -- MIRROR RULE (2b.7): the copy states only that a newer version exists. It
  -- must NOT say the previous wording was wrong, defective or corrected.
  -- Telling someone the version they answered was flawed, immediately before
  -- asking them to answer again, primes them to read the replacement as a fix
  -- for something — interpretive framing the platform is not permitted to
  -- supply. p_reason is recorded for admins and is deliberately NOT surfaced.
  --
  -- title/body are stored in English as a fallback for any existing renderer.
  -- The client should prefer an i18n key selected on notification_type: this is
  -- the same server-generated-display-text trap PR 1 had to unpick in the
  -- societal-pulse micro-metrics, and the metadata below carries what a
  -- localized renderer needs.
  insert into public.user_notifications
    (user_id, notification_type, title, body, href, question_id, metadata)
  select distinct
    qs.user_id,
    'stance_needs_reconfirmation',
    'A newer version of a question you answered is available',
    'Please read it and give your stance again.',
    '/q/' || v_root.question_id::text,
    v_root.question_id,
    jsonb_build_object(
      'i18n_key', 'notifications.stanceNeedsReconfirmation',
      'question_id', v_root.question_id,
      'answered_rendition_id', qs.rendition_id
    )
  from public.question_stances qs
  where qs.question_id = v_root.question_id
    and qs.user_id is not null
    and public.stance_needs_reconfirmation(qs.rendition_id)
    -- one open prompt per question per person
    and not exists (
      select 1 from public.user_notifications n
      where n.user_id = qs.user_id
        and n.question_id = v_root.question_id
        and n.notification_type = 'stance_needs_reconfirmation'
        and n.is_read = false
    );
end;
$function$;

comment on function public.invalidate_rendition(uuid, text) is
  'Withdraws a rendition and its derived lineage, rebuilds the question''s current aggregates (2b.5), and notifies affected respondents in-app (D3). Notification copy is Mirror-Rule constrained: it states only that a newer version exists, never that the previous one was wrong. Historical daily snapshots are deliberately not recomputed.';
