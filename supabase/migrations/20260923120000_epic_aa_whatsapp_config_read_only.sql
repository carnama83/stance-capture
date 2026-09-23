-- Epic AA defect AA-15 (Dev reconciliation, 23 Sep 2026): the /admin/whatsapp
-- page saved credentials, a Flow id and a "status" into whatsapp_config, but no
-- function has ever read that table — every WhatsApp function reads Supabase
-- Edge secrets. Save, Disconnect and the status banner were therefore
-- cosmetic, and an access token typed into the page sat in this table in
-- plaintext.
--
-- Decision (23 Sep): the page becomes a read-only status view backed by the
-- whatsapp-status Edge Function, which reports what is actually in effect.
-- Configuration is changed only through Edge secrets.
--
-- This table is left in place (nothing is dropped) but:
--   * browser roles lose all access to it (the page no longer reads or writes it);
--   * any secret a past Save stored is cleared, so a stale token cannot leak or
--     be mistaken for the live one. Dev held none on 23 Sep; on UAT/Prod this
--     statement may clear a real value, which is intended — it was never used.
revoke all on table public.whatsapp_config from anon, authenticated;

update public.whatsapp_config
   set access_token = null,
       webhook_secret = null
 where access_token is not null or webhook_secret is not null;

comment on table public.whatsapp_config is
  'DEPRECATED (Epic AA-15, 23 Sep 2026): not read by any function. WhatsApp runtime '
  'configuration lives in Supabase Edge secrets; /admin/whatsapp shows it read-only '
  'via the whatsapp-status Edge Function. Kept only so historical rows are not lost.';
