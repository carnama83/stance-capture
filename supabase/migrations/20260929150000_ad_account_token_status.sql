-- Ad Accounts: show which Meta token an account launches with, and when it expires.
--
-- Political/social-issue ads must be placed by an ID-confirmed person, so the
-- system-user META_ADS_ACCESS_TOKEN can't launch them (Meta #2708008, Prod,
-- 29 Sep 2026). An admin's own user token is now stored per account by
-- validate-ad-account (mode=set_token). The safe view exposes only metadata
-- about that token — never credentials->>'access_token'.
--
-- CREATE OR REPLACE VIEW may only append columns; the existing ones keep their
-- order, and the view keeps its owner, grants and is_admin() filter.

create or replace view public.ad_account_connections_safe as
select
  id,
  platform,
  account_id,
  account_name,
  status,
  last_sync_at,
  created_at,
  updated_at,
  created_by,
  case when coalesce(credentials->>'access_token', '') <> '' then 'account' else 'system' end as token_source,
  credentials->>'token_type' as token_type,
  credentials->>'token_user_name' as token_user_name,
  nullif(credentials->>'token_expires_at', '')::timestamptz as token_expires_at
from public.ad_account_connections
where is_admin();
