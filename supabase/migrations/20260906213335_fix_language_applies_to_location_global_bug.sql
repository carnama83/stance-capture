-- Sep 2026, FIXED: the "state language also gets national content" escalation
-- (checking whether the question's location is an ancestor of the language's
-- mapped region) trivially matched EVERY region-mapped language whenever a
-- question resolved to "Global" — Global is the root ancestor of every
-- country, so "is Global an ancestor of India" is true for literally any
-- country-mapped language, defeating the whole point of the gate. Confirmed
-- via the fixture test: 'Global' incorrectly returned true before this fix.
-- The escalation is only meant to walk UP a bounded number of real
-- geographic levels (state -> country), not all the way to the literal root
-- of the hierarchy — so exclude type='global' as a valid escalation target.
create or replace function public.language_applies_to_location(p_language_code text, p_location_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.language_regions lr
    where lr.language_code = p_language_code
      and (
        lr.region_id in (select id from public.location_ancestors(p_location_id))
        or (
          p_location_id in (select id from public.location_ancestors(lr.region_id))
          and not exists (select 1 from public.locations gl where gl.id = p_location_id and gl.type = 'global')
        )
      )
  );
$function$;
;
