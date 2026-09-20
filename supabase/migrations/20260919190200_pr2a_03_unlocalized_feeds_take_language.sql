-- PR 2a.1 (part 2b) — the four feeds that took no language at all.
--
-- get_for_you_feed, get_personalized_feed, get_three_tier_curated_feed_v2 and
-- get_trending_questions_v3 all select questions.question directly -- the
-- canonical English column -- with no language parameter anywhere in their
-- signature. That is the root cause of the mixed-language Up Next carousel: a
-- Hindi reader gets Hindi from the localized RPCs and English from these, side
-- by side on the same page.
--
-- Each gains p_language_code, joins wording_for() laterally for its wording,
-- and returns the exact rendition_id per row.
--
-- Every signature changes, so each is DROP + CREATE rather than CREATE OR
-- REPLACE -- adding a parameter would otherwise leave the old form live
-- alongside the new one and PostgREST could bind either.
--
-- get_curated_feed and get_three_tier_curated_feed are deliberately NOT touched:
-- neither has a single caller in src/ or supabase/functions/. Localizing dead
-- RPCs would be work with no consumer.
--
-- Two SECURITY DEFINER functions here had no search_path pinned and referenced
-- tables unqualified (get_three_tier_curated_feed_v2). Both are fixed while
-- rewriting: definer-rights functions with a loose search_path are the exact
-- hardening gap this codebase has hit before.

drop function if exists public.get_for_you_feed(integer, integer);
drop function if exists public.get_personalized_feed(uuid, integer, integer);
drop function if exists public.get_three_tier_curated_feed_v2(uuid, date, text);
drop function if exists public.get_trending_questions_v3(uuid, text, integer);

-- ── 1 of 4 · For You (returns jsonb) ────────────────────────────────────────
create function public.get_for_you_feed(
  p_limit         integer default 10,
  p_offset        integer default 0,
  p_language_code text default 'en')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  WITH user_region AS (
    SELECT city_label, county_label, state_label, country_label
    FROM public.user_region_dimensions
    WHERE user_id = v_uid
  ),
  followed_topics AS (
    SELECT topic_id
    FROM public.user_topic_follows
    WHERE user_id = v_uid
  ),
  scored AS (
    SELECT DISTINCT
      q.id,
      r.rendered_text AS question,
      q.summary,
      q.published_at,
      q.cover_image_url,
      q.tags,
      COALESCE(t.title, t2.title)  AS topic_title,
      COALESCE(qd.topic_id, t2.id) AS topic_id,
      r.rendition_id               AS rendition_id,
      (
        CASE WHEN EXISTS (
          SELECT 1 FROM followed_topics ft
          WHERE ft.topic_id = COALESCE(qd.topic_id, q.topic_draft_id)
        ) THEN 2.0 ELSE 1.0 END
        *
        CASE
          WHEN q.location_label = (SELECT city_label    FROM user_region WHERE city_label    IS NOT NULL LIMIT 1) THEN 1.5
          WHEN q.location_label = (SELECT state_label   FROM user_region WHERE state_label   IS NOT NULL LIMIT 1) THEN 1.2
          WHEN q.location_label = (SELECT country_label FROM user_region WHERE country_label IS NOT NULL LIMIT 1) THEN 1.1
          ELSE 1.0
        END
        /
        NULLIF(GREATEST(EXTRACT(EPOCH FROM (now() - q.published_at)) / 86400.0, 1.0), 0)
      ) AS rank_score
    FROM public.questions q
    JOIN LATERAL public.wording_for(q.id, p_language_code) r ON TRUE
    LEFT JOIN public.question_drafts qd ON qd.id = q.question_draft_id
    LEFT JOIN public.topics t  ON t.id  = qd.topic_id
    LEFT JOIN public.topics t2 ON t2.id = q.topic_draft_id
    WHERE q.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.question_stances qs
        WHERE qs.question_id = q.id AND qs.user_id = v_uid
      )
      AND (
        EXISTS (
          SELECT 1 FROM followed_topics ft
          WHERE ft.topic_id = COALESCE(qd.topic_id, q.topic_draft_id)
        )
        OR q.location_label IN (
          SELECT city_label    FROM user_region WHERE city_label    IS NOT NULL
          UNION
          SELECT state_label   FROM user_region WHERE state_label   IS NOT NULL
          UNION
          SELECT country_label FROM user_region WHERE country_label IS NOT NULL
        )
      )
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',              id,
        'question',        question,
        'summary',         summary,
        'topic_title',     topic_title,
        'topic_id',        topic_id,
        'published_at',    published_at,
        'cover_image_url', cover_image_url,
        'tags',            tags,
        'rendition_id',    rendition_id
      )
      ORDER BY rank_score DESC, published_at DESC
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT * FROM scored
    ORDER BY rank_score DESC, published_at DESC
    LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'questions', v_result,
    'count',     jsonb_array_length(v_result)
  );
end;
$function$;

-- ── 2 of 4 · Personalized feed ──────────────────────────────────────────────
create function public.get_personalized_feed(
  p_user_id       uuid,
  p_limit         integer default 20,
  p_offset        integer default 0,
  p_language_code text default 'en')
returns table (
  question_id uuid, topic_id uuid, question text, summary text, tags text[],
  state text, published_at timestamp with time zone, is_trending boolean,
  trending_score numeric, user_has_answered boolean, topic_title text,
  topic_tags text[], relevance_score numeric, response_count bigint,
  phase text, is_new_phase boolean, cover_image_url text,
  rendition_id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_city    text;
  v_state   text;
  v_country text;
BEGIN
  SELECT city_label, state_label, country_label
  INTO   v_city,     v_state,     v_country
  FROM public.user_region_dimensions
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_country IS NULL THEN
    v_country := 'United States';
  END IF;

  RETURN QUERY
  SELECT
    q.id AS question_id,
    q.topic_id,
    r.rendered_text AS question,
    q.summary,
    q.tags,
    q.state::text AS state,
    q.published_at,
    COALESCE(q.is_trending, false) AS is_trending,
    COALESCE(q.trending_score, 0) AS trending_score,

    EXISTS(
      SELECT 1
      FROM public.question_stances qs
      WHERE qs.question_id = q.id
        AND qs.user_id = p_user_id
    ) AS user_has_answered,

    t.title AS topic_title,
    t.tags AS topic_tags,

    (
      10.0
      + CASE WHEN EXISTS(
          SELECT 1 FROM public.user_follows uf
          WHERE uf.user_id = p_user_id
            AND uf.follow_type = 'topic'
            AND uf.follow_id = q.topic_id
        ) THEN 20.0 ELSE 0.0 END

      + CASE WHEN v_city IS NOT NULL
          AND q.location_label ILIKE '%' || v_city || '%'
        THEN 15.0 ELSE 0.0 END

      + CASE WHEN v_state IS NOT NULL
          AND q.location_label ILIKE '%' || v_state || '%'
        THEN 10.0 ELSE 0.0 END

      + CASE WHEN v_country IS NOT NULL
          AND q.location_label ILIKE '%' || v_country || '%'
        THEN 5.0 ELSE 0.0 END

      + CASE WHEN q.state = 'new' THEN 12.0 ELSE 0.0 END
      + CASE WHEN COALESCE(q.is_trending, false) THEN 10.0 ELSE 0.0 END
      + COALESCE(
          (SELECT qem.response_rate_24h * 2.0
           FROM public.question_engagement_metrics qem
           WHERE qem.question_id = q.id),
          0.0
        )

      + CASE
          WHEN q.location_label IS NULL OR q.location_label = '' THEN 0.0
          WHEN v_country IS NOT NULL AND q.location_label ILIKE '%' || v_country || '%' THEN 0.0
          ELSE -1000000000.0
        END
    ) AS relevance_score,

    COALESCE(
      (SELECT COUNT(*) FROM public.question_stances qs2 WHERE qs2.question_id = q.id),
      0
    )::bigint AS response_count,

    q.phase,

    CASE
      WHEN EXISTS(
        SELECT 1
        FROM public.user_topic_interactions uti
        WHERE uti.user_id = p_user_id
          AND uti.topic_id = q.topic_id
          AND uti.last_question_phase_seen IS DISTINCT FROM q.phase
      ) THEN true
      ELSE false
    END AS is_new_phase,

    q.cover_image_url,
    r.rendition_id

  FROM public.questions q
  JOIN public.topics t ON t.id = q.topic_id
  JOIN LATERAL public.wording_for(q.id, p_language_code) r ON TRUE
  WHERE
    q.status = 'active'
    AND q.state IN ('new', 'active')

    AND NOT EXISTS(
      SELECT 1
      FROM public.question_stances qs_check
      WHERE qs_check.question_id = q.id
        AND qs_check.user_id = p_user_id
    )

    AND (
      q.location_label IS NULL
      OR q.location_label = ''
      OR (v_country IS NOT NULL AND q.location_label ILIKE '%' || v_country || '%')
    )

  ORDER BY relevance_score DESC, q.published_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- ── 3 of 4 · Three-tier curated feed ────────────────────────────────────────
create function public.get_three_tier_curated_feed_v2(
  p_user_id       uuid default null,
  p_date          date default CURRENT_DATE,
  p_ip_country    text default null,
  p_language_code text default 'en')
returns table (
  tier text, tier_label text, question_id uuid, question text, summary text,
  tags text[], location_label text, composite_score numeric, tier_position integer,
  rendition_id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_city TEXT := NULL;
  v_state TEXT := NULL;
  v_country TEXT := NULL;
BEGIN
  IF p_user_id IS NOT NULL THEN
    BEGIN
      SELECT
        max(CASE WHEN l.type = 'city'::location_tier_enum THEN l.name END),
        max(CASE WHEN l.type = 'state'::location_tier_enum THEN l.name END),
        max(CASE WHEN l.type = 'country'::location_tier_enum THEN l.name END)
      INTO v_city, v_state, v_country
      FROM public.user_location_settings uls
      LEFT JOIN public.locations l ON l.id = uls.location_id
      WHERE uls.user_id = p_user_id;
    EXCEPTION WHEN OTHERS THEN
      v_city := NULL;
      v_state := NULL;
      v_country := NULL;
    END;
  ELSIF p_ip_country IS NOT NULL THEN
    v_country := p_ip_country;
  END IF;

  RETURN QUERY
  WITH
  local_questions AS (
    SELECT
      'local'::TEXT as q_tier,
      COALESCE(v_city, v_state, 'Local')::TEXT as q_tier_label,
      q.id as q_id,
      r.rendered_text as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score,
      r.rendition_id as q_rendition_id
    FROM public.questions q
    JOIN LATERAL public.wording_for(q.id, p_language_code) r ON TRUE
    LEFT JOIN public.topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND (tis.composite_score IS NULL OR tis.composite_score >= 5.5)
      AND p_user_id IS NOT NULL
      AND (
        (v_city IS NOT NULL AND q.location_label ILIKE '%' || v_city || '%')
        OR (v_state IS NOT NULL AND q.location_label ILIKE '%' || v_state || '%')
      )
    ORDER BY tis.composite_score DESC NULLS LAST
    LIMIT 5
  ),
  national_questions AS (
    SELECT
      'national'::TEXT as q_tier,
      COALESCE(v_country, 'National')::TEXT as q_tier_label,
      q.id as q_id,
      r.rendered_text as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score,
      r.rendition_id as q_rendition_id
    FROM public.questions q
    JOIN LATERAL public.wording_for(q.id, p_language_code) r ON TRUE
    LEFT JOIN public.topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND (tis.composite_score IS NULL OR tis.composite_score >= 5.0)
      AND v_country IS NOT NULL
      AND q.location_label ILIKE '%' || v_country || '%'
      AND q.id NOT IN (SELECT q_id FROM local_questions)
    ORDER BY tis.composite_score DESC NULLS LAST
    LIMIT 6
  ),
  global_questions AS (
    SELECT
      'global'::TEXT as q_tier,
      'Global'::TEXT as q_tier_label,
      q.id as q_id,
      r.rendered_text as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score,
      r.rendition_id as q_rendition_id
    FROM public.questions q
    JOIN LATERAL public.wording_for(q.id, p_language_code) r ON TRUE
    LEFT JOIN public.topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND (tis.composite_score IS NULL OR tis.composite_score >= 5.0)
      AND q.id NOT IN (
        SELECT q_id FROM local_questions
        UNION
        SELECT q_id FROM national_questions
      )
      AND (
        q.location_label IS NULL
        OR q.location_label = 'Global'
        OR q.location_label = ''
      )
    ORDER BY tis.composite_score DESC NULLS LAST
    LIMIT 15
  ),
  combined AS (
    SELECT
      q_tier, q_tier_label, q_id, q_text, q_summary, q_tags, q_location,
      q_score, q_rendition_id,
      ROW_NUMBER() OVER (ORDER BY
        CASE q_tier
          WHEN 'local' THEN 1
          WHEN 'national' THEN 2
          WHEN 'global' THEN 3
        END,
        q_score DESC
      )::INT as q_position
    FROM (
      SELECT * FROM local_questions
      UNION ALL
      SELECT * FROM national_questions
      UNION ALL
      SELECT * FROM global_questions
    ) all_tiers
  )
  SELECT
    combined.q_tier,
    combined.q_tier_label,
    combined.q_id,
    combined.q_text,
    combined.q_summary,
    combined.q_tags,
    combined.q_location,
    combined.q_score,
    combined.q_position,
    combined.q_rendition_id
  FROM combined
  ORDER BY combined.q_position;

END;
$function$;

-- ── 4 of 4 · Trending questions v3 ──────────────────────────────────────────
create function public.get_trending_questions_v3(
  p_user_id       uuid default null,
  p_location_tier text default 'global',
  p_limit         integer default 15,
  p_language_code text default 'en')
returns table (
  question_id uuid, question text, summary text, tags text[],
  published_at timestamp with time zone, stance_momentum double precision,
  topic_momentum double precision, community_engagement_score double precision,
  lifecycle_modifier double precision, final_trending_score double precision,
  trend_signal text, trend_direction integer, region_scope text,
  trend_reason text, user_has_answered boolean, user_stance_value integer,
  user_answer_date timestamp with time zone, response_count_24h integer,
  response_count_7d integer, response_velocity double precision,
  unique_responders_24h integer, first_response_at timestamp with time zone,
  topic_id uuid, topic_title text, topic_tags text[], question_phase text,
  days_since_published integer, source_count integer,
  source_diversity_score double precision,
  rendition_id uuid)
language sql
stable
set search_path to 'public'
as $function$
WITH scored_questions AS (
  SELECT
    q.id as question_id,
    r.rendered_text as question,
    q.summary,
    q.tags,
    q.published_at,
    q.topic_id,
    q.state::TEXT as question_phase,
    q.created_at,
    r.rendition_id as rendition_id,

    LEAST(100.0,
      COALESCE(
        (
          (SELECT COUNT(DISTINCT user_id)::FLOAT8
           FROM public.question_stances
           WHERE question_id = q.id
             AND created_at >= NOW() - INTERVAL '1 day'
          ) / NULLIF(
            (SELECT COUNT(DISTINCT user_id)::FLOAT8
             FROM public.question_stances
             WHERE created_at >= NOW() - INTERVAL '7 days'
            ),
            0
          ) * 100
        ),
        0.0
      )
    ) as stance_momentum,

    COALESCE(t.trending_score::FLOAT8, 0.0) as topic_momentum,

    LEAST(100.0,
      COALESCE(
        (
          (SELECT COUNT(*)::FLOAT8
           FROM public.comments
           WHERE question_id = q.id
             AND created_at >= NOW() - INTERVAL '24 hours'
          ) / NULLIF(
            (EXTRACT(EPOCH FROM (NOW() - q.published_at)) / 3600 + 1)::FLOAT8,
            0
          ) * 10
        ),
        0.0
      )
    ) as community_engagement_score,

    (SELECT COUNT(*)::INT
     FROM public.question_stances
     WHERE question_id = q.id
       AND created_at >= NOW() - INTERVAL '24 hours'
    ) as response_count_24h,

    (SELECT COUNT(*)::INT
     FROM public.question_stances
     WHERE question_id = q.id
       AND created_at >= NOW() - INTERVAL '7 days'
    ) as response_count_7d,

    (SELECT COUNT(DISTINCT user_id)::INT
     FROM public.question_stances
     WHERE question_id = q.id
       AND created_at >= NOW() - INTERVAL '24 hours'
    ) as unique_responders_24h,

    (SELECT MIN(created_at)
     FROM public.question_stances
     WHERE question_id = q.id
    ) as first_response_at,

    t.id as topic_id_ref,
    t.title as topic_title,
    t.tags as topic_tags

  FROM public.questions q
  JOIN LATERAL public.wording_for(q.id, p_language_code) r ON TRUE
  LEFT JOIN public.topics t ON t.id = q.topic_id
  WHERE q.state::TEXT NOT IN ('archived', 'historical')
),

scored_with_lifecycle AS (
  SELECT
    *,
    EXTRACT(DAY FROM NOW() - created_at)::INT as days_since_published,
    CASE
      WHEN question_phase = 'new' THEN 1.3
      WHEN question_phase = 'active' AND EXTRACT(DAY FROM NOW() - created_at) < 7 THEN 1.15
      WHEN question_phase = 'active' AND EXTRACT(DAY FROM NOW() - created_at) >= 7 THEN 1.0
      WHEN question_phase = 'cooling' THEN 0.7
      WHEN question_phase = 'dormant' THEN 0.3
      ELSE 0.0
    END as lifecycle_modifier
  FROM scored_questions
),

with_signal AS (
  SELECT
    *,
    CASE
      WHEN topic_momentum > 70 AND response_count_24h < 10 THEN 'breaking'
      WHEN stance_momentum > 50 AND response_count_24h >= 10 THEN 'gaining'
      WHEN response_count_7d > 50 AND stance_momentum > 30 THEN 'stable'
      ELSE NULL
    END as trend_signal,
    CASE
      WHEN stance_momentum > 50 THEN 1
      WHEN stance_momentum > 30 THEN 0
      ELSE -1
    END as trend_direction
  FROM scored_with_lifecycle
),

final_scores AS (
  SELECT
    *,
    ((
      (stance_momentum * 0.65) +
      (topic_momentum * 0.25) +
      (community_engagement_score * 0.10)
    ) * lifecycle_modifier) as final_trending_score,

    CASE
      WHEN trend_signal = 'breaking' THEN 'Breaking news generating early discussion'
      WHEN trend_signal = 'gaining' THEN 'Community engagement accelerating'
      WHEN trend_signal = 'stable' THEN 'Sustained community engagement'
      ELSE 'Recent activity'
    END as trend_reason,

    CASE
      WHEN p_location_tier = 'city' THEN 'local'
      WHEN p_location_tier = 'state' THEN 'state'
      WHEN p_location_tier = 'country' THEN 'country'
      ELSE 'global'
    END as region_scope,

    0 as source_count
  FROM with_signal
),

with_user_context AS (
  SELECT
    fs.question_id,
    fs.question,
    fs.summary,
    fs.tags,
    fs.published_at,
    fs.stance_momentum,
    fs.topic_momentum,
    fs.community_engagement_score,
    fs.lifecycle_modifier,
    fs.final_trending_score,
    fs.trend_signal,
    fs.trend_direction,
    fs.region_scope,
    fs.trend_reason,

    (qs.id IS NOT NULL) as user_has_answered,
    qs.score::INT as user_stance_value,
    qs.created_at as user_answer_date,

    fs.response_count_24h,
    fs.response_count_7d,
    (fs.response_count_24h::FLOAT8 / NULLIF(24, 0))::FLOAT8 as response_velocity,
    fs.unique_responders_24h,
    fs.first_response_at,

    fs.topic_id,
    fs.topic_title,
    fs.topic_tags,

    fs.question_phase,
    fs.days_since_published,

    fs.source_count,
    CASE
      WHEN fs.source_count = 0 THEN 0.0
      WHEN fs.source_count = 1 THEN 0.3
      WHEN fs.source_count <= 5 THEN 0.6
      ELSE 1.0
    END as source_diversity_score,

    fs.rendition_id

  FROM final_scores fs
  LEFT JOIN public.question_stances qs
    ON qs.question_id = fs.question_id
    AND qs.user_id = p_user_id
  WHERE fs.region_scope = COALESCE(
    CASE
      WHEN p_location_tier = 'city' THEN 'local'
      WHEN p_location_tier = 'state' THEN 'state'
      WHEN p_location_tier = 'country' THEN 'country'
      ELSE 'global'
    END,
    'global'
  )
)

SELECT * FROM with_user_context
ORDER BY final_trending_score DESC NULLS LAST
LIMIT p_limit;
$function$;

notify pgrst, 'reload schema';
