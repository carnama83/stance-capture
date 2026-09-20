-- PR 1 / D1 — backfill the rendition stubs that were never created.
--
-- Found while gathering numbers for the D1 decision. A Hindi reader sees 13 of
-- 119 active questions, which looks like strict language policy being brutal.
-- It is not: it is a backfill gap.
--
-- stub_question_renditions() creates a non-English stub for every eligible
-- question, and the generate-renditions cron (every minute, active) picks those
-- up. But it is a TRIGGER, attached on 19 Sep by f2_17pre. Every question
-- created before that never got a stub, so the generator has had nothing to
-- collect:
--
--   active questions .................. 119
--   Hindi-eligible .................... 86
--   eligible with NO Hindi row at all .. 75   <- this migration
--   eligible and published ............. 11
--   stuck in draft/pending ............. 0    <- generator is not the bottleneck
--
-- Eligibility is copied verbatim from the trigger rather than re-derived, so a
-- question is stubbed here if and only if the trigger would have stubbed it:
-- community-sourced, or located somewhere the language applies. That gate is
-- deliberate — a US congressional-budget question has no business being
-- translated into Hindi — so this does NOT blanket-translate the feed. It
-- brings coverage of genuinely eligible questions from 11 to 86.
--
-- SAFETY: these are stubs, not content. Each row is created draft/pending with
-- no wording. The generator fills it and then runs the axis-equivalence check,
-- and only a passing check reaches publish_rendition_version(). Unlike the
-- topic labels in PR 1.5 — Class 3 metadata, no gate — question wording is
-- Class 2 instrument text and keeps its semantic gate. Nothing here bypasses
-- review; it feeds it.
--
-- Idempotent: the NOT EXISTS guard means re-running adds nothing.

insert into public.question_renditions (
  question_id, language_code, transform_status, generation_reason,
  rendition_type, lifecycle_status, version)
select
  q.id,
  l.language_code,
  'pending',
  case when q.source = 'community' then 'community_proposer' else 'editorial_pipeline' end,
  'translated',
  'draft',
  1
from public.questions q
cross join public.languages l
where q.status = 'active'
  and q.published_at is not null
  and l.is_active_for_ugq = true
  and l.language_code <> q.canonical_language
  and (
    q.source = 'community'
    or (q.location_id is not null and public.language_applies_to_location(l.language_code, q.location_id))
  )
  and not exists (
    select 1 from public.question_renditions r
    where r.question_id = q.id and r.language_code = l.language_code
  );
