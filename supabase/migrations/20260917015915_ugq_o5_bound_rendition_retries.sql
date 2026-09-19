-- UGQ-O5: rendition generation retried forever on a permanent failure.
--
-- Observed during the D7 regression: the largest source (192-char question +
-- 258-char context_summary) threw and was released for retry twice before
-- succeeding. Nothing caps that. A question that fails permanently -- an
-- oversized output, a prompt that cannot produce valid JSON -- would be
-- reclaimed by the 1-minute cron indefinitely, burning an Anthropic call every
-- sweep with no operator ever being told.
--
-- Two separate problems, fixed separately: this migration bounds the retries;
-- the edge function is changed alongside it to LOG the error text, which is
-- what was actually missing when the cause needed diagnosing (the function
-- returns errors in its HTTP response body and the cron discards it).

alter table public.question_renditions
  add column if not exists failure_count integer not null default 0,
  add column if not exists last_error text;

comment on column public.question_renditions.failure_count is
  'Consecutive generation failures. At MAX_RENDITION_FAILURES the row stops being claimed and is flagged for a human instead of retrying forever.';
comment on column public.question_renditions.last_error is
  'Error text from the most recent failed generation. Previously this only existed in the HTTP response the cron threw away.';

-- 5 is deliberately higher than the edge function's own 3-attempt repair loop:
-- the repair loop handles a rendition the checker REJECTED, this handles the
-- generation call THROWING. They count different things and must not be
-- conflated.
create or replace function public.admin_claim_rendition_jobs(p_limit integer default 20)
returns setof public.question_renditions
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_ids uuid[];
  v_stale_after interval := interval '10 minutes';
begin
  perform public.assert_admin_caller();
  with upd as (
    update public.question_renditions r
       set claimed_at = now()
     where r.id in (
       select id
       from public.question_renditions
       where transform_status = 'pending'
         and failure_count < 5
         and (claimed_at is null or claimed_at < now() - v_stale_after)
       order by created_at asc
       limit greatest(p_limit, 1)
       for update skip locked
     )
     returning r.id
  )
  select coalesce(array_agg(id), '{}') into claimed_ids from upd;

  return query
    select * from public.question_renditions where id = any(claimed_ids);
end;
$$;

-- The targeted path is driven by a human or by ugq-confirm-publish, so it is
-- allowed to retry a capped-out row -- but only deliberately, one call at a
-- time, never on the cron's automatic sweep.
create or replace function public.admin_claim_rendition_job_by_id(p_rendition_id uuid)
returns setof public.question_renditions
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
  v_stale_after interval := interval '10 minutes';
begin
  perform public.assert_admin_caller();
  with upd as (
    update public.question_renditions r
       set claimed_at = now()
     where r.id = (
       select id
       from public.question_renditions
       where id = p_rendition_id
         and transform_status = 'pending'
         and (claimed_at is null or claimed_at < now() - v_stale_after)
       for update skip locked
     )
     returning r.id
  )
  select id into claimed_id from upd;

  return query
    select * from public.question_renditions where id = claimed_id;
end;
$$;

-- Regenerating by hand is an explicit decision to try again, so it clears the
-- counter; otherwise a row that once hit the cap could never be retried.
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
           axis_equivalence_notes = null,
           failure_count          = 0,
           last_error             = null
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

-- Surfaces capped-out renditions so they are visible rather than silently stuck.
create or replace view public.v_rendition_jobs_stuck as
select r.id, r.question_id, r.language_code, r.failure_count, r.last_error,
       r.created_at, r.claimed_at
from public.question_renditions r
where r.transform_status = 'pending' and r.failure_count >= 5;

revoke all on public.v_rendition_jobs_stuck from anon;
grant select on public.v_rendition_jobs_stuck to authenticated, service_role;
