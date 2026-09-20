-- PR 2b.8 — what invalidating this rendition would actually cost.
--
-- Invalidation is operationally heavy: responses stop counting, respondents are
-- notified and asked to answer again, and in-flight WhatsApp cards get rejected
-- and re-asked. None of that is visible from a button labelled "Invalidate",
-- and an admin who reads it as "remove the bad translation" will reach for it
-- casually.
--
-- This returns the numbers the confirmation step shows, so the cost is on
-- screen BEFORE the action rather than discovered afterwards.
--
-- Counts the whole lineage, not just the target. invalidate_rendition()
-- cascades to derived renditions, so counting only the root would understate
-- the impact of exactly the action being confirmed.

create or replace function public.rendition_invalidation_impact(p_rendition_id uuid)
returns table (
  question_id            uuid,
  language_code          text,
  lifecycle_status       text,
  rendition_type         text,
  lineage_size           integer,
  responses_affected     integer,
  respondents_notified   integer,
  in_flight_sessions     integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  with recursive lineage as (
    select r.id, r.question_id, r.language_code, r.lifecycle_status, r.rendition_type
    from public.question_renditions r
    where r.id = p_rendition_id
    union all
    select c.id, c.question_id, c.language_code, c.lifecycle_status, c.rendition_type
    from public.question_renditions c
    join lineage l on c.derived_from_rendition_id = l.id
  ),
  root as (select * from lineage where id = p_rendition_id)
  select
    root.question_id,
    root.language_code,
    root.lifecycle_status,
    root.rendition_type,
    (select count(*)::int from lineage),
    -- Responses that would stop counting toward canonical aggregates.
    (select count(*)::int
       from public.question_stances qs
      where qs.rendition_id in (select id from lineage)),
    -- Of those, the ones attached to an account we can actually notify.
    -- Anonymous and WhatsApp-only responses simply drop out with no prompt,
    -- which is worth seeing separately rather than folded into one number.
    (select count(distinct qs.user_id)::int
       from public.question_stances qs
      where qs.rendition_id in (select id from lineage)
        and qs.user_id is not null),
    -- Cards already delivered and not yet answered. These are the people who
    -- will tap a stance and be re-asked (D4) rather than counted.
    (select count(*)::int
       from public.whatsapp_flow_sessions s
      where s.rendition_id in (select id from lineage)
        and s.responded_at is null
        and (s.expires_at is null or s.expires_at > now()))
  from root;
$function$;

comment on function public.rendition_invalidation_impact(uuid) is
  'Impact preview for PR 2b.8''s admin confirmation step: how many responses stop counting, how many respondents can be notified, and how many delivered-but-unanswered WhatsApp cards will be re-asked. Counts the whole derived lineage because invalidate_rendition() cascades — counting only the target would understate the action being confirmed.';
