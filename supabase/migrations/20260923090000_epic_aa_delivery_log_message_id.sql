-- Epic AA defect AA-07 (Dev reconciliation, 23 Sep 2026): whatsapp-send-link
-- wrote whatsapp_delivery_log rows with a message_id column that did not exist
-- (and an "error" column instead of failure_reason). Every insert failed, and
-- the failure was swallowed, so link-mode sends were never logged. That is also
-- what fed AA-06's endless re-send, because the dispatcher treats "has a log
-- row" as "already processed".
--
-- message_id is the Meta message id (wamid). Both send functions now record it.
-- It is also the key AA-11 needs to match delivery receipts to the right row,
-- instead of "the latest row for this phone hash".
alter table public.whatsapp_delivery_log
  add column if not exists message_id text;

create index if not exists whatsapp_delivery_log_message_id_idx
  on public.whatsapp_delivery_log (message_id)
  where message_id is not null;
