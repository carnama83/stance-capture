-- Epic L remediation, Dev, 15 Sep 2026
-- L-01 (P0): update_my_privacy_settings took 4 params while the frontend sends 5
--            (p_allow_social_ingestion, added for Epic W / W5). PostgREST could not
--            resolve the call at all (PGRST202), so NO privacy setting could be saved.
-- L-07 (P2): user_privacy.display_mode was never propagated to profiles.display_handle_mode,
--            the field that actually drives comment rendering. SettingsPrivacy's control
--            was therefore a decoy. The RPC now writes BOTH stores in one transaction.
--
-- The old 4-param function is dropped and replaced by a 5-param version whose params all
-- DEFAULT NULL, so an existing 4-named-param call still resolves.

drop function if exists public.update_my_privacy_settings(text, text, text, text);

create or replace function public.update_my_privacy_settings(
  p_display_mode           text    default null,
  p_stance_visibility      text    default null,
  p_comment_visibility     text    default null,
  p_profile_visibility     text    default null,
  p_allow_social_ingestion boolean default null
)
returns public.user_privacy
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.user_privacy;
  v_has_username boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Ensure the row exists
  insert into public.user_privacy (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.user_privacy set
    display_mode           = coalesce(p_display_mode,           display_mode),
    stance_visibility      = coalesce(p_stance_visibility,      stance_visibility),
    comment_visibility     = coalesce(p_comment_visibility,     comment_visibility),
    profile_visibility     = coalesce(p_profile_visibility,     profile_visibility),
    allow_social_ingestion = coalesce(p_allow_social_ingestion, allow_social_ingestion),
    updated_at             = now()
  where user_id = v_uid
  returning * into v_row;

  -- L-07: keep profiles.display_handle_mode (the field comment rendering actually uses)
  -- in step with the user-facing setting. Only ever switch to 'username' when one exists,
  -- otherwise the user would render as a blank handle.
  if p_display_mode is not null then
    select (username is not null and length(trim(username)) > 0)
      into v_has_username
      from public.profiles where user_id = v_uid;

    update public.profiles
       set display_handle_mode =
             case when p_display_mode = 'username' and coalesce(v_has_username, false)
                  then 'username'::public.display_handle_mode_enum
                  else 'random_id'::public.display_handle_mode_enum
             end
     where user_id = v_uid;
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.update_my_privacy_settings(text, text, text, text, boolean) from public, anon;
grant execute on function public.update_my_privacy_settings(text, text, text, text, boolean) to authenticated, service_role;
