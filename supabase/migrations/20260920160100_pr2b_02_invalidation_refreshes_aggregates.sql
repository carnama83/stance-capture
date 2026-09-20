-- PR 2b.5 — invalidating a rendition must refresh the aggregates it changes.
--
-- stance_counts_toward_aggregate() is already applied by both refresh
-- functions, so an invalidated rendition's responses are correctly excluded
-- WHEN A REFRESH RUNS. The problem is that nothing runs one.
--
-- The refresh triggers fire on question_stances writes only. Invalidating a
-- rendition changes no stance row, so it fires nothing — the published numbers
-- keep counting responses that are no longer supposed to count, until the next
-- time somebody happens to answer that question. On a question that has gone
-- quiet, that is indefinitely.
--
-- A SECOND, QUIETER BUG, found while wiring this up.
--
-- refresh_question_stance_stats_region() upserts one row per region that still
-- has responses, and only deletes anything when the GLOBAL total hits zero. So
-- when invalidation empties a single region but not the question, that region's
-- row is never updated and never removed — it keeps its pre-invalidation
-- numbers forever, because the upsert simply has no row to write for it.
--
-- That is invisible under normal operation, where scores are added rather than
-- removed and every region that had a row still has responses. Invalidation is
-- the first thing that takes responses AWAY, which is what exposes it.
--
-- refresh_question_stats_all() clears the question's regional rows before
-- refreshing so the rebuild is authoritative rather than additive.

create or replace function public.refresh_question_stats_all(p_question_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  -- Clear first: the regional refresh is an upsert per surviving region and
  -- cannot know about a region that just lost its last counted response.
  delete from public.question_stance_stats_region
  where question_id = p_question_id;

  perform public.refresh_question_stance_stats(p_question_id);
  perform public.refresh_question_stance_stats_region(p_question_id);
end;
$function$;

comment on function public.refresh_question_stats_all(uuid) is
  'Rebuilds current aggregates for a question from scratch. Deletes the regional rows first because refresh_question_stance_stats_region() only upserts surviving regions — a region emptied by invalidation would otherwise keep stale pre-invalidation numbers. Call after any change that REMOVES responses from the counted set.';

-- invalidate_rendition() gains the refresh. Body is otherwise unchanged from
-- f2_10: same admin guard, same original-rendition refusal, same recursive
-- lineage cascade.
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

  -- PR 2b.5: the responses recorded against this wording stop counting from
  -- here. Nothing else would notice — no stance row changed, so no refresh
  -- trigger fires — and the published numbers would keep including them until
  -- the next answer on this question, which may never come.
  perform public.refresh_question_stats_all(v_root.question_id);
end;
$function$;

comment on function public.invalidate_rendition(uuid, text) is
  'Withdraws a rendition and its derived lineage as defective, then rebuilds the question''s current aggregates so the responses recorded against it stop counting immediately (PR 2b.5). Refuses to invalidate a source-language original. Historical daily snapshots are deliberately NOT recomputed — see pr2b_03.';
