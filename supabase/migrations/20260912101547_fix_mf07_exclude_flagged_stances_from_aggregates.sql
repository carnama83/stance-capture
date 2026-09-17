-- M-F07: flagged stances (question_stances.is_flagged, set by flag_anomalous_stances)
-- were counted in every community aggregate. Epic F section 15 scopes this to three
-- functions: refresh_question_stance_stats(), refresh_question_stance_stats_region()
-- and snapshot_community_trends(). refresh_topic_region_trends() is deliberately NOT
-- in scope - the Epic does not list it.
--
-- Each function is patched against its own body with occurrence-count guards, so a
-- structural difference (for example Prod's older generation of the region function,
-- which has no Epic AA WhatsApp branches) aborts cleanly instead of half-applying.
DO $mig$
DECLARE
  v_src text; v_new text; v_cfg text; v_vol text; v_secdef boolean; v_n int;
  v_old2 text; v_new2 text;
BEGIN
  ---------------------------------------------------------------- 1 of 3
  SELECT p.prosrc,
         (SELECT string_agg(replace(c,'search_path=',''),',') FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END,
         p.prosecdef
    INTO v_src, v_cfg, v_vol, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='refresh_question_stance_stats'
    AND pg_get_function_identity_arguments(p.oid)='p_question_id uuid';
  IF v_src IS NULL THEN RAISE EXCEPTION 'M-F07: refresh_question_stance_stats(uuid) not found'; END IF;
  IF NOT v_secdef OR v_cfg IS NULL THEN RAISE EXCEPTION 'M-F07: refresh_question_stance_stats lost SECURITY DEFINER/search_path - refusing'; END IF;
  IF position('is_flagged' in v_src) > 0 THEN RAISE EXCEPTION 'M-F07: refresh_question_stance_stats already filters flagged'; END IF;

  -- anchor includes the table name so the DELETE on question_stance_stats cannot match
  v_old2 := '  from public.question_stances' || E'\n' || '  where question_id = p_question_id;';
  v_new2 := '  from public.question_stances' || E'\n' || '  where question_id = p_question_id' || E'\n'
            || '    and coalesce(is_flagged, false) = false;';
  v_n := (length(v_src)-length(replace(v_src, v_old2, '')))/length(v_old2);
  IF v_n <> 2 THEN RAISE EXCEPTION 'M-F07: expected 2 read sites in refresh_question_stance_stats, found %', v_n; END IF;
  v_new := replace(v_src, v_old2, v_new2);
  EXECUTE format('CREATE OR REPLACE FUNCTION public.refresh_question_stance_stats(p_question_id uuid) '
                 'RETURNS void LANGUAGE plpgsql %s SECURITY DEFINER SET search_path = %s AS %L', v_vol, v_cfg, v_new);

  ---------------------------------------------------------------- 2 of 3
  SELECT p.prosrc,
         (SELECT string_agg(replace(c,'search_path=',''),',') FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END,
         p.prosecdef
    INTO v_src, v_cfg, v_vol, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='refresh_question_stance_stats_region'
    AND pg_get_function_identity_arguments(p.oid)='p_question_id uuid';
  IF v_src IS NULL THEN RAISE EXCEPTION 'M-F07: refresh_question_stance_stats_region(uuid) not found'; END IF;
  IF NOT v_secdef OR v_cfg IS NULL THEN RAISE EXCEPTION 'M-F07: region fn lost SECURITY DEFINER/search_path - refusing'; END IF;
  IF position('is_flagged' in v_src) > 0 THEN RAISE EXCEPTION 'M-F07: region fn already filters flagged'; END IF;

  -- single-line, newline-agnostic. The DELETE uses an unaliased where, so it cannot match.
  v_n := (length(v_src)-length(replace(v_src,'where qs.question_id = p_question_id','')))/length('where qs.question_id = p_question_id');
  IF v_n < 1 THEN RAISE EXCEPTION 'M-F07: no aliased read sites found in region fn'; END IF;
  v_new := replace(v_src, 'where qs.question_id = p_question_id',
                          'where qs.question_id = p_question_id and coalesce(qs.is_flagged, false) = false');
  RAISE NOTICE 'M-F07: patched % read sites in refresh_question_stance_stats_region', v_n;
  EXECUTE format('CREATE OR REPLACE FUNCTION public.refresh_question_stance_stats_region(p_question_id uuid) '
                 'RETURNS void LANGUAGE plpgsql %s SECURITY DEFINER SET search_path = %s AS %L', v_vol, v_cfg, v_new);

  ---------------------------------------------------------------- 3 of 3
  SELECT p.prosrc,
         (SELECT string_agg(replace(c,'search_path=',''),',') FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END,
         p.prosecdef
    INTO v_src, v_cfg, v_vol, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='snapshot_community_trends'
    AND pg_get_function_identity_arguments(p.oid)='';
  IF v_src IS NULL THEN RAISE EXCEPTION 'M-F07: snapshot_community_trends() not found'; END IF;
  IF NOT v_secdef OR v_cfg IS NULL THEN RAISE EXCEPTION 'M-F07: snapshot fn lost SECURITY DEFINER/search_path - refusing'; END IF;
  IF position('is_flagged' in v_src) > 0 THEN RAISE EXCEPTION 'M-F07: snapshot fn already filters flagged'; END IF;

  -- the two demographic blocks (gender, age_group) both alias question_stances as qs
  v_n := (length(v_src)-length(replace(v_src,'where q.status = ''active''','')))/length('where q.status = ''active''');
  IF v_n <> 2 THEN RAISE EXCEPTION 'M-F07: expected 2 demographic blocks, found %', v_n; END IF;
  v_new := replace(v_src, 'where q.status = ''active''',
                          'where q.status = ''active'' and coalesce(qs.is_flagged, false) = false');
  EXECUTE format('CREATE OR REPLACE FUNCTION public.snapshot_community_trends() '
                 'RETURNS jsonb LANGUAGE plpgsql %s SECURITY DEFINER SET search_path = %s AS %L', v_vol, v_cfg, v_new);

  RAISE NOTICE 'M-F07 applied to all three functions';
END
$mig$;
