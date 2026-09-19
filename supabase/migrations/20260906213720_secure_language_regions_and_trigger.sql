-- Sep 2026, FIXED: language_regions had RLS disabled entirely (flagged by
-- get_advisors as an ERROR-level lint) — mirror topic_regions' exact setup
-- (RLS enabled, single admin-only ALL policy, no public read policy at
-- all). Since nothing but admins can read this table directly, the trigger
-- that needs to read it (stub_question_renditions, via
-- language_applies_to_location) must run as SECURITY DEFINER so it isn't
-- blocked by RLS regardless of which role fires the INSERT on questions —
-- the elevated context persists through its nested calls to
-- language_applies_to_location()/location_ancestors() for the duration of
-- this function's execution.
alter table public.language_regions enable row level security;

create policy epicb_admin_language_regions_all
  on public.language_regions
  for all
  to public
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

create or replace function public.stub_question_renditions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.question_renditions (question_id, language_code, transform_status, generation_reason)
  select
    new.id,
    l.language_code,
    'pending',
    case when new.source = 'community' then 'community_proposer' else 'editorial_pipeline' end
  from public.languages l
  where l.is_active_for_ugq = true
    and l.language_code <> new.canonical_language
    and (
      new.source = 'community'
      or (new.location_id is not null and public.language_applies_to_location(l.language_code, new.location_id))
    )
  on conflict (question_id, language_code) do nothing;

  return new;
end;
$function$;
;
