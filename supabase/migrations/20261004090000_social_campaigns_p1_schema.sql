-- Facebook Campaign Manager, Phase 1 (PDD v1.2): schema.
--
-- Manual distribution of a published city question to the Stance Capture Page
-- and reviewed city Facebook groups. Nothing here talks to Meta: group and Page
-- posts are made by a person; the system prepares content, schedules tasks and
-- measures what comes back through tracked /c/<code> links.
--
-- Attribution design (shared with Epic Y paid ads):
--   social_campaign_links   one opaque code per (campaign, destination, language),
--                           pointing at EITHER an organic social campaign OR a
--                           paid public.campaigns row.
--   social_campaign_visits  one row per browser landing; its id is the bearer
--                           token the browser keeps for 7 days.
--   question_stances.campaign_visit_id / question_stances_pending.campaign_visit_id
--                           set only in the INSERT of a user's FIRST stance on the
--                           question (see ..._p1_stance_paths.sql). Never an
--                           UPDATE afterwards: question_stances has 7 AFTER triggers.
--   social_campaign_attribution  a view over the two stance tables, not a table.
--
-- question_stances.source is deliberately NOT touched: reports group by it as
-- the channel (native / web_forward / ...). Campaign is a separate dimension.

-- ── posting identities ──────────────────────────────────────────────────────
-- A label for whoever posts (the Page, or a named person's profile). No
-- credentials are ever stored.
create table public.social_posting_identities (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  kind text not null check (kind in ('page','profile')),
  profile_url text,
  active boolean not null default true,
  daily_group_post_cap int not null default 5 check (daily_group_post_cap between 1 and 20),
  min_gap_minutes int not null default 30 check (min_gap_minutes between 0 and 720),
  -- PDD §5: a recorded Facebook warning pauses every group task for this identity.
  restricted_at timestamptz,
  restriction_note text,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── group directory ─────────────────────────────────────────────────────────
create table public.social_group_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null check (url ~* '^https://([a-z0-9-]+\.)?facebook\.com/groups/'),
  url_normalized text generated always as (
    lower(regexp_replace(regexp_replace(btrim(url), '^https?://(www\.|m\.|web\.)?', '', 'i'), '[?#].*$|/+$', '', 'g'))
  ) stored,
  location_id uuid not null references public.locations(id),
  language_codes text[] not null default '{en}',
  topic_ids uuid[] not null default '{}',
  lean text not null default 'general' check (lean in ('general','interest','partisan')),
  link_policy text not null default 'unknown'
    check (link_policy in ('allowed','link_in_comment','no_links','admin_approval','unknown')),
  membership_status text not null default 'not_joined'
    check (membership_status in ('not_joined','requested','member','left','banned')),
  requires_post_approval boolean not null default false,
  allowed_identity_ids uuid[] not null default '{}',   -- empty = any active profile identity
  rules_reviewed boolean not null default false,
  rules_notes text,
  posting_cap_per_campaign int not null default 1 check (posting_cap_per_campaign between 1 and 7),
  member_count_approx int,
  last_verified_at timestamptz,
  last_verified_by uuid references auth.users(id) on delete set null,
  enabled boolean not null default true,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_group_directory_url_uniq unique (url_normalized)
);
create index social_group_directory_location_idx on public.social_group_directory (location_id) where enabled;
create index social_group_directory_topics_idx on public.social_group_directory using gin (topic_ids);

-- ── campaigns ───────────────────────────────────────────────────────────────
create table public.social_campaigns (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete restrict,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','active','paused','completed','cancelled')),
  timezone text not null default 'Asia/Kolkata',
  start_date date not null,
  duration_days int not null default 7 check (duration_days between 1 and 30),
  daily_slots time[] not null default '{09:00,14:00,19:00}',
  language_codes text[] not null default '{en}',
  include_page boolean not null default true,
  page_identity_id uuid references public.social_posting_identities(id),
  page_posts_per_day int not null default 1 check (page_posts_per_day between 0 and 6),
  group_posts_per_group int not null default 1 check (group_posts_per_group between 1 and 7),
  plan_version int not null default 0,
  balance_warning jsonb,
  balance_acknowledged_at timestamptz,
  balance_acknowledged_by uuid references auth.users(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  activated_at timestamptz,
  activated_by uuid references auth.users(id) on delete set null,
  paused_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_campaigns_slots_count check (cardinality(daily_slots) between 1 and 6),
  constraint social_campaigns_langs_count check (cardinality(language_codes) between 1 and 5)
);
create index social_campaigns_question_idx on public.social_campaigns (question_id);
create index social_campaigns_live_idx on public.social_campaigns (status) where status in ('active','paused');

-- Groups chosen for a campaign (matching output + admin choice).
create table public.social_campaign_groups (
  campaign_id uuid not null references public.social_campaigns(id) on delete cascade,
  group_id uuid not null references public.social_group_directory(id) on delete restrict,
  match_tier smallint,
  partisan_override_reason text,
  overridden_by uuid references auth.users(id) on delete set null,
  overridden_at timestamptz,
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (campaign_id, group_id)
);

-- ── caption variants ────────────────────────────────────────────────────────
create table public.social_campaign_caption_variants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.social_campaigns(id) on delete cascade,
  language_code text not null,
  label text not null,
  purpose text not null default 'invitation'
    check (purpose in ('invitation','context','reminder','closing')),
  body text not null check (length(btrim(body)) between 10 and 2000),   -- WITHOUT the link
  body_hash text generated always as (md5(lower(regexp_replace(btrim(body), '\s+', ' ', 'g')))) stored,
  ai_draft text,
  ai_model text,
  ai_drafted_at timestamptz,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  neutrality_result text check (neutrality_result in ('pass','fail')),
  neutrality_notes text,
  neutrality_checked_by uuid references auth.users(id) on delete set null,
  neutrality_checked_at timestamptz,
  edited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, language_code, label),
  -- PDD §4 / AC11: an approved variant always carries a recorded neutrality pass.
  constraint social_caption_approved_needs_pass check (
    status <> 'approved'
    or (neutrality_result = 'pass' and neutrality_checked_at is not null and neutrality_checked_by is not null)
  )
);
create index social_caption_variants_campaign_idx on public.social_campaign_caption_variants (campaign_id, language_code);

-- ── links (shared with Epic Y paid ads) ─────────────────────────────────────
create table public.social_campaign_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]{8,12}$'),
  social_campaign_id uuid references public.social_campaigns(id) on delete cascade,
  paid_campaign_id uuid references public.campaigns(id) on delete cascade,
  destination_kind text not null check (destination_kind in ('page','group','paid_ad')),
  group_id uuid references public.social_group_directory(id) on delete restrict,
  question_id uuid not null references public.questions(id) on delete cascade,
  language_code text not null default 'en',
  created_at timestamptz not null default now(),
  constraint social_links_one_owner check (num_nonnulls(social_campaign_id, paid_campaign_id) = 1),
  constraint social_links_paid_kind check ((destination_kind = 'paid_ad') = (paid_campaign_id is not null)),
  constraint social_links_group_kind check ((destination_kind = 'group') = (group_id is not null))
);
create unique index social_links_organic_dest_uniq on public.social_campaign_links
  (social_campaign_id, destination_kind, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), language_code)
  where social_campaign_id is not null;
create unique index social_links_paid_uniq on public.social_campaign_links (paid_campaign_id, language_code)
  where paid_campaign_id is not null;

-- ── visits ──────────────────────────────────────────────────────────────────
-- Deliberately no IP, user agent or device id.
create table public.social_campaign_visits (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.social_campaign_links(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index social_campaign_visits_link_idx on public.social_campaign_visits (link_id, created_at);

-- ── jobs (posting tasks) ────────────────────────────────────────────────────
create table public.social_campaign_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.social_campaigns(id) on delete cascade,
  plan_version int not null,
  destination_kind text not null check (destination_kind in ('page','group')),
  group_id uuid references public.social_group_directory(id) on delete restrict,
  identity_id uuid references public.social_posting_identities(id) on delete restrict,
  language_code text not null,
  rendition_id uuid not null references public.question_renditions(id),
  caption_variant_id uuid references public.social_campaign_caption_variants(id) on delete set null,
  caption_body_hash text,
  caption_snapshot text not null,
  link_mode text not null default 'inline' check (link_mode in ('inline','comment','none')),
  link_url text,
  link_id uuid not null references public.social_campaign_links(id) on delete restrict,
  slot_index int not null,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','claimed','submitted','posted','skipped','missed','cancelled')),
  status_history jsonb not null default '[]'::jsonb,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  posted_at timestamptz,
  posted_url text check (posted_url is null or posted_url ~* '^https://([a-z0-9-]+\.)?(facebook\.com|fb\.com|business\.facebook\.com)/'),
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_jobs_group_kind check ((destination_kind = 'group') = (group_id is not null)),
  constraint social_jobs_posted_has_url check (status <> 'posted' or posted_url is not null)
);
-- One task per (campaign, destination, slot, plan version): duplicate prevention (PDD §13).
create unique index social_jobs_dest_slot_uniq on public.social_campaign_jobs
  (campaign_id, plan_version, destination_kind, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid), slot_index, language_code);
create index social_jobs_due_idx on public.social_campaign_jobs (status, scheduled_at) where status in ('scheduled','claimed');
create index social_jobs_identity_idx on public.social_campaign_jobs (identity_id, scheduled_at) where status not in ('cancelled','skipped');
create index social_jobs_campaign_idx on public.social_campaign_jobs (campaign_id, scheduled_at);
create index social_jobs_caption_idx on public.social_campaign_jobs (caption_body_hash, scheduled_at) where destination_kind = 'group';

-- ── attribution columns on the stance tables ────────────────────────────────
alter table public.question_stances
  add column if not exists campaign_visit_id uuid references public.social_campaign_visits(id) on delete set null;
alter table public.question_stances_pending
  add column if not exists campaign_visit_id uuid references public.social_campaign_visits(id) on delete set null,
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;
create index if not exists idx_qs_campaign_visit on public.question_stances (campaign_visit_id) where campaign_visit_id is not null;
create index if not exists idx_qsp_campaign_visit on public.question_stances_pending (campaign_visit_id) where campaign_visit_id is not null;

-- ── triggers ────────────────────────────────────────────────────────────────
create trigger social_posting_identities_set_updated before update on public.social_posting_identities
  for each row execute function public.set_updated_at();
create trigger social_group_directory_set_updated before update on public.social_group_directory
  for each row execute function public.set_updated_at();
create trigger social_campaigns_set_updated before update on public.social_campaigns
  for each row execute function public.set_updated_at();
create trigger social_caption_variants_set_updated before update on public.social_campaign_caption_variants
  for each row execute function public.set_updated_at();
create trigger social_campaign_jobs_set_updated before update on public.social_campaign_jobs
  for each row execute function public.set_updated_at();

-- Partisan groups need a recorded override reason (PDD §4).
create or replace function public.trg_social_campaign_group_partisan_check()
returns trigger language plpgsql set search_path to '' as $$
declare v_lean text;
begin
  select lean into v_lean from public.social_group_directory where id = new.group_id;
  if v_lean = 'partisan' and coalesce(btrim(new.partisan_override_reason), '') = '' then
    raise exception 'PARTISAN_OVERRIDE_REQUIRED: group % is partisan/advocacy; record an override reason', new.group_id
      using errcode = '23514';
  end if;
  if coalesce(btrim(new.partisan_override_reason), '') <> '' then
    new.overridden_by := coalesce(new.overridden_by, auth.uid());
    new.overridden_at := coalesce(new.overridden_at, now());
  end if;
  return new;
end $$;
create trigger social_campaign_groups_partisan_check before insert or update on public.social_campaign_groups
  for each row execute function public.trg_social_campaign_group_partisan_check();

-- Editing a caption invalidates its neutrality check.
create or replace function public.trg_social_caption_reset_neutrality()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.body is distinct from old.body then
    new.neutrality_result := null;
    new.neutrality_notes := null;
    new.neutrality_checked_by := null;
    new.neutrality_checked_at := null;
    if new.status = 'approved' then new.status := 'draft'; end if;
    new.edited_by := auth.uid();
  end if;
  return new;
end $$;
create trigger social_caption_reset_neutrality before update on public.social_campaign_caption_variants
  for each row execute function public.trg_social_caption_reset_neutrality();

-- Job status history (PDD §13: status history on the job row covers auditing).
create or replace function public.trg_social_job_status_history()
returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'INSERT' then
    new.status_history := jsonb_build_array(jsonb_build_object('to', new.status, 'at', now(), 'by', auth.uid()));
  elsif new.status is distinct from old.status then
    new.status_history := coalesce(old.status_history, '[]'::jsonb) || jsonb_build_object(
      'from', old.status, 'to', new.status, 'at', now(), 'by', auth.uid(), 'note', new.skip_reason);
  end if;
  return new;
end $$;
create trigger social_job_status_history before insert or update on public.social_campaign_jobs
  for each row execute function public.trg_social_job_status_history();

-- ── RLS: admin only ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'social_posting_identities','social_group_directory','social_campaigns','social_campaign_groups',
    'social_campaign_caption_variants','social_campaign_links','social_campaign_visits','social_campaign_jobs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', t || '_admin_all', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- Visits are written only by record_campaign_visit (SECURITY DEFINER); links and
-- jobs only by admin RPCs. Admins may read them directly.
revoke insert, update, delete on public.social_campaign_visits from authenticated;

-- ── attribution view ────────────────────────────────────────────────────────
create or replace view public.social_campaign_attribution with (security_invoker = true) as
select 'stance'::text as row_kind, qs.id as row_id, qs.question_id, qs.user_id,
       qs.score::int as score, qs.rendition_id, qs.source,
       qs.created_at as first_at, qs.updated_at,
       v.id as visit_id, v.created_at as visit_at,
       l.id as link_id, l.destination_kind, l.group_id, l.social_campaign_id, l.paid_campaign_id, l.language_code
from public.question_stances qs
join public.social_campaign_visits v on v.id = qs.campaign_visit_id
join public.social_campaign_links l on l.id = v.link_id
union all
select 'pending', p.id, p.question_id, null::uuid,
       p.score::int, p.rendition_id, p.source,
       p.created_at, p.updated_at,
       v.id, v.created_at,
       l.id, l.destination_kind, l.group_id, l.social_campaign_id, l.paid_campaign_id, l.language_code
from public.question_stances_pending p
join public.social_campaign_visits v on v.id = p.campaign_visit_id
join public.social_campaign_links l on l.id = v.link_id
where coalesce(p.committed, false) = false;
revoke all on public.social_campaign_attribution from anon, authenticated;
grant select on public.social_campaign_attribution to service_role;

comment on view public.social_campaign_attribution is
  'First stances (committed or still pending) that arrived through a campaign link within 7 days. Descriptive only: a difference between attributed and other respondents describes who answered through each route, not a causal effect.';
