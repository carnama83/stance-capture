-- Epic AA defect AA-11 (Dev reconciliation, 23 Sep 2026): delivery and
-- engagement counters were unreliable.
--   * whatsapp-flow-webhook mapped both "delivered" and "read" receipts to
--     delivered and incremented total_delivered for each, so every read
--     message counted as delivered twice;
--   * a receipt updated the phone hash's LATEST delivery_log row, not the row
--     for that message, so it could land on the wrong broadcast;
--   * total_opened counted WhatsApp read receipts, not Flow opens, and
--     flow_completed_at was never written, so "completed" was always 0;
--   * whatsapp-sync-delivery marked any send older than an hour "delivered"
--     with no evidence, from a stale counter snapshot.
--
-- Fix, in the database so each transition is atomic and counted exactly once:
--   record_whatsapp_delivery_status(message_id, status, ...) matches the row by
--     Meta's message id (column added for AA-07) and only moves it forward:
--     sent -> delivered (+total_delivered), sent -> failed (+total_failed).
--     A "read" also implies delivery if that receipt never came, and records
--     read_at; a read is NOT an open.
--   record_whatsapp_flow_event(broadcast, phone_hash, 'opened'|'completed') is
--     called by whatsapp-flow-endpoint when the recipient actually opens the
--     Flow (INIT) or submits it. Each is counted once per recipient.
--   refresh_whatsapp_broadcast_counters(broadcast) recomputes the receipt and
--     engagement counters from the log, so whatsapp-sync-delivery reconciles
--     instead of inventing deliveries.
-- total_sent / total_failed remain the dispatcher's accounting of API calls;
-- a later "failed" receipt adds to total_failed.

alter table public.whatsapp_delivery_log
  add column if not exists read_at timestamptz;

create or replace function public.record_whatsapp_delivery_status(
  p_message_id text,
  p_status     text,
  p_error      text        default null,
  p_at         timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row  record;
  v_at   timestamptz := coalesce(p_at, now());
  v_new  text;
  v_dlv  boolean := false;
  v_fail boolean := false;
begin
  if p_message_id is null then
    return jsonb_build_object('matched', false);
  end if;

  select id, broadcast_id, status into v_row
    from public.whatsapp_delivery_log
   where message_id = p_message_id
   for update;
  -- Not a broadcast message (OTP, next-question, test send) or logged before
  -- message_id existed: nothing to account for. Deliberately NO fallback to
  -- "latest row for this phone" — that is what misattributed receipts.
  if not found then
    return jsonb_build_object('matched', false);
  end if;

  v_new := v_row.status;
  if p_status in ('delivered', 'read') and v_row.status = 'sent' then
    v_new := 'delivered';
    v_dlv := true;
  elsif p_status = 'failed' and v_row.status = 'sent' then
    v_new := 'failed';
    v_fail := true;
  end if;

  update public.whatsapp_delivery_log
     set status         = v_new,
         failure_reason = case when v_fail then left(coalesce(p_error, 'meta_failed'), 500) else failure_reason end,
         read_at        = case when p_status = 'read' then coalesce(read_at, v_at) else read_at end
   where id = v_row.id;

  if v_dlv then
    update public.whatsapp_broadcasts set total_delivered = total_delivered + 1 where id = v_row.broadcast_id;
  elsif v_fail then
    update public.whatsapp_broadcasts set total_failed = total_failed + 1 where id = v_row.broadcast_id;
  end if;

  return jsonb_build_object('matched', true, 'from', v_row.status, 'to', v_new,
                            'counted', case when v_dlv then 'delivered' when v_fail then 'failed' end);
end;
$function$;

create or replace function public.record_whatsapp_flow_event(
  p_broadcast_id uuid,
  p_phone_hash   text,
  p_event        text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id     uuid;
  v_opened boolean := false;
  v_done   boolean := false;
begin
  if p_broadcast_id is null or p_phone_hash is null or p_event not in ('opened', 'completed') then
    return false;
  end if;

  select id into v_id
    from public.whatsapp_delivery_log
   where broadcast_id = p_broadcast_id and phone_hash = p_phone_hash
   order by sent_at desc
   limit 1
   for update;
  if not found then return false; end if;

  -- Opened: first time only. A completion implies an open.
  update public.whatsapp_delivery_log
     set flow_opened_at = now()
   where id = v_id and flow_opened_at is null;
  v_opened := found;

  if p_event = 'completed' then
    update public.whatsapp_delivery_log
       set flow_completed_at = now()
     where id = v_id and flow_completed_at is null;
    v_done := found;
  end if;

  if v_opened or v_done then
    update public.whatsapp_broadcasts
       set total_opened    = total_opened    + (case when v_opened then 1 else 0 end),
           total_completed = total_completed + (case when v_done   then 1 else 0 end)
     where id = p_broadcast_id;
  end if;
  return v_opened or v_done;
end;
$function$;

create or replace function public.refresh_whatsapp_broadcast_counters(p_broadcast_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with c as (
    select
      count(*) filter (where status = 'delivered')          as delivered,
      count(*) filter (where flow_opened_at is not null)    as opened,
      count(*) filter (where flow_completed_at is not null) as completed
    from public.whatsapp_delivery_log
    where broadcast_id = p_broadcast_id
  ), s as (
    select count(*) as stances from public.question_stances where broadcast_id = p_broadcast_id
  )
  update public.whatsapp_broadcasts b
     set total_delivered = c.delivered,
         total_opened    = c.opened,
         total_completed = c.completed,
         total_stances   = s.stances
    from c, s
   where b.id = p_broadcast_id
  returning jsonb_build_object('delivered', b.total_delivered, 'opened', b.total_opened,
                               'completed', b.total_completed, 'stances', b.total_stances);
$function$;

revoke all on function public.record_whatsapp_delivery_status(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_whatsapp_flow_event(uuid, text, text)                   from public, anon, authenticated;
revoke all on function public.refresh_whatsapp_broadcast_counters(uuid)                      from public, anon, authenticated;
grant execute on function public.record_whatsapp_delivery_status(text, text, text, timestamptz) to service_role;
grant execute on function public.record_whatsapp_flow_event(uuid, text, text)                   to service_role;
grant execute on function public.refresh_whatsapp_broadcast_counters(uuid)                      to service_role;
