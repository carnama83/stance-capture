-- PR 3.4 (part 2) — the localized RPCs stop serving the English summary.
--
-- pr3_03 put summary on the rendition and populated it. This is the read side:
-- every RPC that already resolves a rendition into `r` now takes summary from
-- that SAME r, instead of reaching past it to questions.summary.
--
-- WHY r.summary AND NOT coalesce(r.summary, q.summary).
--
-- The tempting version keeps the English paragraph whenever a translation has
-- not been written yet. That reintroduces precisely the defect: a Hindi
-- question, answered on a Hindi slider, with an English framing paragraph above
-- it that changes what the question appears to ask -- and now with the card
-- declaring data-instrument-language="hi", so the DOM scan would not even flag
-- it. A coalesce here buys content at the cost of an UNDECLARED mixed-language
-- instrument.
--
-- Taking summary from the resolved rendition is correct in both cases, which is
-- why it needs no fallback:
--
--   * Reader has a Hindi rendition, summary not yet translated -> NULL, and the
--     client renders no summary. Honest: nothing is asserted in a language
--     nobody wrote.
--   * Reader has NO Hindi rendition -> the resolver already fell back to the
--     English original, so r IS that original, r.summary is its English summary,
--     and the whole card is declared English by D1's labelled fallback. Mixed,
--     but LABELLED and consistent -- which is what D1 chose.
--
-- The cost is visible and small: 5 Dev questions currently have a published
-- Hindi rendition and an English summary, and those five lose a paragraph until
-- the rendition pipeline fills summary. Losing a paragraph is recoverable.
-- Silently miscounting stances taken against text nobody could read is not.
--
-- THE PIPELINE IS NOT YET WRITING IT. Generating summary alongside rendered_text
-- belongs to the rendition edge function, which is deployed separately and is
-- untouched by this work -- the same split that left the deployed ai-stance-tip
-- behind its own source in PR 3.1. Until it is redeployed, translated renditions
-- carry a NULL summary and those questions simply show none.
--
-- PATCHED IN PLACE, WITH COUNTED ANCHORS. These bodies run to 200 lines of
-- ranking logic that this change has no business touching, so each definition is
-- fetched, regex-patched and re-executed. Every function declares how many
-- substitutions it must receive; a mismatch RAISES rather than half-applying.
-- get_three_tier_curated_feed_v2 expects 3 because it selects the same shape in
-- three tiers -- patching two of them would ship a feed that is localized in
-- some rows and not others, which is worse than not patching at all.
--
-- `r` IS NOT THE RENDITIONS TABLE. The first attempt at this migration assumed
-- it was and failed outright with "column r.summary does not exist": every one
-- of these RPCs gets `r` from `join lateral public.wording_for(...) r`, so the
-- column has to exist on the RESOLVER's return type before any caller can
-- select it. That is the right place for it anyway -- wording_for is what
-- applies the D1 fallback, so a summary taken from its output is guaranteed to
-- come from the same rendition as the wording beside it, which is the whole
-- property this change is trying to establish.
--
-- summary is appended LAST, the convention PR 2a used when rendition_id was
-- added. All nine consumers reference wording_for's columns BY NAME and not one
-- uses `select *`, so appending cannot shift anything underneath them.

-- ── the resolver learns about summary ───────────────────────────────────────
drop function if exists public.wording_for(uuid, text);

create function public.wording_for(p_question_id uuid, p_language_code text)
returns table (
  rendered_text     text,
  slider_low_label  text,
  slider_high_label text,
  context_summary   text,
  rendition_id      uuid,
  summary           text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with allow as (
    select case
      when auth.uid() is null then true
      else coalesce(
        (select pr.show_unavailable_language from public.profiles pr where pr.user_id = auth.uid()),
        false)
    end as fallback_ok
  ),
  match as (
    select r.rendered_text, r.slider_low_label, r.slider_high_label,
           r.context_summary, r.id, r.summary
    from public.question_renditions r
    where r.question_id = p_question_id
      and r.lifecycle_status = 'published'
      and r.language_code = coalesce(p_language_code, 'en')
    limit 1
  ),
  original as (
    select r.rendered_text, r.slider_low_label, r.slider_high_label,
           r.context_summary, r.id, r.summary
    from public.question_renditions r
    where r.question_id = p_question_id
      and r.lifecycle_status = 'published'
      and r.rendition_type = 'original'
    limit 1
  )
  select * from match
  union all
  select o.* from original o, allow
  where allow.fallback_ok and not exists (select 1 from match);
$function$;

comment on function public.wording_for(uuid, text) is
  'Resolves the rendition a reader should be shown, applying the D1 fallback. Returns the instrument text AND the Class-2 summary from that same rendition, so framing prose can never come from a different rendition than the wording it sits above (PR 3.4). rendition_id and summary are appended last; callers reference columns by name.';

do $$
declare
  v_target   record;
  v_def      text;
  v_new      text;
  v_count    integer;
  -- proname -> how many [qv].summary tokens directly follow an r.rendered_text
  -- line in that body. Established by reading each definition, not guessed.
  v_expect   jsonb := jsonb_build_object(
    'get_for_you_feed',                 1,
    'get_live_questions_localized',     1,
    'get_personalized_feed',            1,
    'get_question_localized',           1,
    'get_related_questions_localized',  1,
    'get_three_tier_curated_feed_v2',   3,
    'get_trending_questions_homepage',  1,
    'get_trending_questions_v3',        1
  );
  v_want     integer;
begin
  for v_target in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_for_you_feed','get_live_questions_localized','get_personalized_feed',
        'get_question_localized','get_related_questions_localized',
        'get_three_tier_curated_feed_v2','get_trending_questions_homepage',
        'get_trending_questions_v3')
  loop
    v_def  := pg_get_functiondef(v_target.oid);
    v_want := (v_expect ->> v_target.proname)::integer;

    -- "...r.rendered_text <anything> <newline> <indent> q.summary"  ->  r.summary
    -- Anchored on rendered_text so only the SELECT list that already resolved a
    -- rendition is touched; a bare q.summary elsewhere is left alone.
    v_new := regexp_replace(
               v_def,
               '(r\.rendered_text[^' || chr(10) || ']*' || chr(10) || '\s*)[qv]\.summary',
               '\1r.summary',
               'g');

    -- How many sites the pattern actually matched, counted on the ORIGINAL
    -- body so the expectation is checked against what was there, not against
    -- what the replace produced.
    v_count := (select count(*) from regexp_matches(
                  v_def,
                  '(r\.rendered_text[^' || chr(10) || ']*' || chr(10) || '\s*)[qv]\.summary',
                  'g'));

    if v_count <> v_want then
      raise exception
        'pr3_04: % matched % summary site(s), expected % -- body has drifted, patch by hand',
        v_target.proname, v_count, v_want;
    end if;

    execute v_new;
  end loop;
end $$;

-- ── get_tailored_feed: summary arrives through a CTE ────────────────────────
-- Its `base` CTE selects v.* (carrying the English summary) plus the rendition
-- columns aliased loc_*. So the rendition summary has to be carried in as
-- loc_summary and read out in place of base.summary -- the same shape the other
-- localized columns already use here.
do $$
declare
  v_oid  oid;
  v_def  text;
  v_new  text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tailored_feed';

  if v_oid is null then
    raise exception 'pr3_04: get_tailored_feed not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  v_new := v_def;

  v_new := replace(v_new,
    '      r.rendition_id      as loc_rendition_id,',
    '      r.rendition_id      as loc_rendition_id,' || chr(10) ||
    '      r.summary           as loc_summary,');

  v_new := replace(v_new,
    '    base.summary,',
    '    base.loc_summary        as summary,');

  if v_new = v_def then
    raise exception 'pr3_04: get_tailored_feed anchors did not match';
  end if;
  if position('loc_summary,' in v_new) = 0
     or position('base.loc_summary' in v_new) = 0 then
    raise exception 'pr3_04: get_tailored_feed only partially patched -- refusing';
  end if;

  execute v_new;
end $$;

notify pgrst, 'reload schema';
