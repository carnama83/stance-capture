create or replace view public.v_live_questions as
 SELECT q.id,
    q.question,
    q.summary,
    q.tags,
    q.location_label,
    q.published_at,
    q.status,
    q.cover_image_url,
    q.phase,
    t.title AS topic_title,
    q.origin_location_label,
    q.audience_location_label,
    q.slider_low_label,
    q.slider_high_label,
    q.content_type,
    q.video_recording_path
   FROM questions q
     JOIN topics t ON t.id = q.topic_id
     LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
  WHERE q.status = 'active'::text AND q.published_at IS NOT NULL AND (vr.visibility IS NULL OR vr.visibility = 'visible'::question_visibility_enum);

create or replace function public.get_live_questions_localized(p_language_code text DEFAULT 'en'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_region_label text DEFAULT 'Global'::text, p_exclude_country_label text DEFAULT NULL::text)
 returns SETOF v_live_questions
 language sql
 stable
as $function$
  select
    v.id,
    coalesce(r.rendered_text, v.question)              as question,
    v.summary,
    v.tags,
    v.location_label,
    v.published_at,
    v.status,
    v.cover_image_url,
    v.phase,
    v.topic_title,
    v.origin_location_label,
    v.audience_location_label,
    coalesce(r.slider_low_label, v.slider_low_label)   as slider_low_label,
    coalesce(r.slider_high_label, v.slider_high_label) as slider_high_label,
    v.content_type,
    v.video_recording_path
  from public.v_live_questions v
  left join public.question_renditions r
    on r.question_id = v.id
   and r.language_code = p_language_code
   and r.transform_status = 'published'
  where
    (p_region_label <> 'Global' and v.audience_location_label = p_region_label)
    or (p_region_label = 'Global' and p_exclude_country_label is not null and v.audience_location_label <> p_exclude_country_label)
    or (p_region_label = 'Global' and p_exclude_country_label is null)
  order by v.published_at desc
  limit  greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$function$;

drop function if exists public.get_trending_questions_homepage(uuid,text,text,uuid,integer,integer,text);

create or replace function public.get_trending_questions_homepage(p_user_id uuid, p_region_scope text, p_region_key text, p_location_id uuid, p_limit integer, p_offset integer, p_language_code text DEFAULT 'en'::text)
 returns TABLE(question_id uuid, question_text text, summary text, tags text[], topic_id uuid, topic_title text, tier text, location_label text, user_has_answered boolean, trend_micro_signal text, trend_score numeric, stance_momentum numeric, topic_momentum numeric, cover_image_url text, impact_normalized numeric, origin_location_label text, audience_location_label text, is_new_phase boolean, user_stance_value numeric, slider_low_label text, slider_high_label text, content_type text, video_recording_path text)
 language sql
 security definer
as $function$
with
cfg as (
  select
    max(value) filter (where key = 'stance_weight')                 as stance_weight,
    max(value) filter (where key = 'topic_weight')                  as topic_weight,
    max(value) filter (where key = 'lifecycle_weight')              as lifecycle_weight,
    max(value) filter (where key = 'stance_24h_weight')             as stance_24h_weight,
    max(value) filter (where key = 'stance_7d_weight')              as stance_7d_weight,
    max(value) filter (where key = 'stance_u24h_cap')               as stance_u24h_cap,
    max(value) filter (where key = 'stance_u7d_cap')                as stance_u7d_cap,
    max(value) filter (where key = 'stance_v6h_cap')                as stance_v6h_cap,
    max(value) filter (where key = 'topic_news_v24h_cap')           as topic_news_v24h_cap,
    max(value) filter (where key = 'breaking_topic_threshold')      as breaking_topic_threshold,
    max(value) filter (where key = 'breaking_stance_low_threshold') as breaking_stance_low_threshold,
    max(value) filter (where key = 'gaining_velocity_threshold')    as gaining_velocity_threshold,
    max(value) filter (where key = 'stable_7d_threshold')           as stable_7d_threshold,
    max(value) filter (where key = 'new_days')                      as new_days,
    max(value) filter (where key = 'stale_days')                    as stale_days,
    max(value) filter (where key = 'min_score_floor')               as min_score_floor,
    coalesce(max(value) filter (where key = 'impact_gate_min_score'), 7.0) as impact_gate_min_score,
    coalesce(max(value) filter (where key = 'impact_gate_enabled'),   1.0) as impact_gate_enabled
  from public.app_config_trending
),
base_questions as (
  select
    q.id                                                        as question_id,
    coalesce(r.rendered_text, q.question)                        as question_text,
    q.summary,
    q.tags,
    q.topic_id,
    t.title                                                      as topic_title,
    q.phase,
    coalesce(q.published_at, q.created_at)                       as opened_at,
    coalesce(q.location_label, t.location_label)                 as effective_location_label,
    q.cover_image_url,
    q.origin_location_label,
    q.audience_location_label,
    coalesce(r.slider_low_label, q.slider_low_label)             as slider_low_label,
    coalesce(r.slider_high_label, q.slider_high_label)           as slider_high_label,
    q.content_type,
    q.video_recording_path
  from public.questions q
  join public.topics t on t.id = q.topic_id
  left join public.question_renditions r
    on r.question_id = q.id
   and r.language_code = p_language_code
   and r.transform_status = 'published'
  where q.status = 'active'
    and q.published_at is not null
    and (
      coalesce(q.audience_location_label, q.location_label, t.location_label) is null
      or coalesce(q.audience_location_label, q.location_label, t.location_label) = 'Global'
      or (
        p_region_scope <> 'global'
        and coalesce(q.audience_location_label, q.location_label, t.location_label) = p_region_key
      )
    )
),
stance_stats as (
  select
    s.question_id,
    coalesce(s.unique_users_24h, 0)::numeric as unique_users_24h,
    coalesce(s.unique_users_7d,  0)::numeric as unique_users_7d,
    coalesce(s.velocity_6h,      0)::numeric as velocity_6h
  from public.question_stance_momentum_region_v s
  where s.region_scope = p_region_scope
    and s.region_key   = p_region_key
),
topic_stats as (
  select
    tr.topic_id,
    coalesce(tr.total_24h, 0)::numeric as topic_total_24h
  from public.topic_region_trends tr
  where tr.location_id = p_location_id
),
impact_scores as (
  select
    qis.question_id,
    qis.composite_score,
    least(coalesce(qis.composite_score, 0) / 10.0, 1.0)::numeric as impact_normalized
  from public.question_impact_scores qis
),
answered as (
  select
    qs.question_id,
    true              as user_has_answered,
    qs.score::numeric as user_stance_value
  from public.question_stances qs
  where p_user_id is not null
    and qs.user_id = p_user_id
),
followed_topics as (
  select topic_id
  from public.user_topic_follows
  where p_user_id is not null
    and user_id = p_user_id
),
followed_topic_ids as (
  select t.id as topic_id
  from public.topics t
  where t.id in (select topic_id from followed_topics)
  union
  select t.id as topic_id
  from public.topics t
  where t.parent_topic_id in (select topic_id from followed_topics)
),
phase_seen as (
  select
    uti.topic_id,
    uti.last_question_phase_seen
  from public.user_topic_interactions uti
  where p_user_id is not null
    and uti.user_id = p_user_id
),
scored as (
  select
    bq.question_id, bq.question_text, bq.summary, bq.tags, bq.topic_id, bq.topic_title,
    bq.cover_image_url, bq.effective_location_label, bq.opened_at,
    bq.origin_location_label, bq.audience_location_label,
    bq.slider_low_label, bq.slider_high_label,
    bq.content_type, bq.video_recording_path,
    (cfg.stance_24h_weight * least(coalesce(ss.unique_users_24h, 0) / nullif(cfg.stance_u24h_cap, 0), 1.0)
   + cfg.stance_7d_weight  * least(coalesce(ss.unique_users_7d,  0) / nullif(cfg.stance_u7d_cap,  0), 1.0))::numeric as stance_momentum,
    least(coalesce(ts.topic_total_24h, 0) / nullif(cfg.topic_news_v24h_cap, 0), 1.0)::numeric as topic_momentum,
    (case when bq.phase in ('new', 'initial') then 1.0 when bq.phase = 'active' then 0.6
          when bq.phase = 'dormant' then 0.2 else 0.4 end
     * case when bq.opened_at >= now() - (cfg.new_days::int || ' days')::interval then 1.0
            when bq.opened_at < now() - (cfg.stale_days::int || ' days')::interval then 0.4
            else 0.8 end
    )::numeric as lifecycle_modifier,
    coalesce(ss.velocity_6h, 0)::numeric        as velocity_6h,
    coalesce(a.user_has_answered, false)         as user_has_answered,
    a.user_stance_value                          as user_stance_value,
    imp.composite_score,
    coalesce(imp.impact_normalized, 0)::numeric  as impact_normalized,
    case
      when a.user_has_answered = true
        and ps.last_question_phase_seen is not null
        and ps.last_question_phase_seen is distinct from bq.phase
      then true
      else false
    end as is_new_phase,
    case
      when exists (select 1 from followed_topic_ids ft where ft.topic_id = bq.topic_id)
      then 1.5
      else 1.0
    end as followed_boost
  from base_questions bq
  left join stance_stats  ss  on ss.question_id  = bq.question_id
  left join topic_stats   ts  on ts.topic_id     = bq.topic_id
  left join impact_scores imp on imp.question_id = bq.question_id
  left join answered      a   on a.question_id   = bq.question_id
  left join phase_seen    ps  on ps.topic_id     = bq.topic_id
  cross join cfg
),
final as (
  select s.*,
    (cfg.stance_weight * s.stance_momentum + cfg.topic_weight * s.topic_momentum
   + cfg.lifecycle_weight * s.lifecycle_modifier + 0.30 * s.impact_normalized
    )::numeric * s.followed_boost as trend_score,
    (case when s.topic_momentum >= cfg.breaking_topic_threshold
               and s.stance_momentum < cfg.breaking_stance_low_threshold then 'breaking'
          when least(s.velocity_6h / nullif(cfg.stance_v6h_cap, 0), 1.0) >= cfg.gaining_velocity_threshold then 'gaining'
          when s.stance_momentum >= cfg.stable_7d_threshold then 'stable'
          else 'gaining' end)::text as trend_micro_signal,
    cfg.impact_gate_min_score, cfg.impact_gate_enabled, cfg.min_score_floor
  from scored s cross join cfg
),
gated as (
  select *, 1 as feed_priority from final
  where trend_score >= min_score_floor
    and (impact_gate_enabled < 1.0 or (impact_gate_enabled >= 1.0 and composite_score >= impact_gate_min_score))
),
fallback as (
  select *, 2 as feed_priority from final
  where (composite_score is null or composite_score < impact_gate_min_score)
    and trend_score >= min_score_floor
),
gated_count as (select count(*)::int as n from gated),
combined as (
  select * from gated
  union all
  select fb.* from fallback fb cross join gated_count gc where gc.n < (p_offset + p_limit)
)
select
  question_id, question_text, summary, tags, topic_id, topic_title,
  null::text as tier, effective_location_label as location_label,
  user_has_answered, trend_micro_signal, trend_score, stance_momentum, topic_momentum,
  cover_image_url, impact_normalized, origin_location_label, audience_location_label,
  is_new_phase, user_stance_value,
  slider_low_label,
  slider_high_label,
  content_type,
  video_recording_path
from combined
order by feed_priority asc, trend_score desc, topic_momentum desc, stance_momentum desc, opened_at desc
limit  greatest(coalesce(p_limit, 10), 1)
offset greatest(coalesce(p_offset, 0), 0);
$function$;
;
