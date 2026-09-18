-- Epic UGQ Design F2, phase 3 of 6: make published wording immutable, make
-- publishing atomic, and stop unverified wording reaching respondents.

-- ---------------------------------------------------------------- publish gate
-- A rendition may only collect responses if it is approved source text
-- (not_applicable), machine-verified (pass), or a human vouched for it
-- (human_approved). needs_review / failed / unchecked can never be published.
alter table public.question_renditions
  drop constraint if exists question_renditions_publish_requires_text;

alter table public.question_renditions
  add constraint question_renditions_publish_gate
    check (
      lifecycle_status <> 'published'
      or (rendered_text is not null and btrim(rendered_text) <> ''
          and axis_equivalence_check in ('pass','human_approved','not_applicable'))
    );

-- Originals are the source wording; there is nothing to compare them against,
-- so a machine verdict on one is meaningless rather than merely unnecessary.
alter table public.question_renditions
  add constraint question_renditions_original_not_checked
    check (rendition_type <> 'original' or axis_equivalence_check = 'not_applicable');

-- ------------------------------------------------------------ immutability
-- Drafts may mutate freely. Published rows may not: once respondents can answer
-- wording, that wording is part of the measurement record. Corrections append a
-- new version instead. Enforced here rather than in application code so a future
-- caller cannot quietly reintroduce the upsert this design exists to remove.
create or replace function public.question_renditions_enforce_append_only()
returns trigger
language plpgsql
as $$
begin
  if old.lifecycle_status = 'published' then
    if new.rendered_text     is distinct from old.rendered_text
    or new.slider_low_label  is distinct from old.slider_low_label
    or new.slider_high_label is distinct from old.slider_high_label
    or new.context_summary   is distinct from old.context_summary
    or new.language_code     is distinct from old.language_code
    or new.question_id       is distinct from old.question_id
    or new.version           is distinct from old.version
    or new.rendition_type    is distinct from old.rendition_type then
      raise exception
        'Rendition % is published and immutable; insert a new version and supersede it instead (see publish_rendition_version)',
        old.id
        using errcode = '23514';
    end if;

    -- published may only move on to superseded or invalidated
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
$$;

drop trigger if exists trg_question_renditions_append_only on public.question_renditions;
create trigger trg_question_renditions_append_only
  before update on public.question_renditions
  for each row execute function public.question_renditions_enforce_append_only();

-- --------------------------------------------------- atomic supersede+publish
-- Supersede-and-publish in ONE server-side transaction. Two admins publishing
-- the same (question, language) concurrently would otherwise race the partial
-- unique index; the advisory lock serialises them, and the closing assertion
-- means a bug here fails loudly rather than leaving two live wordings.
create or replace function public.publish_rendition_version(p_rendition_id uuid)
returns public.question_renditions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.question_renditions;
  v_live integer;
begin
  perform public._ensure_admin_or_service();

  select * into v_row from public.question_renditions where id = p_rendition_id;
  if v_row.id is null then
    raise exception 'Rendition % not found', p_rendition_id;
  end if;

  if v_row.lifecycle_status = 'published' then
    return v_row;
  end if;
  if v_row.lifecycle_status in ('superseded','invalidated') then
    raise exception 'Rendition % is % and cannot be published', p_rendition_id, v_row.lifecycle_status;
  end if;
  if v_row.axis_equivalence_check not in ('pass','human_approved','not_applicable') then
    raise exception
      'Rendition % cannot be published: axis_equivalence_check is %. Only verified wording may collect responses.',
      p_rendition_id, coalesce(v_row.axis_equivalence_check, 'unchecked');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_row.question_id::text || ':' || v_row.language_code, 0));

  update public.question_renditions
     set lifecycle_status = 'superseded',
         superseded_at    = now()
   where question_id     = v_row.question_id
     and language_code   = v_row.language_code
     and lifecycle_status = 'published'
     and id <> p_rendition_id;

  update public.question_renditions
     set lifecycle_status = 'published',
         published_at     = now(),
         transform_status = 'published'
   where id = p_rendition_id
  returning * into v_row;

  select count(*) into v_live
  from public.question_renditions
  where question_id = v_row.question_id
    and language_code = v_row.language_code
    and lifecycle_status = 'published';

  if v_live <> 1 then
    raise exception 'publish_rendition_version left % published rows for (%, %)',
      v_live, v_row.question_id, v_row.language_code;
  end if;

  return v_row;
end;
$$;

revoke all on function public.publish_rendition_version(uuid) from public, anon;
grant execute on function public.publish_rendition_version(uuid) to authenticated, service_role;
