-- CRITICAL GAP in the F2 build: nothing creates an ORIGINAL rendition.
--
-- f2_02 backfilled one for each of the 116 existing questions and every check
-- since has passed, because no question has been created in between. But
-- stub_question_renditions() only ever wrote rendition_type='translated', and
-- no edge function or RPC writes 'original' at all. So the next question
-- created would have had NO original, and under F2 that is not a cosmetic gap:
--
--   fetchOriginal()              throws  -> every rendition for it fails
--   wording_for()                empty   -> invisible in EVERY language feed,
--                                           English included
--   resolve_response_rendition() null    -> stance submission refused
--
-- i.e. a newly published question would have been invisible and unanswerable.
--
-- Fixed here rather than in the publish edge functions because questions are
-- inserted from several paths (ugq-publish, the admin draft publisher, the
-- editorial pipeline). A trigger on the table is the only place the invariant
-- "every question has exactly one original" can actually be guaranteed.

create or replace function public.stub_question_renditions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. The ORIGINAL: the question's own wording in its own language. This is
  --    the row that makes the question answerable at all -- feeds, stance
  --    provenance and rendition generation all resolve through it.
  --
  --    Published immediately and marked not_applicable: it is the source, so
  --    there is nothing to verify it against. That is invariant 3 (for an
  --    English-source question the original IS also the semantic hub) and
  --    invariant 2 (source_text is authoritative for its own language).
  insert into public.question_renditions (
    question_id, language_code, rendered_text, slider_low_label, slider_high_label,
    context_summary, rendition_type, lifecycle_status, transform_status,
    axis_equivalence_check, generation_reason, version, published_at)
  select
    new.id, new.canonical_language, new.question,
    new.slider_low_label, new.slider_high_label, new.context_summary,
    'original', 'published', 'published', 'not_applicable',
    case when new.source = 'community' then 'community_proposer' else 'editorial_pipeline' end,
    1, coalesce(new.published_at, now())
  where new.question is not null
    and btrim(new.question) <> ''
    and not exists (
      select 1 from public.question_renditions r
      where r.question_id = new.id and r.rendition_type = 'original'
    );

  -- 2. Stubs for the other languages, awaiting generation. Draft and unverified
  --    by construction: unverified wording must never be distributable.
  insert into public.question_renditions (
    question_id, language_code, transform_status, generation_reason,
    rendition_type, lifecycle_status, version)
  select
    new.id, l.language_code, 'pending',
    case when new.source = 'community' then 'community_proposer' else 'editorial_pipeline' end,
    'translated', 'draft', 1
  from public.languages l
  where l.is_active_for_ugq = true
    and l.language_code <> new.canonical_language
    and (
      new.source = 'community'
      or (new.location_id is not null and public.language_applies_to_location(l.language_code, new.location_id))
    )
    -- Replaces the ON CONFLICT that f2_01 broke by dropping the unique
    -- constraint it relied on; under append-only, "already has a row for this
    -- language" is the right test anyway.
    and not exists (
      select 1 from public.question_renditions r
      where r.question_id = new.id and r.language_code = l.language_code
    );

  return new;
end;
$$;

-- Backstop: if a question ever ends up without an original, say so loudly at
-- the point of damage rather than letting it surface later as an invisible
-- question nobody can answer.
create or replace function public.assert_question_has_original()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.question_renditions r
    where r.question_id = new.id and r.rendition_type = 'original'
  ) then
    raise exception
      'Question % has no original rendition; it would be invisible in every language feed and unanswerable', new.id
      using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_question_has_original on public.questions;
create constraint trigger trg_question_has_original
  after insert on public.questions
  deferrable initially deferred
  for each row execute function public.assert_question_has_original();
