-- Both rendition prompts hardcoded English as the source language -- correct
-- while questions.question WAS the question, wrong the moment F2 made the
-- proposer's own wording authoritative.
--
-- This is not cosmetic. Running the first hop for a Hindi-source question, the
-- checker reported: "The 'English question' field is actually in Hindi". It
-- reached the right verdict anyway, but a checker told the source is English
-- while being handed Devanagari is one nudge away from failing a perfectly good
-- rendition for the wrong reason.
--
-- {{source_language_name}} is supplied by generate-question-renditions v10 in
-- BOTH the transform and equivalence variable sets, and callClaude asserts every
-- prompt is fully substituted, so a missing value fails loudly rather than
-- reaching the model as a literal placeholder.

update public.ai_prompts set
  system_prompt = replace(replace(replace(system_prompt,
    'from English into {{target_language_name}}',
    'from {{source_language_name}} into {{target_language_name}}'),
    'as an English speaker reading the original',
    'as a {{source_language_name}} speaker reading the original'),
    'absent from the English original',
    'absent from the {{source_language_name}} original'),
  user_prompt_template = replace(user_prompt_template,
    'English question: {{canonical_text}}',
    'Source question, in {{source_language_name}}: {{canonical_text}}')
where prompt_key = 'question_essence_transform' and is_active;

update public.ai_prompts set
  system_prompt = replace(system_prompt,
    'preserves the same stance axis as its English original',
    'preserves the same stance axis as its {{source_language_name}} original'),
  user_prompt_template = replace(replace(user_prompt_template,
    'English question: {{canonical_text}}',
    'Source question, in {{source_language_name}}: {{canonical_text}}'),
    'English slider labels:',
    'Source slider labels:')
where prompt_key = 'question_axis_equivalence_check' and is_active;

-- No active prompt may still assert the source is English, and every variable
-- either prompt references must be one the edge function actually supplies.
do $$
declare
  bad text;
  unknown_vars text;
begin
  select string_agg(prompt_key, ', ') into bad
  from public.ai_prompts
  where is_active
    and prompt_key in ('question_essence_transform','question_axis_equivalence_check')
    and (system_prompt ~ 'English (original|speaker|question)' or user_prompt_template ~ 'English (question|slider)');
  if bad is not null then
    raise exception 'F2: prompt(s) % still assume an English source', bad;
  end if;

  select string_agg(distinct v, ', ') into unknown_vars
  from public.ai_prompts p,
       lateral (select m[1] as v
                from regexp_matches(p.system_prompt || ' ' || p.user_prompt_template,
                                    '\{\{(\w+)\}\}', 'g') m) x
  where p.is_active
    and p.prompt_key in ('question_essence_transform','question_axis_equivalence_check')
    and v not in ('target_language_name','source_language_name','canonical_text',
                  'slider_low_label','slider_high_label','context_summary',
                  'rendered_text','rendered_slider_low','rendered_slider_high');
  if unknown_vars is not null then
    raise exception
      'F2: prompt references variable(s) % that generate-question-renditions does not supply; callClaude would throw on every call',
      unknown_vars;
  end if;
end $$;
