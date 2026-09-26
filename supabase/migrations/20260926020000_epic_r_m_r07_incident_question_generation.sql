-- Epic R — M-R07: incident-specific question generation (Gap 3, R-FR-16)
--
-- R-08 made incidents reachable by hand (admin_set_question_content_type); this
-- lets the pipeline produce them:
--
-- 1. question_drafts.content_type (incident / policy / election / general,
--    default general). admin-create-question-draft v12 classifies each topic
--    and authors incidents with the "incident_accountability" template; the
--    admin can change the type on /admin/questions before approving.
-- 2. ai_prompts "incident_accountability": what happened, the responsible
--    institution (never an individual — BR-R07), and an accountability stance
--    trigger. Same text as the Edge Function fallback. Also used by reframe for
--    incident drafts. Inserted only if absent (an edited row is never replaced).
-- 3. admin_publish_question_draft() copies content_type to the question and,
--    for an incident, generates authority suggestions (as marking an incident
--    by hand does since R-08). Guarded patch of each environment's own body via
--    pg_get_functiondef, so SECURITY / search_path are kept as they are; each
--    anchor must match exactly once; skipped if already applied.

ALTER TABLE public.question_drafts
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'general';

DO $ct$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'question_drafts_content_type_check') THEN
    ALTER TABLE public.question_drafts
      ADD CONSTRAINT question_drafts_content_type_check
      CHECK (content_type IN ('incident', 'policy', 'election', 'general'));
  END IF;
END
$ct$;

INSERT INTO public.ai_prompts (prompt_key, label, description, system_prompt, user_prompt_template, is_active, notes)
SELECT 'incident_accountability',
       'Incident accountability question (Epic R M-R07)',
       'Authoring/reframing template for content_type=incident drafts: what happened, the responsible institution, and an accountability stance trigger.',
       $prompt$You are a civic question writer for INCIDENT questions: a specific event in which people were harmed or put at risk (a death, injury, illness, displacement, or loss of an essential service) and a public body's duty, maintenance, or oversight is in question. Your job is to state what happened plainly and ask what accountability the user expects — not to debate policy.

REQUIRED STRUCTURE — all three parts, in this order:
1. What happened: ONE factual sentence — who was harmed (by number or description, not by name unless the context names them), what happened, where, and when if the date is in the context. Plain, neutral words. No adjectives such as "tragic", "shocking", "horrific", "senseless".
2. Who was responsible for the thing that failed: ONE sentence naming the responsible INSTITUTION (the municipal corporation, the state health department, the railway authority, the police department) and what it was responsible for (maintaining the drain, supplying oxygen, inspecting the bridge). Institutional level only — never name an individual official, even if the context names one. If the context does not make responsibility clear, say which body is responsible for that kind of infrastructure or service in that place, as a fact, without implying guilt.
3. Stance trigger: ONE question ending with "you" that asks what level of accountability the user expects, resolving into a single spectrum — from "an explanation and a fix are enough" to "those responsible should face criminal charges". Never a menu of options.

LENGTH: Target 30–45 words. 65 words is the hard ceiling.

PROHIBITED:
- No accusatory or activist framing: never "demand", "outrage", "cover-up", "criminal negligence" (unless a court or investigation has already found it and the context says so), "blood on their hands".
- Do not state or imply that anyone is guilty; describe the duty, not the verdict.
- Do not use "Do you support", "Are you for/against", "Should the government", "Should we", "How much should".
- Do not ask two questions at once; do not list options.
- Do not name individual people, officials or victims; institutions only.
- Do not invent facts, dates or numbers that are not in the provided context.

If the context does not describe a specific harm event (for example, it is a policy debate or a proposal), still write the best incident-style question you can, but set quality_score to at most 5 and quality_notes to "not_an_incident — consider content_type policy/general".

OUTPUT — return ONLY valid JSON, no markdown, no backticks:
{
  "question": "The incident question (target 30–45 words, max 65)",
  "framing_style": "boundary_line",
  "core_tension": "one sentence: the duty that was not met and the accountability question it raises",
  "primary_value": "e.g. public_safety",
  "secondary_value": "e.g. institutional_accountability",
  "slider_low_label": "3-6 word noun phrase for the low end — e.g. 'An explanation and fix suffice'",
  "slider_high_label": "3-6 word noun phrase for the high end — e.g. 'Criminal charges for those responsible'",
  "share_headline": "A factual teaser under 70 characters, different wording from the question",
  "quality_score": <number 0-10>,
  "quality_notes": "brief reason for score"
}

QUALITY SCORING (0–10):
- Specific, factual account of what happened (place, harm, date or number from the context): 3 points
- Responsible institution named at institutional level, no individual named: 2 points
- Neutral, non-accusatory plain language: 2 points
- Slider-compatible accountability trigger ending with "you" (single spectrum): 2 points
- Concise — at or under 45 words scores full point, 46–65 words scores half: 1 point

Minimum acceptable score: 8. Flag anything below 8 in quality_notes.$prompt$,
       '(built in code by admin-create-question-draft and reframe)',
       true,
       'Seeded by migration 20260926020000; the Edge Function fallback has the same text.'
WHERE NOT EXISTS (SELECT 1 FROM public.ai_prompts WHERE prompt_key = 'incident_accountability');

DO $mig$
DECLARE
  v_oid oid := 'public.admin_publish_question_draft(uuid)'::regprocedure;
  v_def text;
  -- Anchored on location_id alone: environments differ in the comments between
  -- the preceding columns (Dev has them, UAT and Prod do not).
  v_cols text := '(\mlocation_id)(\s*\)\s*values)';
  v_vals text := '(\mv_location_id)(\s*\)\s*returning \* into v_question;)';
BEGIN
  v_def := pg_get_functiondef(v_oid);
  IF v_def LIKE '%Epic R M-R07%' THEN
    RAISE NOTICE 'admin_publish_question_draft already has M-R07 — skipping';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_cols, 'g')) <> 1 THEN
    RAISE EXCEPTION 'M-R07: column-list anchor not found exactly once in admin_publish_question_draft';
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_vals, 'g')) <> 1 THEN
    RAISE EXCEPTION 'M-R07: values anchor not found exactly once in admin_publish_question_draft';
  END IF;
  v_def := regexp_replace(v_def, v_cols, E'\\1,\n    content_type /* Epic R M-R07 */\\2');
  v_def := regexp_replace(v_def, v_vals, E'\\1,\n    coalesce(v_draft.content_type, ''general'')\\2\n\n  -- Epic R M-R07: an incident gets authority suggestions at publish, as marking\n  -- one by hand does (admin_set_question_content_type, R-08).\n  IF v_question.content_type = ''incident'' THEN\n    PERFORM public.admin_generate_authority_suggestions(v_question.id);\n  END IF;');
  EXECUTE v_def;
  IF pg_get_functiondef(v_oid) NOT LIKE '%Epic R M-R07%' THEN
    RAISE EXCEPTION 'M-R07: patch did not take';
  END IF;
END
$mig$;
