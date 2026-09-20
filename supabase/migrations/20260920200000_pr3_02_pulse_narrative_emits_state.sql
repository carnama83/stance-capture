-- PR 3.1 — the societal-pulse narrative emits STATE + PARAMS, not prose.
--
-- D5 INVESTIGATION RESULT, and it materially shrinks PR 3.
--
-- The brief treats pulse commentary as AI-written Class 4 content and
-- prescribes derived_fact_sets -> sibling derived_narratives -> a claim checker
-- to stop two languages making different claims about identical data.
--
-- It is not AI-written. It is five hand-written sentence templates selected by
-- a deterministic state machine and filled with format():
--
--   STABLE | REAWAKENING | POLARIZING | ACCELERATING | FOCUSED
--
-- Deterministic text cannot hallucinate, cannot drift between languages, and
-- has nothing for a claim checker to check. So this does not need the fact-set
-- architecture — it needs the same treatment the momentum micro-metrics got in
-- PR 1: stop shipping display text from the database, ship the state and let
-- the client render it from i18n templates.
--
-- If LLM narration is introduced later, THAT is when derived_fact_sets and the
-- checker become necessary. D5 is deferred on exactly that basis.
--
-- sentence_1/sentence_2 are RETAINED. A client build predating this migration
-- renders them, and migrations and deploys are not atomic.
--
-- The interpolated topic names are Class 3 metadata and localize separately:
-- chips already carry topic_id ordered by the same movement_score that selects
-- t1/t2/t3, so the client maps the first three chips through topic_translations
-- rather than needing ids duplicated here.
--
-- t1_missing/t2_missing replace string-sniffing the English fallbacks
-- ('key topics', 'public discussion'). Those strings are themselves display
-- text the client must be able to localize, and comparing against them to
-- detect the fallback would reintroduce the bug one layer up.
--
-- Patched in place rather than redefined: the body is ~12KB of scoring logic
-- this change has no business touching. Guarded — a missing anchor RAISES.

do $$
declare
  v_def text;
  v_before text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_societal_pulse_homepage';

  if v_def is null then
    raise exception 'pr3_02: get_societal_pulse_homepage not found';
  end if;
  v_before := v_def;

  -- 1. declare the two flags
  v_def := replace(v_def,
    '  v_sentence_1 text;',
    '  v_t1_missing boolean := false;' || chr(10) ||
    '  v_t2_missing boolean := false;' || chr(10) ||
    '  v_sentence_1 text;');

  -- 2. capture "was there actually a topic" before the English fallback lands
  v_def := replace(v_def,
    '  v_t1 := COALESCE(v_t1, ''key topics'');',
    '  v_t1_missing := (v_t1 IS NULL);' || chr(10) ||
    '  v_t2_missing := (v_t2 IS NULL);' || chr(10) ||
    '  v_t1 := COALESCE(v_t1, ''key topics'');');

  -- 3. emit state + params alongside the retained English sentences
  v_def := replace(v_def,
    '    ''narrative'',     jsonb_build_object(' || chr(10) ||
    '                       ''title'',      ''Societal Pulse'',' || chr(10) ||
    '                       ''sentence_1'', v_sentence_1,' || chr(10) ||
    '                       ''sentence_2'', v_sentence_2' || chr(10) ||
    '                     ),',
    '    ''narrative'',     jsonb_build_object(' || chr(10) ||
    '                       ''title'',      ''Societal Pulse'',' || chr(10) ||
    '                       ''sentence_1'', v_sentence_1,' || chr(10) ||
    '                       ''sentence_2'', v_sentence_2,' || chr(10) ||
    '                       ''state'',      v_state,' || chr(10) ||
    '                       ''params'',     jsonb_build_object(' || chr(10) ||
    '                         ''t1'', v_t1, ''t2'', v_t2, ''t3'', v_t3,' || chr(10) ||
    '                         ''t1_missing'', v_t1_missing,' || chr(10) ||
    '                         ''t2_missing'', v_t2_missing' || chr(10) ||
    '                       )' || chr(10) ||
    '                     ),');

  if v_def = v_before then
    raise exception 'pr3_02: no anchors matched — function body has drifted, patch by hand';
  end if;
  if position('v_t1_missing boolean' in v_def) = 0
     or position('v_t1_missing := (v_t1 IS NULL)' in v_def) = 0
     or position('''state'',      v_state' in v_def) = 0 then
    raise exception 'pr3_02: only some anchors matched — refusing a partial change';
  end if;

  execute v_def;
end $$;

comment on function public.get_societal_pulse_homepage(text, integer) is
  'Societal pulse for the homepage. narrative.state (STABLE|REAWAKENING|POLARIZING|ACCELERATING|FOCUSED) plus narrative.params drive client-side i18n templates; sentence_1/sentence_2 are retained English for client builds predating PR 3. micro_metrics carry a stable code (PR 1). The narrative is deterministic template selection, not generated prose — which is why it needs no fact-set or claim-checker apparatus.';

notify pgrst, 'reload schema';
