-- f2_21 stamped every write-through version as human_approved, which the
-- question_renditions_original_not_checked constraint correctly rejected.
--
-- The distinction it forced is a real one. For an ENGLISH-SOURCE question the
-- published English row IS the original, so editing it is editing the SOURCE:
-- the new version is still an original and must stay not_applicable, because
-- there is nothing to compare source wording against. For a non-English-source
-- question the English row is a translation, so a hand-edit is exactly what
-- human_approved means -- a person vouched for this rendering of someone else's
-- words.
--
-- Same keystroke, two different meanings depending on whose words they are.
-- Worth having the constraint enforce rather than the author remember.

create or replace function public.write_through_question_to_english_rendition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur   public.question_renditions;
  v_next  integer;
  v_check text;
  v_note  text;
begin
  if new.question is not distinct from old.question then return null; end if;
  if pg_trigger_depth() > 1 then return null; end if;
  if new.question is null or btrim(new.question) = '' then return null; end if;

  select * into v_cur
  from public.question_renditions
  where question_id = new.id and language_code = 'en' and lifecycle_status = 'published';

  if v_cur.id is null then return null; end if;
  if v_cur.rendered_text is not distinct from new.question then return null; end if;

  if v_cur.rendition_type = 'original' then
    -- Editing the source. Still the source; nothing to verify it against.
    v_check := 'not_applicable';
    v_note  := 'Source wording edited directly on questions.question and written through. '
            || 'Not machine-verified because it is the source.';
  else
    -- Editing a translation of someone else's words: a person vouched for it.
    v_check := 'human_approved';
    v_note  := 'English rendition edited directly on questions.question and written through. '
            || 'A person authored this wording; it was not re-verified by the equivalence pipeline.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.id::text || ':en', 0));

  select coalesce(max(version), 0) + 1 into v_next
  from public.question_renditions
  where question_id = new.id and language_code = 'en';

  update public.question_renditions
     set lifecycle_status = 'superseded', superseded_at = now()
   where id = v_cur.id;

  insert into public.question_renditions (
    question_id, language_code, rendered_text, slider_low_label, slider_high_label,
    context_summary, rendition_type, lifecycle_status, transform_status,
    axis_equivalence_check, axis_equivalence_notes, generation_reason,
    version, derived_from_rendition_id, reviewed_by, reviewed_at, published_at)
  values (
    new.id, 'en', new.question,
    coalesce(new.slider_low_label,  v_cur.slider_low_label),
    coalesce(new.slider_high_label, v_cur.slider_high_label),
    coalesce(new.context_summary,   v_cur.context_summary),
    v_cur.rendition_type, 'published', 'published',
    v_check, v_note,
    v_cur.generation_reason, v_next, v_cur.derived_from_rendition_id,
    auth.uid(), now(), now());

  return null;
end;
$$;
