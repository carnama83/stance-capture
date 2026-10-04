-- Facebook Campaign Manager, Phase 1: admin RPCs.
--
--   admin_match_social_groups(question)        city-first group suggestions with reasons
--   admin_plan_social_campaign(campaign, ...)  schedule preview (p_commit=false) and
--                                              activation / replan (p_commit=true)
--   admin_social_job_action(job, action, ...)  posting-queue transitions
--   admin_set_social_campaign_status(...)      pause / resume / cancel
--   admin_set_caption_neutrality(...)          records who checked a caption and when
--   admin_social_campaign_impact(...)          with/without campaign traffic aggregate
--
-- All SECURITY DEFINER, guarded by public.is_admin(auth.uid()) (errcode 42501).
-- Planning lives in SQL so the preview is exactly what activation writes, and
-- identity caps / the 24h caption rule are checked against every live campaign.

-- ── internal: get (or mint) the tracked link for one destination ────────────
create or replace function public.social_campaign_link_for(
  p_campaign_id uuid, p_kind text, p_group_id uuid, p_lang text, p_question_id uuid, p_create boolean)
returns public.social_campaign_links
language plpgsql volatile security definer set search_path to '' as $$
declare v public.social_campaign_links;
begin
  select * into v from public.social_campaign_links
   where social_campaign_id = p_campaign_id
     and destination_kind = p_kind
     and group_id is not distinct from p_group_id
     and language_code = p_lang;
  if found or not p_create then
    return v;
  end if;
  insert into public.social_campaign_links (code, social_campaign_id, destination_kind, group_id, question_id, language_code)
  values (public.social_new_link_code(), p_campaign_id, p_kind, p_group_id, p_question_id, p_lang)
  on conflict do nothing
  returning * into v;
  if v.id is null then
    select * into v from public.social_campaign_links
     where social_campaign_id = p_campaign_id
       and destination_kind = p_kind
       and group_id is not distinct from p_group_id
       and language_code = p_lang;
  end if;
  return v;
end $$;
revoke all on function public.social_campaign_link_for(uuid, text, uuid, text, uuid, boolean) from public, anon, authenticated;

create or replace function public.social_text_array_intersect(a text[], b text[])
returns text[] language sql immutable set search_path to '' as $$
  select coalesce(array_agg(x order by x), '{}') from unnest(a) x where x = any(b)
$$;

-- ── matching ────────────────────────────────────────────────────────────────
-- Tier 1: group is in the question's location (or below it) AND shares its topic.
-- Tier 2: location match only.
-- Tier 3: group sits one level up, or at a same-named location (Pune exists as
--         both a city and a county).
create or replace function public.admin_match_social_groups(p_question_id uuid)
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

  select q.location_id, q.topic_id into v_loc, v_topic from public.questions q where q.id = p_question_id;
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
  where s.loc_exact or s.loc_near
  order by 9, (x.reason is not null), case s.lean when 'general' then 0 when 'interest' then 1 else 2 end, s.name;
end $$;
revoke all on function public.admin_match_social_groups(uuid) from public, anon;
grant execute on function public.admin_match_social_groups(uuid) to authenticated;


-- ── planner ─────────────────────────────────────────────────────────────────
create or replace function public.admin_plan_social_campaign(
  p_campaign_id uuid,
  p_commit boolean default false,
  p_site_origin text default 'https://www.stancecapture.com',
  p_acknowledge_balance boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path to '' as $$
declare
  c public.social_campaigns;
  v_origin text := rtrim(coalesce(nullif(btrim(p_site_origin), ''), 'https://www.stancecapture.com'), '/');
  v_now timestamptz := now();
  v_cutoff timestamptz := now() + interval '10 minutes';
  v_ver int;
  v_nslots int;
  v_nlang int;
  v_windows int := 0;
  v_upcoming int := 0;
  v_warn jsonb := '[]'::jsonb;
  v_block boolean := false;
  v_page_i int := 0;
  v_need int;
  v_kept int;
  v_found boolean;
  v_unplaced int := 0;
  v_try int;
  v_t timestamptz;
  v_ident uuid;
  v_lang text;
  v_rend uuid;
  v_link public.social_campaign_links;
  v_url text;
  v_mode text;
  v_snap text;
  v_n_groups int := 0;
  v_n_skew int := 0;
  v_skew jsonb;
  v_jobs jsonb;
  v_counts jsonb;
  d int; si int; k int;
  g record; cell record; v record;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if v_origin !~ '^https://[a-z0-9.-]+$' and v_origin !~ '^http://localhost(:[0-9]+)?$' then
    raise exception 'INVALID_SITE_ORIGIN: %', v_origin using errcode = '22023';
  end if;
  if p_commit then
    perform pg_advisory_xact_lock(hashtext('social_campaign_planner'));
  end if;

  select * into c from public.social_campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  if c.status in ('cancelled', 'completed') then
    raise exception 'CAMPAIGN_CLOSED: campaign is %', c.status using errcode = '22023';
  end if;
  begin
    perform v_now at time zone c.timezone;
  exception when others then
    raise exception 'INVALID_TIMEZONE: %', c.timezone using errcode = '22023';
  end;

  v_ver := c.plan_version + 1;
  v_nslots := cardinality(c.daily_slots);
  v_nlang := cardinality(c.language_codes);

  create temp table if not exists _sc_cells (
    idx int primary key, ts timestamptz, day int, upcoming boolean, gload int not null default 0
  ) on commit drop;
  create temp table if not exists _sc_rend (lang text primary key, rendition_id uuid) on commit drop;
  create temp table if not exists _sc_busy (
    identity_id uuid, ts timestamptz, body_hash text, group_id uuid, own boolean
  ) on commit drop;
  create temp table if not exists _sc_plan (
    seq serial, destination_kind text, group_id uuid, identity_id uuid, language_code text,
    rendition_id uuid, caption_variant_id uuid, caption_body_hash text, caption_snapshot text,
    link_mode text, link_url text, link_id uuid, slot_index int, scheduled_at timestamptz
  ) on commit drop;
  -- `where true`: PostgREST sessions load pg-safeupdate, which rejects a bare DELETE.
  delete from _sc_cells where true; delete from _sc_rend where true;
  delete from _sc_busy where true; delete from _sc_plan where true;

  -- Windows (PDD §9): days x slots. Elapsed windows are never backfilled.
  for d in 0 .. c.duration_days - 1 loop
    for si in 1 .. v_nslots loop
      v_t := ((c.start_date + d) + c.daily_slots[si]) at time zone c.timezone;
      insert into _sc_cells (idx, ts, day, upcoming)
      values (d * v_nslots + si - 1, v_t, d, v_t >= v_cutoff);
      v_windows := v_windows + 1;
      if v_t >= v_cutoff then v_upcoming := v_upcoming + 1; end if;
    end loop;
  end loop;

  -- One published rendition per campaign language (exact wording, PDD §12).
  foreach v_lang in array c.language_codes loop
    select r.id into v_rend from public.question_renditions r
     where r.question_id = c.question_id and r.language_code = v_lang and r.lifecycle_status = 'published'
     order by r.published_at desc nulls last limit 1;
    if v_rend is null then
      v_warn := v_warn || jsonb_build_object('code', 'no_rendition', 'lang', v_lang, 'blocking', true,
        'message', format('No published %s rendition of this question.', v_lang));
      v_block := true;
    else
      insert into _sc_rend values (v_lang, v_rend);
    end if;
    v_rend := null;
  end loop;

  -- AC11: every caption variant carries a recorded neutrality check.
  if exists (select 1 from public.social_campaign_caption_variants
              where campaign_id = c.id and status <> 'retired' and neutrality_checked_at is null) then
    v_warn := v_warn || jsonb_build_object('code', 'neutrality_unchecked', 'blocking', true,
      'message', 'Every caption variant needs a recorded neutrality check (or retire it).');
    v_block := true;
  end if;

  -- Busy times from every other live campaign plus this campaign's kept jobs.
  -- Kept = anything a replan does not replace (claimed, posted, due now, ...).
  insert into _sc_busy (identity_id, ts, body_hash, group_id, own)
  select j.identity_id, j.scheduled_at, j.caption_body_hash, j.group_id, j.campaign_id = c.id
  from public.social_campaign_jobs j
  where j.destination_kind = 'group'
    and j.status not in ('cancelled', 'skipped', 'missed')
    and not (j.campaign_id = c.id and j.status = 'scheduled' and j.scheduled_at >= v_cutoff);

  -- ── Page jobs: own frequency (default 1/day), languages rotate ──
  if c.include_page and c.page_posts_per_day > 0 then
    for d in 0 .. c.duration_days - 1 loop
      select count(*) into v_kept from public.social_campaign_jobs j
       where j.campaign_id = c.id and j.destination_kind = 'page'
         and j.slot_index / v_nslots = d
         and j.status not in ('cancelled')
         and not (j.status = 'scheduled' and j.scheduled_at >= v_cutoff);
      v_need := c.page_posts_per_day - v_kept;
      for cell in select * from _sc_cells x
                   where x.day = d and x.upcoming
                     and not exists (select 1 from public.social_campaign_jobs j
                                      where j.campaign_id = c.id and j.destination_kind = 'page'
                                        and j.slot_index = x.idx and j.status not in ('cancelled')
                                        and not (j.status = 'scheduled' and j.scheduled_at >= v_cutoff))
                   order by x.idx loop
        exit when v_need <= 0;
        v_lang := c.language_codes[(v_page_i % v_nlang) + 1];
        v_page_i := v_page_i + 1;
        select rendition_id into v_rend from _sc_rend where lang = v_lang;
        continue when v_rend is null;
        select cv.id, cv.body, cv.body_hash into v
          from public.social_campaign_caption_variants cv
         where cv.campaign_id = c.id and cv.status = 'approved' and cv.language_code = v_lang
         order by (select count(*) from _sc_plan p where p.caption_variant_id = cv.id), cv.label
         limit 1;
        if v.id is null then
          if not v_warn @> jsonb_build_array(jsonb_build_object('code', 'no_approved_variant', 'lang', v_lang)) then
            v_warn := v_warn || jsonb_build_object('code', 'no_approved_variant', 'lang', v_lang, 'blocking', true,
              'message', format('No approved %s caption variant.', v_lang));
          end if;
          v_block := true;
          v_need := v_need - 1;
          continue;
        end if;
        v_link := public.social_campaign_link_for(c.id, 'page', null, v_lang, c.question_id, p_commit);
        v_url := v_origin || '/c/' || coalesce(v_link.code, '__________');
        insert into _sc_plan (destination_kind, group_id, identity_id, language_code, rendition_id,
                              caption_variant_id, caption_body_hash, caption_snapshot, link_mode, link_url,
                              link_id, slot_index, scheduled_at)
        values ('page', null, c.page_identity_id, v_lang, v_rend, v.id, v.body_hash,
                v.body || E'\n\n' || v_url, 'inline', v_url, v_link.id, cell.idx, cell.ts);
        v_need := v_need - 1;
        v := null;
      end loop;
    end loop;
  end if;

  -- ── Group jobs ──
  for g in
    select sg.*, cg.match_tier,
           case
             when not sg.enabled then 'disabled'
             when sg.membership_status <> 'member' then 'membership ' || sg.membership_status
             when not sg.rules_reviewed then 'rules not reviewed'
             when sg.link_policy = 'unknown' then 'link policy unknown'
             when sg.lean = 'partisan' and coalesce(btrim(cg.partisan_override_reason), '') = '' then 'partisan without override'
           end as bad,
           row_number() over (partition by sg.lean order by cg.match_tier nulls last, sg.name) as rk
    from public.social_campaign_groups cg
    join public.social_group_directory sg on sg.id = cg.group_id
    where cg.campaign_id = c.id
    order by rk, case sg.lean when 'general' then 0 when 'interest' then 1 else 2 end, sg.name
  loop
    if g.bad is not null then
      v_warn := v_warn || jsonb_build_object('code', 'group_ineligible', 'group_id', g.id, 'blocking', false,
        'message', format('%s is excluded: %s.', g.name, g.bad));
      continue;
    end if;

    v_n_groups := v_n_groups + 1;
    if g.lean in ('interest', 'partisan') then v_n_skew := v_n_skew + 1; end if;
    if g.last_verified_at is null or g.last_verified_at < v_now - interval '30 days' then
      v_warn := v_warn || jsonb_build_object('code', 'stale_verification', 'group_id', g.id, 'blocking', false,
        'message', format('%s was last verified %s.', g.name, coalesce(to_char(g.last_verified_at, 'DD Mon YYYY'), 'never')));
    end if;

    select x into v_lang from unnest(c.language_codes) with ordinality as t(x, o)
     where x = any(g.language_codes) order by o limit 1;
    if v_lang is null then
      v_lang := c.language_codes[1];
      v_warn := v_warn || jsonb_build_object('code', 'group_language_mismatch', 'group_id', g.id, 'blocking', false,
        'message', format('%s lists none of the campaign languages; using %s.', g.name, v_lang));
    end if;
    select rendition_id into v_rend from _sc_rend where lang = v_lang;
    if v_rend is null then
      continue;   -- already a blocking no_rendition warning
    end if;

    v_mode := case g.link_policy when 'link_in_comment' then 'comment' when 'no_links' then 'none' else 'inline' end;
    if v_mode = 'none' then
      v_warn := v_warn || jsonb_build_object('code', 'link_policy_no_links', 'group_id', g.id, 'blocking', false,
        'message', format('%s does not allow links: text-only invitation, untracked. Confirm that is permitted.', g.name));
    end if;

    select count(*) into v_kept from _sc_busy b where b.own and b.group_id = g.id;
    v_need := least(c.group_posts_per_group, g.posting_cap_per_campaign) - v_kept;

    for k in 1 .. greatest(v_need, 0) loop
      v_found := false;
      for cell in select * from _sc_cells x
                   where x.upcoming
                     -- a group never gets two tasks within 24h
                     and not exists (select 1 from _sc_busy b where b.group_id = g.id
                                      and abs(extract(epoch from b.ts - x.ts)) < 86400)
                   -- spread across the week: emptiest window, then emptiest day
                   order by x.gload,
                            (select coalesce(sum(y.gload), 0) from _sc_cells y where y.day = x.day),
                            x.idx loop
        for v_try in 0 .. 2 loop
          v_t := cell.ts + make_interval(mins => 30 * v_try);
          v_ident := null;
          select i.id into v_ident
            from public.social_posting_identities i
           where i.active and i.restricted_at is null
             and ((cardinality(g.allowed_identity_ids) = 0 and i.kind = 'profile') or i.id = any(g.allowed_identity_ids))
             and (select count(*) from _sc_busy b where b.identity_id = i.id
                   and (b.ts at time zone c.timezone)::date = (v_t at time zone c.timezone)::date) < i.daily_group_post_cap
             and not exists (select 1 from _sc_busy b where b.identity_id = i.id
                              and abs(extract(epoch from b.ts - v_t)) < i.min_gap_minutes * 60)
           order by (select count(*) from _sc_busy b where b.identity_id = i.id
                      and (b.ts at time zone c.timezone)::date = (v_t at time zone c.timezone)::date), i.label
           limit 1;
          continue when v_ident is null;

          v := null;
          select cv.id, cv.body, cv.body_hash into v
            from public.social_campaign_caption_variants cv
           where cv.campaign_id = c.id and cv.status = 'approved' and cv.language_code = v_lang
             and not exists (select 1 from _sc_busy b where b.body_hash = cv.body_hash
                              and abs(extract(epoch from b.ts - v_t)) < 86400)
           order by (select count(*) from _sc_plan p where p.caption_variant_id = cv.id), cv.label
           limit 1;
          continue when v.id is null;

          v_link := public.social_campaign_link_for(c.id, 'group', g.id, v_lang, c.question_id, p_commit);
          v_url := v_origin || '/c/' || coalesce(v_link.code, '__________');
          v_snap := case v_mode when 'inline' then v.body || E'\n\n' || v_url else v.body end;
          insert into _sc_plan (destination_kind, group_id, identity_id, language_code, rendition_id,
                                caption_variant_id, caption_body_hash, caption_snapshot, link_mode, link_url,
                                link_id, slot_index, scheduled_at)
          values ('group', g.id, v_ident, v_lang, v_rend, v.id, v.body_hash, v_snap, v_mode,
                  case when v_mode = 'none' then null else v_url end, v_link.id, cell.idx, v_t);
          insert into _sc_busy values (v_ident, v_t, v.body_hash, g.id, true);
          update _sc_cells set gload = gload + 1 where idx = cell.idx;
          v_found := true;
          exit;
        end loop;
        exit when v_found;
      end loop;
      if not v_found then
        v_unplaced := v_unplaced + 1;
        v_warn := v_warn || jsonb_build_object('code', 'unplaced_job', 'group_id', g.id, 'blocking', false,
          'message', format('Could not place post %s of %s for %s within identity limits, the 24h caption rule, or the remaining windows.', k, v_need, g.name));
      end if;
    end loop;
    v_rend := null; v_lang := null;
  end loop;

  if exists (select 1 from public.social_campaign_groups where campaign_id = c.id)
     and not exists (select 1 from public.social_posting_identities where active and restricted_at is null) then
    v_warn := v_warn || jsonb_build_object('code', 'no_posting_identity', 'blocking', true,
      'message', 'Add an active, unrestricted posting identity before scheduling group tasks.');
    v_block := true;
  end if;

  -- Balance warning (PDD §4).
  if v_n_groups > 0 and v_n_skew::numeric / v_n_groups > 0.5 then
    v_skew := jsonb_build_object('groups', v_n_groups, 'interest_or_partisan', v_n_skew,
                                 'share', round(v_n_skew::numeric / v_n_groups, 2));
    if c.balance_acknowledged_at is null and not p_acknowledge_balance then
      v_warn := v_warn || jsonb_build_object('code', 'balance_skew', 'blocking', true, 'detail', v_skew,
        'message', format('%s of %s selected groups are interest-specific or partisan. Acknowledge before activating.', v_n_skew, v_n_groups));
      v_block := true;
    else
      v_warn := v_warn || jsonb_build_object('code', 'balance_skew', 'blocking', false, 'detail', v_skew,
        'message', format('%s of %s selected groups are interest-specific or partisan (acknowledged).', v_n_skew, v_n_groups));
    end if;
  end if;

  if not exists (select 1 from _sc_plan) and c.status = 'draft' then
    v_warn := v_warn || jsonb_build_object('code', 'no_jobs', 'blocking', true,
      'message', 'Nothing to schedule: no upcoming windows, no Page posts and no eligible groups.');
    v_block := true;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'destination_kind', p.destination_kind, 'group_id', p.group_id, 'group_name', sg.name,
           'identity_id', p.identity_id, 'identity_label', i.label, 'language_code', p.language_code,
           'slot_index', p.slot_index, 'scheduled_at', p.scheduled_at,
           'local_time', to_char(p.scheduled_at at time zone c.timezone, 'Dy DD Mon HH24:MI'),
           'variant_label', cv.label, 'link_mode', p.link_mode, 'caption_snapshot', p.caption_snapshot)
         order by p.scheduled_at, p.destination_kind desc, sg.name), '[]'::jsonb)
    into v_jobs
    from _sc_plan p
    left join public.social_group_directory sg on sg.id = p.group_id
    left join public.social_posting_identities i on i.id = p.identity_id
    left join public.social_campaign_caption_variants cv on cv.id = p.caption_variant_id;

  v_counts := jsonb_build_object(
    'windows_total', v_windows,
    'windows_upcoming', v_upcoming,
    'page_posts', (select count(*) from _sc_plan where destination_kind = 'page'),
    'group_tasks', (select count(*) from _sc_plan where destination_kind = 'group'),
    'unplaced', v_unplaced,
    'kept_jobs', (select count(*) from public.social_campaign_jobs j
                   where j.campaign_id = c.id and j.status not in ('cancelled')
                     and not (j.status = 'scheduled' and j.scheduled_at >= v_cutoff)));

  if p_commit and not v_block then
    update public.social_campaign_jobs
       set status = 'cancelled', skip_reason = 'replanned as v' || v_ver
     where campaign_id = c.id and status = 'scheduled' and scheduled_at >= v_cutoff;

    insert into public.social_campaign_jobs (campaign_id, plan_version, destination_kind, group_id, identity_id,
      language_code, rendition_id, caption_variant_id, caption_body_hash, caption_snapshot, link_mode, link_url,
      link_id, slot_index, scheduled_at)
    select c.id, v_ver, destination_kind, group_id, identity_id, language_code, rendition_id, caption_variant_id,
           caption_body_hash, caption_snapshot, link_mode, link_url, link_id, slot_index, scheduled_at
      from _sc_plan;

    -- AC13 backstop: no two live group tasks within 24h share caption text.
    if exists (
      select 1 from public.social_campaign_jobs a
      join public.social_campaign_jobs b
        on a.caption_body_hash = b.caption_body_hash and a.id < b.id
       and abs(extract(epoch from a.scheduled_at - b.scheduled_at)) < 86400
     where a.destination_kind = 'group' and b.destination_kind = 'group'
       and a.status not in ('cancelled','skipped','missed') and b.status not in ('cancelled','skipped','missed')
       and (a.campaign_id = c.id or b.campaign_id = c.id)) then
      raise exception 'DUPLICATE_CAPTION_24H: two group tasks within 24h would share caption text' using errcode = '23514';
    end if;

    update public.social_campaigns
       set plan_version = v_ver,
           status = case when status = 'draft' then 'active' else status end,
           activated_at = coalesce(activated_at, case when status = 'draft' then v_now end),
           activated_by = coalesce(activated_by, case when status = 'draft' then auth.uid() end),
           balance_warning = v_skew,
           balance_acknowledged_at = case when p_acknowledge_balance and balance_acknowledged_at is null then v_now
                                          else balance_acknowledged_at end,
           balance_acknowledged_by = case when p_acknowledge_balance and balance_acknowledged_at is null then auth.uid()
                                          else balance_acknowledged_by end
     where id = c.id;
  end if;

  return jsonb_build_object(
    'campaign_id', c.id,
    'committed', p_commit and not v_block,
    'blocking', v_block,
    'plan_version', case when p_commit and not v_block then v_ver else c.plan_version end,
    'timezone', c.timezone,
    'counts', v_counts,
    'warnings', v_warn,
    'jobs', v_jobs);
end $$;
revoke all on function public.admin_plan_social_campaign(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.admin_plan_social_campaign(uuid, boolean, text, boolean) to authenticated;

-- ── posting queue ───────────────────────────────────────────────────────────
-- Copying content or opening a group never changes status (AC07); only these do.
create or replace function public.admin_social_job_action(
  p_job_id uuid, p_action text, p_url text default null, p_note text default null)
returns public.social_campaign_jobs
language plpgsql volatile security definer set search_path to '' as $$
declare
  j public.social_campaign_jobs;
  c public.social_campaigns;
  i public.social_posting_identities;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into j from public.social_campaign_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found' using errcode = 'P0002'; end if;
  select * into c from public.social_campaigns where id = j.campaign_id;
  select * into i from public.social_posting_identities where id = j.identity_id;

  if p_action = 'claim' then
    if j.status <> 'scheduled' then
      raise exception 'JOB_NOT_CLAIMABLE: job is %', j.status using errcode = '22023';
    end if;
    if c.status <> 'active' then
      raise exception 'CAMPAIGN_NOT_ACTIVE: campaign is %', c.status using errcode = '22023';
    end if;
    if j.destination_kind = 'group' and i.restricted_at is not null then
      raise exception 'IDENTITY_RESTRICTED: % has a recorded Facebook restriction', i.label using errcode = '22023';
    end if;
    update public.social_campaign_jobs set status = 'claimed', claimed_by = auth.uid(), claimed_at = now()
     where id = j.id returning * into j;

  elsif p_action = 'release' then
    if j.status <> 'claimed' then
      raise exception 'JOB_NOT_CLAIMED' using errcode = '22023';
    end if;
    update public.social_campaign_jobs set status = 'scheduled', claimed_by = null, claimed_at = null
     where id = j.id returning * into j;

  elsif p_action = 'submitted' then
    -- Posted into a group that holds posts for admin approval. Counts against
    -- limits; no replacement task is issued while it is pending (PDD §10).
    if j.status not in ('scheduled', 'claimed', 'missed') then
      raise exception 'JOB_NOT_OPEN: job is %', j.status using errcode = '22023';
    end if;
    update public.social_campaign_jobs set status = 'submitted', posted_at = now(),
           claimed_by = coalesce(claimed_by, auth.uid()), skip_reason = p_note
     where id = j.id returning * into j;

  elsif p_action = 'posted' then
    if j.status not in ('scheduled', 'claimed', 'submitted', 'missed') then
      raise exception 'JOB_NOT_OPEN: job is %', j.status using errcode = '22023';
    end if;
    if p_url is null or p_url !~* '^https://([a-z0-9-]+\.)?(facebook\.com|fb\.com|business\.facebook\.com)/' then
      raise exception 'POST_URL_REQUIRED: record the Facebook post URL' using errcode = '22023';
    end if;
    update public.social_campaign_jobs set status = 'posted', posted_url = p_url, posted_at = coalesce(posted_at, now()),
           claimed_by = coalesce(claimed_by, auth.uid()), skip_reason = p_note
     where id = j.id returning * into j;

  elsif p_action = 'rejected' then
    -- Group admins declined a submitted post.
    if j.status <> 'submitted' then
      raise exception 'JOB_NOT_SUBMITTED' using errcode = '22023';
    end if;
    update public.social_campaign_jobs set status = 'skipped', skip_reason = coalesce(p_note, 'rejected by group admins')
     where id = j.id returning * into j;

  elsif p_action = 'skip' then
    if j.status not in ('scheduled', 'claimed', 'missed') then
      raise exception 'JOB_NOT_OPEN: job is %', j.status using errcode = '22023';
    end if;
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'SKIP_REASON_REQUIRED' using errcode = '22023';
    end if;
    update public.social_campaign_jobs set status = 'skipped', skip_reason = p_note
     where id = j.id returning * into j;

  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;

  return j;
end $$;
revoke all on function public.admin_social_job_action(uuid, text, text, text) from public, anon;
grant execute on function public.admin_social_job_action(uuid, text, text, text) to authenticated;

-- ── campaign lifecycle ──────────────────────────────────────────────────────
create or replace function public.admin_set_social_campaign_status(
  p_campaign_id uuid, p_action text, p_reason text default null)
returns public.social_campaigns
language plpgsql volatile security definer set search_path to '' as $$
declare c public.social_campaigns;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into c from public.social_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campaign not found' using errcode = 'P0002'; end if;

  if p_action = 'pause' then
    if c.status <> 'active' then raise exception 'CAMPAIGN_NOT_ACTIVE' using errcode = '22023'; end if;
    update public.social_campaigns set status = 'paused', paused_at = now() where id = c.id returning * into c;

  elsif p_action = 'resume' then
    if c.status <> 'paused' then raise exception 'CAMPAIGN_NOT_PAUSED' using errcode = '22023'; end if;
    -- No burst of missed posts on resume (PDD §10): overdue tasks are skipped.
    update public.social_campaign_jobs
       set status = 'skipped', skip_reason = 'overdue while paused'
     where campaign_id = c.id and status in ('scheduled', 'claimed')
       and scheduled_at < now() - interval '60 minutes';
    update public.social_campaigns set status = 'active', paused_at = null where id = c.id returning * into c;

  elsif p_action = 'cancel' then
    if c.status in ('cancelled', 'completed') then raise exception 'CAMPAIGN_CLOSED' using errcode = '22023'; end if;
    update public.social_campaign_jobs
       set status = 'cancelled', skip_reason = coalesce(p_reason, 'campaign cancelled')
     where campaign_id = c.id and status in ('scheduled', 'claimed');
    update public.social_campaigns set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
     where id = c.id returning * into c;

  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  return c;
end $$;
revoke all on function public.admin_set_social_campaign_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_social_campaign_status(uuid, text, text) to authenticated;

-- ── caption neutrality ──────────────────────────────────────────────────────
create or replace function public.admin_set_caption_neutrality(
  p_variant_id uuid, p_result text, p_notes text default null)
returns public.social_campaign_caption_variants
language plpgsql volatile security definer set search_path to '' as $$
declare v public.social_campaign_caption_variants;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_result not in ('pass', 'fail') then
    raise exception 'result must be pass or fail' using errcode = '22023';
  end if;
  update public.social_campaign_caption_variants
     set neutrality_result = p_result,
         neutrality_notes = p_notes,
         neutrality_checked_by = auth.uid(),
         neutrality_checked_at = now(),
         status = case when p_result = 'pass' then 'approved' else 'draft' end
   where id = p_variant_id and status <> 'retired'
  returning * into v;
  if v.id is null then raise exception 'variant not found or retired' using errcode = 'P0002'; end if;
  return v;
end $$;
revoke all on function public.admin_set_caption_neutrality(uuid, text, text) from public, anon;
grant execute on function public.admin_set_caption_neutrality(uuid, text, text) to authenticated;

-- ── results: with and without campaign traffic ──────────────────────────────
-- Same response set as get_question_report / community stats (committed stances
-- + uncommitted anonymous pending rows, flagged and non-counting renditions
-- excluded). Descriptive only: a difference describes who answered through each
-- route; it does not show the campaign caused a shift.
create or replace function public.admin_social_campaign_impact(
  p_social_campaign_id uuid default null, p_paid_campaign_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_qid uuid;
  v_rows jsonb;
  v_segments jsonb;
  v_dest jsonb;
  v_tasks jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if num_nonnulls(p_social_campaign_id, p_paid_campaign_id) <> 1 then
    raise exception 'pass exactly one campaign id' using errcode = '22023';
  end if;
  if p_social_campaign_id is not null then
    select question_id into v_qid from public.social_campaigns where id = p_social_campaign_id;
  else
    select question_id into v_qid from public.campaigns where id = p_paid_campaign_id;
  end if;
  if v_qid is null then raise exception 'campaign not found' using errcode = 'P0002'; end if;

  with verified as (
    select qs.score::int as s, qs.campaign_visit_id as cv,
           (qs.updated_at > qs.created_at + interval '1 second') as upd
    from public.question_stances qs
    where qs.question_id = v_qid
      and coalesce(qs.is_flagged, false) = false
      and public.stance_counts_toward_aggregate(qs.rendition_id)
  ),
  anonymous as (
    select p.score::int, p.campaign_visit_id,
           (p.updated_at > p.created_at + interval '1 second')
    from public.question_stances_pending p
    left join public.whatsapp_forward_chains w on w.id = p.forward_chain_id
    where p.question_id = v_qid
      and coalesce(p.committed, false) = false
      and public.stance_counts_toward_aggregate(p.rendition_id)
      and not exists (
        select 1 from public.question_stances qs
        where qs.question_id = v_qid
          and w.responder_user_id is not null
          and qs.user_id = w.responder_user_id)
  ),
  allrows as (select * from verified union all select * from anonymous),
  tagged as (
    select a.s, a.upd, a.cv is not null as any_c,
           coalesce(l.social_campaign_id = p_social_campaign_id or l.paid_campaign_id = p_paid_campaign_id, false) as this_c
    from allrows a
    left join public.social_campaign_visits v on v.id = a.cv
    left join public.social_campaign_links l on l.id = v.link_id
  ),
  seg as (
    select 'all' as k, 1 as o, * from tagged
    union all select 'this_campaign', 2, * from tagged where this_c
    union all select 'without_this_campaign', 3, * from tagged where not this_c
    union all select 'any_campaign', 4, * from tagged where any_c
    union all select 'without_any_campaign', 5, * from tagged where not any_c
  ),
  names(k, o) as (
    values ('all', 1), ('this_campaign', 2), ('without_this_campaign', 3),
           ('any_campaign', 4), ('without_any_campaign', 5)
  ),
  agg as (
    -- every segment is returned, empty ones with n = 0
    select nm.k, nm.o, count(sg.s)::int as n,
           count(sg.s) filter (where sg.upd)::int as later_updates,
           round(100.0 * count(sg.s) filter (where sg.s > 0) / nullif(count(sg.s), 0), 1) as support_pct,
           round(100.0 * count(sg.s) filter (where sg.s = 0) / nullif(count(sg.s), 0), 1) as neutral_pct,
           round(100.0 * count(sg.s) filter (where sg.s < 0) / nullif(count(sg.s), 0), 1) as oppose_pct,
           round(avg(sg.s)::numeric, 2) as mean
    from names nm left join seg sg on sg.k = nm.k
    group by nm.k, nm.o
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'segment', k, 'n', n, 'later_updates', later_updates, 'support_pct', support_pct,
           'neutral_pct', neutral_pct, 'oppose_pct', oppose_pct, 'mean', mean,
           'too_few_to_compare', n < 30) order by o), '[]'::jsonb)
    into v_segments from agg;

  -- Per destination: visits, attributed first stances (committed + pending), conversion.
  select coalesce(jsonb_agg(x order by x->>'destination_kind' desc, x->>'group_name'), '[]'::jsonb) into v_dest
  from (
    select jsonb_build_object(
             'link_id', l.id, 'code', l.code, 'destination_kind', l.destination_kind,
             'group_id', l.group_id, 'group_name', g.name, 'group_lean', g.lean, 'language_code', l.language_code,
             'visits', (select count(*) from public.social_campaign_visits v where v.link_id = l.id),
             'first_stances', (select count(*) from public.social_campaign_attribution a where a.link_id = l.id),
             'pending_first_stances', (select count(*) from public.social_campaign_attribution a
                                        where a.link_id = l.id and a.row_kind = 'pending')) as x
    from public.social_campaign_links l
    left join public.social_group_directory g on g.id = l.group_id
    where (p_social_campaign_id is not null and l.social_campaign_id = p_social_campaign_id)
       or (p_paid_campaign_id is not null and l.paid_campaign_id = p_paid_campaign_id)
  ) s;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_tasks
  from (select status, count(*) as n from public.social_campaign_jobs
         where p_social_campaign_id is not null and campaign_id = p_social_campaign_id
         group by status) t;

  return jsonb_build_object(
    'question_id', v_qid,
    'segments', v_segments,
    'destinations', v_dest,
    'tasks_by_status', v_tasks,
    'note', 'Descriptive only. Attributed respondents opened a campaign link in the same browser within 7 days before their first stance. Neither group is representative of the city, and a difference does not show the campaign caused a shift.');
end $$;
revoke all on function public.admin_social_campaign_impact(uuid, uuid) from public, anon;
grant execute on function public.admin_social_campaign_impact(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
