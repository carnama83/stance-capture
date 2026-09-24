-- Epic AA defect AA-13 (Dev reconciliation, 23 Sep 2026): phone OTPs could be
-- brute-forced. verify_whatsapp_phone and verify_whatsapp_otp_for_signin
-- compared a 6-digit code without counting failures, and a wrong guess did not
-- consume the code, so the whole 10^6 space was open for the 10-minute
-- lifetime. A successful guess could link a victim's number to the attacker's
-- profile (pulling in the victim's anonymous stances) or, via
-- whatsapp-otp-verify, sign the attacker into the victim's WhatsApp-first account.
--
-- Fix: every wrong guess is counted, and the code is burned on the 5th.
-- Combined with the AA-05 send limit (3 codes per number per 10 min), that caps
-- guessing at 15 attempts per number per 10 minutes. The row is locked
-- (FOR UPDATE) while it is checked, so parallel guesses cannot overshoot.
--
-- verify_whatsapp_phone used to RAISE on a wrong code, and a raise rolls the
-- counter back with everything else. It now records the failure and returns
-- normally with HTTP 400 (PostgREST response.status) and the same error body
-- shape and message. Measured on Dev on 23 Sep that PostgREST commits in that
-- case; the deployed SettingsProfile, which looks for "invalid" in
-- error.message, needs no change.

alter table public.whatsapp_phone_verifications
  add column if not exists failed_attempts smallint not null default 0;

-- Atomically counts one failed guess; burns the code on the 5th. Returns the new count.
create or replace function public.register_whatsapp_otp_failure(p_id uuid)
returns smallint
language sql
security definer
set search_path to 'public'
as $function$
  update public.whatsapp_phone_verifications
     set failed_attempts = failed_attempts + 1,
         used            = used or failed_attempts + 1 >= 5
   where id = p_id
  returning failed_attempts;
$function$;

revoke all on function public.register_whatsapp_otp_failure(uuid) from public, anon, authenticated;
grant execute on function public.register_whatsapp_otp_failure(uuid) to service_role;

create or replace function public.verify_whatsapp_phone(p_verification_token uuid, p_otp text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_rec       record;
  v_attempts  smallint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Look up the verification token; lock it so concurrent guesses serialise.
  select * into v_rec
  from public.whatsapp_phone_verifications
  where verification_token = p_verification_token
    and used = false
    and expires_at > now()
  limit 1
  for update;

  if not found then
    raise exception 'Invalid or expired verification code';
  end if;

  -- Wrong code: record the attempt and return a 400 WITHOUT raising, so the
  -- counter is committed (AA-13).
  if v_rec.otp_code is distinct from p_otp then
    v_attempts := public.register_whatsapp_otp_failure(v_rec.id);
    perform set_config('response.status', '400', true);
    return jsonb_build_object(
      'code', 'P0001',
      'message', case when v_attempts >= 5
                      then 'Invalid verification code. Too many attempts: request a new code.'
                      else 'Invalid verification code' end,
      'details', null,
      'hint', null,
      'verified', false);
  end if;

  -- Mark token as used
  update public.whatsapp_phone_verifications
  set used = true
  where id = v_rec.id;

  -- Store phone hash on profile
  update public.profiles
  set verified_phone_hash = v_rec.phone_hash,
      updated_at          = now()
  where user_id = v_uid;

  return jsonb_build_object('verified', true);
end;
$function$;

create or replace function public.verify_whatsapp_otp_for_signin(p_verification_token uuid, p_otp text)
returns table(otp_valid boolean, user_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rec record;
  v_user_id uuid;
begin
  select * into v_rec
  from public.whatsapp_phone_verifications
  where verification_token = p_verification_token
    and used = false
    and expires_at > now()
  limit 1
  for update;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  -- AA-13: count the wrong guess (burned on the 5th). This path returns
  -- normally, so the increment commits.
  if v_rec.otp_code is distinct from p_otp then
    perform public.register_whatsapp_otp_failure(v_rec.id);
    return query select false, null::uuid;
    return;
  end if;

  -- OTP consumed here regardless of whether an account is found below —
  -- it was correctly used to prove phone possession either way, and
  -- shouldn't be retryable after this point (same one-time-use semantics
  -- as verify_whatsapp_phone()).
  update public.whatsapp_phone_verifications
  set used = true
  where id = v_rec.id;

  select p.user_id into v_user_id
  from public.profiles p
  where p.verified_phone_hash = v_rec.phone_hash;

  return query select true, v_user_id;
end;
$function$;

-- verify_whatsapp_phone is only ever called by a signed-in user (SettingsProfile)
-- and refuses anon in its own body; don't leave it anon/PUBLIC-executable.
revoke all on function public.verify_whatsapp_phone(uuid, text) from public, anon;
grant execute on function public.verify_whatsapp_phone(uuid, text) to authenticated, service_role;
