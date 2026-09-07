-- Second RLS/security-definer hardening pass.
-- Found during a UAT-parity audit: 5 SECURITY DEFINER views were granted
-- SELECT to anon/authenticated with no self-scoping or role check, and the
-- app's only protection was a client-side is_moderator()/is_admin() gate on
-- the React route, which does not stop a direct PostgREST call. Confirmed
-- exploitable (not just theoretical) for mod_identifier_overview,
-- user_region_dimensions, and v_hygiene_suppressed via code review of their
-- callers. user_region_dimensions in particular lets anon map a user_id to
-- home city/state — on a political-stance app, that's the most sensitive
-- one. user_stance_summary is unused by the client and just closed off.

-- mod_identifier_overview: admin identifier-lookup tool (AdminIdentifiers.tsx)
-- gated in the UI by rpc('is_moderator') but not at the data layer. Add the
-- same check as a row filter; view stays SECURITY DEFINER since it needs to
-- read across all profiles/username_history/location_audits for moderators.
CREATE OR REPLACE VIEW public.mod_identifier_overview AS
SELECT user_id,
    random_id,
    username,
    display_handle_mode,
    created_at,
    ( SELECT count(*) AS count
           FROM username_history uh
          WHERE (uh.user_id = p.user_id)) AS username_changes,
    ( SELECT max(uh.created_at) AS max
           FROM username_history uh
          WHERE (uh.user_id = p.user_id)) AS username_last_changed_at,
    ( SELECT count(*) AS count
           FROM location_audits la
          WHERE (la.user_id = p.user_id)) AS location_changes,
    ( SELECT max(la.created_at) AS max
           FROM location_audits la
          WHERE (la.user_id = p.user_id)) AS location_last_changed_at
   FROM profiles p
  WHERE is_moderator();

-- user_region_dimensions: every legitimate caller (SettingsLocation.tsx,
-- Index.tsx, QuestionDetailPage.tsx, CommunityPulsePage.tsx,
-- useShouldShowLanguageToggle.ts) already filters to .eq("user_id", userId)
-- for the CURRENT user only. Enforcing that server-side changes nothing for
-- any of them, and closes off reading anyone else's home region.
CREATE OR REPLACE VIEW public.user_region_dimensions AS
SELECT u.id AS user_id,
    max(
        CASE
            WHEN (l.type = 'city'::location_tier_enum) THEN l.name
            ELSE NULL::text
        END) AS city_label,
    max(
        CASE
            WHEN (l.type = 'county'::location_tier_enum) THEN l.name
            ELSE NULL::text
        END) AS county_label,
    max(
        CASE
            WHEN (l.type = 'state'::location_tier_enum) THEN l.name
            ELSE NULL::text
        END) AS state_label,
    max(
        CASE
            WHEN (l.type = 'country'::location_tier_enum) THEN l.name
            ELSE NULL::text
        END) AS country_label,
    'Global'::text AS global_label,
    max(
        CASE
            WHEN (l.type = 'country'::location_tier_enum) THEN l.iso_code
            ELSE NULL::text
        END) AS country_code
   FROM ((auth.users u
     LEFT JOIN user_location_settings uls ON ((uls.user_id = u.id)))
     LEFT JOIN locations l ON ((l.id = uls.location_id)))
  WHERE u.id = auth.uid()
  GROUP BY u.id;

-- v_hygiene_suppressed: moderation-reasons view (impact-dashboard's
-- suppressed/archived question list) queried via raw fetch with no admin
-- check in the request at all. Add the same is_moderator() gate.
CREATE OR REPLACE VIEW public.v_hygiene_suppressed AS
SELECT q.id AS question_id,
    q.question,
    q.published_at,
    q.is_trending,
    q.trending_score,
    vr.visibility,
    vr.reason,
    vr.last_evaluated_at,
    qe.responses_total,
    qe.responses_last_24h,
    tis.composite_score
   FROM (((questions q
     JOIN question_visibility_rules vr ON ((vr.question_id = q.id)))
     LEFT JOIN question_engagement_metrics qe ON ((qe.question_id = q.id)))
     LEFT JOIN topic_impact_scores tis ON ((tis.question_id = q.id)))
  WHERE ((vr.reason ~~ 'Feed hygiene:%'::text)
     AND (vr.visibility = ANY (ARRAY['suppressed'::question_visibility_enum, 'archived'::question_visibility_enum]))
     AND is_moderator())
  ORDER BY vr.last_evaluated_at DESC;

-- v_source_health: ingestion source ops dashboard (admin/sources), same
-- pattern — raw fetch, no admin check in the request. Gate with is_admin().
CREATE OR REPLACE VIEW public.v_source_health AS
SELECT ts.id,
    ts.name,
    ts.kind,
    ts.endpoint,
    ts.is_enabled,
    ts.last_polled_at,
    ts.last_status,
    ts.last_error,
    ts.success_count,
    ts.failure_count,
    ts.polling_interval,
    ts.country_name,
    ts.country_code,
    ts.created_at,
    count(ni.id) AS total_articles,
    max(ni.published_at) AS latest_article_at,
    sum(
        CASE
            WHEN (ni.published_at > (now() - '24:00:00'::interval)) THEN 1
            ELSE 0
        END) AS articles_last_24h
   FROM (topic_sources ts
     LEFT JOIN news_items ni ON ((ni.source_id = ts.id)))
  WHERE is_admin()
  GROUP BY ts.id, ts.name, ts.kind, ts.endpoint, ts.is_enabled, ts.last_polled_at, ts.last_status, ts.last_error, ts.success_count, ts.failure_count, ts.polling_interval, ts.country_name, ts.country_code, ts.created_at;

-- user_stance_summary: per-user aggregated political-stance profile, not
-- referenced anywhere in the client — just close the public grant rather
-- than invent a self-service shape nothing asks for.
REVOKE SELECT ON public.user_stance_summary FROM anon, authenticated;

-- topics: public_read_topics (qual=true, roles anon+authenticated) made the
-- two published-only policies dead code, since RLS policies are OR'd —
-- anyone could read unpublished/draft topics. Drop it and restore the
-- authenticated-role published-only read the anon-only policies already
-- modeled (existing app pages read topics while signed in).
DROP POLICY IF EXISTS public_read_topics ON public.topics;

CREATE POLICY authenticated_can_read_published_topics ON public.topics
  FOR SELECT
  TO authenticated
  USING (published_at IS NOT NULL);
