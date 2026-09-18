-- The mirror alone fixes today's drift but leaves the mechanism that creates
-- it. ugq-moderate's edit_published action writes questions.question directly,
-- and since f2_09 the feed serves only wording_for() -- so that admin edit has
-- had NO visible effect at all: the reader keeps seeing the old rendition.
-- Rewriting that one function would not be enough either, because the same
-- applies to every other writer of the column, present and future.
--
-- So the mirror is made WRITE-THROUGH, the way an updatable view is: writing
-- questions.question is accepted and pushed into the English rendition as a new
-- published version. Existing callers keep working, unchanged, and now actually
-- take effect.
--
-- Recorded as human_approved, not 'pass': a person typed this text. That is
-- exactly the distinction human_approved exists to carry, and it keeps
-- "someone edited this by hand" visible in the audit trail rather than
-- disguised as a machine verification.
--
-- Recursion is cut two ways: pg_trigger_depth() = 1 means this only responds to
-- a direct write, never to the mirror writing back, and the text-difference
-- check makes the return trip a no-op regardless.

create or replace function public.write_through_question_to_english_rendition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur  public.question_renditions;
  v_next integer;
begin
  -- Only a direct edit of the text, and never re-entry from the mirror.
  if new.question is not distinct from old.question then return null; end if;
  if pg_trigger_depth() > 1 then return null; end if;
  if new.question is null or btrim(new.question) = '' then return null; end if;

  select * into v_cur
  from public.question_renditions
  where question_id = new.id and language_code = 'en' and lifecycle_status = 'published';

  -- No published English yet (a non-English question whose English is still
  -- being verified). Leave it alone: seeding an unverified English here would
  -- smuggle wording past the verification gate.
  if v_cur.id is null then return null; end if;
  if v_cur.rendered_text is not distinct from new.question then return null; end if;

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
    'human_approved',
    'Edited directly on questions.question and written through to this rendition. '
      || 'A person authored this wording; it was not re-verified by the equivalence pipeline.',
    v_cur.generation_reason, v_next, v_cur.derived_from_rendition_id,
    auth.uid(), now(), now());

  return null;
end;
$$;

drop trigger if exists trg_write_through_question on public.questions;
create trigger trg_write_through_question
  after update of question on public.questions
  for each row execute function public.write_through_question_to_english_rendition();
