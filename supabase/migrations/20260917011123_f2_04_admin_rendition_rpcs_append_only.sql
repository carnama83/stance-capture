-- Epic UGQ Design F2, phase 3b: the four admin rendition RPCs all mutated rows
-- in place, which the append-only trigger now forbids for published wording.
-- Rewritten so corrections APPEND a version instead. Signatures, defaults and
-- return types are unchanged, so src/routes/admin/rendition-review/Index.tsx
-- keeps working without a frontend change.

create or replace function public.admin_publish_rendition(p_rendition_id uuid)
returns public.question_renditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.question_renditions;
begin
  perform public._ensure_admin_or_service();

  update public.question_renditions
     set reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_rendition_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  return public.publish_rendition_version(p_rendition_id);
end;
$$;

-- An admin editing wording creates a NEW version rather than overwriting the
-- one respondents may already have answered. Recorded as human_approved, not
-- 'pass': "a person vouched for this" must stay distinguishable from "a model
-- verified this" when the aggregate is later interrogated.
create or replace function public.admin_edit_and_publish_rendition(
  p_rendition_id uuid,
  p_rendered_text text,
  p_slider_low_label text default null::text,
  p_slider_high_label text default null::text)
returns public.question_renditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.question_renditions;
  v_new public.question_renditions;
  v_next integer;
begin
  perform public._ensure_admin_or_service();

  if p_rendered_text is null or btrim(p_rendered_text) = '' then
    raise exception 'rendered_text cannot be empty';
  end if;

  select * into v_old from public.question_renditions where id = p_rendition_id;
  if v_old.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  -- A draft has no respondents yet, so editing it in place loses nothing and
  -- avoids littering the history with versions nobody ever saw.
  if v_old.lifecycle_status = 'draft' then
    update public.question_renditions
       set rendered_text          = p_rendered_text,
           slider_low_label       = coalesce(p_slider_low_label, slider_low_label),
           slider_high_label      = coalesce(p_slider_high_label, slider_high_label),
           axis_equivalence_check = 'human_approved',
           axis_equivalence_notes = 'Manually edited and approved by reviewer.',
           reviewed_by            = auth.uid(),
           reviewed_at            = now()
     where id = p_rendition_id
    returning * into v_new;

    return public.publish_rendition_version(v_new.id);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_old.question_id::text || ':' || v_old.language_code, 0));

  select coalesce(max(version), 0) + 1 into v_next
  from public.question_renditions
  where question_id = v_old.question_id and language_code = v_old.language_code;

  insert into public.question_renditions (
    question_id, language_code, rendered_text, slider_low_label, slider_high_label,
    context_summary, rendition_type, lifecycle_status, transform_status,
    axis_equivalence_check, axis_equivalence_notes, generation_reason,
    version, derived_from_rendition_id, reviewed_by, reviewed_at,
    transform_model, transform_prompt_version)
  values (
    v_old.question_id, v_old.language_code, p_rendered_text,
    coalesce(p_slider_low_label, v_old.slider_low_label),
    coalesce(p_slider_high_label, v_old.slider_high_label),
    v_old.context_summary, v_old.rendition_type, 'draft', 'transformed',
    'human_approved', 'Manually edited and approved by reviewer.',
    v_old.generation_reason, v_next, v_old.derived_from_rendition_id,
    auth.uid(), now(), v_old.transform_model, v_old.transform_prompt_version)
  returning * into v_new;

  return public.publish_rendition_version(v_new.id);
end;
$$;

-- Flagging is review metadata, not a lifecycle change: it must not silently
-- pull live wording out from under respondents. An admin who wants it gone
-- invalidates it explicitly.
create or replace function public.admin_flag_rendition(
  p_rendition_id uuid, p_review_notes text)
returns public.question_renditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.question_renditions;
begin
  perform public._ensure_admin_or_service();

  if p_review_notes is null or btrim(p_review_notes) = '' then
    raise exception 'review_notes required when flagging a rendition';
  end if;

  update public.question_renditions
     set transform_status = 'flagged',
         review_notes     = p_review_notes,
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   where id = p_rendition_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  return v_row;
end;
$$;

-- Regenerating PUBLISHED wording must not blank the text respondents are
-- currently answering. It opens a new draft version to regenerate into; the
-- live row stays live until the replacement is verified and published.
create or replace function public.admin_regenerate_rendition(p_rendition_id uuid)
returns public.question_renditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.question_renditions;
  v_new public.question_renditions;
  v_next integer;
begin
  perform public._ensure_admin_or_service();

  select * into v_old from public.question_renditions where id = p_rendition_id;
  if v_old.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  if v_old.rendition_type = 'original' then
    raise exception
      'Rendition % is the source-language original; it is the proposer''s approved wording and is never machine-regenerated', p_rendition_id;
  end if;

  if v_old.lifecycle_status = 'draft' then
    update public.question_renditions
       set transform_status       = 'pending',
           claimed_at             = null,
           review_notes           = null,
           axis_equivalence_check = null,
           axis_equivalence_notes = null
     where id = p_rendition_id
    returning * into v_new;
    return v_new;
  end if;

  if v_old.lifecycle_status <> 'published' then
    raise exception 'Rendition % is % and cannot be regenerated', p_rendition_id, v_old.lifecycle_status;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_old.question_id::text || ':' || v_old.language_code, 0));

  select coalesce(max(version), 0) + 1 into v_next
  from public.question_renditions
  where question_id = v_old.question_id and language_code = v_old.language_code;

  insert into public.question_renditions (
    question_id, language_code, rendered_text, slider_low_label, slider_high_label,
    context_summary, rendition_type, lifecycle_status, transform_status,
    generation_reason, version, derived_from_rendition_id)
  values (
    v_old.question_id, v_old.language_code, v_old.rendered_text,
    v_old.slider_low_label, v_old.slider_high_label, v_old.context_summary,
    v_old.rendition_type, 'draft', 'pending',
    v_old.generation_reason, v_next, v_old.derived_from_rendition_id)
  returning * into v_new;

  return v_new;
end;
$$;
