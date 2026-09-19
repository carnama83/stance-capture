-- REGRESSION FIX, introduced by f2_01.
--
-- f2_01 dropped UNIQUE (question_id, language_code) -- correctly: that
-- constraint plus in-place UPDATE is exactly what made rendition_id a pointer
-- to mutable text instead of provenance, and append-only cannot coexist with
-- it. What it missed is that stub_question_renditions(), a trigger on
-- questions INSERT, relied on that constraint for its ON CONFLICT clause.
--
-- Effect: since f2_01, INSERTING ANY QUESTION failed outright with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Nothing in the F2 work created a question, so nothing
-- exercised it -- it surfaced only when a synthetic question was inserted to
-- test the ML-16 canary. Question creation on Dev has been broken since then.
--
-- Two changes: replace ON CONFLICT with NOT EXISTS (no constraint needed), and
-- populate the F2 columns the stub rows now require, which the original could
-- not have known about.

create or replace function public.stub_question_renditions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.question_renditions (
    question_id, language_code, transform_status, generation_reason,
    rendition_type, lifecycle_status, version)
  select
    new.id,
    l.language_code,
    'pending',
    case when new.source = 'community' then 'community_proposer' else 'editorial_pipeline' end,
    -- A stub is always a translation awaiting generation. The ORIGINAL is the
    -- question's own source-language wording, created by the publish path, not
    -- stubbed here.
    'translated',
    -- Draft, never published: unverified wording must not be distributable.
    'draft',
    1
  from public.languages l
  where l.is_active_for_ugq = true
    and l.language_code <> new.canonical_language
    and (
      new.source = 'community'
      or (new.location_id is not null and public.language_applies_to_location(l.language_code, new.location_id))
    )
    -- Replaces ON CONFLICT: the unique constraint it depended on is gone, and
    -- must stay gone. Under append-only, "already has a row for this language"
    -- is the right test anyway -- a second version is created deliberately by
    -- publish_rendition_version, never accidentally by a stub.
    and not exists (
      select 1 from public.question_renditions r
      where r.question_id = new.id and r.language_code = l.language_code
    );

  return new;
end;
$$;
