CREATE OR REPLACE FUNCTION public.bootstrap_user_after_login()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid         uuid := auth.uid();
  v_email       text;
  v_old_id      uuid;
  v_is_new_user boolean;
  r             record;

  v_meta                     jsonb;
  v_username                 text;
  v_dob                      text;
  v_gender                   text;
  v_gender_self              text;
  v_country                  text;
  v_state_code               text;
  v_county_code              text;
  v_city_id                  uuid;
  v_campaign_audience        text;
  v_entry_path               text;
  v_preferred_language_code  text;
  v_location_override        boolean;
  v_dob_age_band             int;
  v_loc_id                   uuid;
  v_loc_precision            public.precision_enum;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(email), raw_user_meta_data
    into v_email, v_meta
  from auth.users where id = v_uid;

  if v_email is null then
    raise exception 'Email not found for user %', v_uid;
  end if;

  select id into v_old_id
  from public.users
  where email = v_email and id <> v_uid
  limit 1;

  if v_old_id is not null then
    for r in
      select tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.table_schema   = tc.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and ccu.table_schema = 'public'
        and ccu.table_name   = 'users'
        and ccu.column_name  = 'id'
    loop
      execute format(
        'update public.%I set %I = $1 where %I = $2',
        r.table_name, r.column_name, r.column_name
      ) using v_uid, v_old_id;
    end loop;

    delete from public.users where id = v_old_id;
  end if;

  insert into public.users (id, email, status, created_at, last_seen_at)
  values (v_uid, v_email, 'active'::public.user_status_enum, now(), now())
  on conflict (id) do update
    set email        = excluded.email,
        last_seen_at = now()
  returning (xmax = 0) into v_is_new_user;

  insert into public.profiles (user_id, random_id, display_handle_mode)
  values (v_uid, public.generate_random_id(), 'random_id'::public.display_handle_mode_enum)
  on conflict (user_id) do nothing;

  if v_is_new_user and v_meta is not null then
    begin
      v_username          := nullif(btrim(v_meta->>'username'), '');
      v_dob                := nullif(btrim(v_meta->>'dob'), '');
      v_gender             := nullif(btrim(v_meta->>'gender'), '');
      v_gender_self        := nullif(btrim(v_meta->>'gender_self'), '');
      v_country            := nullif(btrim(v_meta->>'country'), '');
      v_state_code         := nullif(btrim(v_meta->>'state_code'), '');
      v_county_code        := nullif(btrim(v_meta->>'county_code'), '');
      v_campaign_audience  := nullif(btrim(v_meta->>'campaign_audience'), '');
      v_entry_path         := nullif(btrim(v_meta->>'entry_path'), '');
      v_preferred_language_code := nullif(btrim(v_meta->>'preferred_language_code'), '');
      v_location_override := coalesce((v_meta->>'location_override')::boolean, false);

      begin
        v_city_id := nullif(v_meta->>'city_id', '')::uuid;
      exception when others then
        v_city_id := null;
      end;

      if v_username is not null then
        begin
          perform public.set_username(v_username);
        exception when others then
          raise notice 'bootstrap: set_username failed for %: %', v_uid, sqlerrm;
        end;
      end if;

      if v_dob is not null then
        begin
          perform public.profile_set_dob_checked(v_dob);
          v_dob_age_band := extract(year from age(current_date, v_dob::date))::int;
          if v_dob_age_band < 0 or v_dob_age_band > 149 then
            v_dob_age_band := null;
          end if;
        exception when others then
          raise notice 'bootstrap: profile_set_dob_checked failed for %: %', v_uid, sqlerrm;
        end;
      end if;

      if v_gender is not null then
        begin
          perform public.profile_set_gender(v_gender, v_gender_self);
        exception when others then
          raise notice 'bootstrap: profile_set_gender failed for %: %', v_uid, sqlerrm;
        end;
      end if;

      if v_preferred_language_code is not null then
        begin
          update public.profiles
             set preferred_language_code = v_preferred_language_code
           where user_id = v_uid
             and exists (
               select 1 from public.languages l
               where l.language_code = v_preferred_language_code
                 and l.is_active_for_ui = true
             );
        exception when others then
          raise notice 'bootstrap: preferred_language_code update failed for %: %', v_uid, sqlerrm;
        end;
      end if;

      begin
        select rl.location_id, rl.loc_precision
          into v_loc_id, v_loc_precision
        from public.resolve_location_from_codes(v_country, v_state_code, v_county_code, v_city_id) rl;

        if v_loc_id is not null then
          perform public.set_user_location_cascade(
            v_uid, v_loc_id, v_loc_precision, v_location_override,
            case when v_location_override then 'signup_ip_override' else 'signup' end
          );
        else
          raise notice 'bootstrap: no location match at any tier for user % (country=%, state=%, county=%, city=%)',
            v_uid, v_country, v_state_code, v_county_code, v_city_id;
        end if;
      exception when others then
        raise notice 'bootstrap: location resolution/cascade failed for %: %', v_uid, sqlerrm;
      end;

      begin
        perform public.initialize_user_context_from_signup(
          v_email, v_dob_age_band, v_entry_path, v_campaign_audience, null
        );
      exception when others then
        raise notice 'bootstrap: initialize_user_context_from_signup failed for %: %', v_uid, sqlerrm;
      end;
    exception when others then
      raise notice 'bootstrap: signup metadata block failed unexpectedly for %: %', v_uid, sqlerrm;
    end;
  end if;
end;
$function$;
;
