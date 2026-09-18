-- BUG C-9 (Epic C QA, Sep 2026) — P1
-- The 'Reopened' band was permanently empty on the Global tab. This function joined
-- question_stance_stats_region on region_key = 'Global', but every global row in that
-- table uses lowercase 'global' (22/22 on Dev; no capitalised variant exists). The
-- LEFT JOIN never matched, so qsr.avg_score was NULL and the function's own
-- "WHERE qsr.avg_score IS NOT NULL" discarded every candidate. Index.tsx passes
-- globalLabel = 'Global', so this was the default path.
-- Only the Global branch's region_key comparison changes; everything else is verbatim.
CREATE OR REPLACE FUNCTION public.get_reopened_questions_for_user(p_region text DEFAULT 'Global'::text, p_limit integer DEFAULT 3, p_min_shift numeric DEFAULT 1.0, p_min_age_days integer DEFAULT 30)
 RETURNS TABLE(question_id uuid, question_text text, last_answered_at timestamp with time zone, public_shift_proxy numeric, reason text, generated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_current_user uuid;
BEGIN
    v_current_user := auth.uid();
    IF v_current_user IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    RETURN QUERY
    WITH user_old_answers AS (
        SELECT
            qs.question_id,
            qs.score as user_score,
            qs.created_at as last_answered_at,
            q.question as question_text
        FROM public.question_stances qs
        JOIN public.questions q ON q.id = qs.question_id
        JOIN public.topics t ON t.id = q.topic_id
        WHERE qs.user_id = v_current_user
            AND qs.created_at < NOW() - (p_min_age_days || ' days')::interval
            AND CASE
                WHEN p_region = 'United States' THEN
                    COALESCE(q.location_label, t.location_label) IN ('United States', 'Global')
                    OR COALESCE(q.location_label, t.location_label) IS NULL
                WHEN p_region = 'Global' THEN
                    TRUE
                ELSE
                    COALESCE(q.location_label, t.location_label) = p_region
            END
    ),
    with_current_stats AS (
        SELECT
            uoa.question_id,
            uoa.question_text,
            uoa.last_answered_at,
            uoa.user_score,
            qsr.avg_score as current_avg_score,
            ABS(uoa.user_score - COALESCE(qsr.avg_score, 0)) as score_divergence
        FROM user_old_answers uoa
        LEFT JOIN public.question_stance_stats_region qsr
            ON qsr.question_id = uoa.question_id
            AND CASE
                WHEN p_region = 'Global' THEN
                    -- C-9: stored key is lowercase 'global'; compare case-insensitively
                    qsr.region_scope = 'global' AND lower(qsr.region_key) = 'global'
                ELSE
                    qsr.region_scope = 'country' AND qsr.region_key = p_region
            END
        WHERE qsr.avg_score IS NOT NULL
    )
    SELECT
        wcs.question_id,
        wcs.question_text,
        wcs.last_answered_at,
        wcs.score_divergence as public_shift_proxy,
        CASE
            WHEN wcs.score_divergence >= 1.5 THEN 'Public opinion has shifted significantly'
            WHEN wcs.score_divergence >= 1.0 THEN 'Public opinion has shifted moderately'
            WHEN wcs.score_divergence >= 0.5 THEN 'Public opinion has shifted slightly'
            ELSE 'Slight change detected'
        END as reason,
        NOW() as generated_at
    FROM with_current_stats wcs
    WHERE wcs.score_divergence >= p_min_shift
    ORDER BY wcs.score_divergence DESC, wcs.last_answered_at ASC
    LIMIT p_limit;
END;
$function$;
