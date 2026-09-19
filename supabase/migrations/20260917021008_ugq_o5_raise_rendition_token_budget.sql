-- UGQ-O5, the actual cause: max_tokens=600 is too tight for the transform.
--
-- Narrowed by instrumentation rather than guessed. The persisted error was
-- "No text content in Anthropic response", NOT a JSON parse failure -- which
-- rules out the original hypothesis (truncated JSON) and points at the budget
-- being consumed before a usable text block was produced.
--
-- The arithmetic supports it. A successful run on the largest question emits
-- 276 characters of Devanagari for the question plus a 330-character Hindi
-- context_summary, plus two slider labels and JSON structure. Devanagari costs
-- roughly one token per character, so a success lands at or just under a
-- 600-token ceiling -- which is exactly the shape of an intermittent failure:
-- it works until the output runs slightly long, then produces nothing usable.
--
-- Honest limitation: stop_reason was NOT captured, because the attempt after
-- the richer diagnostic shipped happened to succeed. v12 of the edge function
-- now reports stop_reason, the emitted block types and usage on this error, so
-- the next occurrence confirms or refutes this in one look rather than needing
-- another investigation.
--
-- 2000 is headroom, not a tuned value: roughly 3x the largest observed output.
-- The cost of being generous is zero -- max_tokens caps a response, it does not
-- reserve or bill for it.

update public.ai_prompts
set max_tokens = 2000
where prompt_key = 'question_essence_transform' and is_active and max_tokens < 2000;

-- The checker emits a verdict plus a prose note, in English, and its notes have
-- been observed running to ~260 characters. 400 is tight enough to truncate a
-- thorough explanation, and a truncated note is a checker whose reasoning we
-- cannot audit.
update public.ai_prompts
set max_tokens = 1000
where prompt_key = 'question_axis_equivalence_check' and is_active and max_tokens < 1000;

do $$
declare bad text;
begin
  select string_agg(prompt_key || '=' || max_tokens, ', ') into bad
  from public.ai_prompts
  where is_active
    and prompt_key in ('question_essence_transform','question_axis_equivalence_check')
    and max_tokens < 1000;
  if bad is not null then
    raise exception 'UGQ-O5: token budget still too low for %', bad;
  end if;
end $$;
