-- Sep 2026, CUTOVER: replaces the text_mentions_india() OR-chain (which
-- inspected three questions columns plus two topics columns of free text)
-- with a single check against the question's own resolved location_id, via
-- the new language_applies_to_location() hierarchy-overlap function. This
-- generalizes Hindi-only gating into a data-driven language<->region model
-- — see language_regions table. text_mentions_india() itself is left in
-- place (unused by this trigger from now on) rather than dropped, in case
-- anything else still references it; safe to remove in a later cleanup
-- once confirmed nothing does.
--
-- UGQ (source='community') behavior is completely unchanged — still stubs
-- unconditionally regardless of location. A null location_id (nothing
-- resolved from the free-text labels) short-circuits to no extra stub,
-- matching text_mentions_india()'s own behavior for unrecognized text —
-- deliberately not defaulting to "stub for Global", which would require an
-- explicit language_regions row mapped to the Global location instead.
create or replace function public.stub_question_renditions()
returns trigger
language plpgsql
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
