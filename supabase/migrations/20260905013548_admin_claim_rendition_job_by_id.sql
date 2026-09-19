-- Sep 2026, NEW: single-row counterpart to admin_claim_rendition_jobs, for
-- the synchronous UGQ-publish path (generate-question-renditions' optional
-- rendition_id param) — same pending/staleness guard and row-level lock as
-- the FIFO batch claim, just targeted at exactly one row instead of the
-- next N by created_at. Lets a publish-time caller claim a specific, known
-- rendition_id without racing (or double-processing with) the 1-min cron
-- sweep, which keeps claiming whatever's oldest-and-pending regardless.
create or replace function public.admin_claim_rendition_job_by_id(p_rendition_id uuid)
returns setof question_renditions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  claimed_id uuid;
  v_stale_after interval := interval '10 minutes';
begin
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
$function$;
