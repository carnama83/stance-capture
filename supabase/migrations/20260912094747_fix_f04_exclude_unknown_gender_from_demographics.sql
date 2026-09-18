-- F-04: snapshot_community_trends() counted users with no gender instead of
-- excluding them. It built the dimension value as
--   coalesce(p.gender, 'prefer_not_to_say')
-- so every user who never completed the field was relabelled and counted as a
-- demographic group. BR-F02 states such users "are excluded from the denominator
-- for that dimension", and the section 17 note on this function repeats it.
-- The age_group block added by M-F01 already does the right thing (it joins a
-- subquery filtered to dob_encrypted is not null and dob_checked = true); the
-- older gender block was the outlier.
--
-- Patches THIS environment's own body with single-line, newline-agnostic
-- replacements, and aborts cleanly if anything does not match.
DO $mig$
DECLARE
  v_src    text;
  v_new    text;
  v_cfg    text;
  v_vol    text;
  v_secdef boolean;
  v_before int;
BEGIN
  SELECT p.prosrc,
         (SELECT string_agg(replace(c, 'search_path=', ''), ',') FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END,
         p.prosecdef
    INTO v_src, v_cfg, v_vol, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'snapshot_community_trends'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'F-04: snapshot_community_trends() not found';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'F-04: target is NOT SECURITY DEFINER - refusing';
  END IF;
  IF v_cfg IS NULL THEN
    RAISE EXCEPTION 'F-04: target has no search_path in proconfig - refusing';
  END IF;

  v_before := (length(v_src) - length(replace(v_src, 'coalesce(p.gender', ''))) / length('coalesce(p.gender');
  IF v_before = 0 THEN
    RAISE EXCEPTION 'F-04: already applied (no coalesce(p.gender) present)';
  END IF;
  IF v_before <> 2 THEN
    RAISE EXCEPTION 'F-04: expected exactly 2 occurrences of coalesce(p.gender), found % - refusing', v_before;
  END IF;

  v_new := v_src;

  -- 1) stop relabelling NULL gender as a demographic value
  IF position('coalesce(p.gender, ''prefer_not_to_say'')                  as dimension_value,' in v_new) = 0 THEN
    RAISE EXCEPTION 'F-04: dimension_value anchor not found';
  END IF;
  v_new := replace(v_new,
    'coalesce(p.gender, ''prefer_not_to_say'')                  as dimension_value,',
    'p.gender                                                 as dimension_value,');

  -- 2) exclude unknown / withheld gender, and group on the raw column.
  --    The filter is prefixed onto the GROUP BY line so it continues the
  --    existing WHERE clause without needing a multi-line anchor.
  IF position('group by qs.question_id, coalesce(p.gender, ''prefer_not_to_say'')' in v_new) = 0 THEN
    RAISE EXCEPTION 'F-04: group-by anchor not found';
  END IF;
  v_new := replace(v_new,
    'group by qs.question_id, coalesce(p.gender, ''prefer_not_to_say'')',
    'and p.gender is not null and p.gender <> ''prefer_not_to_say''' || E'\n' ||
    '  group by qs.question_id, p.gender');

  IF position('coalesce(p.gender' in v_new) > 0 THEN
    RAISE EXCEPTION 'F-04: coalesce(p.gender) survived the replacement';
  END IF;
  IF position('p.gender is not null' in v_new) = 0 THEN
    RAISE EXCEPTION 'F-04: exclusion filter missing after replacement';
  END IF;
  IF v_new = v_src THEN
    RAISE EXCEPTION 'F-04: body unchanged';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.snapshot_community_trends() '
    'RETURNS jsonb LANGUAGE plpgsql %s SECURITY DEFINER SET search_path = %s AS %L',
    v_vol, v_cfg, v_new);

  RAISE NOTICE 'F-04 applied: % -> % chars', length(v_src), length(v_new);
END
$mig$;
