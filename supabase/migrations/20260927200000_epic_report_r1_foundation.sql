-- Epic Report R1 — data foundation for the per-question Insight Report.
--
--   RPT-01  question_stance_definitions: what each of the five positions means
--           for one exact rendition (the wording a respondent actually saw).
--           Generated once per rendition by the generate-stance-definitions
--           edge function; ai-stance-tip reads from here so the slider tip and
--           the report describe each position identically.
--   RPT-05  can_view_question_report(): the ONLY place report visibility is
--           decided. MVP rule: any published question with >= 1 response.
--   RPT-03/04 get_question_insight_report(): the deterministic statistical
--           layer. Every number the report (and later the AI) uses is computed
--           here — the model never calculates.
--
-- The response set deliberately mirrors get_question_community_stats exactly
-- (committed stances + uncommitted anonymous pending rows, flagged and
-- invalidated-rendition responses excluded, WhatsApp responders who later
-- answered natively not double counted), so the report can never disagree
-- with the numbers already shown on the question page.

-- ---------------------------------------------------------------------------
-- RPT-01
-- ---------------------------------------------------------------------------
create table if not exists public.question_stance_definitions (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions(id) on delete cascade,
  rendition_id   uuid not null references public.question_renditions(id) on delete cascade,
  language_code  text not null,
  score          smallint not null check (score between -2 and 2),
  -- The scale end label for -2/+2 (copied from the rendition). NULL for
  -- -1/0/+1: those labels are UI chrome built by buildStanceLabels().
  label          text,
  -- User-facing, second person — what the slider shows.
  ai_tip         text not null,
  -- Third person, richer — input for reporting, never shown as a quote.
  interpretation text not null,
  model          text,
  prompt_version text,
  generated_at   timestamptz not null default now(),
  unique (rendition_id, score)
);

create index if not exists question_stance_definitions_question_idx
  on public.question_stance_definitions (question_id);

alter table public.question_stance_definitions enable row level security;

-- Definitions describe positions on a public question; nothing personal.
-- Writes are service-role only (no insert/update/delete policy).
drop policy if exists qsd_public_read on public.question_stance_definitions;
create policy qsd_public_read on public.question_stance_definitions
  for select using (true);

grant select on public.question_stance_definitions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPT-05
-- ---------------------------------------------------------------------------
-- Uses auth.uid() directly rather than taking a user id argument, so a caller
-- cannot probe whether an arbitrary user is an admin. Long-run rule (UGQ
-- reports limited to proposer + admins) is a change to this body only.
create or replace function public.can_view_question_report(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null
         and exists (select 1 from public.admin_users a where a.user_id = auth.uid())
      then exists (select 1 from public.questions q where q.id = p_question_id)
    else
      exists (
        select 1 from public.questions q
        where q.id = p_question_id
          and q.published_at is not null
          and q.status = 'active'
          and exists (
            select 1 from public.question_renditions r
            where r.question_id = q.id and r.lifecycle_status = 'published')
      )
      and (
        exists (
          select 1 from public.question_stances s
          where s.question_id = p_question_id
            and coalesce(s.is_flagged, false) = false)
        or exists (
          select 1 from public.question_stances_pending p
          where p.question_id = p_question_id
            and coalesce(p.committed, false) = false)
      )
  end;
$$;

grant execute on function public.can_view_question_report(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPT-03 / RPT-04
-- ---------------------------------------------------------------------------
create or replace function public.get_question_insight_report(
  p_question_id uuid,
  p_language    text default 'en'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lang        text := lower(split_part(coalesce(nullif(trim(p_language), ''), 'en'), '-', 1));
  v_q           public.questions%rowtype;
  v_r           public.question_renditions%rowtype;
  v_fallback    boolean := false;
  v_rows        jsonb;
  v_total       int;
  v_first       timestamptz;
  v_last        timestamptz;
  v_chunk       int;
  v_max_chunk   int;
  v_bucket      text;
  v_topic       text;
  v_result      jsonb;
begin
  if not public.can_view_question_report(p_question_id) then
    raise exception 'report_not_available' using errcode = '42501';
  end if;

  select * into v_q from public.questions where id = p_question_id;

  -- Wording shown in the report: the reader's language if a published
  -- rendition exists, otherwise the published original. Unlike wording_for(),
  -- the report always falls back (it is aggregate, and the flag tells the UI).
  select * into v_r from public.question_renditions r
   where r.question_id = p_question_id
     and r.lifecycle_status = 'published'
     and r.language_code = v_lang
   order by r.published_at desc nulls last
   limit 1;
  if not found then
    select * into v_r from public.question_renditions r
     where r.question_id = p_question_id
       and r.lifecycle_status = 'published'
       and r.rendition_type = 'original'
     order by r.published_at desc nulls last
     limit 1;
    v_fallback := true;
  end if;

  select t.title into v_topic from public.topics t where t.id = v_q.topic_id;

  -- The response set, identical to get_question_community_stats. Held as
  -- jsonb once so every aggregate below reads the same snapshot.
  with verified as (
    select qs.score::int as s, true as v, qs.user_id as u, qs.rendition_id as r,
           qs.created_at as t, coalesce(qs.source, 'native') as src
    from public.question_stances qs
    where qs.question_id = p_question_id
      and coalesce(qs.is_flagged, false) = false
      and public.stance_counts_toward_aggregate(qs.rendition_id)
  ),
  anonymous as (
    select p.score::int, false, null::uuid, p.rendition_id,
           p.created_at, coalesce(p.source, 'web_forward')
    from public.question_stances_pending p
    left join public.whatsapp_forward_chains w on w.id = p.forward_chain_id
    where p.question_id = p_question_id
      and coalesce(p.committed, false) = false
      and public.stance_counts_toward_aggregate(p.rendition_id)
      and not exists (
        select 1 from public.question_stances qs
        where qs.question_id = p_question_id
          and w.responder_user_id is not null
          and qs.user_id = w.responder_user_id
      )
  ),
  allrows as (
    select * from verified union all select * from anonymous
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           's', s, 'v', v, 'u', u, 'r', r, 't', t, 'src', src) order by t), '[]'::jsonb),
         count(*), min(t), max(t)
    into v_rows, v_total, v_first, v_last
    from allrows;

  -- Trend bucketing. Small samples go by response order in chunks of at
  -- least 3 (so no point ever reveals one person's score); a short remainder
  -- is folded into the previous chunk.
  if v_total < 30 then
    v_bucket    := 'sequence';
    v_chunk     := greatest(3, ceil(v_total / 8.0)::int);
    v_max_chunk := greatest(floor(v_total::numeric / v_chunk)::int - 1, 0);
  elsif v_last - v_first <= interval '60 days' then
    v_bucket := 'day';
  else
    v_bucket := 'week';
  end if;

  with x as (
    select *, row_number() over (order by t) as rn
    from jsonb_to_recordset(v_rows) as x(s int, v boolean, u uuid, r uuid, t timestamptz, src text)
  ),
  dist as (
    select g.score,
           count(x.s)::int as cnt
    from generate_series(-2, 2) as g(score)
    left join x on x.s = g.score
    group by g.score
  ),
  -- Rendition change classification over the canonical-language originals.
  canon as (
    select r.id, r.version, r.published_at, r.rendered_text, r.slider_low_label,
           r.slider_high_label, r.context_summary, r.summary,
           lag(r.id)                over w as prev_id,
           lag(r.rendered_text)     over w as prev_text,
           lag(r.slider_low_label)  over w as prev_low,
           lag(r.slider_high_label) over w as prev_high,
           lag(r.context_summary)   over w as prev_ctx,
           lag(r.summary)           over w as prev_summary
    from public.question_renditions r
    where r.question_id = p_question_id
      and r.rendition_type = 'original'
      and r.published_at is not null
    window w as (order by r.published_at, r.version)
  ),
  changes as (
    select c.*,
           (c.rendered_text is distinct from c.prev_text) as wording_changed,
           (c.slider_low_label is distinct from c.prev_low
              or c.slider_high_label is distinct from c.prev_high) as scale_changed,
           (c.context_summary is distinct from c.prev_ctx
              or c.summary is distinct from c.prev_summary) as context_changed,
           (select count(*) from x where x.t < c.published_at)::int as responses_before
    from canon c
    where c.prev_id is not null
  ),
  classified as (
    select *,
           case when wording_changed then 'wording'
                when scale_changed   then 'scale'
                when context_changed then 'context'
                else 'none' end as kind
    from changes
  ),
  seq as (
    select least((rn - 1) / v_chunk, v_max_chunk)::int as b, s, rn, t
    from x where v_bucket = 'sequence'
  ),
  timed as (
    select to_char(date_trunc(v_bucket, t at time zone 'UTC'), 'YYYY-MM-DD') as b, s, rn, t
    from x where v_bucket in ('day', 'week')
  ),
  buckets as (
    select b::text as key, count(*)::int as responses, sum(s)::int as score_sum,
           min(rn)::int as from_n, max(rn)::int as to_n, min(t) as from_t, max(t) as to_t
    from seq group by b
    union all
    select b, count(*)::int, sum(s)::int, min(rn)::int, max(rn)::int, min(t), max(t)
    from timed group by b
  ),
  trend as (
    select key, responses, from_n, to_n, from_t, to_t,
           sum(responses) over (order by from_n)::int as cumulative,
           sum(score_sum) over (order by from_n)::numeric as cum_sum,
           score_sum
    from buckets
  ),
  -- One city per respondent (a user can hold several location rows), the
  -- same max() pick refresh_question_stance_stats_region uses.
  located as (
    select c.city, x.s
    from x
    join lateral (
      select max(l.name) as city
      from public.user_location_settings uls
      join public.locations l on l.id = uls.location_id
       and l.type = 'city'::location_tier_enum
      where uls.user_id = x.u
    ) c on c.city is not null
    where x.v
  ),
  city_counts as (
    select city, count(*)::int as cnt, avg(s) as mean from located group by city
  ),
  geo as (
    select case when cnt >= 5 then city else 'Other' end as region,
           sum(cnt)::int as cnt,
           case when bool_and(cnt >= 5) then round(avg(mean), 2) end as mean
    from city_counts
    group by 1
  )
  select jsonb_build_object(
    'questionId',       p_question_id,
    'language',         coalesce(v_r.language_code, 'en'),
    'requestedLanguage', v_lang,
    'fallbackLanguage', v_fallback,
    'generatedAt',      now(),
    'question', jsonb_build_object(
      'text',               v_r.rendered_text,
      'summary',            v_r.summary,
      'context',            v_r.context_summary,
      'lowLabel',           v_r.slider_low_label,
      'highLabel',          v_r.slider_high_label,
      'location',           v_q.location_label,
      'topic',              v_topic,
      'createdByType',      case when v_q.proposed_by is not null or v_q.source = 'community'
                                 then 'community' else 'admin' end,
      'createdAt',          v_q.published_at,
      'closedAt',           v_q.archived_at,
      'currentRenditionId', v_r.id
    ),
    'responseSummary', jsonb_build_object(
      'total',     v_total,
      'signedIn',  (select count(*) from x where v)::int,
      'anonymous', (select count(*) from x where not v)::int,
      'distribution', (select jsonb_agg(jsonb_build_object(
                         'score', score, 'count', cnt,
                         'percentage', case when v_total > 0
                                            then round(cnt * 100.0 / v_total)::int else 0 end)
                         order by score) from dist),
      'mean',   (select round(avg(s), 2) from x),
      'median', (select percentile_disc(0.5) within group (order by s) from x),
      'lean', jsonb_build_object(
                'low',     (select count(*) from x where s < 0)::int,
                'neutral', (select count(*) from x where s = 0)::int,
                'high',    (select count(*) from x where s > 0)::int),
      'strength', case when v_total < 30 then 'early'
                       when v_total < 100 then 'emerging'
                       else 'established' end,
      'firstResponseAt', v_first,
      'lastResponseAt',  v_last
    ),
    'stanceDefinitions', (
      select case when count(*) = 5 then jsonb_agg(jsonb_build_object(
               'score', d.score, 'label', d.label, 'aiTip', d.ai_tip,
               'interpretation', d.interpretation) order by d.score) end
      from public.question_stance_definitions d
      where d.rendition_id = v_r.id
    ),
    'renditions', (
      -- Responses recorded before rendition provenance existed have a NULL
      -- rendition_id; they are listed as one entry with renditionId null so
      -- the per-rendition counts always add up to the total.
      select coalesce(jsonb_agg(jsonb_build_object(
               'renditionId', g.r, 'language', r.language_code, 'type', r.rendition_type,
               'version', r.version, 'publishedAt', r.published_at, 'responses', g.cnt)
               order by r.published_at nulls first), '[]'::jsonb)
      from (select x.r, count(*)::int as cnt from x group by x.r) g
      left join public.question_renditions r on r.id = g.r
    ),
    -- Only material changes after the first response become trend markers.
    'changes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'at', published_at, 'kind', kind,
               'wordingChanged', wording_changed, 'scaleChanged', scale_changed,
               'contextChanged', context_changed,
               'fromRenditionId', prev_id, 'toRenditionId', id,
               'responsesBefore', responses_before) order by published_at), '[]'::jsonb)
      from classified where kind <> 'none' and responses_before > 0
    ),
    'preResponseEdits', (select count(*) from classified where kind <> 'none' and responses_before = 0)::int,
    'republishesWithoutChange', (select count(*) from classified where kind = 'none')::int,
    'trend', jsonb_build_object(
      'bucket', v_bucket,
      'points', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'key', key, 'responses', responses, 'cumulative', cumulative,
                 'fromResponse', from_n, 'toResponse', to_n, 'from', from_t, 'to', to_t,
                 'bucketMean', case when responses >= 3 then round(score_sum::numeric / responses, 2) end,
                 'cumulativeMean', case when cumulative >= 3 then round(cum_sum / cumulative, 2) end)
                 order by from_n), '[]'::jsonb)
        from trend)
    ),
    'channels', (
      select coalesce(jsonb_agg(jsonb_build_object('source', src, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (select src, count(*)::int as cnt from x group by src) c
    ),
    'geography', (
      select case when coalesce(sum(cnt), 0) >= 5 then
               jsonb_agg(jsonb_build_object('region', region, 'count', cnt, 'mean', mean)
                         order by (region = 'Other'), cnt desc) end
      from geo
    ),
    'reasons', null
  )
  into v_result
  from (select 1) one;

  return v_result;
end;
$$;

grant execute on function public.get_question_insight_report(uuid, text) to anon, authenticated;
