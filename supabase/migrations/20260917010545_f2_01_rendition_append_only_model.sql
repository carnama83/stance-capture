-- Epic UGQ Design F2, phase 1 of 6: turn question_renditions into an
-- append-only survey-instrument record.
--
-- Reclassification this whole design follows from: a rendition is not display
-- text, it is part of the measurement instrument. Once a respondent can submit
-- a stance against wording, that wording is part of the record -- hence
-- immutable once published, append-only, lineage-preserving.
--
-- rendition_type and lifecycle_status are SEPARATE dimensions on purpose: the
-- source row is simultaneously type=original and status=published, so one
-- column cannot carry both.
--
-- This phase adds the model and backfills it. transform_status keeps its
-- current meaning (pipeline/job state) until phase 5 moves every reader onto
-- lifecycle_status; nothing appends a second row until phase 2, so the two
-- cannot disagree in between.

alter table public.question_renditions
  add column version                   integer     not null default 1,
  add column rendition_type            text        not null default 'translated',
  add column lifecycle_status          text        not null default 'draft',
  add column derived_from_rendition_id uuid        null references public.question_renditions(id) on delete set null,
  add column published_at              timestamptz null,
  add column superseded_at             timestamptz null,
  add column invalidated_at            timestamptz null;

-- Backfill publication state from the column that carried it until now.
update public.question_renditions
set lifecycle_status = case when transform_status = 'published' then 'published' else 'draft' end,
    published_at     = case when transform_status = 'published' then coalesce(updated_at, created_at) end;

alter table public.question_renditions
  add constraint question_renditions_rendition_type_check
    check (rendition_type in ('original', 'translated')),
  add constraint question_renditions_lifecycle_status_check
    check (lifecycle_status in ('draft', 'published', 'superseded', 'invalidated'));

-- not_applicable: original rows are never machine-checked (nothing to compare
-- against -- they ARE the source). human_approved: keeps "a person vouched for
-- this" distinguishable from "a model passed it", and without it
-- admin_edit_and_publish_rendition cannot satisfy the publish gate below.
alter table public.question_renditions
  drop constraint question_renditions_axis_equivalence_check_check;
alter table public.question_renditions
  add constraint question_renditions_axis_equivalence_check_check
    check (axis_equivalence_check is null
           or axis_equivalence_check in ('pass','needs_review','failed','not_applicable','human_approved'));

-- The old constraint plus in-place UPDATE is precisely what made rendition_id a
-- pointer to mutable text rather than provenance. Replaced by: at most one
-- PUBLISHED row per (question, language), unlimited historical versions.
alter table public.question_renditions
  drop constraint question_renditions_unique;

create unique index question_renditions_one_published
  on public.question_renditions (question_id, language_code)
  where lifecycle_status = 'published';

create unique index question_renditions_version_unique
  on public.question_renditions (question_id, language_code, version);

create index idx_question_renditions_derived_from
  on public.question_renditions (derived_from_rendition_id)
  where derived_from_rendition_id is not null;

comment on column public.question_renditions.version is
  'Append-only version within (question_id, language_code). Corrections insert version+1 and supersede the prior row; published rows are never updated in place.';
comment on column public.question_renditions.rendition_type is
  'original = the proposer-approved wording in the source language, copied verbatim, never model-generated. translated = derived from another rendition.';
comment on column public.question_renditions.lifecycle_status is
  'draft -> published -> superseded|invalidated. Superseded wording was valid when used and its responses stay in the aggregate; invalidated wording was defective and its responses are quarantined but retained.';
comment on column public.question_renditions.derived_from_rendition_id is
  'Lineage. A rendition verified against wording that is later invalidated holds a meaningless verdict, so invalidation must cascade along this edge.';
