-- Epic AA defect AA-09 (decided 24 Sep 2026: "encrypt the number on YES").
--
-- whatsapp-send-update could never send: subscriptions held only the salted
-- phone hash, and Meta needs the real number (wa_id) as `to`. The function
-- logged "Would dispatch update" and then marked the subscriber as notified.
--
-- Decision: when a person replies YES to subscribe to a question, the webhook
-- stores their wa_id ENCRYPTED on that subscription row only. This is a
-- documented exception to AA5.2 ("raw number never stored"), justified by the
-- explicit YES opt-in, and scoped as narrowly as possible:
--
--   * Encryption is AES-256-GCM, done in the Edge Functions with the key in the
--     WHATSAPP_NUMBER_KEY Edge secret. The key never reaches the database, not
--     even as a query parameter, so a database dump or SQL access alone cannot
--     recover a number. The phone hash is bound in as additional authenticated
--     data, so a ciphertext copied onto another subscriber's row fails to decrypt.
--   * Format: 'v1.' || base64(iv) || '.' || base64(ciphertext+tag).
--   * Only YES subscriptions carry it. Broadcast recipients, global
--     SUBSCRIBE opt-ins and every other table still hold hashes only.
--   * STOP wipes it: the constraint below makes an inactive subscription with a
--     stored number impossible, so a deactivation that forgets to clear it
--     fails loudly instead of leaving the number behind.
--   * Deleting the question deletes the subscription (existing ON DELETE CASCADE).
--
-- last_inbound_at is when the subscriber last messaged us about this
-- subscription (the YES itself). whatsapp-send-update uses it, with
-- whatsapp_active_sessions.updated_at, to decide whether Meta's 24-hour
-- customer-service window is open (free-form text) or closed (approved template).
--
-- The table is already service-role only (AA-13 lockdown: no anon or
-- authenticated grants, no policies), so no grant changes are needed.

alter table public.whatsapp_question_subscriptions
  add column if not exists wa_id_enc text,
  add column if not exists last_inbound_at timestamptz;

comment on column public.whatsapp_question_subscriptions.wa_id_enc is
  'Epic AA-09: subscriber wa_id, AES-256-GCM encrypted in the Edge Functions (key: WHATSAPP_NUMBER_KEY Edge secret, never in the DB; AAD = whatsapp_phone_hash). Format v1.<iv b64>.<ct b64>. Set on YES, cleared on STOP. Documented exception to AA5.2.';
comment on column public.whatsapp_question_subscriptions.last_inbound_at is
  'Epic AA-09: last inbound message from this subscriber for this subscription (the YES). Used to decide whether Meta''s 24h window is open.';

-- Existing inactive rows (none in any environment on 24 Sep 2026) cannot hold a
-- number, so the constraint validates immediately.
alter table public.whatsapp_question_subscriptions
  drop constraint if exists whatsapp_question_subscriptions_number_only_while_active;
alter table public.whatsapp_question_subscriptions
  add constraint whatsapp_question_subscriptions_number_only_while_active
  check (is_active or wa_id_enc is null);

alter table public.whatsapp_question_subscriptions
  drop constraint if exists whatsapp_question_subscriptions_wa_id_enc_format;
alter table public.whatsapp_question_subscriptions
  add constraint whatsapp_question_subscriptions_wa_id_enc_format
  check (wa_id_enc is null or wa_id_enc ~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$');
