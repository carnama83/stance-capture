-- The anonymous homepage feed could not see Global-audience questions.
--
-- SYMPTOM. Signed out, the hero renders "No questions available right now." and
-- the feed is empty; signing in fixes it. Reproduced on UAT, where the single
-- live question carries audience_location_label = 'Global'.
--
-- WHY IT IS AN ANON-ONLY BUG. Signed-in and signed-out readers are served by two
-- different RPCs that each carry their own copy of the region rule:
--
--   authed -> get_trending_questions_homepage:
--       coalesce(audience, location, topic_location) is null
--       or coalesce(...) = 'Global'                      <-- Global always in
--       or (p_region_scope <> 'global' and coalesce(...) = p_region_key)
--
--   anon   -> get_live_questions_localized (this function), country branch:
--       p_region_label <> 'Global' and v.audience_location_label = p_region_label
--
-- The anon country branch matches an exact literal country string and nothing
-- else: no 'Global' arm, no NULL arm. So a Global-audience question is visible
-- to a signed-in reader on the United States tab and invisible to an anonymous
-- one on the same tab. This is the duplicated-rule failure f2_09 called out when
-- it pulled eligibility into wording_for -- the region rule was left duplicated.
--
-- It bites anonymous readers specifically because they are the ones who land on
-- the country tab by default: useIPLocation resolves a country, effectiveHasCountry
-- flips regionTab to "country", and the hero re-fetches under p_region_label =
-- that country. The console shows it as
--   [hero:region] region changed Global -> United States -- resetting hero
-- i.e. the hero is briefly correct on first paint and then empties itself.
--
-- NOT AN RLS OR GRANTS PROBLEM. anon holds EXECUTE on this function and SELECT on
-- v_live_questions; the call returns HTTP 200 with []. Verified before changing
-- anything, so that nothing here is a permissions workaround.
--
-- WHY DEV LOOKED HEALTHY. Dev carries this identical body (md5 cbf714b8... on both
-- Dev and UAT) but happens to hold 3 United-States-audience questions, so the
-- broken branch still finds content for a US visitor. Dev was masked by data, not
-- fixed: an anonymous visitor geolocating anywhere other than the United States
-- got zero rows on Dev too.
--
-- SECOND, QUIETER BUG IN THE SAME CLAUSE. The Global branch used
--   v.audience_location_label <> p_exclude_country_label
-- which is NULL, not true, for a NULL audience -- so a question with no audience
-- label was silently dropped from the Global tab as well. Replaced with
-- `is distinct from`.
--
-- WHY coalesce(audience, location) AND NOT THE FULL AUTHED COALESCE. The authed
-- rule falls back to the topic's location as a third term. v_live_questions does
-- not expose it (it selects t.title, not t.location_label), and this function is
-- SECURITY INVOKER: reaching past the view to join questions/topics directly
-- would put anon back under those tables' RLS and re-create exactly the class of
-- bug being fixed here. The view is the RLS-bypassing boundary and this stays
-- behind it. The gap is unreachable today -- 0 live questions in either Dev or
-- UAT have a NULL audience_location_label, let alone a topic-only location -- and
-- such a row would be treated as 'Global' (shown everywhere) rather than hidden,
-- which fails open rather than blank.
--
-- Return type, argument list, defaults and the whole select list are unchanged --
-- in particular r.summary stays as PR 3.4 set it. Only the WHERE clause moves.

create or replace function public.get_live_questions_localized(
  p_language_code         text default 'en',
  p_limit                 integer default 50,
  p_offset                integer default 0,
  p_region_label          text default 'Global',
  p_exclude_country_label text default null)
returns table (
  id uuid, question text, summary text, tags text[], location_label text,
  published_at timestamp with time zone, status text, cover_image_url text,
  phase text, topic_title text, origin_location_label text,
  audience_location_label text, slider_low_label text, slider_high_label text,
  content_type text, video_recording_path text,
  rendition_id uuid)
language sql
stable
as $function$
  select
    v.id,
    r.rendered_text     as question,
    r.summary,
    v.tags,
    v.location_label,
    v.published_at,
    v.status,
    v.cover_image_url,
    v.phase,
    v.topic_title,
    v.origin_location_label,
    v.audience_location_label,
    r.slider_low_label  as slider_low_label,
    r.slider_high_label as slider_high_label,
    v.content_type,
    v.video_recording_path,
    r.rendition_id
  from public.v_live_questions v
  join lateral public.wording_for(v.id, p_language_code) r on true
  where
    case
      -- Global tab: everything except the reader's own country. A NULL
      -- audience counts as 'Global' and therefore survives.
      when coalesce(p_region_label, 'Global') = 'Global' then
        p_exclude_country_label is null
        or coalesce(v.audience_location_label, v.location_label, 'Global')
             is distinct from p_exclude_country_label
      -- Country tab: this country, plus the Global-audience questions that
      -- belong in every country's feed. Mirrors the authed rule.
      else
        coalesce(v.audience_location_label, v.location_label, 'Global')
          in ('Global', p_region_label)
    end
  order by v.published_at desc
  limit  greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

comment on function public.get_live_questions_localized(text, integer, integer, text, text) is
  'Anonymous homepage feed. Its region rule mirrors get_trending_questions_homepage: a country tab returns that country PLUS Global-audience questions, so a signed-out reader sees the same set a signed-in one does. Before 20260922030000 the country branch matched an exact country string only, which blanked the anon hero wherever the live content was Global-audience.';

-- Assert the property rather than a row count, so this is meaningful whatever
-- the environment happens to hold. Restricted to questions that actually resolve
-- wording in the language asked for -- wording_for is entitled to drop the rest,
-- and folding that in would make this fail for the wrong reason.
do $$
declare
  v_missing integer;
  v_probe   text := 'United States';
begin
  select count(*) into v_missing
  from public.v_live_questions v
  where coalesce(v.audience_location_label, v.location_label, 'Global') = 'Global'
    and exists (select 1 from public.wording_for(v.id, 'en'))
    and not exists (
      select 1
      from public.get_live_questions_localized('en', 1000, 0, v_probe, null) g
      where g.id = v.id);

  if v_missing > 0 then
    raise exception
      'anon country tab still drops % Global-audience question(s)', v_missing;
  end if;

  select count(*) into v_missing
  from public.v_live_questions v
  where v.audience_location_label is null
    and exists (select 1 from public.wording_for(v.id, 'en'))
    and not exists (
      select 1
      from public.get_live_questions_localized('en', 1000, 0, 'Global', v_probe) g
      where g.id = v.id);

  if v_missing > 0 then
    raise exception
      'global tab still drops % NULL-audience question(s)', v_missing;
  end if;

  raise notice 'anon feed region predicate OK';
end $$;
