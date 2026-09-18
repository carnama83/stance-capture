-- Epic UGQ Design F2, phase 2 of 6: give every question an ORIGINAL rendition.
--
-- After this, ALL human-visible wording lives in question_renditions -- the
-- source language included. That is what makes question_stances.rendition_id
-- able to be NOT NULL later with no special cases and no meaning hidden in NULL.
--
-- Source language is DERIVED, not stored (UGQ-ML-15): it is the language_code
-- of the row where rendition_type='original'. No source_rendition_id column,
-- no circular FK, no second source of truth.

-- Resolve each question's true source language from the proposal that created
-- it. proposal_language postdates the earliest proposals, and editorial-pipeline
-- questions have no proposal at all; both default to English, which is correct
-- -- those were authored in English.
create temporary table _src on commit drop as
select q.id as question_id,
       coalesce(
         (select p.proposal_language
          from public.user_question_proposals p
          where p.reframed_question_id = q.id and p.proposal_language is not null
          order by p.created_at desc limit 1),
         'en') as source_language
from public.questions q;

-- 1. English-source questions: the English text IS the approved source wording,
--    and by invariant 3 it is also the semantic hub -- one row, no second
--    artifact, no equivalence check (there is nothing to compare it against).
insert into public.question_renditions (
  question_id, language_code, rendered_text, slider_low_label, slider_high_label,
  context_summary, rendition_type, lifecycle_status, transform_status,
  axis_equivalence_check, generation_reason, version, published_at)
select q.id, 'en', q.question, q.slider_low_label, q.slider_high_label,
       q.context_summary, 'original', 'published', 'published',
       'not_applicable', 'manual_admin', 1, coalesce(q.published_at, q.created_at, now())
from public.questions q
join _src s on s.question_id = q.id
where s.source_language = 'en'
  and not exists (select 1 from public.question_renditions r
                  where r.question_id = q.id and r.language_code = 'en');

-- 2. Hindi-source questions: the existing hi rendition already holds the
--    proposer-approved wording verbatim (seeded from preview_reframe, never
--    model-generated -- transform_model IS NULL). Reclassify in place rather
--    than re-deriving it; round-tripping a proposer's own words through the
--    English would be the worst available failure.
update public.question_renditions r
set rendition_type         = 'original',
    axis_equivalence_check = 'not_applicable',
    axis_equivalence_notes = null,
    derived_from_rendition_id = null
from _src s
where s.question_id = r.question_id
  and s.source_language = r.language_code
  and s.source_language <> 'en';

-- 3. For those same questions the ENGLISH is a derived artifact, not the
--    question itself -- and its first hop (source -> English) was never
--    verified by anything. It therefore enters as a DRAFT awaiting the
--    verification phase 4 introduces, not as published wording. This is the
--    design working as intended, not data loss: unverified English stops being
--    silently authoritative.
insert into public.question_renditions (
  question_id, language_code, rendered_text, slider_low_label, slider_high_label,
  context_summary, rendition_type, lifecycle_status, transform_status,
  axis_equivalence_check, generation_reason, version, derived_from_rendition_id)
select q.id, 'en', q.question, q.slider_low_label, q.slider_high_label,
       q.context_summary, 'translated', 'draft', 'pending',
       null, 'manual_admin', 1,
       (select o.id from public.question_renditions o
        where o.question_id = q.id and o.rendition_type = 'original' limit 1)
from public.questions q
join _src s on s.question_id = q.id
where s.source_language <> 'en'
  and not exists (select 1 from public.question_renditions r
                  where r.question_id = q.id and r.language_code = 'en');

-- Every question must now have exactly one original. Fail the migration rather
-- than leave a question whose source wording is unaccounted for.
do $$
declare bad integer;
begin
  select count(*) into bad
  from public.questions q
  where (select count(*) from public.question_renditions r
         where r.question_id = q.id and r.rendition_type = 'original') <> 1;
  if bad > 0 then
    raise exception 'F2 phase 2: % question(s) do not have exactly one original rendition', bad;
  end if;
end $$;
