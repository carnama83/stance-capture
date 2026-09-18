-- The F2 rendition pipeline depends on two ai_prompts rows that the migrations
-- never created -- they were authored directly on Dev and only ever UPDATED by
-- migration. On any environment that lacks them, generate-question-renditions
-- throws "No active ai_prompts row for question_essence_transform" on every
-- rendition, so the whole multilingual build is inert despite every migration
-- and function being present. Found on UAT immediately after promotion.
--
-- Worse, the guards that were supposed to catch this PASSED VACUOUSLY:
--   f2_12  updates ... WHERE prompt_key = '...' AND is_active  -> 0 rows, then
--          asserts "no active prompt still asserts an English source", which is
--          trivially true when no such row exists.
--   ugq_o5_raise_rendition_token_budget -- same shape, same vacuum.
-- An assertion over a set that can legitimately be empty proves nothing. The
-- check at the bottom asserts EXISTENCE first and only then content, so it
-- cannot pass by finding nothing.
--
-- Rows are seeded only when absent: on Dev they already exist and carry the
-- f2_12 wording plus the O5 token budget, and this must not overwrite them.

insert into public.ai_prompts (prompt_key, version, label, description, system_prompt, user_prompt_template, model, temperature, max_tokens, is_active)
select
  'question_essence_transform', 1,
  'Question essence-preserving transform',
  'Transforms a canonical stance question into another language, preserving the stance axis rather than translating literally. Language-agnostic -- target language is interpolated at call time so this one row serves Hindi now and Marathi/Tamil later without a new row per language.',
  $sp$You are transforming a civic stance question from {{source_language_name}} into {{target_language_name}} for a platform where users respond on a -2 to +2 agree/disagree scale. Your job is essence-preserving transformation, not literal translation: a native {{target_language_name}} speaker reading your output should answer the same way, for the same reasons, as a {{source_language_name}} speaker reading the original. Preserve the exact decision point and the exact stance axis (what -2 means vs what +2 means) with zero drift. Do not add framing, emphasis, or connotation absent from the {{source_language_name}} original — neutrality is a hard requirement, not a style preference. You are ALSO given optional background/context text (context_summary) that grounds the question with real facts, dates, or figures — if it is non-empty, translate it faithfully into {{target_language_name}} as well (same essence-preserving standard: no added/removed facts or framing); if it is empty, return an empty string for it. Respond with valid JSON only, no other text, in this exact shape: {"rendered_text": "...", "slider_low_label": "...", "slider_high_label": "...", "rendered_context_summary": "..."}$sp$,
  'Source question, in {{source_language_name}}: {{canonical_text}}' || E'\n' ||
  'Slider low label (oppose end): {{slider_low_label}}' || E'\n' ||
  'Slider high label (support end): {{slider_high_label}}' || E'\n' ||
  'Background/context (may be empty): {{context_summary}}',
  'claude-sonnet-5', 0.3, 2000, true
where not exists (select 1 from public.ai_prompts where prompt_key = 'question_essence_transform');

insert into public.ai_prompts (prompt_key, version, label, description, system_prompt, user_prompt_template, model, temperature, max_tokens, is_active)
select
  'question_axis_equivalence_check', 1,
  'Axis equivalence verification',
  'Checks whether a transformed rendition preserves the same stance axis and decision point as the source question. Language-agnostic, runs against the transform stage output.',
  $sp$You are checking whether a {{target_language_name}} rendition of a civic stance question preserves the same stance axis as its {{source_language_name}} original. You are not judging translation fluency — you are checking whether someone answering -2 to +2 on the rendition is making the same real-world judgment, about the same decision point, with no added or removed framing. Respond with valid JSON only, no other text, in this exact shape: {"result": "pass" | "needs_review" | "failed", "notes": "..."}. Use "failed" only when the decision point itself changed or the axis is reversed/scrambled. Use "needs_review" for framing drift, tone shift, or ambiguity a fluent human reviewer should judge. Use "pass" only when confident there is no meaningful drift.$sp$,
  'Source question, in {{source_language_name}}: {{canonical_text}}' || E'\r\n' ||
  'Source slider labels: {{slider_low_label}} / {{slider_high_label}}' || E'\r\n\r\n' ||
  '{{target_language_name}} rendition: {{rendered_text}}' || E'\r\n' ||
  '{{target_language_name}} slider labels: {{rendered_slider_low}} / {{rendered_slider_high}}',
  'claude-sonnet-5', 0.2, 1000, true
where not exists (select 1 from public.ai_prompts where prompt_key = 'question_axis_equivalence_check');

-- EXISTENCE first, then content. This is the check f2_12 should have carried.
do $chk$
declare
  k text;
  v record;
begin
  foreach k in array array['question_essence_transform','question_axis_equivalence_check'] loop
    select count(*) filter (where is_active) as active_rows into v
    from public.ai_prompts where prompt_key = k;
    if v.active_rows <> 1 then
      raise exception 'F2: expected exactly 1 ACTIVE ai_prompts row for %, found %', k, v.active_rows;
    end if;
  end loop;

  -- f2_12's intent, now non-vacuous: the row exists AND is source-language aware.
  if exists (
    select 1 from public.ai_prompts
    where is_active
      and prompt_key in ('question_essence_transform','question_axis_equivalence_check')
      and system_prompt not like '%{{source_language_name}}%'
  ) then
    raise exception 'F2: an active rendition prompt does not reference {{source_language_name}}; f2_12 did not take effect here';
  end if;

  -- UGQ-O5's intent, likewise.
  if exists (
    select 1 from public.ai_prompts
    where is_active and prompt_key = 'question_essence_transform' and max_tokens < 2000
  ) then
    raise exception 'F2: question_essence_transform token budget below 2000; ugq_o5 did not take effect here';
  end if;
  if exists (
    select 1 from public.ai_prompts
    where is_active and prompt_key = 'question_axis_equivalence_check' and max_tokens < 1000
  ) then
    raise exception 'F2: question_axis_equivalence_check token budget below 1000; ugq_o5 did not take effect here';
  end if;
end
$chk$;
