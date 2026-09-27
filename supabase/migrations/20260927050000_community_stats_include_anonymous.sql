-- Community Stance: include anonymous (held) answers, softly tagged.
--
-- Sep 2026 launch: anonymous web answers are staged in question_stances_pending
-- and only reach question_stances (and so the stats tables) once the person
-- signs up. On launch day the Pune question had 9 real answers and the page
-- said "No stances recorded yet". This read-only RPC returns the global
-- distribution with verified and anonymous answers counted separately, so the
-- bar can show both (anonymous drawn lighter, captioned "all anonymous").
--
-- Nothing stored changes: question_stance_stats / _region stay verified-only,
-- and regional comparisons keep reading them. question_stances_pending stays
-- revoked from anon/authenticated; this SECURITY DEFINER function exposes
-- aggregates only.

create or replace function public.get_question_community_stats(p_question_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with verified as (
    -- Same filters as refresh_question_stance_stats_region's global block.
    select qs.score
    from public.question_stances qs
    where qs.question_id = p_question_id
      and coalesce(qs.is_flagged, false) = false
      and public.stance_counts_toward_aggregate(qs.rendition_id)
  ),
  anonymous as (
    -- One row per device per question (record_web_stance updates in place).
    -- Rows with a null rendition can never commit but are still real answers;
    -- stance_counts_toward_aggregate(null) is true.
    select p.score
    from public.question_stances_pending p
    left join public.whatsapp_forward_chains w on w.id = p.forward_chain_id
    where p.question_id = p_question_id
      and coalesce(p.committed, false) = false
      and public.stance_counts_toward_aggregate(p.rendition_id)
      -- Don't count someone twice if they have since answered signed in.
      and not exists (
        select 1 from public.question_stances qs
        where qs.question_id = p_question_id
          and w.responder_user_id is not null
          and qs.user_id = w.responder_user_id
      )
  ),
  allrows as (
    select score, true as is_verified from verified
    union all
    select score, false from anonymous
  )
  select json_build_object(
    'total',     count(*),
    'verified',  count(*) filter (where is_verified),
    'anonymous', count(*) filter (where not is_verified),
    'oppose',  json_build_object(
                 'verified',  count(*) filter (where score < 0 and is_verified),
                 'anonymous', count(*) filter (where score < 0 and not is_verified)),
    'neutral', json_build_object(
                 'verified',  count(*) filter (where score = 0 and is_verified),
                 'anonymous', count(*) filter (where score = 0 and not is_verified)),
    'support', json_build_object(
                 'verified',  count(*) filter (where score > 0 and is_verified),
                 'anonymous', count(*) filter (where score > 0 and not is_verified)),
    'avg_score', round(avg(score)::numeric, 2)
  )
  from allrows;
$$;

revoke all on function public.get_question_community_stats(uuid) from public;
grant execute on function public.get_question_community_stats(uuid) to anon, authenticated, service_role;
