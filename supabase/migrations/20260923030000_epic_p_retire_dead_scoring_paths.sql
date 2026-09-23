-- Epic P v1.4, step 1: retire dead code and close the last anon-callable
-- trending writer. No behaviour a user or admin can reach changes.
--
-- P-06  get_curated_feed() failed on every call (42804: row_index bigint vs
--       integer) and had no caller. Dropped rather than fixed:
--       get_daily_curated_questions is the better reader if the curated feed
--       is ever surfaced (it falls back to top-scored questions).
-- P-10  The topic-level scoring path was dead: 0 topic-level rows,
--       upsert_topic_impact_scores could never run (ON CONFLICT (topic_id)
--       does not match the partial unique index), and cron-impact-refresh
--       was never scheduled. Dropped with everything that only served it.
--       topic_impact_scores.topic_id and its CHECK stay.
--       The impact-score, impact-score-batch and cron-impact-refresh Edge
--       Functions are deleted separately (not SQL objects).
-- P-11  Scoring formulas other than ai-score-question's (the only live
--       scorer) are dropped: compute_composite_score (with P-10),
--       upsert_question_impact_scores (no caller) and
--       generate_realistic_impact_scores (random test-data generator that
--       anyone could call).
-- P-12  refresh_all_trending_scores' guard could never fire: it is SECURITY
--       DEFINER, so current_user is always postgres. It now calls
--       assert_admin_caller(), which the trending-refresh-hourly cron
--       (postgres session) passes, and anon loses EXECUTE.
--
-- Callers were checked before dropping: no function body, cron.job, view,
-- src/ file or recent gateway request references any dropped object except
-- the Edge Functions being deleted.

drop function if exists public.get_curated_feed(uuid, integer);
drop function if exists public.get_high_impact_candidates(integer);
drop function if exists public.rpc_get_topic_score_v1(uuid, integer);
drop function if exists public.compute_composite_score(uuid);
drop function if exists public.upsert_topic_impact_scores(uuid, numeric, numeric, numeric, numeric, numeric, text);
drop function if exists public.upsert_question_impact_scores(uuid, numeric, numeric, numeric, numeric, numeric, text);
drop function if exists public.generate_realistic_impact_scores();
drop view if exists public.v_topic_impact_admin;

do $mig$
declare
  src text;
  newsrc text;
  n int;
  cfg text;
  f oid := 'public.refresh_all_trending_scores()'::regprocedure;
begin
  src := replace((select prosrc from pg_proc where oid = f), chr(13), '');
  if src like '%assert_admin_caller()%' then
    raise notice 'refresh_all_trending_scores already guarded - skipped';
    return;
  end if;

  n := (select count(*) from regexp_matches(src, '^BEGIN$', 'gmi'));
  if n <> 1 then
    raise exception 'refresh_all_trending_scores: expected 1 top-level BEGIN line, found %', n;
  end if;
  newsrc := regexp_replace(src, '^BEGIN$',
    E'BEGIN\n  -- Epic P P-12: the current_user check below can never fire under\n  -- SECURITY DEFINER; this is the real guard (admin, service_role or cron).\n  PERFORM public.assert_admin_caller();\n',
    'mi');

  select coalesce(string_agg(format(' set %s to %s', split_part(c, '=', 1), substr(c, strpos(c, '=') + 1)), ''), '')
    into cfg
    from unnest((select proconfig from pg_proc where oid = f)) c;

  execute format('create or replace function public.refresh_all_trending_scores(%s) returns %s language plpgsql security definer%s as %L',
    pg_get_function_arguments(f), pg_get_function_result(f), cfg, newsrc);
end
$mig$;

alter function public.refresh_all_trending_scores() set search_path = public, pg_temp;
revoke execute on function public.refresh_all_trending_scores() from public, anon;
