-- Epic AA defect AA-05 (Dev reconciliation, 23 Sep 2026): OTP sending must stay
-- reachable from the browser (SettingsProfile, and PhoneSignInFlow before any
-- session exists), so instead of locking whatsapp-send-flow's verification_mode
-- it is rate-limited per phone, per requester IP and globally. The IP is stored
-- only as a salted hash, the same way phone numbers are.
alter table public.whatsapp_phone_verifications
  add column if not exists requester_ip_hash text;

create index if not exists whatsapp_phone_verifications_created_idx
  on public.whatsapp_phone_verifications (created_at);
create index if not exists whatsapp_phone_verifications_phone_created_idx
  on public.whatsapp_phone_verifications (phone_hash, created_at);
create index if not exists whatsapp_phone_verifications_ip_created_idx
  on public.whatsapp_phone_verifications (requester_ip_hash, created_at)
  where requester_ip_hash is not null;
