-- Facebook Campaign Manager, Phase 1: each campaign names its target city.
--
-- PDD v1.2 §7: "Admin selects a published question and its target city."
-- questions.location_id cannot stand in for it: on Prod (4 Oct 2026) the Pune
-- questions carry either NULL or the India country row (location_label
-- "Pune, India"), so city-first matching found nothing, or every Indian
-- group. The campaign's own location_id drives matching (and caption drafting);
-- the question's location is only the fallback.

alter table public.social_campaigns
  add column if not exists location_id uuid references public.locations(id);

-- New optional parameter: drop the 1-arg form so PostgREST has one candidate.
drop function if exists public.admin_match_social_groups(uuid);

create or replace function public.admin_match_social_groups(p_question_id uuid, p_location_id uuid default null)
returns table(
  group_id uuid, name text, url text, location_name text, lean text, link_policy text,
  membership_status text, language_codes text[], match_tier int,
  location_match boolean, topic_match boolean, language_match boolean,
  eligible boolean, excluded_reason text, reasons text[], last_verified_at timestamptz)
language plpgsql stable security definer set search_path to '' as $$
#variable_conflict use_column
declare
  v_loc uuid; v_parent uuid; v_loc_name text; v_topic uuid; v_langs text[];
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select coalesce(p_location_id, q.location_id), q.topic_id into v_loc, v_topic
    from public.questions q where q.id = p_question_id;
  select l.parent_id, l.name into v_parent, v_loc_name from public.locations l where l.id = v_loc;
  select coalesce(array_agg(distinct r.language_code), '{}') into v_langs
    from public.question_renditions r
   where r.question_id = p_question_id and r.lifecycle_status = 'published';

  return query
  with recursive below as (
    select l.id from public.locations l where l.id = v_loc
    union
    select c.id from public.locations c join below b on c.parent_id = b.id
  ),
  scored as (
    select g.*, gl.name as loc_name,
           (g.location_id in (select id from below)) as loc_exact,
           (g.location_id = v_parent
             or (v_loc_name is not null and lower(gl.name) = lower(v_loc_name) and g.location_id <> v_loc)) as loc_near,
           (v_topic is not null and v_topic = any(g.topic_ids)) as t_match,
           (g.language_codes && v_langs) as l_match
    from public.social_group_directory g
    join public.locations gl on gl.id = g.location_id
  )
  select s.id, s.name, s.url, s.loc_name, s.lean, s.link_policy, s.membership_status, s.language_codes,
         case when s.loc_exact and s.t_match then 1 when s.loc_exact then 2 else 3 end,
         (s.loc_exact or s.loc_near), s.t_match, s.l_match,
         x.reason is null,
         x.reason,
         array_remove(array[
           case when s.loc_exact then 'in ' || s.loc_name
                when s.loc_near then 'near: ' || s.loc_name end,
           case when s.t_match then 'same topic' end,
           case when s.l_match then 'language: ' || array_to_string(public.social_text_array_intersect(s.language_codes, v_langs), ', ')
                else 'no published rendition in the group''s languages' end,
           case when s.lean <> 'general' then 'lean: ' || s.lean end,
           case when s.last_verified_at is null or s.last_verified_at < now() - interval '30 days'
                then 'verification stale' end
         ], null),
         s.last_verified_at
  from scored s
  cross join lateral (select case
      when not s.enabled then 'disabled'
      when s.membership_status <> 'member' then 'membership ' || s.membership_status
      when not s.rules_reviewed then 'rules not reviewed'
      when s.link_policy = 'unknown' then 'link policy unknown'
      when s.lean = 'partisan' then 'partisan (override required)'
    end as reason) x
  where v_loc is not null and (s.loc_exact or s.loc_near)
  order by 9, (x.reason is not null), case s.lean when 'general' then 0 when 'interest' then 1 else 2 end, s.name;
end $$;
revoke all on function public.admin_match_social_groups(uuid, uuid) from public, anon;
grant execute on function public.admin_match_social_groups(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
