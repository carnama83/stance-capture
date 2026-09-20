-- PR 3.4 — questions.summary is Class 2 instrument text and travels with the
-- rendition.
--
-- THE AUDIT §3.4 ASKED FOR, AND WHAT IT FOUND.
--
-- The brief's test is: could it change what the respondent thinks the question
-- asks? If yes it is Class 2. Every localized RPC returns q.summary RAW while
-- returning localized rendered_text beside it. In get_question_localized the
-- two sit on ADJACENT LINES receiving opposite treatment:
--
--     q.summary,                              -- English, always
--     r.context_summary as context_summary,   -- localized, from the rendition
--
-- context_summary was promoted to Class 2 already. summary was missed. They are
-- distinct fields, not duplicates: on Dev 94 questions carry both and NOT ONE
-- pair is identical.
--
-- And summary is not a neutral description. Live Dev rows read:
--
--   "Basic school safety was neglected until outside pressure forced action,
--    raising the question of how much accountability citizens should have to
--    demand before the state acts."
--
--   "Policy actions that could genuinely lower household costs are being rolled
--    out in the final stretch before midterms, making it hard to separate
--    governing from campaigning."
--
-- That is evaluative framing -- "neglected", "forced", "genuinely lower" -- and
-- it renders directly above the slider on cards, feeds, hero and embed. It
-- passes the test outright.
--
-- WHY THE DOM SCAN DID NOT CATCH THIS. Five Dev questions ALREADY have a
-- published Hindi rendition and an English summary. The scan is green only
-- because none of those five happened to rank onto the three scanned routes.
-- That is coverage by luck: the defect is live, and a ranking change surfaces
-- it. A passing scan bounded by what the feed chose to show is not evidence
-- that a field is clean -- which is why this audit read the schema and the rows
-- rather than trusting the green suite.
--
-- WHAT THIS MIGRATION DOES. Adds summary to question_renditions and threads it
-- through the three functions that already carry context_summary, in exactly
-- the same positions: the stub, the write-through and the mirror. No new
-- mechanism -- the mechanism exists and this column was left out of it.
--
-- IT ALSO JOINS THE IMMUTABLE SET. A published rendition's summary must not be
-- editable in place for the same reason its wording must not: responses are
-- recorded against a rendition id, so changing what that id says retroactively
-- rewrites what people were asked. Leaving summary out of the append-only guard
-- would have left exactly that hole open for the one Class-2 field nobody was
-- watching.
--
-- ORDER MATTERS HERE. The backfill UPDATEs published rows, so it runs BEFORE
-- summary is added to the guard. Reversing those two statements makes the
-- migration fail against its own new rule.
--
-- NOT DONE HERE, AND DELIBERATELY: the RPCs still return q.summary. Serving
-- r.summary is the next migration, so the column is populated and verifiable
-- before anything starts reading from it.

alter table public.question_renditions
  add column if not exists summary text;

comment on column public.question_renditions.summary is
  'Class 2. Respondent-visible framing prose shown with the instrument. Travels with the rendition for the same reason rendered_text does: it can change what the respondent understands the question to ask. Mirrors questions.summary for the canonical-language original.';

-- ── backfill (before the guard tightens) ────────────────────────────────────
-- Only the rendition in the question's OWN language: questions.summary is
-- written in the canonical language, so copying it into a translated rendition
-- would assert that an English paragraph is the Hindi wording -- the fabricated
-- provenance this whole plan exists to stop.
update public.question_renditions r
   set summary = q.summary
  from public.questions q
 where r.question_id = q.id
   and r.language_code = q.canonical_language
   and coalesce(btrim(q.summary), '') <> ''
   and r.summary is distinct from q.summary;

-- ── stub: the original carries the summary from birth ───────────────────────
create or replace function public.stub_question_renditions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.question_renditions (
    question_id, language_code, rendered_text, slider_low_label, slider_high_label,
    context_summary, summary, rendition_type, lifecycle_status, transform_status,
    axis_equivalence_check, generation_reason, version, published_at)
  select
    new.id, new.canonical_language, new.question,
    new.slider_low_label, new.slider_high_label, new.context_summary, new.summary,
    'original', 'published', 'published', 'not_applicable',
    case when new.source = 'community' then 'community_proposer' else 'editorial_pipeline' end,
    1, coalesce(new.published_at, now())
  where new.question is not null
    and btrim(new.question) <> ''
    and not exists (
      select 1 from public.question_renditions r
      where r.question_id = new.id and r.rendition_type = 'original'
    );

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
    and not exists (
      select 1 from public.question_renditions r
      where r.question_id = new.id and r.language_code = l.language_code
    );

  return new;
end;
$function$;

-- ── write-through: an edited English question carries summary into the new
--    version, instead of the new version silently losing it ─────────────────
create or replace function public.write_through_question_to_english_rendition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    v_check := 'not_applicable';
    v_note  := 'Source wording edited directly on questions.question and written through. '
            || 'Not machine-verified because it is the source.';
  else
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
    context_summary, summary, rendition_type, lifecycle_status, transform_status,
    axis_equivalence_check, axis_equivalence_notes, generation_reason,
    version, derived_from_rendition_id, reviewed_by, reviewed_at, published_at)
  values (
    new.id, 'en', new.question,
    coalesce(new.slider_low_label,  v_cur.slider_low_label),
    coalesce(new.slider_high_label, v_cur.slider_high_label),
    coalesce(new.context_summary,   v_cur.context_summary),
    coalesce(new.summary,           v_cur.summary),
    v_cur.rendition_type, 'published', 'published',
    v_check, v_note,
    v_cur.generation_reason, v_next, v_cur.derived_from_rendition_id,
    auth.uid(), now(), now());

  return null;
end;
$function$;

-- ── mirror: publishing an English rendition writes summary back ─────────────
create or replace function public.mirror_english_rendition_to_question()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.language_code <> 'en' or new.lifecycle_status <> 'published' then
    return null;
  end if;

  update public.questions q
     set question          = new.rendered_text,
         slider_low_label  = coalesce(new.slider_low_label,  q.slider_low_label),
         slider_high_label = coalesce(new.slider_high_label, q.slider_high_label),
         context_summary   = coalesce(new.context_summary,   q.context_summary),
         summary           = coalesce(new.summary,           q.summary)
   where q.id = new.question_id
     and (q.question          is distinct from new.rendered_text
       or q.slider_low_label  is distinct from coalesce(new.slider_low_label,  q.slider_low_label)
       or q.slider_high_label is distinct from coalesce(new.slider_high_label, q.slider_high_label)
       or q.context_summary   is distinct from coalesce(new.context_summary,   q.context_summary)
       or q.summary           is distinct from coalesce(new.summary,           q.summary));

  return null;
end;
$function$;

-- ── immutability (LAST: the backfill above edits published rows) ────────────
create or replace function public.question_renditions_enforce_append_only()
returns trigger
language plpgsql
as $function$
begin
  if old.lifecycle_status = 'published' then
    if new.rendered_text     is distinct from old.rendered_text
    or new.slider_low_label  is distinct from old.slider_low_label
    or new.slider_high_label is distinct from old.slider_high_label
    or new.context_summary   is distinct from old.context_summary
    -- PR 3.4: summary is Class 2. A published rendition's framing prose is as
    -- immutable as its wording -- responses point at this id, so editing what
    -- it says rewrites what people were asked.
    or new.summary           is distinct from old.summary
    or new.language_code     is distinct from old.language_code
    or new.question_id       is distinct from old.question_id
    or new.version           is distinct from old.version
    or new.rendition_type    is distinct from old.rendition_type then
      raise exception
        'Rendition % is published and immutable; insert a new version and supersede it instead (see publish_rendition_version)',
        old.id
        using errcode = '23514';
    end if;

    if new.lifecycle_status not in ('published','superseded','invalidated') then
      raise exception 'Illegal lifecycle transition published -> % on rendition %',
        new.lifecycle_status, old.id using errcode = '23514';
    end if;
  end if;

  if old.lifecycle_status = 'invalidated'
     and new.lifecycle_status <> 'invalidated' then
    raise exception 'Rendition % is invalidated; that is terminal', old.id
      using errcode = '23514';
  end if;

  if new.lifecycle_status = 'superseded'  and new.superseded_at  is null then
    new.superseded_at := now();
  end if;
  if new.lifecycle_status = 'invalidated' and new.invalidated_at is null then
    new.invalidated_at := now();
  end if;

  return new;
end;
$function$;

notify pgrst, 'reload schema';
