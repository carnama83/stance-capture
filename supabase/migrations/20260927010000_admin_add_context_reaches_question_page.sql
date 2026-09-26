-- Admin > Live question > "Add Context" never reached the question page.
--
-- TWO DEFECTS, BOTH NEEDED FOR THE SYMPTOM ("I added context, nothing changed"):
--
-- 1. The RPC failed and said it succeeded. add_context_to_existing_question was
--    SECURITY INVOKER, so its audit insert into question_context_updates ran as
--    the admin's own role and hit RLS (that table has a read policy only). A
--    blanket EXCEPTION WHEN OTHERS turned the error into a normal result row
--    (success=false), and the admin page only checked for an HTTP error, so it
--    showed a green "Context added successfully." Nothing was written.
--    Proven on UAT as a real admin role in a rolled-back transaction:
--      success=f msg=Error: new row violates row-level security policy for
--      table "question_context_updates"
--
-- 2. Even a successful write would not have shown. Since the multilingual work
--    (pr3), the question page reads Background from question_renditions via
--    get_question_localized, and published renditions are immutable. The only
--    bridge from questions -> renditions is trg_write_through_question, which
--    fires on UPDATE OF question (the wording), never on context_summary.
--
-- FIX
--  * add_context_to_existing_question: SECURITY DEFINER, admin-guarded, errors
--    propagate instead of being swallowed, no anon EXECUTE. The appended text is
--    a plain new paragraph: the page renders plain text, so the old
--    "---" / "**Update N:**" markdown showed up as literal punctuation.
--  * New trigger trg_write_through_context: a direct change to
--    questions.context_summary publishes a new version of the published English
--    rendition carrying the new context (append-only, like the wording
--    write-through), and, when English is the question's source, re-queues every
--    published translation so generate-question-renditions re-translates it with
--    the new background. community_proposer translations auto-publish on pass;
--    others land in Rendition Review as before. The old translation stays live
--    until the new one is published, so no language ever goes blank.
--  Because the trigger sits on the column, "Update Phase"
--  (admin_mark_question_updated) is covered too, without touching it.

-- ── 1. the RPC ──────────────────────────────────────────────────────────────
create or replace function public.add_context_to_existing_question(
  p_question_id uuid,
  p_new_context text,
  p_supporting_link text default null,
  p_should_reactivate boolean default true)
returns table(success boolean, new_context_version integer, new_state text, message text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_context text;
  v_current_links   text[];
  v_current_version int;
  v_current_status  text;
  v_current_phase   text;
  v_new_context     text;
  v_new_links       text[];
  v_new_version     int;
  v_new_status      text;
  v_response_count  integer;
  v_age_days        numeric;
begin
  perform public.assert_admin_caller();

  if p_new_context is null or btrim(p_new_context) = '' then
    raise exception 'Context text is required' using errcode = '22023';
  end if;

  select q.context_summary, q.supporting_links, coalesce(q.context_version, 0),
         q.status::text, q.phase::text,
         (select count(*) from public.question_stances s where s.question_id = q.id),
         extract(epoch from (now() - q.published_at)) / 86400
    into v_current_context, v_current_links, v_current_version,
         v_current_status, v_current_phase, v_response_count, v_age_days
    from public.questions q
   where q.id = p_question_id
   for update;

  if not found then
    return query select false, 0, ''::text, 'Question not found'::text;
    return;
  end if;

  -- Append as a plain paragraph. The history of each addition lives in
  -- question_context_updates; the page itself renders plain text.
  if v_current_context is null or btrim(v_current_context) = '' then
    v_new_context := btrim(p_new_context);
  else
    v_new_context := v_current_context || E'\n\n' || btrim(p_new_context);
  end if;

  if p_supporting_link is not null and btrim(p_supporting_link) <> '' then
    v_new_links := array_append(coalesce(v_current_links, array[]::text[]), btrim(p_supporting_link));
  else
    v_new_links := v_current_links;
  end if;

  v_new_version := v_current_version + 1;

  if p_should_reactivate and v_current_status in ('dormant', 'cooling') then
    v_new_status := 'active';
  else
    v_new_status := v_current_status;
  end if;

  -- Never touches the question wording. trg_write_through_context carries the
  -- new context into the published rendition the page actually reads.
  update public.questions
     set context_summary         = v_new_context,
         supporting_links        = v_new_links,
         context_version         = v_new_version,
         last_context_refresh_at = now(),
         status                  = v_new_status::question_state
   where id = p_question_id;

  insert into public.question_context_updates (
    question_id, updated_by, old_phase, new_phase, new_context, supporting_links, updated_at)
  values (
    p_question_id, auth.uid(), coalesce(v_current_phase, 'initial'), 'update', btrim(p_new_context),
    case when p_supporting_link is not null and btrim(p_supporting_link) <> ''
         then array[btrim(p_supporting_link)] end,
    now());

  insert into public.question_state_history (
    question_id, old_state, new_state, reason, response_count, response_rate, age_days, created_at, created_by)
  values (
    p_question_id, v_current_status::question_state, v_new_status::question_state,
    'context_update:version_' || v_new_version, v_response_count, 0, coalesce(v_age_days, 0), now(), auth.uid());

  return query select true, v_new_version, v_new_status,
    format('Context added. Version %s.', v_new_version)::text;
end;
$function$;

revoke all on function public.add_context_to_existing_question(uuid, text, text, boolean) from public, anon;
grant execute on function public.add_context_to_existing_question(uuid, text, text, boolean) to authenticated, service_role;

-- ── 2. context write-through ────────────────────────────────────────────────
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
  -- Depth > 1 means the change came FROM a rendition (the English mirror), not
  -- from an edit; writing it back would loop, or push a translation's context
  -- into a source it was translated from.
  if pg_trigger_depth() > 1 then return null; end if;

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

  -- Re-translate only when English is the source. For a question that
  -- originated in another language, the English context is itself a
  -- translation, and deriving other languages from it would be the fabricated
  -- provenance the rendition model exists to prevent.
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
       -- a draft already waiting will read the new source context when it runs
       and not exists (
         select 1 from public.question_renditions d
          where d.question_id = new.id and d.language_code = t.language_code
            and d.lifecycle_status = 'draft' and d.transform_status = 'pending');
  end if;

  return null;
end;
$function$;

revoke all on function public.write_through_context_to_renditions() from public, anon, authenticated;

drop trigger if exists trg_write_through_context on public.questions;
create trigger trg_write_through_context
  after update of context_summary on public.questions
  for each row execute function public.write_through_context_to_renditions();

notify pgrst, 'reload schema';
