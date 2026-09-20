-- PR 2a.1 (part 2a) — get_tailored_feed: localize it, and fix the fact that it
-- has been raising 42P13 at runtime.
--
-- FOUND WHILE REWRITING THIS FUNCTION, NOT PART OF THE MULTILINGUAL PLAN:
-- both overloads declare RETURNS SETOF v_live_questions (16 columns) but their
-- final SELECT lists only 14 -- content_type and video_recording_path are
-- missing. A SQL function's result shape is validated when it is CREATED, not
-- when the view it references later gains columns, so this passed creation and
-- then started failing on every call:
--
--   ERROR: 42P13: return type mismatch in function declared to return
--          v_live_questions
--   DETAIL: Final statement returns too few columns.
--
-- Confirmed by calling it on UAT. It is reached from
-- src/components/home/LatestQuestionsSection.tsx and src/hooks/useTailoredFeed.ts,
-- so the homepage "Latest Questions" section for logged-in users is dead. The
-- explicit RETURNS TABLE below removes the class of bug entirely: the function
-- no longer inherits its shape from a view that can drift underneath it.
--
-- The one-argument overload get_tailored_feed(integer) is DROPPED. Both call
-- sites pass {p_user_id, p_limit}, so they bind the two-argument form, and no
-- SQL function references it. Two overloads whose parameters all have defaults
-- is an ambiguity landmine in its own right: PostgREST resolves overloads by
-- the JSON body's key set, and a body of {p_limit} matches BOTH forms.
-- Collapsing to one function removes that.
--
-- Localization: wording now comes from wording_for(), so the feed renders in
-- the selected language and returns the exact rendition_id for each row. The
-- INNER lateral join is intentional -- see pr2a_01.

drop function if exists public.get_tailored_feed(integer);
drop function if exists public.get_tailored_feed(uuid, integer);

create function public.get_tailored_feed(
  p_user_id       uuid default null,
  p_limit         integer default 20,
  p_language_code text default 'en')
returns table (
  id uuid, question text, summary text, tags text[], location_label text,
  published_at timestamp with time zone, status text, cover_image_url text,
  phase text, topic_title text, origin_location_label text,
  audience_location_label text, slider_low_label text, slider_high_label text,
  content_type text, video_recording_path text,
  rendition_id uuid)
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  with me as (
    select coalesce(p_user_id, auth.uid()) as user_id
  ),
  my_region as (
    select
      urd.user_id, urd.city_label, urd.county_label,
      urd.state_label, urd.country_label, urd.global_label
    from public.user_region_dimensions urd
    join me on urd.user_id = me.user_id
  ),
  my_segment as (
    select p.audience_segment_id
    from me
    left join public.profiles p on p.user_id = me.user_id
  ),
  segment_match as (
    select
      qaf.question_id,
      min(case qaf.relevance_tier
            when 'direct'   then 0
            when 'adjacent' then 1
            else                 2
          end) as best_tier_rank
    from public.question_audience_fit qaf
    join my_segment ms on ms.audience_segment_id = qaf.audience_segment_id
    where ms.audience_segment_id is not null
    group by qaf.question_id
  ),
  base as (
    select
      v.*,
      r.rendered_text     as loc_question,
      r.slider_low_label  as loc_slider_low,
      r.slider_high_label as loc_slider_high,
      r.rendition_id      as loc_rendition_id,
      case
        when exists (
          select 1
          from public.question_stances qs
          join me on qs.user_id = me.user_id
          where qs.question_id = v.id
        ) then 1
        else 0
      end as answered_flag,
      qss.total_responses,
      qss.avg_score,
      coalesce(sm.best_tier_rank, 2) as segment_bucket,
      case
        when (select user_id from me) is null then 2
        when v.location_label is null then 3
        when mr.city_label   is not null and v.location_label = mr.city_label   then 0
        when mr.county_label is not null and v.location_label = mr.county_label then 0
        when mr.state_label  is not null and v.location_label = mr.state_label  then 0
        when mr.country_label is not null and v.location_label = mr.country_label then 0
        when v.location_label = 'Global' then 2
        else 3
      end as location_bucket,
      case
        when qss.total_responses is null then 2
        when qss.total_responses < 5 then 1
        else 0
      end as engagement_bucket,
      case
        when qss.avg_score is null then 1
        when abs(qss.avg_score) < 0.5 then 0
        else 1
      end as controversy_bucket
    from public.v_live_questions v
    join lateral public.wording_for(v.id, p_language_code) r on true
    left join my_region mr on true
    left join public.question_stance_stats qss on qss.question_id = v.id
    left join segment_match sm on sm.question_id = v.id
    where v.status = 'active'
  )
  select
    base.id,
    base.loc_question       as question,
    base.summary,
    base.tags,
    base.location_label,
    base.published_at,
    base.status,
    base.cover_image_url,
    base.phase,
    base.topic_title,
    base.origin_location_label,
    base.audience_location_label,
    base.loc_slider_low     as slider_low_label,
    base.loc_slider_high    as slider_high_label,
    base.content_type,
    base.video_recording_path,
    base.loc_rendition_id   as rendition_id
  from base
  order by
    base.answered_flag               asc,
    base.segment_bucket              asc,
    base.location_bucket             asc,
    base.engagement_bucket           asc,
    base.controversy_bucket          asc,
    coalesce(base.total_responses,0) desc,
    base.published_at                desc
  limit p_limit;
$function$;

comment on function public.get_tailored_feed(uuid, integer, text) is
  'Tailored feed for a signed-in user, localized via wording_for() and returning the exact rendition_id per row (PR 2a). Replaces two overloads that returned SETOF v_live_questions and had been failing with 42P13 since the view gained content_type and video_recording_path; the explicit RETURNS TABLE stops the shape being inherited from a view that can drift.';

notify pgrst, 'reload schema';
