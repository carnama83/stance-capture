-- Epic Report R1 (RPT-01) — prompt for generate-stance-definitions.
-- The edge function carries an identical hardcoded fallback; keep them in sync.
insert into public.ai_prompts
  (prompt_key, version, label, description, system_prompt, user_prompt_template,
   model, temperature, max_tokens, is_active, notes)
select
  'stance_definitions_generation', 1,
  'Stance definitions (per rendition)',
  'Defines what each of the five positions (-2..+2) means for one exact question rendition. ai_tip is shown on the slider; interpretation is reporting input for the Question Insight Report.',
  $sys$You define what each position on a five-point opinion scale means for one civic question on a public platform. You describe positions, never the people who hold them. You are neutral: you never persuade, never rank positions, and never add facts that are not in the question or its context. You always answer with valid JSON only.$sys$,
  $usr$Question: {{question_text}}
Context: {{context}}

Scale for THIS question:
-2 = {{low_label}}
-1 = leans toward "{{low_label}}"
 0 = neutral / unsure
+1 = leans toward "{{high_label}}"
+2 = {{high_label}}

For each of the five scores write:
- "ai_tip": second person ("You ..."), 40-70 words. Explains what choosing this position means for THIS question, in terms of its two ends.
- "interpretation": third person ("This position ..."), 60-110 words. What the position emphasises or prioritises, the concern it responds to, and the outcome it seeks. For -1 and +1, say what separates it from the stronger position on the same side. For 0, cover the range: unsure, sees merit on both sides, or wants more information.

Rules:
- Frame positions the way the labels do. If the labels describe delivery or implementation (e.g. "Not delivered" / "Fully delivered"), a position is a JUDGMENT about whether it happened, not support for the idea. If they describe support or opposition, it is policy alignment.
- Never mention respondents, voters, people, residents, percentages, or how many hold a position.
- Never call any position right, better, popular or the majority.
- Write every "ai_tip" and "interpretation" in {{language_name}}.

Return exactly:
{"definitions":[{"score":-2,"ai_tip":"...","interpretation":"..."},{"score":-1,...},{"score":0,...},{"score":1,...},{"score":2,...}]}$usr$,
  'gpt-4o-mini', 0.3, 2500, true,
  'Epic Report R1. Seeded 27 Sep 2026.'
where not exists (
  select 1 from public.ai_prompts
  where prompt_key = 'stance_definitions_generation' and version = 1
);
