-- Epic AA defect AA-08 (Dev reconciliation, 23 Sep 2026): no WhatsApp job was
-- registered on Dev or UAT. Scheduled broadcasts never dispatched, delivery
-- counters were never reconciled, anonymous stances were never claimed nightly,
-- and nothing enforced the 90-day delivery-log retention (AA5.2) or expired
-- sessions and tokens. Prod had three of these jobs, registered by hand.
--
-- This registers ONE job set in every environment. Each job is created only if
-- no job with that name exists (cron.schedule with an existing name would
-- overwrite it), so Prod's hand-registered whatsapp-broadcast-dispatch,
-- whatsapp-delivery-log-purge and whatsapp-phone-verifications-purge are left
-- exactly as they are.
--
-- Edge Functions are invoked through admin.cron_invoke_notification(slug, job),
-- the helper the notification jobs already use. It calls the function with the
-- service-role key, which the WhatsApp functions accept, and records every run
-- in admin.cron_runs.
--
-- Deliberately NOT scheduled: whatsapp-send-update. It is the AA-09 stub, which
-- marks subscribers as notified without sending anything; scheduling it would
-- corrupt the subscription history. Register it only once AA-09 is decided.
--
-- On Dev and UAT this means a broadcast an admin schedules WILL send real
-- WhatsApp messages (both environments hold live Meta credentials). That was
-- the explicit decision when AA-08 was approved on 23 Sep.
-- Expiry sweep for WhatsApp session/token tables (none existed anywhere).
-- Retention after expiry: sign-in tokens (15 min life) and YES-reply sessions
-- (30 min life) 1 day; Flow sessions (2-day life) 30 days, because they carry
-- the D4 recorded/rejected_invalidated outcome, which is worth keeping for a while.
create or replace function public.purge_expired_whatsapp_sessions()
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_tokens   int;
  v_active   int;
  v_flow     int;
  v_result   jsonb;
begin
  delete from public.whatsapp_signin_tokens  where expires_at < now() - interval '1 day';
  get diagnostics v_tokens = row_count;
  delete from public.whatsapp_active_sessions where expires_at < now() - interval '1 day';
  get diagnostics v_active = row_count;
  delete from public.whatsapp_flow_sessions  where expires_at < now() - interval '30 days';
  get diagnostics v_flow = row_count;

  v_result := jsonb_build_object('signin_tokens', v_tokens, 'active_sessions', v_active, 'flow_sessions', v_flow);
  insert into admin.cron_runs(job, finished_at, ok, message)
  values ('whatsapp_expired_sessions_purge', now(), true, v_result::text);
  return v_result;
end;
$function$;

revoke all on function public.purge_expired_whatsapp_sessions() from public, anon, authenticated;
grant execute on function public.purge_expired_whatsapp_sessions() to service_role;

do $jobs$
declare
  v_job record;
begin
  for v_job in
    select * from (values
      ('whatsapp-broadcast-dispatch',      '*/5 * * * *',
       $c$select admin.cron_invoke_notification('whatsapp-broadcast-dispatch', 'whatsapp_broadcast_dispatch')$c$),
      ('whatsapp-sync-delivery',           '15 * * * *',
       $c$select admin.cron_invoke_notification('whatsapp-sync-delivery', 'whatsapp_sync_delivery')$c$),
      ('whatsapp-claim-anonymous-stances', '0 2 * * *',
       $c$select admin.cron_invoke_notification('whatsapp-claim-anonymous-stances', 'whatsapp_claim_anonymous_stances')$c$),
      ('whatsapp-delivery-log-purge',      '0 3 * * *',
       $c$DELETE FROM public.whatsapp_delivery_log WHERE purge_after < current_date$c$),
      ('whatsapp-phone-verifications-purge', '30 3 * * *',
       $c$DELETE FROM public.whatsapp_phone_verifications WHERE created_at < now() - interval '24 hours'$c$),
      ('whatsapp-expired-sessions-purge',  '45 3 * * *',
       $c$select public.purge_expired_whatsapp_sessions()$c$)
    ) as j(name, schedule, command)
  loop
    if exists (select 1 from cron.job where jobname = v_job.name) then
      raise notice 'cron job % already exists; left unchanged', v_job.name;
    else
      perform cron.schedule(v_job.name, v_job.schedule, v_job.command);
      raise notice 'cron job % registered (%)', v_job.name, v_job.schedule;
    end if;
  end loop;
end
$jobs$;
