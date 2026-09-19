-- Finishes wiring F2's write path to match its read path (§3 R15 rewrite).
--
-- The read side already treats questions.canonical_language as the question's
-- SOURCE language: stub_question_renditions() uses it to decide which language
-- the ORIGINAL rendition is created in (f2_17), and f2_18 aligned existing rows
-- with their originals. The write side still hardcoded 'en', so for a
-- non-English proposal the ORIGINAL was created in English and the proposer's
-- own words became a 'translated' rendition -- meaning a third language would
-- be derived from an unverified English translation, the exact single point of
-- semantic failure invariant 4 exists to close.
--
-- With canonical_language set to the real source language, the trigger creates
-- the original in the right LANGUAGE but with the wrong TEXT: it only has
-- questions.question, which is the English mirror. This RPC corrects that in
-- one server-side transaction.
--
-- Deliberately does NOT seed the English rendition from the existing reframe.
-- Leaving the 'en' stub pending means generate-question-renditions produces the
-- English FROM the proposer's own wording and puts it through the equivalence
-- check -- which is invariant 4 (the verified first hop) actually happening,
-- rather than an unverified English being grandfathered in because it arrived
-- first. Consequence, by design: the question is absent from the English feed
-- until that verification passes.
--
-- questions.question keeps the English reframe and the non-English-script
-- guardrail in ugq-publish stays exactly as it was: that column is the mirror
-- of the English semantic rendition and must remain English.

create or replace function public.adopt_proposer_source_wording(
  p_question_id uuid,
  p_source_language text,
  p_text text,
  p_slider_low text default null,
  p_slider_high text default null,
  p_context_summary text default null)
returns public.question_renditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.question_renditions;
  v_new public.question_renditions;
  v_stances integer;
begin
  perform public._ensure_admin_or_service();

  if p_text is null or btrim(p_text) = '' then
    raise exception 'Source wording cannot be empty';
  end if;

  -- Never rewrite wording anyone has already answered. This runs milliseconds
  -- after publish, so a stance existing means something is wrong, not that we
  -- should proceed carefully.
  select count(*) into v_stances from public.question_stances where question_id = p_question_id;
  if v_stances > 0 then
    raise exception
      'Question % already has % response(s); its source wording is part of the measurement record and cannot be replaced',
      p_question_id, v_stances;
  end if;

  select * into v_old from public.question_renditions
   where question_id = p_question_id and rendition_type = 'original';
  if v_old.id is null then
    raise exception 'Question % has no original rendition to adopt over', p_question_id;
  end if;
  if v_old.language_code <> p_source_language then
    raise exception
      'Original rendition is in % but the proposer wrote in %; set questions.canonical_language before calling this',
      v_old.language_code, p_source_language;
  end if;

  -- Replace rather than UPDATE: the row is published, and published wording is
  -- immutable by design. Deleting a seconds-old row with no responses is
  -- working state, not history -- and the constraint trigger on questions
  -- guarantees an original exists again before the transaction commits.
  delete from public.question_renditions where id = v_old.id;

  insert into public.question_renditions (
    question_id, language_code, rendered_text, slider_low_label, slider_high_label,
    context_summary, rendition_type, lifecycle_status, transform_status,
    axis_equivalence_check, axis_equivalence_notes, generation_reason,
    version, published_at)
  values (
    p_question_id, p_source_language, btrim(p_text),
    coalesce(nullif(btrim(coalesce(p_slider_low, '')), ''), v_old.slider_low_label),
    coalesce(nullif(btrim(coalesce(p_slider_high, '')), ''), v_old.slider_high_label),
    nullif(btrim(coalesce(p_context_summary, '')), ''),
    'original', 'published', 'published', 'not_applicable',
    'Proposer''s own wording, reviewed and approved by them in the publish preview. '
      || 'Not machine-verified because it is the source: there is nothing to compare it against.',
    v_old.generation_reason, 1, coalesce(v_old.published_at, now()))
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.adopt_proposer_source_wording(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.adopt_proposer_source_wording(uuid, text, text, text, text, text) to service_role;

comment on function public.adopt_proposer_source_wording(uuid, text, text, text, text, text) is
  'F2: makes the proposer''s approved native wording the question''s ORIGINAL, replacing the English-derived placeholder the insert trigger creates. Leaves the English rendition pending so it is generated FROM the source and verified (invariant 4) rather than grandfathered in unverified.';
