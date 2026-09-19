-- PR 0.3 — drop upsert_whatsapp_stance().
--
-- Orphaned by f2_13 (UGQ-ML-C03), which moved WhatsApp provenance to send time:
-- whatsapp_flow_sessions.rendition_id is bound when the card goes out, and
-- whatsapp-flow-endpoint reads it back on reply. Nothing calls this function --
-- grep across src/, supabase/functions/ and the SQL catalogue returns only its
-- own definition.
--
-- It also INSERTs into public.question_stances without rendition_id, so it
-- would raise 23502 the moment anything did call it. A dormant SECURITY DEFINER
-- function that throws on first use is a trap for whoever rewires it next,
-- and its presence invites exactly that: it looks like the supported way to
-- record a WhatsApp stance, and it is not.
--
-- The signature is spelled out so this drops the intended function rather than
-- whatever else might one day share the name. IF EXISTS is deliberate: this
-- migration replays across Dev, UAT and Prod, and the function's presence was
-- only confirmed on UAT.

drop function if exists public.upsert_whatsapp_stance(uuid, smallint, text, uuid);

notify pgrst, 'reload schema';
