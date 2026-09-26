-- Let a live question's wording be improved, but only until someone answers it.
--
-- WHY. Proposers often realise right after posting that the question should
-- say more. Until now a proposer had no way to change a live question at all,
-- while admins could change it at ANY time (ugq-moderate edit_published and
-- the Live Questions dialog both UPDATE questions.question directly) with no
-- stance check, and that edit only reached the English rendition: the Hindi
-- rendition kept asking the OLD question, so the two languages' answers were
-- pooled across two different questions.
--
-- THE RULE (decided with the product owner, Sep 2026):
--   * the proposer and admins may change the wording, the slider ends and the
--     background, through an AI-suggested revision the person then approves
--     (edge function question-edit);
--   * ONLY while the question has no answers of any kind;
--   * the rule binds admins too. Once answered, wording is frozen; Background
--     can still be ADDED to (add_context_to_existing_question).
--
-- WHAT THIS MIGRATION DOES
--  1. question_answer_count(): every kind of answer, not just question_stances
--     (staged anonymous answers, embed answers and ingested social replies
--     count too: each is a person who answered the wording on screen).
--  2. trg_questions_lock_wording: a BEFORE UPDATE guard. A direct change to
--     the wording or slider ends is refused once any answer exists, whoever
--     makes it. Changes arriving from a rendition (the English mirror, depth>1)
--     are not edits and pass through. Also refreshes dedup_key and clears
--     share_headline, both of which were derived from the old wording.
--  3. write_through_question_to_english_rendition, rewritten: now also fires on
--     slider-end changes; the replaced English wording is INVALIDATED rather
--     than superseded (set_question_stance rejects invalidated renditions, so a
--     stale page cannot record an answer to wording that no longer exists);
--     when English is the source, every published translation is invalidated
--     and re-queued, so no language keeps asking the old question. Until the
--     new translation publishes (about a minute on UAT/Prod), readers of that
--     language get the English fallback rather than the wrong question.
--  4. trg_write_through_context steps aside when the wording changes in the
--     same UPDATE, so one edit produces one new English version, not two.
--  5. question_wording_edits: an audit row for every wording change.
--  6. question_edit_suggestions + apply_question_edit_suggestion(): the
--     AI-suggest-then-approve flow. The applied text is always the stored
--     suggestion, never text sent from the browser, so what goes live is
--     exactly what the safety check saw.

-- ── 1. answer count ─────────────────────────────────────────────────────────
create or replace function public.question_answer_count(p_question_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (
      (select count(*) from public.question_stances         where question_id = p_question_id)
    + (select count(*) from public.question_stances_pending where question_id = p_question_id)
    + (select count(*) from public.embedded_stances         where question_id = p_question_id)
    + (select count(*) from public.ingested_stances         where question_id = p_question_id)
  )::integer;
$function$;

revoke all on function public.question_answer_count(uuid) from public, anon;
grant execute on function public.question_answer_count(uuid) to authenticated, service_role;

-- ── 5. audit (created before the triggers that write it) ────────────────────
create table if not exists public.question_wording_edits (
  id              uuid primary key default gen_random_uuid(),
  question_id     uuid not null references public.questions(id) on delete cascade,
  edited_by       uuid,
  edit_source     text,           -- 'proposer' | 'admin' | null (direct SQL / legacy admin dialog)
  change_request  text,           -- what the person asked for, when the edit came from a suggestion
  old_question    text,
  new_question    text,
  old_slider_low  text,
  new_slider_low  text,
  old_slider_high text,
  new_slider_high text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_question_wording_edits_question
  on public.question_wording_edits (question_id, created_at desc);

alter table public.question_wording_edits enable row level security;
drop policy if exists question_wording_edits_admin_read on public.question_wording_edits;
create policy question_wording_edits_admin_read on public.question_wording_edits
  for select to authenticated using (public.is_admin_me());
revoke all on public.question_wording_edits from anon;

-- ── 2. the lock ─────────────────────────────────────────────────────────────
create or replace function public.questions_lock_wording_after_answers()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_answers integer;
begin
  if new.question          is not distinct from old.question
     and new.slider_low_label  is not distinct from old.slider_low_label
     and new.slider_high_label is not distinct from old.slider_high_label then
    return new;
  end if;

  -- Depth > 1: the change is the English mirror copying a PUBLISHED rendition
  -- back onto questions (rendition review, translated-English publish). That
  -- is not an edit of what respondents answered, so it is not blocked here.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_answers := public.question_answer_count(new.id);
  if v_answers > 0 then
    raise exception 'QUESTION_LOCKED: this question already has % answer(s), so its wording and slider ends can no longer change. Background can still be added.', v_answers
      using errcode = '23514';
  end if;

  -- Derived from the old wording; recompute / fall back to the question text.
  if new.question is distinct from old.question then
    new.dedup_key      := public.generate_dedup_key(new.question, null);
    new.share_headline := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_questions_lock_wording on public.questions;
create trigger trg_questions_lock_wording
  before update of question, slider_low_label, slider_high_label on public.questions
  for each row execute function public.questions_lock_wording_after_answers();

-- ── 3. wording write-through ────────────────────────────────────────────────
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
  v_actor uuid;
begin
  if new.question          is not distinct from old.question
     and new.slider_low_label  is not distinct from old.slider_low_label
     and new.slider_high_label is not distinct from old.slider_high_label then
    return null;
  end if;
  if pg_trigger_depth() > 1 then return null; end if;
  if new.question is null or btrim(new.question) = '' then return null; end if;

  select * into v_cur
  from public.question_renditions
  where question_id = new.id and language_code = 'en' and lifecycle_status = 'published';

  if v_cur.id is null then return null; end if;
  if v_cur.rendered_text     is not distinct from new.question
     and v_cur.slider_low_label  is not distinct from new.slider_low_label
     and v_cur.slider_high_label is not distinct from new.slider_high_label then
    return null;
  end if;

  if v_cur.rendition_type = 'original' then
    v_check := 'not_applicable';
    v_note  := 'Source wording edited before any answers and written through. '
            || 'Not machine-verified because it is the source.';
  else
    v_check := 'human_approved';
    v_note  := 'English rendition edited directly on questions and written through. '
            || 'A person authored this wording; it was not re-verified by the equivalence pipeline.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.id::text || ':en', 0));

  select coalesce(max(version), 0) + 1 into v_next
  from public.question_renditions
  where question_id = new.id and language_code = 'en';

  -- Invalidated, not superseded: the lock guarantees nobody has answered this
  -- wording, and invalidation makes set_question_stance refuse a late answer
  -- from a page still showing it.
  update public.question_renditions
     set lifecycle_status = 'invalidated', invalidated_at = now()
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

  -- Every other language must stop asking the old question. Re-derive only
  -- when English is the source (see write_through_context_to_renditions).
  if v_cur.rendition_type = 'original' then
    update public.question_renditions
       set lifecycle_status = 'invalidated', invalidated_at = now()
     where question_id = new.id
       and rendition_type = 'translated'
       and lifecycle_status = 'published';

    -- Drafts derived from the old wording are obsolete too.
    update public.question_renditions
       set lifecycle_status = 'superseded', superseded_at = now()
     where question_id = new.id
       and rendition_type = 'translated'
       and lifecycle_status = 'draft';

    insert into public.question_renditions (
      question_id, language_code, transform_status, generation_reason,
      rendition_type, lifecycle_status, version)
    select new.id, l.language_code, 'pending', l.generation_reason, 'translated', 'draft',
           (select coalesce(max(v.version), 0) + 1 from public.question_renditions v
             where v.question_id = new.id and v.language_code = l.language_code)
      from (select distinct on (r.language_code) r.language_code, r.generation_reason
              from public.question_renditions r
             where r.question_id = new.id
               and r.rendition_type = 'translated'
             order by r.language_code, r.version desc) l;
  end if;

  v_actor := coalesce(auth.uid(), nullif(current_setting('app.question_edit_actor', true), '')::uuid);

  insert into public.question_wording_edits (
    question_id, edited_by, edit_source, change_request,
    old_question, new_question, old_slider_low, new_slider_low, old_slider_high, new_slider_high)
  values (
    new.id, v_actor,
    nullif(current_setting('app.question_edit_source', true), ''),
    nullif(current_setting('app.question_edit_request', true), ''),
    old.question, new.question, old.slider_low_label, new.slider_low_label,
    old.slider_high_label, new.slider_high_label);

  return null;
end;
$function$;

drop trigger if exists trg_write_through_question on public.questions;
create trigger trg_write_through_question
  after update of question, slider_low_label, slider_high_label on public.questions
  for each row execute function public.write_through_question_to_english_rendition();

-- ── 4. context write-through steps aside for a wording edit ─────────────────
create or replace function public.write_through_context_to_renditions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cur  public.question_renditions;
  v_next integer;
begin
  if new.context_summary is not distinct from old.context_summary then return null; end if;
  if pg_trigger_depth() > 1 then return null; end if;
  -- A wording change in the same UPDATE is carried (with this context) by
  -- write_through_question_to_english_rendition; doing it here too would
  -- publish two English versions for one edit.
  if new.question          is distinct from old.question
     or new.slider_low_label  is distinct from old.slider_low_label
     or new.slider_high_label is distinct from old.slider_high_label then
    return null;
  end if;

  select * into v_cur
    from public.question_renditions
   where question_id = new.id and language_code = 'en' and lifecycle_status = 'published';

  if v_cur.id is null then return null; end if;
  if v_cur.context_summary is not distinct from new.context_summary then return null; end if;

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
    new.id, 'en', v_cur.rendered_text, v_cur.slider_low_label, v_cur.slider_high_label,
    new.context_summary, v_cur.summary, v_cur.rendition_type, 'published', 'published',
    v_cur.axis_equivalence_check,
    'Background (context_summary) updated by an admin and written through; wording and slider labels unchanged.',
    v_cur.generation_reason, v_next, v_cur.derived_from_rendition_id,
    auth.uid(), now(), now());

  if v_cur.rendition_type = 'original' then
    insert into public.question_renditions (
      question_id, language_code, transform_status, generation_reason,
      rendition_type, lifecycle_status, version)
    select new.id, t.language_code, 'pending', t.generation_reason, 'translated', 'draft',
           (select coalesce(max(v.version), 0) + 1 from public.question_renditions v
             where v.question_id = new.id and v.language_code = t.language_code)
      from public.question_renditions t
     where t.question_id = new.id
       and t.lifecycle_status = 'published'
       and t.rendition_type = 'translated'
       and not exists (
         select 1 from public.question_renditions d
          where d.question_id = new.id and d.language_code = t.language_code
            and d.lifecycle_status = 'draft' and d.transform_status = 'pending');
  end if;

  return null;
end;
$function$;

-- ── 6. suggest-then-approve ─────────────────────────────────────────────────
create table if not exists public.question_edit_suggestions (
  id                 uuid primary key default gen_random_uuid(),
  question_id        uuid not null references public.questions(id) on delete cascade,
  requested_by       uuid not null,
  requester_role     text not null check (requester_role in ('proposer', 'admin')),
  change_request     text not null,
  base_question      text not null,   -- the wording the suggestion was made from
  suggested_question text not null,
  suggested_low      text,
  suggested_high     text,
  suggested_context  text,
  suggested_links    text[],
  safety_flag        text,
  framing_flag       text,
  notes              text,
  model              text,
  status             text not null default 'pending'
                     check (status in ('pending', 'applied', 'discarded', 'superseded', 'expired')),
  created_at         timestamptz not null default now(),
  applied_at         timestamptz
);
create index if not exists idx_question_edit_suggestions_question
  on public.question_edit_suggestions (question_id, created_at desc);

-- Service role only: the edge function is the sole reader and writer.
alter table public.question_edit_suggestions enable row level security;
revoke all on public.question_edit_suggestions from anon, authenticated;

create or replace function public.apply_question_edit_suggestion(p_suggestion_id uuid, p_actor uuid)
returns table(question_id uuid, question text, slider_low_label text, slider_high_label text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s        public.question_edit_suggestions;
  v_q        public.questions;
  v_is_admin boolean;
begin
  select * into v_s from public.question_edit_suggestions where id = p_suggestion_id for update;
  if v_s.id is null then
    raise exception 'SUGGESTION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_s.requested_by <> p_actor then
    raise exception 'FORBIDDEN: only the person who asked for this suggestion can apply it' using errcode = '42501';
  end if;
  if v_s.status <> 'pending' then
    raise exception 'SUGGESTION_NOT_PENDING: this suggestion is %', v_s.status using errcode = '22023';
  end if;
  if v_s.created_at < now() - interval '1 hour' then
    update public.question_edit_suggestions set status = 'expired' where id = v_s.id;
    raise exception 'SUGGESTION_EXPIRED' using errcode = '22023';
  end if;

  select * into v_q from public.questions where id = v_s.question_id for update;
  if v_q.id is null then
    raise exception 'QUESTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Re-checked here (not only in the edge function) so the rule cannot be
  -- bypassed by calling the RPC another way.
  v_is_admin := exists (select 1 from public.admin_users au where au.user_id = p_actor);
  if not v_is_admin and v_q.proposed_by is distinct from p_actor then
    raise exception 'FORBIDDEN: only the person who posted this question or an admin can edit it' using errcode = '42501';
  end if;
  if v_s.requester_role = 'admin' and not v_is_admin then
    raise exception 'FORBIDDEN: admin rights required' using errcode = '42501';
  end if;
  -- Someone else changed the question after this suggestion was made.
  if v_q.question is distinct from v_s.base_question then
    update public.question_edit_suggestions set status = 'superseded' where id = v_s.id;
    raise exception 'QUESTION_CHANGED: the question was edited after this suggestion was made' using errcode = '40001';
  end if;

  perform set_config('app.question_edit_actor',   p_actor::text,          true);
  perform set_config('app.question_edit_source',  v_s.requester_role,     true);
  perform set_config('app.question_edit_request', left(v_s.change_request, 1000), true);

  -- trg_questions_lock_wording enforces "no answers yet" inside this UPDATE.
  update public.questions q
     set question          = v_s.suggested_question,
         slider_low_label  = coalesce(v_s.suggested_low,  q.slider_low_label),
         slider_high_label = coalesce(v_s.suggested_high, q.slider_high_label),
         context_summary   = coalesce(v_s.suggested_context, q.context_summary),
         supporting_links  = case when v_s.suggested_links is not null and cardinality(v_s.suggested_links) > 0
                                  then v_s.suggested_links else q.supporting_links end
   where q.id = v_s.question_id;

  -- Share images were rendered from the old wording.
  delete from public.og_image_cache      where og_image_cache.question_id      = v_s.question_id;
  delete from public.whatsapp_card_cache where whatsapp_card_cache.question_id = v_s.question_id;

  update public.question_edit_suggestions
     set status = 'applied', applied_at = now()
   where id = v_s.id;
  update public.question_edit_suggestions
     set status = 'superseded'
   where question_edit_suggestions.question_id = v_s.question_id
     and status = 'pending' and id <> v_s.id;

  return query
    select q.id, q.question, q.slider_low_label, q.slider_high_label
      from public.questions q where q.id = v_s.question_id;
end;
$function$;

revoke all on function public.apply_question_edit_suggestion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_question_edit_suggestion(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
