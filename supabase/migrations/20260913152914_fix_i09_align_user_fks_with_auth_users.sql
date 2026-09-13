-- Epic I defect I-09 (P1) - ROOT CAUSE fix.
--
-- Symptom: notify-new-local-topics aborted its entire run on a single FK violation. Per-user
-- isolation (shipped in 04e3602) stops one bad row killing a run, but the bad rows should not
-- exist in the first place.
--
-- Chain: public.users had NO foreign key back to auth.users (only a PK on id and a unique on
-- email), and no trigger kept the two in step. Deleting a user from auth.users therefore left
-- the public.users row behind, which in turn kept user_location_settings alive - that table
-- references public.users, not auth.users. Those stale location rows then fed
-- notify-new-local-topics, which writes user_notifications (FK -> auth.users), raising 23503.
--
-- Only 2 of the 8 notification-related tables referenced public.users
-- (user_location_settings, notification_topic_prefs); the other 6 referenced auth.users.
--
-- Three changes, in dependency order:
--   1. remove the orphaned public.users rows (they cascade their user_location_settings rows);
--   2. repoint the two odd-one-out FKs at auth.users so all 8 agree;
--   3. add the missing public.users.id -> auth.users(id) ON DELETE CASCADE so the class of
--      orphan cannot recur.
--
-- NOTE ON BLAST RADIUS: step 3 means deleting an auth.users row now cascades through
-- public.users into the 16 tables that reference it (15 CASCADE, 1 SET NULL on
-- ingested_stances.attributed_user_id). That is the intended account-deletion semantic and
-- already applies to the 6 notification tables wired directly to auth.users, but it is a real
-- behavioural change beyond Epic I.
--
-- OPERATIONAL NOTE: altering these constraints makes PostgREST reload its schema cache. On Dev
-- that produced ~2 minutes of intermittent HTTP 504s on /rest/v1 before settling. Expect the
-- same window on any environment this is applied to, and do not read those 504s as a defect.
--
-- Applied: Dev 20260913152914, UAT 20260913153201.
--   Dev removed 4 orphans (public.users 17 -> 13, user_location_settings 25 -> 21).
--   UAT had 0 orphans, so the cleanup was a no-op there (7 public.users vs 8 auth.users - the
--   asymmetry runs the other way, which the FK direction permits).

-- 1. Orphan cleanup. Guarded: only rows with no auth.users match are touched, and the guard
--    reports what it removed so the migration is self-documenting in the log.
do $cleanup$
declare v_orphans int;
begin
  select count(*) into v_orphans
  from public.users pu
  where not exists (select 1 from auth.users au where au.id = pu.id);

  raise notice 'I-09: removing % orphaned public.users row(s)', v_orphans;

  delete from public.users pu
  where not exists (select 1 from auth.users au where au.id = pu.id);
end;
$cleanup$;

-- Safety: refuse to continue if any child row would violate the new constraints.
do $guard$
declare v_bad int;
begin
  select count(*) into v_bad from public.user_location_settings uls
   where not exists (select 1 from auth.users au where au.id = uls.user_id);
  if v_bad > 0 then
    raise exception 'I-09 abort: % user_location_settings row(s) still have no auth.users match', v_bad;
  end if;

  select count(*) into v_bad from public.notification_topic_prefs ntp
   where not exists (select 1 from auth.users au where au.id = ntp.user_id);
  if v_bad > 0 then
    raise exception 'I-09 abort: % notification_topic_prefs row(s) still have no auth.users match', v_bad;
  end if;

  select count(*) into v_bad from public.users pu
   where not exists (select 1 from auth.users au where au.id = pu.id);
  if v_bad > 0 then
    raise exception 'I-09 abort: % public.users row(s) still have no auth.users match', v_bad;
  end if;
end;
$guard$;

-- 2. Repoint the two odd-one-out notification FKs at auth.users.
alter table public.user_location_settings
  drop constraint user_location_settings_user_id_fkey,
  add  constraint user_location_settings_user_id_fkey
       foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.notification_topic_prefs
  drop constraint notification_topic_prefs_user_id_fkey,
  add  constraint notification_topic_prefs_user_id_fkey
       foreign key (user_id) references auth.users(id) on delete cascade;

-- 3. The missing parent link, so orphans cannot be created again.
alter table public.users
  add constraint users_id_auth_users_fkey
      foreign key (id) references auth.users(id) on delete cascade;
