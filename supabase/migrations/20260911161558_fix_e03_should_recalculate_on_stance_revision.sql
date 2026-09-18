-- E-03: should_recalculate_cognitive_state() gated only on question COUNT and 7-day age,
-- so revising a stance score never refreshed the cognitive profile. TopicBeliefProfile
-- then showed a stale mean_stance/consistency contradicting the user's current stance,
-- and /me/insights hides its refresh button behind this same function.
--
-- Patches THIS environment's own body by targeted replacement (newline-agnostic, so it
-- works against both the LF and CRLF generations) and aborts cleanly if any anchor is
-- missing. Preserves SECURITY DEFINER, search_path and volatility read from the target.
DO $mig$
DECLARE
  v_src    text;
  v_new    text;
  v_cfg    text;
  v_vol    text;
  v_secdef boolean;
  v_hits   int;
BEGIN
  SELECT p.prosrc,
         (SELECT string_agg(replace(c, 'search_path=', ''), ',') FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END,
         p.prosecdef
    INTO v_src, v_cfg, v_vol, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'should_recalculate_cognitive_state'
    AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'E-03: should_recalculate_cognitive_state(uuid) not found';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'E-03: target is NOT SECURITY DEFINER - refusing (would re-break D-01)';
  END IF;
  IF v_cfg IS NULL THEN
    RAISE EXCEPTION 'E-03: target has no search_path in proconfig - refusing';
  END IF;
  IF position('v_stance_changed' in v_src) > 0 THEN
    RAISE EXCEPTION 'E-03: already applied on this environment';
  END IF;
  IF position('v_current_count INTEGER;' in v_src) = 0 THEN
    RAISE EXCEPTION 'E-03: DECLARE anchor not found';
  END IF;
  IF position('RETURN (' in v_src) = 0 THEN
    RAISE EXCEPTION 'E-03: RETURN( anchor not found';
  END IF;
  IF position('OR (v_current_count - v_last_count) >= 5' in v_src) = 0 THEN
    RAISE EXCEPTION 'E-03: RETURN-clause anchor not found';
  END IF;

  v_new := v_src;

  v_new := replace(v_new,
    'v_current_count INTEGER;',
    'v_current_count INTEGER;' || E'\n    v_stance_changed BOOLEAN;');

  v_new := replace(v_new,
    'RETURN (',
    'SELECT EXISTS ('                                                       || E'\n' ||
    '        SELECT 1 FROM public.question_stances qs'                      || E'\n' ||
    '        WHERE qs.user_id = p_user_id'                                  || E'\n' ||
    '          AND qs.updated_at > ('                                       || E'\n' ||
    '              SELECT ucs.evaluated_at FROM public.user_cognitive_states ucs' || E'\n' ||
    '              WHERE ucs.user_id = p_user_id AND ucs.state_status = ''current''' || E'\n' ||
    '              ORDER BY ucs.evaluated_at DESC LIMIT 1)'                 || E'\n' ||
    '    ) INTO v_stance_changed;'                                          || E'\n\n' ||
    '    RETURN (');

  v_new := replace(v_new,
    'OR (v_current_count - v_last_count) >= 5',
    'OR (v_current_count - v_last_count) >= 5' || E'\n        OR COALESCE(v_stance_changed, FALSE)');

  v_hits := (length(v_new) - length(replace(v_new, 'v_stance_changed', ''))) / length('v_stance_changed');
  IF v_hits <> 3 THEN
    RAISE EXCEPTION 'E-03: expected 3 occurrences of v_stance_changed, got %', v_hits;
  END IF;
  IF v_new = v_src THEN
    RAISE EXCEPTION 'E-03: body unchanged after replacement';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.should_recalculate_cognitive_state(p_user_id uuid) '
    'RETURNS boolean LANGUAGE plpgsql %s SECURITY DEFINER SET search_path = %s AS %L',
    v_vol, v_cfg, v_new);

  RAISE NOTICE 'E-03 applied: % -> % chars', length(v_src), length(v_new);
END
$mig$;
