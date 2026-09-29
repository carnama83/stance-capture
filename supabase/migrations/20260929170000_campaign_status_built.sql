-- Campaigns: 'built' = created on the platform, all paused, never submitted.
--
-- "Build paused" used to record 'pending_review', so a campaign nobody had
-- submitted read "Pending review" (Prod, 29 Sep 2026). create-meta-campaign now
-- writes 'built', and activate:true on a built campaign submits the existing
-- objects for review (→ 'pending_review'). Widen the status check to allow it.

alter table public.campaigns drop constraint if exists campaigns_status_check;
alter table public.campaigns add constraint campaigns_status_check
  check (status = any (array[
    'draft', 'built', 'pending_review', 'active', 'paused', 'completed', 'cancelled', 'rejected'
  ]::text[]));
