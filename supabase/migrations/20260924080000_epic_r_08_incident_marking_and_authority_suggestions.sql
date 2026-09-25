-- Epic R — R-08: make the incident stream reachable (M-R07, QA-R15, QA-R19)
--
-- Before: nothing set questions.content_type = 'incident' (no admin control;
-- no Edge Function or DB function sets it; Dev had 0 incident questions), so
-- IncidentSummaryCard and the accountability prompt never rendered. Nothing
-- wrote pending_authority_suggestions either, so the admin "Pending
-- Suggestions" tab was permanently empty.
--
-- After:
--   * admin_set_question_content_type(question, type) — admin-only; sets
--     incident / policy / election / general. 'video' is owned by the UGQ
--     publish flow and is neither set nor overwritten here.
--   * admin_generate_authority_suggestions(question) — admin-only; turns the
--     organisations that entity extraction already stored for the question's
--     source articles (ingestion_queue.entities.organizations, reached via
--     topic_drafts → topic_cluster_items) into pending suggestions for review.
--     Only public-institution-like names pass (ministries, departments,
--     municipal bodies, police, courts, commissions, …); news outlets are
--     excluded. People are never suggested (BR-R07: institution-level first).
--     Names already suggested for the question (any status, so a rejection
--     sticks) or already mapped to it are skipped. At most 10 per call,
--     most-mentioned first. Nothing is mapped automatically.
--   * Marking a question as an incident runs the generator once.
--
-- Not in scope: an incident-specific question-generation prompt in the
-- pipeline (M-R07 "incident_accountability" template) — that is a prompt /
-- product decision and remains open.

CREATE OR REPLACE FUNCTION public.admin_generate_authority_suggestions(p_question_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_news_item uuid;
  v_inserted integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can generate authority suggestions' USING ERRCODE = '42501';
  END IF;

  SELECT q.news_item_id INTO v_news_item FROM public.questions q WHERE q.id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question % not found', p_question_id USING ERRCODE = 'P0002';
  END IF;

  WITH orgs AS (
    SELECT btrim(o.name) AS name, iq.id AS article
    FROM public.questions q
    JOIN public.topic_drafts td ON td.id = q.topic_draft_id
    JOIN public.topic_cluster_items tci ON tci.cluster_id = td.cluster_id
    JOIN public.ingestion_queue iq ON iq.id = tci.ingestion_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(iq.entities -> 'organizations') = 'array'
           THEN iq.entities -> 'organizations' ELSE '[]'::jsonb END) AS o(name)
    WHERE q.id = p_question_id
  ), ranked AS (
    SELECT min(name) AS name, count(DISTINCT article) AS mentions
    FROM orgs
    WHERE length(name) BETWEEN 3 AND 200
      -- public institutions only
      AND name ~* '(ministry|department|municipal|municipality|nagar nigam|panchayat|city council|county|district|council|commission|authority|board|police|court|tribunal|government|agency|bureau|administration|directorate|inspectorate|regulator|parliament|senate|congress|assembly|secretariat|cabinet|public works|office of|health service|fire service|state of|federal|army|navy|air force)'
      -- never news outlets / media
      AND name !~* '(news|times|post|tribune|herald|gazette|express|reuters|associated press|bbc|cnn|al jazeera|deutsche welle|press trust|agence france|media|television|\mtv\M|radio|journal|broadcast)'
      -- never political parties or party bodies, and not the aircraft
      AND name !~* '(\mparty\M|indian national congress|congress working committee|congress committee|pradesh congress|ysr congress|trinamool congress|kerala congress|^congress$|air force one)'
    GROUP BY lower(name)
  ), fresh AS (
    SELECT r.name, r.mentions
    FROM ranked r
    WHERE NOT EXISTS (
            SELECT 1 FROM public.pending_authority_suggestions s
            WHERE s.question_id = p_question_id AND lower(s.candidate_name) = lower(r.name))
      AND NOT EXISTS (
            SELECT 1 FROM public.question_authority_map m
            JOIN public.authority_registry a ON a.id = m.authority_id
            WHERE m.question_id = p_question_id AND lower(a.name) = lower(r.name))
    ORDER BY r.mentions DESC, r.name
    LIMIT 10
  )
  INSERT INTO public.pending_authority_suggestions (question_id, candidate_name, candidate_type, source_article_id, status)
  SELECT p_question_id, f.name, 'institution', v_news_item, 'pending'
  FROM fresh f;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_generate_authority_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_generate_authority_suggestions(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_question_content_type(p_question_id uuid, p_content_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_prev text;
  v_added integer := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can change a question''s content type' USING ERRCODE = '42501';
  END IF;

  IF p_content_type IS NULL OR p_content_type NOT IN ('incident', 'policy', 'election', 'general') THEN
    RAISE EXCEPTION 'content_type must be incident, policy, election or general' USING ERRCODE = '22023';
  END IF;

  SELECT content_type INTO v_prev FROM public.questions WHERE id = p_question_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question % not found', p_question_id USING ERRCODE = 'P0002';
  END IF;
  IF v_prev = 'video' THEN
    RAISE EXCEPTION 'Video questions keep content_type ''video'' (set by the UGQ publish flow)' USING ERRCODE = 'P0001';
  END IF;

  IF v_prev IS DISTINCT FROM p_content_type THEN
    UPDATE public.questions SET content_type = p_content_type WHERE id = p_question_id;
    IF p_content_type = 'incident' THEN
      v_added := public.admin_generate_authority_suggestions(p_question_id);
    END IF;
  END IF;

  RETURN jsonb_build_object('previous', v_prev, 'content_type', p_content_type, 'suggestions_added', v_added);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_question_content_type(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_question_content_type(uuid, text) TO authenticated, service_role;
