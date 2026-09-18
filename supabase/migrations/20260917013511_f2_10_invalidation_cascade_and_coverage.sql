-- Epic UGQ Design F2, phase 6 of 6: aggregation integrity.
--
-- Superseded is NOT invalidated. Superseded wording was valid when it was used
-- and its responses stay in the aggregate; invalidated wording was defective
-- and its responses are quarantined -- removed from the headline number but
-- never deleted, because they are evidence of what people were asked.

-- ------------------------------------------------- quarantine predicate
create or replace function public.stance_counts_toward_aggregate(p_rendition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.lifecycle_status <> 'invalidated'
     from public.question_renditions r where r.id = p_rendition_id),
    true);
$$;

grant execute on function public.stance_counts_toward_aggregate(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------- invalidation + cascade
-- A rendition verified against wording that is later found defective holds a
-- meaningless verdict, so invalidation has to travel along derived_from.
-- Descendants are returned to DRAFT rather than invalidated when they still
-- have text worth re-verifying -- their wording may be fine even though the
-- grounds for trusting it are gone. Published descendants are invalidated,
-- because they are live and can no longer be justified.
create or replace function public.invalidate_rendition(
  p_rendition_id uuid,
  p_reason text default null)
returns table (affected_rendition_id uuid, previous_status text, new_status text)
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;

revoke all on function public.invalidate_rendition(uuid, text) from public, anon;
grant execute on function public.invalidate_rendition(uuid, text) to authenticated, service_role;

-- ------------------------------------------------- coverage denominator
-- Languages come online at different times, so the headline number moves for
-- reasons unrelated to opinion change. Recording which languages were live when
-- an aggregate was computed is what lets a later reader tell a shift in opinion
-- apart from a shift in who was able to answer.
alter table public.question_stance_stats
  add column if not exists coverage_languages text[] not null default '{}';
alter table public.question_stance_stats_region
  add column if not exists coverage_languages text[] not null default '{}';

comment on column public.question_stance_stats.coverage_languages is
  'Languages with a published rendition when this aggregate was computed. Without it, adding a language looks identical to opinion changing.';

create or replace function public.question_language_coverage(p_question_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct r.language_code order by r.language_code), '{}')
  from public.question_renditions r
  where r.question_id = p_question_id and r.lifecycle_status = 'published';
$$;

grant execute on function public.question_language_coverage(uuid) to anon, authenticated, service_role;

-- ------------------------------------------- quarantine in the aggregates
-- The three refreshers that already exclude flagged stances are exactly the
-- ones that produce the numbers users see. Extended mechanically from their own
-- definitions, asserted to have changed.
do $$
declare
  rec  record;
  def  text;
  orig text;
  n    integer := 0;
begin
  for rec in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in ('refresh_question_stance_stats',
                        'refresh_question_stance_stats_region',
                        'snapshot_community_trends')
  loop
    def  := pg_get_functiondef(rec.sig);
    orig := def;

    def := replace(def,
      'coalesce(qs.is_flagged, false) = false',
      'coalesce(qs.is_flagged, false) = false and public.stance_counts_toward_aggregate(qs.rendition_id)');
    def := replace(def,
      'coalesce(is_flagged, false) = false',
      'coalesce(is_flagged, false) = false and public.stance_counts_toward_aggregate(rendition_id)');

    if def = orig then
      raise exception 'F2 phase 6: quarantine predicate not applied to %', rec.sig;
    end if;

    execute def;
    n := n + 1;
  end loop;

  if n <> 3 then
    raise exception 'F2 phase 6: expected 3 aggregate refreshers, updated %', n;
  end if;
end $$;
