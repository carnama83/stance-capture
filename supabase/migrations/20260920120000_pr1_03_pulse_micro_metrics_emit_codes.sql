-- PR 1 — get_societal_pulse_homepage emits CODES for its micro-metrics.
--
-- The RPC returned display text:
--
--   'micro_metrics', jsonb_build_array(
--     jsonb_build_object('label', 'topics shifting rapidly', 'value', ...),
--     jsonb_build_object('label', 'polarized',               'value', ...),
--     jsonb_build_object('label', 'reawakening',             'value', ...))
--
-- so a Hindi page rendered "0 topics shifting rapidly" no matter what the UI
-- language was. This was genuinely confusing to diagnose: home.polarizedLabel
-- and friends already exist and are correctly translated, and a second client
-- code path does use them — so the keys looked fine, the translations looked
-- fine, and the page was still English. The text was simply never coming from
-- i18next at all.
--
-- This is the brief's own three-way split (§4). A momentum classification is
-- three separate things and only the first belongs in the database:
--
--   'polarized'                   data, an enum value
--   "Polarized" / "ध्रुवीकृत"      Class 1 chrome, an i18next value map
--   an AI explanation of why      Class 4 derived content
--
-- The server was emitting the middle one. It now emits the first, and the
-- client maps code -> i18n key.
--
-- `label` is KEPT alongside `code`. Dropping it would break any client build
-- that predates this migration, and Supabase migrations and Vercel deploys are
-- not atomic. Clients prefer `code` and fall back to `label`.
--
-- WHY A TEXT REPLACEMENT RATHER THAN A FULL REDEFINITION: the function body is
-- ~12KB of scoring and narrative logic that this change has no business
-- touching. Reproducing it in full to alter three lines invites transcription
-- errors in code nobody intended to modify. The replacement is guarded: if any
-- of the three anchors is missing the migration RAISES rather than silently
-- applying a partial change, so a drifted environment fails loudly.

do $$
declare
  v_def text;
  v_before text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_societal_pulse_homepage';

  if v_def is null then
    raise exception 'get_societal_pulse_homepage not found';
  end if;

  v_before := v_def;

  v_def := replace(v_def,
    $a$jsonb_build_object('label', 'topics shifting rapidly', 'value', COALESCE(v_rapid_shift_count, 0))$a$,
    $b$jsonb_build_object('code', 'rapid_shifts', 'label', 'topics shifting rapidly', 'value', COALESCE(v_rapid_shift_count, 0))$b$);

  v_def := replace(v_def,
    $a$jsonb_build_object('label', 'polarized',               'value', COALESCE(v_polarized_count,   0))$a$,
    $b$jsonb_build_object('code', 'polarized', 'label', 'polarized', 'value', COALESCE(v_polarized_count, 0))$b$);

  v_def := replace(v_def,
    $a$jsonb_build_object('label', 'reawakening',             'value', COALESCE(v_reawakening_count, 0))$a$,
    $b$jsonb_build_object('code', 'reawakening', 'label', 'reawakening', 'value', COALESCE(v_reawakening_count, 0))$b$);

  -- Fail loudly on drift rather than half-applying.
  if v_def = v_before then
    raise exception 'pr1_03: no micro_metrics anchors matched — function body has drifted, patch it by hand';
  end if;
  if position($a$'code', 'rapid_shifts'$a$ in v_def) = 0
     or position($a$'code', 'polarized'$a$ in v_def) = 0
     or position($a$'code', 'reawakening'$a$ in v_def) = 0 then
    raise exception 'pr1_03: only some micro_metrics anchors matched — refusing to apply a partial change';
  end if;

  execute v_def;
end $$;

comment on function public.get_societal_pulse_homepage(text, integer) is
  'Societal pulse for the homepage. micro_metrics entries carry a stable `code` (rapid_shifts | polarized | reawakening) which the client maps to an i18n key; the English `label` is retained only for client builds predating PR 1 and must not be rendered when a code is present. The narrative block is Class 4 derived content and is still English-only until PR 3.';

notify pgrst, 'reload schema';
