-- Settings → Location: typo-tolerant place search.
--
-- Sep 2026: a user typed "Maharastra" and got "No matching states found" (read
-- as "not a valid state"). The page searched with name ILIKE '%query%', so any
-- spelling slip, a trailing space, or a state code like "MH" found nothing.
--
-- search_locations() keeps the substring match and adds:
--   * trimming (and collapsing inner whitespace),
--   * ISO code match ("MH" or "IN-MH" → Maharashtra, "US" → United States),
--   * pg_trgm similarity >= 0.3 for misspellings ("Maharastra", "Utar Pradesh").
-- Ranked: exact name / code, then prefix, then substring, then closest spelling.
-- SECURITY INVOKER: locations is already publicly readable.

create or replace function public.search_locations(
  p_type text,
  p_query text,
  p_parent_id uuid default null,
  p_limit int default 25
)
returns table (id uuid, iso_code text, name text, type text)
language sql
stable
set search_path = public
as $$
  with q as (
    select regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g') as s
  ),
  c as (
    select l.id, l.iso_code, l.name, l.type::text as type,
      case
        when lower(l.name) = lower(q.s) then 0
        when l.iso_code is not null
             and (upper(l.iso_code) = upper(q.s)
                  or upper(split_part(l.iso_code, '-', 2)) = upper(q.s)) then 0
        when l.name ilike q.s || '%' then 1
        when l.name ilike '%' || q.s || '%' then 2
        else 3
      end as rank,
      similarity(q.s, l.name) as sim
    from public.locations l, q
    where length(q.s) >= 1
      and l.type::text = p_type
      and (p_parent_id is null or l.parent_id = p_parent_id)
      and (
        l.name ilike '%' || q.s || '%'
        or (l.iso_code is not null
            and (upper(l.iso_code) = upper(q.s)
                 or upper(split_part(l.iso_code, '-', 2)) = upper(q.s)))
        or (length(q.s) >= 3 and similarity(q.s, l.name) >= 0.3)
      )
  )
  select c.id, c.iso_code, c.name, c.type
  from c
  order by c.rank, c.sim desc, c.name
  limit greatest(1, least(coalesce(p_limit, 25), 50));
$$;

grant execute on function public.search_locations(text, text, uuid, int) to anon, authenticated, service_role;
