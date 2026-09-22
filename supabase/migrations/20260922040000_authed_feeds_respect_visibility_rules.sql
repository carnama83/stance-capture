-- Five authed feed RPCs served questions that feed hygiene had retired.
--
-- SYMPTOM, found on Prod. Both of Prod's two questions carry
-- question_visibility_rules.visibility = 'archived', written by the active
-- feed-hygiene-6h cron ('Feed hygiene: no activity after 7 days (auto)'). The
-- anonymous feed correctly showed nothing. The signed-in feed returned the
-- archived question anyway:
--
--   anon   -> get_live_questions_localized -> v_live_questions      0 rows
--   authed -> get_trending_questions_homepage -> questions directly 1 row  <-- archived
--
-- v_live_questions carries the rule as
--   (vr.visibility is null or vr.visibility = 'visible')
-- and every RPC that reads through that view inherits it. The five RPCs below
-- read public.questions DIRECTLY and never mentioned question_visibility_rules
-- at all, so an archived, suppressed or manual_only question stayed in every one
-- of their feeds forever. All five are live in the frontend:
--
--   get_trending_questions_homepage   src/pages/Index.tsx
--   get_trending_questions_v3         src/hooks/useQuestionLifecycle.ts
--   get_for_you_feed                  src/pages/ForYouFeedPage.tsx
--   get_personalized_feed             src/components/feed/PersonalizedFeed.tsx
--   get_three_tier_curated_feed_v2    src/components/question/ThreeTierQuestionsFeed.tsx
--
-- This is the same shape as 20260922030000: one rule, duplicated across the anon
-- and authed paths, and the copies drifted. Fixing only the homepage RPC would
-- have left four live copies of the same defect, so all five are done here.
--
-- THE RULE NOW LIVES IN ONE PLACE. question_visible_ids holds it once and the
-- five functions join it, rather than each growing its own copy of the predicate
-- -- which is precisely how this bug and the previous one were created.
-- question_visibility_rules has PRIMARY KEY (question_id), so at most one rule
-- exists per question and this inner join can never duplicate a feed row. It is
-- exactly equivalent to v_live_questions' left-join form.
--
-- Excluding "not visible" rather than naming 'archived': the enum is
-- (visible, suppressed, archived, manual_only). Only 'visible' and "no rule at
-- all" belong in a feed -- matching v_live_questions, which is the behaviour
-- anonymous readers already got.
--
-- A PLAIN VIEW, NOT security_invoker. It mirrors v_live_questions, which is also
-- owner-run and is the established RLS-bypassing boundary for feed reads. Four of
-- the five functions are SECURITY DEFINER, but get_trending_questions_v3 is
-- SECURITY INVOKER, so the view is granted to anon/authenticated explicitly --
-- without that grant this migration would blank v3 for real callers rather than
-- filter it. It exposes only question ids, no question content.
--
-- PATCHED IN PLACE WITH COUNTED ANCHORS, the convention pr3_04 established: each
-- body is fetched, textually patched and re-executed, and every function declares
-- how many call sites it must have. get_three_tier_curated_feed_v2 expects 3
-- because it selects from questions once per tier -- patching two of them would
-- ship a feed filtered in some tiers and not others, which is worse than not
-- patching at all. A mismatch RAISES instead of half-applying.
--
-- The join is inserted immediately after the table reference rather than into a
-- WHERE clause, because these five bodies build their WHERE clauses differently
-- (only the homepage one even has a q.published_at test) and there is no single
-- WHERE anchor common to all of them. Appending an inner join to the FROM item is
-- valid whatever follows it -- another join, a comma, or WHERE.

create or replace view public.question_visible_ids as
select q.id as question_id
from public.questions q
where not exists (
  select 1
  from public.question_visibility_rules vr
  where vr.question_id = q.id
    and vr.visibility <> 'visible'
);

comment on view public.question_visible_ids is
  'Question ids eligible for any feed: no visibility rule, or a rule of exactly visible. The single home of the rule that v_live_questions spells out inline, so the authed feed RPCs that read public.questions directly can honour it by joining rather than by each keeping their own copy (20260922040000).';

-- get_trending_questions_v3 is SECURITY INVOKER and is called by anon and by
-- signed-in users, so both roles need to be able to read this.
grant select on public.question_visible_ids to anon, authenticated, service_role;

do $patch$
declare
  v_target  record;
  v_def     text;
  v_new     text;
  v_count   integer;
  v_want    integer;
  -- proname -> how many `from public.questions q` sites that body has.
  -- Established by counting them on Dev, not guessed.
  v_expect  jsonb := jsonb_build_object(
    'get_trending_questions_homepage', 1,
    'get_trending_questions_v3',       1,
    'get_for_you_feed',                1,
    'get_personalized_feed',           1,
    'get_three_tier_curated_feed_v2',  3
  );
  v_pattern text := '(from\s+public\.questions\s+q)\y';
  v_join    text := '\1 join public.question_visible_ids qvis on qvis.question_id = q.id';
begin
  for v_target in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_trending_questions_homepage','get_trending_questions_v3',
                        'get_for_you_feed','get_personalized_feed',
                        'get_three_tier_curated_feed_v2')
  loop
    v_def  := pg_get_functiondef(v_target.oid);
    v_want := (v_expect ->> v_target.proname)::integer;

    -- Idempotence: a re-run must not stack a second join.
    if position('question_visible_ids' in v_def) > 0 then
      raise notice '% already joins question_visible_ids - skipped', v_target.proname;
      continue;
    end if;

    -- Counted on the ORIGINAL body, so the expectation is checked against what
    -- was actually there rather than against what the replace produced.
    v_count := (select count(*) from regexp_matches(v_def, v_pattern, 'gi'));

    if v_count <> v_want then
      raise exception
        'authed-visibility: % matched % questions-site(s), expected % -- body has drifted, patch by hand',
        v_target.proname, v_count, v_want;
    end if;

    v_new := regexp_replace(v_def, v_pattern, v_join, 'gi');
    execute v_new;
  end loop;
end
$patch$;

-- Assert the outcome, not just that the loop ran: every direct read of
-- public.questions must now have a guard beside it.
do $verify$
declare
  r     record;
  v_bad text := '';
begin
  for r in
    select p.proname,
           (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'from\s+public\.questions\s+q\y', 'gi')) as sites,
           (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'question_visible_ids', 'gi'))           as guards
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_trending_questions_homepage','get_trending_questions_v3',
                        'get_for_you_feed','get_personalized_feed',
                        'get_three_tier_curated_feed_v2')
  loop
    if r.guards < r.sites then
      v_bad := v_bad || format(' %s has %s questions-site(s) but only %s guard(s);',
                               r.proname, r.sites, r.guards);
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'authed-visibility end state wrong:%', v_bad;
  end if;

  raise notice 'authed feeds respect question_visibility_rules OK';
end
$verify$;
