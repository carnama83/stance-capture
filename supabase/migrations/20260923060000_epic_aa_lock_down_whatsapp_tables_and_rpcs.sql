-- Epic AA defects AA-03 + AA-04 (Dev reconciliation, 23 Sep 2026).
--
-- AA-03: three policies named service_role_all_* were granted to PUBLIC with
--   USING (true) WITH CHECK (true), and anon/authenticated held full table
--   grants, so anyone with the public key could read and write
--   whatsapp_forward_chains, whatsapp_question_subscriptions and
--   whatsapp_active_sessions. An anonymous GET returned phone hashes, user ids
--   and device ids. The service role bypasses RLS, so the policies never did
--   anything for their intended caller.
--
-- AA-04: SECURITY DEFINER functions that rewrite who owns a stance were
--   EXECUTE-able by anon with no caller check (several via a PUBLIC grant).
--
-- Browser access that remains, and why (swept from src/ on 23 Sep):
--   * whatsapp_config / _broadcasts / _contact_lists / _contact_list_numbers:
--     the /admin/whatsapp pages, as authenticated, gated by is_admin_me() RLS.
--     They keep SELECT/INSERT/UPDATE/DELETE, and lose TRUNCATE/TRIGGER/REFERENCES
--     (TRUNCATE ignores RLS).
--   * attach_user_to_node: WebOptInCard, as the signed-in user, for their own id.
--     It keeps authenticated EXECUTE but gains a guard.
--   * record_web_stance, verify_whatsapp_phone, commit_staged_stances_for_device_by_user:
--     browser RPCs that already guard themselves; untouched.
-- Every other WhatsApp table and RPC is used only by Edge Functions (service role)
-- or by other SECURITY DEFINER functions, which run as their owner.

-- ── AA-03: policies ──────────────────────────────────────────────────────────
drop policy if exists service_role_all_whatsapp_forward_chains        on public.whatsapp_forward_chains;
drop policy if exists service_role_all_whatsapp_question_subscriptions on public.whatsapp_question_subscriptions;
drop policy if exists service_role_all_whatsapp_active_sessions        on public.whatsapp_active_sessions;

-- ── AA-03: table grants ──────────────────────────────────────────────────────
do $grants$
declare t text;
begin
  for t in
    select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and (c.relname like 'whatsapp\_%' or c.relname = 'question_stances_pending')
  loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$grants$;

grant select, insert, update, delete on table
  public.whatsapp_config,
  public.whatsapp_broadcasts,
  public.whatsapp_contact_lists,
  public.whatsapp_contact_list_numbers
to authenticated;

-- ── AA-04: service-role-only functions ───────────────────────────────────────
-- Revoke from PUBLIC as well as the roles: several carried =X/postgres, and a
-- role-only revoke would have silently changed nothing.
revoke all on function public.claim_whatsapp_stances_for_profile(uuid, text)   from public, anon, authenticated;
revoke all on function public.bootstrap_whatsapp_account(uuid, text)           from public, anon, authenticated;
revoke all on function public.attach_phone_to_node(text, text, uuid)           from public, anon, authenticated;
revoke all on function public.commit_staged_stance(text, uuid, text)           from public, anon, authenticated;
revoke all on function public.increment_broadcast_counter(uuid, text)          from public, anon, authenticated;
revoke all on function public.claim_card_regeneration(uuid, integer)           from public, anon, authenticated;
revoke all on function public.claim_whatsapp_signin_token(text)                from public, anon, authenticated;
revoke all on function public.verify_whatsapp_otp_for_signin(uuid, text)       from public, anon, authenticated;

grant execute on function public.claim_whatsapp_stances_for_profile(uuid, text)   to service_role;
grant execute on function public.bootstrap_whatsapp_account(uuid, text)           to service_role;
grant execute on function public.attach_phone_to_node(text, text, uuid)           to service_role;
grant execute on function public.commit_staged_stance(text, uuid, text)           to service_role;
grant execute on function public.increment_broadcast_counter(uuid, text)          to service_role;
grant execute on function public.claim_card_regeneration(uuid, integer)           to service_role;
grant execute on function public.claim_whatsapp_signin_token(text)                to service_role;
grant execute on function public.verify_whatsapp_otp_for_signin(uuid, text)       to service_role;

-- ── AA-04: attach_user_to_node, guarded ──────────────────────────────────────
-- Before: anyone could attach any node (and commit its staged stance) to any
-- user id. Now, for API callers other than the service role:
--   * p_user_id must be the caller (auth.uid());
--   * a node already attached to someone else is left alone;
--   * a node recorded from a device can only be claimed by that device.
--     A visitor's own ref is shared in every link they forward (?ref=), so
--     knowing a ref proves nothing. The device id stays in the browser that
--     answered. Nodes without a device id (storage blocked) remain claimable
--     by ref, which was the old behaviour.
-- The signature changes (new p_device_id), so the old one is dropped. The live
-- frontend call without p_device_id still resolves (the parameter defaults to
-- null). Device-bound nodes simply stay pending until the updated WebOptInCard
-- ships; OAuthCallbackPage's commit_staged_stances_for_device_by_user already
-- commits them on sign-in.
drop function if exists public.attach_user_to_node(text, uuid);

create function public.attach_user_to_node(p_ref text, p_user_id uuid, p_device_id text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_node   record;
  v_api    boolean := session_user = 'authenticator' and coalesce(auth.role(), '') <> 'service_role';
begin
  if p_ref is null or p_user_id is null then return; end if;

  if v_api and auth.uid() is distinct from p_user_id then
    raise exception 'attach_user_to_node: can only attach your own account' using errcode = '42501';
  end if;

  select responder_user_id, responder_device_id into v_node
    from public.whatsapp_forward_chains where id = p_ref;
  if not found then return; end if;

  if v_node.responder_user_id is not null and v_node.responder_user_id <> p_user_id then
    return;  -- already someone else's
  end if;
  if v_api and v_node.responder_device_id is not null
     and v_node.responder_device_id is distinct from p_device_id then
    return;  -- not the browser that answered
  end if;

  update public.whatsapp_forward_chains
     set responder_user_id = p_user_id
   where id = p_ref;

  perform public.commit_staged_stance(p_ref, p_user_id, null);
end;
$function$;

revoke all on function public.attach_user_to_node(text, uuid, text) from public, anon;
grant execute on function public.attach_user_to_node(text, uuid, text) to authenticated, service_role;
