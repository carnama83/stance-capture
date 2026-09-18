-- The public-read policy on question_renditions still keyed on
-- transform_status = 'published'. Under F2 that column is pipeline state, not
-- publication state -- publish_rendition_version sets BOTH, so a superseded row
-- keeps transform_status='published' forever and stayed publicly readable.
--
-- Observed directly: after an admin edit-and-publish, v1 sat lifecycle_status
-- ='superseded' with transform_status='published'.
--
-- This is not a leak of anything secret -- the wording was public when it was
-- live -- but it is the model being inconsistent with itself, and it matters
-- for INVALIDATED renditions: wording withdrawn as defective would remain
-- readable to anyone querying the table directly. The feed functions were
-- already correct (they go through wording_for, which filters on
-- lifecycle_status); only direct table access was wrong.

drop policy if exists question_renditions_public_read on public.question_renditions;

create policy question_renditions_public_read
  on public.question_renditions
  for select
  using (lifecycle_status = 'published');

do $$
declare v_expr text;
begin
  select pg_get_expr(polqual, polrelid) into v_expr
  from pg_policy where polrelid='public.question_renditions'::regclass
    and polname='question_renditions_public_read';
  if v_expr is null or v_expr !~ 'lifecycle_status' then
    raise exception 'F2: public read policy did not switch to lifecycle_status (got %)', v_expr;
  end if;
end $$;
