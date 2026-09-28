-- Epic Report R5 — finding a report: the /reports picker.
--
-- list_reportable_questions lists the questions whose report the CALLER can
-- open, with search, topic / place filters and a sort. It reuses the two
-- existing decision points so the list can never disagree with the report:
--   * responses = get_question_community_stats(q).total (the same count the
--     question page and the report show)
--   * visibility = can_view_question_report(q) (the report's own gate; when
--     UGQ reports become proposer-only, the list follows automatically)
-- Only questions with at least one response are listed.
--
-- Question text is the published rendition in p_language, falling back to the
-- published original; text_language says which one was used.

create or replace function public.list_reportable_questions(
  p_search   text    default null,
  p_topic_id uuid    default null,
  p_location text    default null,
  p_sort     text    default 'recent',   -- recent | responses | newest | trending
  p_language text    default 'en',
  p_limit    integer default 20,
  p_offset   integer default 0
)
returns table (
  question_id      uuid,
  question_text    text,
  text_language    text,
  topic_id         uuid,
  topic_title      text,
  location_label   text,
  created_by_type  text,
  published_at     timestamptz,
  closed_at        timestamptz,
  responses        integer,
  last_response_at timestamptz,
  total_count      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with args as (
    select lower(split_part(coalesce(nullif(trim(p_language), ''), 'en'), '-', 1)) as lang,
           nullif(trim(p_search), '') as search,
           nullif(trim(p_location), '') as place,
           least(greatest(coalesce(p_limit, 20), 1), 50) as lim,
           greatest(coalesce(p_offset, 0), 0) as off
  ),
  base as (
    select q.id, q.topic_id, q.location_label, q.published_at, q.archived_at,
           q.proposed_by, q.source, q.trending_score, q.question
      from public.questions q, args a
     where q.published_at is not null
       and q.status = 'active'
       and (p_topic_id is null or q.topic_id = p_topic_id)
       and (a.place is null or q.location_label ilike '%' || replace(replace(a.place, '%', '\%'), '_', '\_') || '%')
  ),
  counted as (
    select b.*,
           coalesce((public.get_question_community_stats(b.id) ->> 'total')::int, 0) as responses,
           greatest(
             (select max(s.created_at) from public.question_stances s where s.question_id = b.id),
             (select max(p.created_at) from public.question_stances_pending p
               where p.question_id = b.id and coalesce(p.committed, false) = false)
           ) as last_response_at
      from base b
  ),
  viewable as (
    select c.* from counted c
     where c.responses > 0
       and public.can_view_question_report(c.id)
  ),
  worded as (
    select v.*, w.rendered_text as text, w.language_code as text_language
      from viewable v
      cross join args a
      left join lateral (
        select r.rendered_text, r.language_code
          from public.question_renditions r
         where r.question_id = v.id
           and r.lifecycle_status = 'published'
           and (r.language_code = a.lang or r.rendition_type = 'original')
         order by (r.language_code = a.lang) desc, (r.rendition_type = 'original') desc
         limit 1
      ) w on true
  ),
  searched as (
    select w.* from worded w, args a
     where a.search is null
        or w.text ilike '%' || replace(replace(a.search, '%', '\%'), '_', '\_') || '%'
        or w.question ilike '%' || replace(replace(a.search, '%', '\%'), '_', '\_') || '%'
  )
  select s.id, coalesce(s.text, s.question), coalesce(s.text_language, 'en'), s.topic_id, t.title,
         s.location_label,
         case when s.proposed_by is not null or s.source = 'community' then 'community' else 'admin' end,
         s.published_at, s.archived_at::timestamptz, s.responses, s.last_response_at,
         count(*) over ()
    from searched s
    left join public.topics t on t.id = s.topic_id
    cross join args a
   order by
     case when p_sort = 'responses' then s.responses end desc nulls last,
     case when p_sort = 'newest' then s.published_at end desc nulls last,
     case when p_sort = 'trending' then s.trending_score end desc nulls last,
     s.last_response_at desc nulls last,
     s.id
   limit (select lim from args) offset (select off from args);
$$;

grant execute on function public.list_reportable_questions(text, uuid, text, text, text, integer, integer) to anon, authenticated;

-- The topics and places that currently have at least one report the caller
-- can open — so the filters never offer an empty choice.
create or replace function public.list_report_filters()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select q.topic_id, t.title as topic_title, q.location_label
      from public.questions q
      left join public.topics t on t.id = q.topic_id
     where q.published_at is not null
       and q.status = 'active'
       and coalesce((public.get_question_community_stats(q.id) ->> 'total')::int, 0) > 0
       and public.can_view_question_report(q.id)
  )
  select jsonb_build_object(
    'topics', coalesce((select jsonb_agg(jsonb_build_object('id', topic_id, 'title', topic_title, 'count', n) order by topic_title)
                          from (select topic_id, topic_title, count(*) n from r where topic_id is not null group by 1, 2) x), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('label', location_label, 'count', n) order by location_label)
                             from (select location_label, count(*) n from r where location_label is not null group by 1) y), '[]'::jsonb)
  );
$$;

grant execute on function public.list_report_filters() to anon, authenticated;
