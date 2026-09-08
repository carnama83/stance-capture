-- BUG FIX: profile_set_dob_checked() encrypted and stored the DOB but never
-- set dob_checked = true, so the column has been permanently false for every
-- user regardless of signup path. Confirmed cross-epic impact: Epic F's
-- snapshot_community_trends() filters its age_group demographic breakdown on
-- p.dob_checked = true, so that breakdown has never returned any rows.
-- clear_my_dob() already correctly resets dob_checked = false, confirming
-- true/false was always the intended lifecycle for this column.
-- Applied to stance-capture-dev and stance-capture-uat 2026-09-08.

CREATE OR REPLACE FUNCTION public.profile_set_dob_checked(p_dob_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_dob date;
  v_key text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- no-op if already set
  if exists (
    select 1 from public.profiles
    where user_id = v_uid and dob_encrypted is not null
  ) then
    return;
  end if;

  if p_dob_text is null or btrim(p_dob_text) = '' then
    raise exception 'DOB is required';
  end if;

  v_dob := btrim(p_dob_text)::date;

  if v_dob > (current_date - interval '13 years')::date then
    raise exception 'Must be at least 13 years old';
  end if;

  v_key := private.get_secret('dob_key');
  if v_key is null or v_key = '' then
    raise exception 'DOB encryption key not configured';
  end if;

  update public.profiles
     set dob_encrypted = extensions.pgp_sym_encrypt(v_dob::text, v_key),
         dob_checked   = true,
         updated_at = now()
   where user_id = v_uid;

  if not found then
    raise exception 'Profile row not found for user %', v_uid;
  end if;
end;
$function$;

-- Backfill: profiles that already have a DOB genuinely set should reflect
-- that immediately, not just on the next DOB write for that user.
UPDATE public.profiles
   SET dob_checked = true
 WHERE dob_encrypted IS NOT NULL
   AND dob_checked = false;
