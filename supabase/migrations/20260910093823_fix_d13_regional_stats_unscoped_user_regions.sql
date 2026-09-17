-- Epic D QA defect D-13 (P1, correctness).
--
-- refresh_question_stance_stats_region() is SECURITY DEFINER but joined
-- public.user_region_dimensions, a view whose definition ends
--   WHERE u.id = auth.uid()
-- Inside a SECURITY DEFINER function auth.uid() still resolves to the CALLING
-- user, so the view yielded at most that one user's row and the join matched
-- only that user's own stances. Every other user's stance was excluded from the
-- city / county / state / country tiers, so each stance write overwrote the
-- regional aggregates with a count of just the submitter. When auth.uid() was
-- NULL the view returned no rows, the INSERT ... SELECT wrote nothing, and the
-- tiers silently went stale instead of clearing.
--
-- Fix: replace the auth.uid()-scoped view with an inline `urd` CTE that applies
-- the SAME per-tier aggregation over user_location_settings + locations for ALL
-- users. Semantics are otherwise identical -- user_location_settings stores one
-- row per tier a user has set (verified in Dev: 10 users country-only,
-- 1 country+state, 3 with all four tiers), which is exactly what the view's
-- max(CASE ...) GROUP BY collapses. The WhatsApp/anonymous branches, the global
-- aggregate and the zero-response delete are unchanged.
--
-- BR-D11 note: the SET LOCAL lock_timeout='5s' lives in the trigger wrapper
-- trg_question_stances_refresh_stats_region(), which this migration does not touch.
create or replace function public.refresh_question_stance_stats_region(p_question_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_total     integer;
  v_agree     integer;
  v_disagree  integer;
  v_neutral   integer;
  v_avg       numeric;
begin
  -- 1) GLOBAL aggregate (no join needed) — unchanged
  select count(*)::int,
         count(*) filter (where qs.score > 0)::int,
         count(*) filter (where qs.score < 0)::int,
         count(*) filter (where qs.score = 0)::int,
         avg(qs.score)::numeric
  into v_total, v_agree, v_disagree, v_neutral, v_avg
  from public.question_stances qs
  where qs.question_id = p_question_id;

  if v_total = 0 then
    delete from public.question_stance_stats_region
    where question_id = p_question_id;
    return;
  else
    insert into public.question_stance_stats_region (
      question_id, region_scope, region_key, region_label,
      total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
    )
    values (
      p_question_id, 'global', 'global', 'Global',
      v_total,
      (v_agree::numeric    * 100.0) / v_total,
      (v_disagree::numeric * 100.0) / v_total,
      (v_neutral::numeric  * 100.0) / v_total,
      v_avg, now()
    )
    on conflict (question_id, region_scope, region_key)
    do update set
      total_responses = excluded.total_responses,
      pct_agree       = excluded.pct_agree,
      pct_disagree    = excluded.pct_disagree,
      pct_neutral     = excluded.pct_neutral,
      avg_score       = excluded.avg_score,
      updated_at      = excluded.updated_at;
  end if;

  -- CITY
  insert into public.question_stance_stats_region (
    question_id, region_scope, region_key, region_label,
    total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
  )
  with urd as (
    select uls.user_id,
           max(case when l.type = 'city'::location_tier_enum    then l.name end) as city_label,
           max(case when l.type = 'county'::location_tier_enum  then l.name end) as county_label,
           max(case when l.type = 'state'::location_tier_enum   then l.name end) as state_label,
           max(case when l.type = 'country'::location_tier_enum then l.name end) as country_label
    from public.user_location_settings uls
    join public.locations l on l.id = uls.location_id
    group by uls.user_id
  ),
  combined as (
    select qs.score, urd.city_label as region_label
    from public.question_stances qs
    join urd on urd.user_id = qs.user_id
    where qs.question_id = p_question_id
      and urd.city_label is not null

    union all

    select qs.score, lal.city_label as region_label
    from public.question_stances qs
    join public.whatsapp_forward_chains wfc on wfc.id = qs.forward_chain_id
    join public.location_ancestor_labels(wfc.location_id) lal on true
    where qs.question_id = p_question_id
      and qs.user_id is null
      and wfc.location_id is not null
      and lal.city_label is not null
  )
  select
    p_question_id, 'city', region_label, region_label,
    count(*)::int,
    (count(*) filter (where score > 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score < 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score = 0)::numeric * 100.0) / count(*),
    avg(score)::numeric,
    now()
  from combined
  group by region_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- COUNTY
  insert into public.question_stance_stats_region (
    question_id, region_scope, region_key, region_label,
    total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
  )
  with urd as (
    select uls.user_id,
           max(case when l.type = 'city'::location_tier_enum    then l.name end) as city_label,
           max(case when l.type = 'county'::location_tier_enum  then l.name end) as county_label,
           max(case when l.type = 'state'::location_tier_enum   then l.name end) as state_label,
           max(case when l.type = 'country'::location_tier_enum then l.name end) as country_label
    from public.user_location_settings uls
    join public.locations l on l.id = uls.location_id
    group by uls.user_id
  ),
  combined as (
    select qs.score, urd.county_label as region_label
    from public.question_stances qs
    join urd on urd.user_id = qs.user_id
    where qs.question_id = p_question_id
      and urd.county_label is not null

    union all

    select qs.score, lal.county_label as region_label
    from public.question_stances qs
    join public.whatsapp_forward_chains wfc on wfc.id = qs.forward_chain_id
    join public.location_ancestor_labels(wfc.location_id) lal on true
    where qs.question_id = p_question_id
      and qs.user_id is null
      and wfc.location_id is not null
      and lal.county_label is not null
  )
  select
    p_question_id, 'county', region_label, region_label,
    count(*)::int,
    (count(*) filter (where score > 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score < 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score = 0)::numeric * 100.0) / count(*),
    avg(score)::numeric,
    now()
  from combined
  group by region_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- STATE
  insert into public.question_stance_stats_region (
    question_id, region_scope, region_key, region_label,
    total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
  )
  with urd as (
    select uls.user_id,
           max(case when l.type = 'city'::location_tier_enum    then l.name end) as city_label,
           max(case when l.type = 'county'::location_tier_enum  then l.name end) as county_label,
           max(case when l.type = 'state'::location_tier_enum   then l.name end) as state_label,
           max(case when l.type = 'country'::location_tier_enum then l.name end) as country_label
    from public.user_location_settings uls
    join public.locations l on l.id = uls.location_id
    group by uls.user_id
  ),
  combined as (
    select qs.score, urd.state_label as region_label
    from public.question_stances qs
    join urd on urd.user_id = qs.user_id
    where qs.question_id = p_question_id
      and urd.state_label is not null

    union all

    select qs.score, lal.state_label as region_label
    from public.question_stances qs
    join public.whatsapp_forward_chains wfc on wfc.id = qs.forward_chain_id
    join public.location_ancestor_labels(wfc.location_id) lal on true
    where qs.question_id = p_question_id
      and qs.user_id is null
      and wfc.location_id is not null
      and lal.state_label is not null
  )
  select
    p_question_id, 'state', region_label, region_label,
    count(*)::int,
    (count(*) filter (where score > 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score < 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score = 0)::numeric * 100.0) / count(*),
    avg(score)::numeric,
    now()
  from combined
  group by region_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- COUNTRY
  insert into public.question_stance_stats_region (
    question_id, region_scope, region_key, region_label,
    total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at
  )
  with urd as (
    select uls.user_id,
           max(case when l.type = 'city'::location_tier_enum    then l.name end) as city_label,
           max(case when l.type = 'county'::location_tier_enum  then l.name end) as county_label,
           max(case when l.type = 'state'::location_tier_enum   then l.name end) as state_label,
           max(case when l.type = 'country'::location_tier_enum then l.name end) as country_label
    from public.user_location_settings uls
    join public.locations l on l.id = uls.location_id
    group by uls.user_id
  ),
  combined as (
    select qs.score, urd.country_label as region_label
    from public.question_stances qs
    join urd on urd.user_id = qs.user_id
    where qs.question_id = p_question_id
      and urd.country_label is not null

    union all

    select qs.score, lal.country_label as region_label
    from public.question_stances qs
    join public.whatsapp_forward_chains wfc on wfc.id = qs.forward_chain_id
    join public.location_ancestor_labels(wfc.location_id) lal on true
    where qs.question_id = p_question_id
      and qs.user_id is null
      and wfc.location_id is not null
      and lal.country_label is not null
  )
  select
    p_question_id, 'country', region_label, region_label,
    count(*)::int,
    (count(*) filter (where score > 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score < 0)::numeric * 100.0) / count(*),
    (count(*) filter (where score = 0)::numeric * 100.0) / count(*),
    avg(score)::numeric,
    now()
  from combined
  group by region_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;
end;
$function$;
