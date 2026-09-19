-- Corrective. The f2_24 seed, as first APPLIED to UAT, carried a literal
-- backslash before every double quote in the two system prompts -- 16 of them
-- in question_essence_transform, 18 in question_axis_equivalence_check -- so
-- the model was being shown
--     {\"rendered_text\": \"...\"}
-- instead of
--     {"rendered_text": "..."}
-- as the required output shape. Cause: the source values were read out of Dev
-- via jsonb_pretty(), which renders a JSON string and therefore ESCAPES the
-- quotes in its output; that escaping was copied into the seed as if it were
-- part of the prompt. Dev itself has zero backslashes in either prompt.
--
-- The committed f2_24 above is the CORRECTED text, so on a fresh environment
-- (Prod) this migration is a no-op and only its assertion runs. It is kept in
-- the sequence rather than folded into f2_24 because UAT already applied the
-- bad seed and needs the repair; replaying history honestly is worth more than
-- a tidy file list.
--
-- The closing assertion pins both prompts to Dev's exact md5. Length or
-- "contains the right phrase" checks would NOT have caught this -- the text
-- read correctly to the eye and every content assertion in f2_24 passed. An
-- exact hash is the only check that distinguishes "looks right" from "is the
-- same bytes as the environment it was copied from".

update public.ai_prompts
set system_prompt = replace(system_prompt, '\"', '"'),
    updated_at = now()
where prompt_key in ('question_essence_transform','question_axis_equivalence_check')
  and system_prompt like '%\"%';

do $chk$
declare
  v_transform  text;
  v_equiv      text;
  -- Known-good hashes, read from Dev (essnvhvezxjcoqxvuxuq) on 17 Sep 2026.
  c_transform  constant text := 'ed3656a5b434f0e9a6db3bbece02f022';
  c_equiv      constant text := '51278cde300bca223645eeca5492451a';
begin
  select md5(system_prompt) into v_transform
  from public.ai_prompts where prompt_key = 'question_essence_transform' and is_active;
  select md5(system_prompt) into v_equiv
  from public.ai_prompts where prompt_key = 'question_axis_equivalence_check' and is_active;

  if v_transform is null or v_equiv is null then
    raise exception 'F2: a rendition prompt is missing or inactive (transform=%, equivalence=%)',
      coalesce(v_transform,'MISSING'), coalesce(v_equiv,'MISSING');
  end if;
  if v_transform <> c_transform then
    raise exception 'F2: question_essence_transform system_prompt differs from Dev (got %, want %)', v_transform, c_transform;
  end if;
  if v_equiv <> c_equiv then
    raise exception 'F2: question_axis_equivalence_check system_prompt differs from Dev (got %, want %)', v_equiv, c_equiv;
  end if;

  if exists (
    select 1 from public.ai_prompts
    where is_active
      and prompt_key in ('question_essence_transform','question_axis_equivalence_check')
      and system_prompt like '%\%'
  ) then
    raise exception 'F2: a rendition prompt still contains a backslash';
  end if;
end
$chk$;
