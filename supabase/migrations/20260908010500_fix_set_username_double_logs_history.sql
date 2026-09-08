-- BUG FIX: set_username() explicitly inserted into username_history AND the
-- trg_profiles_log_username trigger (AFTER UPDATE OF username -> log_username_history())
-- ALSO inserted into username_history for the same change. Every username set
-- (including the very first one at signup) logged TWO history rows instead of
-- one, which immediately exhausted the 2-per-30-day quota (cfg_username_changes_per_30d)
-- for every new user before they had made a single real change. Fix: remove the
-- redundant explicit insert from set_username() and let the trigger (which
-- fires for ANY username-changing UPDATE, not just this one RPC) be the single
-- source of truth, matching how every other write path already relies on it.
-- Applied to stance-capture-dev 2026-09-08 -- needs promotion to UAT and Prod.

CREATE OR REPLACE FUNCTION public.set_username(p_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_uid uuid := auth.uid();
  v_existing text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_username is null or length(trim(p_username)) < 3 then
    raise exception 'Invalid username';
  end if;

  p_username := lower(trim(p_username));

  -- If user already has this username -> NO-OP
  select username
    into v_existing
  from public.profiles
  where user_id = v_uid;

  if v_existing = p_username then
    return;
  end if;

  -- Check if someone else is using it now
  if exists (
    select 1
    from public.profiles
    where username = p_username
      and user_id <> v_uid
  ) then
    raise exception 'Username already taken';
  end if;

  -- Update profile. trg_profiles_log_username fires on this UPDATE and logs
  -- the change to username_history exactly once -- no separate insert here.
  update public.profiles
  set username = p_username,
      display_handle_mode = 'username',
      updated_at = now()
  where user_id = v_uid;

  if not found then
    raise exception 'Profile not found';
  end if;
end;
$function$;

-- Data cleanup: collapse the duplicate rows this bug already created (keep
-- one row per user/username/changed_at group) so existing users' quotas
-- aren't stuck wrongly exhausted.
DELETE FROM public.username_history a
USING public.username_history b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.username = b.username
  AND a.changed_at = b.changed_at;
