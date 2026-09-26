-- Epic R — R-12: no single "winner" on the public ledger or in authority briefs (BR-R09)
--
-- R-07 fixed the question-page signal, but two places still singled out one
-- expectation: PublicLedgerPage highlighted the first snapshot row as
-- "dominant", and the authority-brief prompt asked the model for "the
-- dominant expectation type" (a UAT brief called compensation dominant while
-- compensation and investigation were both at 100%).
--
-- 1. publish_expectation_ledger() now freezes, per snapshot entry,
--    meets_threshold (rate >= threshold at publish time) and threshold_pct.
--    The ledger page highlights every entry that met the threshold and the
--    brief generator marks them, so neither needs to guess. Guarded patch on
--    each environment's own body (the anchor must match exactly once; skipped
--    if already applied); SECURITY DEFINER and search_path are re-emitted.
-- 2. The stored authority_brief_generation prompt stops asking for a dominant
--    type (the Edge Function's hardcoded fallback is changed to match).

DO $mig$
DECLARE
  v_oid oid := 'public.publish_expectation_ledger(uuid, uuid)'::regprocedure;
  v_src text;
  v_new text;
  v_anchor text := '(''pct_of_respondents'',\s*s\.pct_of_respondents)(\s*\))';
  v_add text := ', /* Epic R R-12 */ ''meets_threshold'', s.pct_of_respondents >= (SELECT coalesce(max(value) FILTER (WHERE key = ''expectation_threshold_pct''), 65) FROM public.app_config_trending), ''threshold_pct'', (SELECT coalesce(max(value) FILTER (WHERE key = ''expectation_threshold_pct''), 65) FROM public.app_config_trending)';
  v_secdef boolean;
  v_cfg text[];
BEGIN
  SELECT prosrc, prosecdef, proconfig INTO v_src, v_secdef, v_cfg FROM pg_proc WHERE oid = v_oid;
  IF v_src LIKE '%Epic R R-12%' THEN
    RAISE NOTICE 'publish_expectation_ledger already has R-12 — skipping';
  ELSE
    IF v_src NOT LIKE '%Epic R R-03%' THEN
      RAISE EXCEPTION 'R-12: apply the R-03 migration (20260924030000) first';
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_src, v_anchor, 'g')) <> 1 THEN
      RAISE EXCEPTION 'R-12: snapshot anchor not found exactly once in publish_expectation_ledger';
    END IF;
    IF NOT v_secdef OR v_cfg IS DISTINCT FROM ARRAY['search_path=public, auth'] THEN
      RAISE EXCEPTION 'R-12: unexpected prosecdef/proconfig (%, %)', v_secdef, v_cfg;
    END IF;
    v_new := regexp_replace(v_src, v_anchor, E'\\1' || v_add || E'\\2');
    EXECUTE format($f$CREATE OR REPLACE FUNCTION public.publish_expectation_ledger(p_question_id uuid, p_region_id uuid)
 RETURNS expectation_ledgers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS %L$f$, v_new);
    IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) NOT LIKE '%Epic R R-12%' THEN
      RAISE EXCEPTION 'R-12: patch did not take';
    END IF;
  END IF;
END
$mig$;

-- The stored prompt (read before the Edge Function's fallback).
UPDATE public.ai_prompts
SET system_prompt = replace(
      replace(system_prompt,
        'the dominant expectation type and its percentage',
        'and each expectation type that meets the threshold with its percentage'),
      '- Do NOT editorialise',
      '- Respondents could choose several expectations, so percentages are independent and can add up to more than 100%. Never call one expectation "dominant", "top" or "main" when several meet the threshold; report them side by side.' || E'\n' || '- Do NOT editorialise'),
    user_prompt_template = replace(user_prompt_template,
      'Expectation distribution: {{expectation_breakdown}}',
      'Expectation selection rates (multi-select, independent): {{expectation_breakdown}}')
WHERE prompt_key = 'authority_brief_generation'
  AND system_prompt NOT LIKE '%Never call one expectation%';

-- Fail loudly if a stored prompt still asks for a dominant type (e.g. its
-- wording differs on this environment and the replace above matched nothing).
DO $chk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ai_prompts
    WHERE prompt_key = 'authority_brief_generation'
      AND (system_prompt LIKE '%dominant expectation type%' OR user_prompt_template LIKE '%Expectation distribution:%')
  ) THEN
    RAISE EXCEPTION 'R-12: authority_brief_generation prompt still asks for a dominant type — review its wording';
  END IF;
END
$chk$;
