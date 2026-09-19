-- Sep 2026, NEW — generalizes Hindi-rendition gating from a hardcoded India
-- keyword list (text_mentions_india, still left in place but no longer
-- called after the follow-up trigger-rewrite migration) into a data-driven
-- language<->region model, so launching a future language (Tamil, Telugu,
-- etc.) means adding rows, not writing new per-language matching code.

-- Mirrors the existing public.topic_regions(topic_id, region_id) pattern —
-- deliberately NOT the denormalized state_code/state_name text pattern
-- election_party_regions uses.
create table public.language_regions (
  language_code text not null references public.languages(language_code) on delete cascade,
  region_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (language_code, region_id)
);
create index on public.language_regions(region_id);
create index on public.language_regions(language_code);

-- Nullable: must tolerate free text that resolves to nothing (e.g. the
-- placeholder literal "Country" already seen in production data).
alter table public.questions add column location_id uuid references public.locations(id);
alter table public.question_drafts add column location_id uuid references public.locations(id);

create index if not exists locations_parent_id_idx on public.locations(parent_id);

-- Resolves free-text location labels (as already written by the editorial
-- pipeline) to a real public.locations row. Four-step: exact name match,
-- exact iso_code match, first-comma-segment match ("Tamil Nadu, India" ->
-- "Tamil Nadu"), then a pg_trgm fuzzy fallback for misspellings (mirrors
-- text_mentions_india()'s own use of pg_trgm, already installed on this
-- project). Returns null if nothing matches at any step — same
-- give-up-gracefully behavior text_mentions_india() already has for
-- unrecognized text.
create or replace function public.resolve_location_id(p_label text)
returns uuid
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_first_segment text;
begin
  if p_label is null or btrim(p_label) = '' then
    return null;
  end if;

  select id into v_id from public.locations
  where lower(name) = lower(btrim(p_label))
  order by case type when 'city' then 1 when 'county' then 2 when 'state' then 3
                      when 'country' then 4 else 5 end
  limit 1;
  if v_id is not null then return v_id; end if;

  select id into v_id from public.locations
  where lower(iso_code) = lower(btrim(p_label))
  limit 1;
  if v_id is not null then return v_id; end if;

  v_first_segment := btrim(split_part(p_label, ',', 1));
  if v_first_segment <> btrim(p_label) and v_first_segment <> '' then
    select id into v_id from public.locations
    where lower(name) = lower(v_first_segment)
    limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  select id into v_id from public.locations
  where similarity(name, btrim(p_label)) > 0.4
  order by similarity(name, btrim(p_label)) desc
  limit 1;

  return v_id;
end;
$function$;

-- Bounded (not unbounded-recursive) walk up locations.parent_id — depth <
-- 6, comfortable margin over the documented global->country->state/county
-- ->city ~4-level depth, so it can never run away even on an unexpected
-- cycle. Returns the location itself plus every ancestor up to Global.
create or replace function public.location_ancestors(p_location_id uuid)
returns table(id uuid)
language sql
stable
set search_path to 'public'
as $function$
  with recursive chain(id, parent_id, depth) as (
    select l.id, l.parent_id, 0 from public.locations l where l.id = p_location_id
    union all
    select l.id, l.parent_id, c.depth + 1
    from public.locations l join chain c on l.id = c.parent_id
    where c.depth < 6
  )
  select id from chain;
$function$;

-- True when EITHER: a language_regions row's region is an ancestor of the
-- question's location (language mapped to India, question resolved to a
-- Tamil Nadu city -> match), OR the question's location is an ancestor of a
-- language_regions row's region (language mapped to Tamil Nadu, question
-- resolved to India -> match — the confirmed "state language also gets
-- national content" decision). Both directions reuse location_ancestors(),
-- so there's no depth-mismatch risk between the two checks.
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
        or p_location_id in (select id from public.location_ancestors(lr.region_id))
      )
  );
$function$;

-- Seed: reproduces today's effective Hindi coverage (all of India, every
-- descendant state/city) with this one row.
insert into public.language_regions (language_code, region_id)
values ('hi', '951ec16f-4d63-4556-9710-4ca8eecc7a1b');
;
