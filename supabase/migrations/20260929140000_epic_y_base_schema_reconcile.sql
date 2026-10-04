-- Epic Y base schema reconcile (written 2026-10-03, timestamped before the
-- first Epic Y ALTER migration so a from-scratch rebuild applies in order).
--
-- public.ad_account_connections, public.campaigns, public.campaign_results,
-- question_stances.campaign_id, embedded_stances.campaign_id and the widened
-- question_stances_source_check were applied straight to Dev/UAT/Prod and never
-- captured in a migration. Definitions below were read from Prod
-- (yzxzpnomcarnxixhjlba) on 2026-10-03 and match Dev and UAT.
--
-- Everything is idempotent: on the three live databases this is a no-op.

-- ── ad_account_connections ──────────────────────────────────────────────────
create table if not exists public.ad_account_connections (
  id uuid not null default gen_random_uuid(),
  platform text not null,
  account_id text not null,
  account_name text,
  status text not null default 'active'::text,
  credentials jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint ad_account_connections_pkey primary key (id),
  constraint ad_account_connections_platform_account_uniq unique (platform, account_id),
  constraint ad_account_connections_platform_check check (platform = any (array['meta'::text, 'linkedin'::text])),
  constraint ad_account_connections_status_check check (status = any (array['active'::text, 'token_expired'::text, 'suspended'::text, 'disconnected'::text])),
  constraint ad_account_connections_created_by_fkey foreign key (created_by) references public.admin_users(user_id) on delete set null
);
create index if not exists idx_adacct_status on public.ad_account_connections using btree (status);
-- RLS on with no policies: credentials are reachable only via service role
-- (edge functions) and the is_admin()-filtered ad_account_connections_safe view.
alter table public.ad_account_connections enable row level security;
drop trigger if exists ad_account_connections_set_updated on public.ad_account_connections;
create trigger ad_account_connections_set_updated before update on public.ad_account_connections
  for each row execute function public.set_updated_at();

-- ── campaigns ───────────────────────────────────────────────────────────────
create table if not exists public.campaigns (
  id uuid not null default gen_random_uuid(),
  name text not null,
  question_id uuid not null,
  platform text not null,
  ad_account_id uuid,
  status text not null default 'draft'::text,
  targeting jsonb not null default '{}'::jsonb,
  budget_type text not null default 'daily'::text,
  budget_amount numeric not null,
  start_date date,
  end_date date,
  platform_campaign_id text,
  creative_headline text,
  creative_body text,
  creative_image_url text,
  destination_url text,
  total_spend numeric not null default 0,
  total_impressions integer not null default 0,
  total_clicks integer not null default 0,
  stances_attributed integer not null default 0,
  rejection_reason text,
  partner_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_pkey primary key (id),
  constraint campaigns_ad_account_id_fkey foreign key (ad_account_id) references public.ad_account_connections(id) on delete set null,
  constraint campaigns_budget_amount_check check (budget_amount > (0)::numeric),
  constraint campaigns_budget_type_check check (budget_type = any (array['daily'::text, 'total'::text])),
  constraint campaigns_created_by_fkey foreign key (created_by) references public.admin_users(user_id) on delete set null,
  constraint campaigns_platform_check check (platform = any (array['meta'::text, 'linkedin'::text])),
  constraint campaigns_question_id_fkey foreign key (question_id) references public.questions(id) on delete restrict
);
-- status check ('built' etc.) is (re)created by 20260929170000_campaign_status_built.sql;
-- creative_digitally_created is added by 20260929190000_campaign_creative_image.sql.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_status_check'
                 and conrelid = 'public.campaigns'::regclass) then
    alter table public.campaigns add constraint campaigns_status_check
      check (status = any (array['draft','built','pending_review','active','paused','completed','cancelled','rejected']::text[]));
  end if;
end $$;
create index if not exists idx_campaigns_created_at on public.campaigns using btree (created_at desc);
create index if not exists idx_campaigns_platform on public.campaigns using btree (platform);
create index if not exists idx_campaigns_question_id on public.campaigns using btree (question_id);
create index if not exists idx_campaigns_status on public.campaigns using btree (status);
alter table public.campaigns enable row level security;
drop policy if exists campaigns_admin_all on public.campaigns;
create policy campaigns_admin_all on public.campaigns
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop trigger if exists campaigns_set_updated on public.campaigns;
create trigger campaigns_set_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ── campaign_results ────────────────────────────────────────────────────────
create table if not exists public.campaign_results (
  id uuid not null default gen_random_uuid(),
  campaign_id uuid not null,
  snapshot_date date not null,
  impressions integer not null default 0,
  reach integer not null default 0,
  clicks integer not null default 0,
  spend numeric not null default 0,
  stances_attributed integer not null default 0,
  synced_at timestamptz not null default now(),
  constraint campaign_results_pkey primary key (id),
  constraint campaign_results_campaign_date_uniq unique (campaign_id, snapshot_date),
  constraint campaign_results_campaign_id_fkey foreign key (campaign_id) references public.campaigns(id) on delete cascade
);
create index if not exists idx_campaign_results_campaign on public.campaign_results using btree (campaign_id, snapshot_date desc);
alter table public.campaign_results enable row level security;
drop policy if exists campaign_results_admin_read on public.campaign_results;
create policy campaign_results_admin_read on public.campaign_results
  for select to authenticated using (public.is_admin());

-- ── stance columns that point at campaigns ──────────────────────────────────
alter table public.question_stances add column if not exists campaign_id uuid;
alter table public.embedded_stances add column if not exists campaign_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'question_stances_campaign_id_fkey') then
    alter table public.question_stances add constraint question_stances_campaign_id_fkey
      foreign key (campaign_id) references public.campaigns(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'embedded_stances_campaign_id_fkey') then
    alter table public.embedded_stances add constraint embedded_stances_campaign_id_fkey
      foreign key (campaign_id) references public.campaigns(id) on delete set null;
  end if;
end $$;
create index if not exists idx_qs_campaign_id on public.question_stances using btree (campaign_id) where (campaign_id is not null);
create index if not exists idx_es_campaign_id on public.embedded_stances using btree (campaign_id) where (campaign_id is not null);

-- ── question_stances.source: live set includes web_forward and campaign ─────
-- Only rebuilt when it differs, so the live databases skip the full-table revalidation.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'question_stances_source_check'
                 and conrelid = 'public.question_stances'::regclass
                 and pg_get_constraintdef(oid) ilike '%web_forward%campaign%') then
    alter table public.question_stances drop constraint if exists question_stances_source_check;
    alter table public.question_stances add constraint question_stances_source_check
      check (source = any (array['native','ingested','embed','whatsapp_flow','web_forward','campaign']::text[]));
  end if;
end $$;
