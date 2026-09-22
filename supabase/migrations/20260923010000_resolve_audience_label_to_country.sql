-- Fix 3 of the UGQ audience-targeting work: a city or state typed into the
-- proposer's Location box must resolve to its COUNTRY before it becomes the
-- audience label.
--
-- SYMPTOM. Dev holds a community question with audience_location_label = 'Jaipur'.
-- Feed matching compares the audience against a COUNTRY label ('India',
-- 'United States', 'Global'), so 'Jaipur' matches no country tab at all: the
-- question surfaces only on the Global tab -- shown to everyone EXCEPT the people
-- it was written for. Same class for any state or city: 'Tamil Nadu', 'Bengaluru',
-- 'Karnataka', 'Seattle', 'Chicago'.
--
-- WHY IT HAPPENS. normalize_audience_location_label is a small alias table
-- (Global/US/UK/UAE) with `initcap()` as the catch-all. It never claimed to map a
-- place to its country -- 'INdia' -> 'India' only ever worked because initcap
-- happens to fix that particular typo, not because India is in the alias list.
-- Anything it does not recognise is simply title-cased and passed through.
--
-- THE FIX USES THE APP'S OWN GAZETTEER, NOT A HARDCODED LIST. public.locations
-- already holds 35,100 rows -- 15 countries, 87 states, 3,924 counties, 31,073
-- cities -- in a parent_id hierarchy. Walking it upward answers the question
-- exactly, stays correct as the table grows, and needs no list maintained by hand.
-- Verified on Dev before writing this:
--
--   Jaipur (county) -> Rajasthan (state) -> India
--   Bengaluru (city) -> Karnataka (state) -> India
--   Tamil Nadu (state)                    -> India
--   Seattle (city) -> King (county) -> Washington (state) -> United States
--   Chicago (city) -> Cook (county) -> Illinois (state)   -> United States
--   Nowhereville                          -> NULL (falls through unchanged)
--
-- normalize_audience_location_label IS DELIBERATELY LEFT ALONE. It is IMMUTABLE
-- and pure; reading a table from it would force STABLE and silently change what
-- it is safe to use in. (Checked: it currently backs no index and no generated
-- column, so the change would have been legal today -- but the constraint is
-- worth keeping.) The gazetteer lookup lives in new STABLE functions instead, and
-- the alias table keeps doing the one job it was written for.
--
-- AMBIGUITY. A bare city name can exist in more than one country. The seed picks
-- the highest-level match first (country > state > county > city) and orders
-- deterministically after that, so 'India' resolves as the country rather than as
-- some village of the same name. With only 15 countries loaded, cross-country
-- collisions are currently nil -- every probe above returned exactly one distinct
-- country. If the gazetteer later grows to where a name genuinely spans countries,
-- this picks one; that is still strictly better than the present behaviour, which
-- leaves the question reaching nobody.
--
-- UNRESOLVED LABELS ARE LEFT EXACTLY AS THEY ARE, not coerced to 'Global'. A label
-- we cannot place is not evidence that the question is worldwide, and quietly
-- widening its audience would be a second targeting bug wearing the first one's
-- clothes.

-- ── the walk ────────────────────────────────────────────────────────────────
create or replace function public.resolve_country_for_label(p_label text)
returns text
language sql
stable
set search_path to 'public'
as $function$
  with recursive seed as (
    select l.id, l.type, l.parent_id,
           row_number() over (
             order by case l.type::text
                        when 'country' then 1
                        when 'state'   then 2
                        when 'county'  then 3
                        else 4
                      end,
                      l.name
           ) as rn
    from public.locations l
    where p_label is not null
      and btrim(p_label) <> ''
      and lower(l.name) = lower(btrim(p_label))
  ),
  walk as (
    select s.id, s.type, s.parent_id, 0 as depth
    from seed s
    where s.rn = 1
    union all
    -- depth guard: the hierarchy is country > state > county > city, so 6 is
    -- already generous. It exists so a cyclic parent_id can never spin here.
    select l.id, l.type, l.parent_id, w.depth + 1
    from walk w
    join public.locations l on l.id = w.parent_id
    where w.type::text <> 'country' and w.depth < 6
  )
  select l.name
  from walk w
  join public.locations l on l.id = w.id
  where w.type::text = 'country'
  limit 1;
$function$;

comment on function public.resolve_country_for_label(text) is
  'Resolves a place name to its country by walking public.locations upward via parent_id. Returns NULL when the name is not in the gazetteer. Prefers a higher-level match (country > state > county > city) when a name is used at several levels.';

-- ── the one place an audience label is made canonical ───────────────────────
create or replace function public.canonical_audience_label(p_label text)
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_norm    text;
  v_country text;
begin
  if p_label is null or btrim(p_label) = '' then
    return null;
  end if;

  -- Alias table first: it owns 'Global' and the US/UK/UAE spellings, and its
  -- answers must not be second-guessed by a gazetteer lookup.
  v_norm := public.normalize_audience_location_label(p_label);

  if v_norm = 'Global' then
    return v_norm;
  end if;

  -- Already a country? resolve_country_for_label returns it unchanged, so this
  -- single call covers both "it is a country" and "it is a place inside one".
  v_country := public.resolve_country_for_label(v_norm);
  if v_country is not null then
    return v_country;
  end if;

  -- Not in the gazetteer. Keep the normalized label rather than inventing a
  -- broader audience for it.
  return v_norm;
end;
$function$;

comment on function public.canonical_audience_label(text) is
  'The single canonicalizer for questions.audience_location_label: alias table, then gazetteer resolution to a country. Unknown labels are returned normalized but otherwise untouched, never widened to Global (20260923010000).';

-- ── inference now canonicalizes the label it derives ────────────────────────
-- Only the PRIMARY (explicit-location) branch changes: the last comma-separated
-- part goes through canonical_audience_label instead of the bare alias table, so
-- "Bengaluru", "Tamil Nadu" and "Jaipur, Rajasthan" all land on 'India'. The
-- keyword fallback below it is untouched here -- that is Fix 1's job, and it is
-- handled by the reframe supplying a country outright.
create or replace function public.infer_audience_location(
  p_question_text text,
  p_summary text default null,
  p_tags text[] default null,
  p_origin_label text default null)
returns table(audience_label text, reason text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  v_origin  text;
  v_parts   text[];
  v_country text;
  v_canon   text;
  v_lower   text;
BEGIN
  v_origin := btrim(coalesce(p_origin_label, ''));

  -- PRIMARY: derive from the corrected event location_label.
  IF v_origin <> '' THEN
    IF lower(v_origin) IN ('global','worldwide','international') THEN
      RETURN QUERY SELECT 'Global'::text,
                          'Multinational event; global relevance.'::text;
      RETURN;
    END IF;

    -- Take the last comma-separated part as the country ("Tamil Nadu, India" -> "India").
    v_parts   := string_to_array(v_origin, ',');
    v_country := btrim(v_parts[cardinality(v_parts)]);

    IF v_country <> '' THEN
      v_canon := public.canonical_audience_label(v_country);

      -- Say which of the two things happened, so audience_reason stays a real
      -- explanation rather than a fixed string.
      IF v_canon IS DISTINCT FROM public.normalize_audience_location_label(v_country) THEN
        RETURN QUERY SELECT v_canon,
                            format('Audience resolved to the country containing %s.', v_country)::text;
      ELSE
        RETURN QUERY SELECT v_canon,
                            'Audience matches the country where the event occurred.'::text;
      END IF;
      RETURN;
    END IF;
  END IF;

  -- FALLBACK: no location signal — light keyword heuristic (preserved verbatim).
  v_lower := lower(
    coalesce(p_question_text,'') || ' ' ||
    coalesce(p_summary,'')       || ' ' ||
    array_to_string(coalesce(p_tags,'{}'), ' ')
  );

  IF v_lower ~* '(white house|congress|senate|supreme court|pentagon|federal government|president trump|president biden|federal law|us military|executive order)'
  THEN
    RETURN QUERY SELECT 'United States'::text,
                        'Federal policy decision; national relevance.'::text;
    RETURN;
  END IF;

  IF v_lower ~* '(nato|united nations|war between|conflict between|multinational|worldwide)'
  THEN
    RETURN QUERY SELECT 'Global'::text,
                        'International conflict or multinational issue; global relevance.'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'Global'::text,
                      'No specific location signal; defaulting to global.'::text;
END;
$function$;

-- ── both triggers canonicalize an explicitly-supplied label ─────────────────
-- This is what makes Fix 1 safe: ugq-publish will start sending an
-- audience_location_label taken from the reframe. If the model answers with a
-- city or state instead of a country, the bare alias table would have title-cased
-- it and written it straight through, recreating the 'Jaipur' bug from a new
-- direction. Routing the explicit path through canonical_audience_label closes
-- that door before it opens.
create or replace function public.fn_ensure_audience_on_insert()
returns trigger
language plpgsql
as $function$
BEGIN
  IF NEW.audience_location_label IS NOT NULL THEN
    NEW.audience_location_label := public.canonical_audience_label(NEW.audience_location_label);
    -- audience_reason exists so a row can explain its own targeting. The
    -- inference branch below has always written one; this branch never did,
    -- because until Fix 1 nothing supplied an explicit label in the first place.
    -- Now that ugq-publish does, leaving it NULL would mean every
    -- reframe-targeted question silently lost that audit trail.
    IF NEW.audience_reason IS NULL THEN
      NEW.audience_reason := 'Audience supplied at publish time and canonicalized.';
    END IF;
  END IF;

  IF NEW.published_at IS NOT NULL AND NEW.audience_location_label IS NULL AND NEW.status = 'active' THEN
    SELECT audience_label, reason
    INTO NEW.audience_location_label, NEW.audience_reason
    FROM public.infer_audience_location(
      NEW.question, NEW.summary, NEW.tags, NEW.location_label
    ) LIMIT 1;
    NEW.origin_location_label := COALESCE(NEW.origin_location_label, NEW.location_label);
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.fn_ensure_audience_on_publish()
returns trigger
language plpgsql
as $function$
BEGIN
  IF NEW.audience_location_label IS NOT NULL THEN
    NEW.audience_location_label := public.canonical_audience_label(NEW.audience_location_label);
    -- audience_reason exists so a row can explain its own targeting. The
    -- inference branch below has always written one; this branch never did,
    -- because until Fix 1 nothing supplied an explicit label in the first place.
    -- Now that ugq-publish does, leaving it NULL would mean every
    -- reframe-targeted question silently lost that audit trail.
    IF NEW.audience_reason IS NULL THEN
      NEW.audience_reason := 'Audience supplied at publish time and canonicalized.';
    END IF;
  END IF;

  IF NEW.published_at IS NOT NULL
     AND OLD.published_at IS NULL
     AND NEW.audience_location_label IS NULL
     AND NEW.status = 'active'
  THEN
    SELECT audience_label, reason
    INTO NEW.audience_location_label, NEW.audience_reason
    FROM public.infer_audience_location(
      NEW.question, NEW.summary, NEW.tags, NEW.location_label
    )
    LIMIT 1;
    NEW.origin_location_label := COALESCE(
      NEW.origin_location_label, NEW.location_label
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- ── assert the behaviour, not just that the functions exist ─────────────────
do $verify$
declare
  v_bad text := '';
  r     record;
begin
  for r in
    select * from (values
      ('Jaipur',           'India'),
      ('Bengaluru',        'India'),
      ('Tamil Nadu',       'India'),
      ('Karnataka',        'India'),
      ('Seattle',          'United States'),
      ('Chicago',          'United States'),
      ('India',            'India'),
      ('USA',              'United States'),
      ('Global',           'Global'),
      -- Unknown place: normalized (initcap) but NOT widened to Global. Spaced
      -- rather than underscored on purpose -- Postgres initcap does not treat
      -- '_' as a word boundary, so an underscored probe asserts nothing about
      -- the normalization actually being applied.
      ('nowhereville fakeplace', 'Nowhereville Fakeplace')
    ) as t(label, expected)
  loop
    if public.canonical_audience_label(r.label) is distinct from r.expected then
      v_bad := v_bad || format(' %s -> %s (expected %s);',
                               r.label, public.canonical_audience_label(r.label), r.expected);
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'canonical_audience_label wrong:%', v_bad;
  end if;

  -- And the inference path that actually runs on insert.
  if (select audience_label from public.infer_audience_location('x', null, null, 'Bengaluru') limit 1)
     is distinct from 'India' then
    raise exception 'infer_audience_location did not resolve Bengaluru to India';
  end if;

  raise notice 'audience label resolution OK';
end
$verify$;
