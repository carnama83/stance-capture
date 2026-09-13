-- Epic I defect I-02 (P0)
-- SettingsNotifications sends -1 to mean "clear quiet hours". The -1 sentinel was handled
-- only in the ON CONFLICT DO UPDATE branch, but Postgres evaluates CHECK constraints on the
-- PROPOSED INSERT ROW before it detects the conflict -- so quiet_hours_start/end = -1 raised
-- 23514 on BOTH the first-save and the update path, making the sentinel unreachable.
-- Fix: coerce -1 to NULL in the INSERT values list too. The DO UPDATE branch is unchanged.
CREATE OR REPLACE FUNCTION public.upsert_my_notification_preferences(
  p_stance_change_enabled boolean DEFAULT NULL::boolean,
  p_weekly_digest_enabled boolean DEFAULT NULL::boolean,
  p_topic_follow_enabled boolean DEFAULT NULL::boolean,
  p_digest_day_of_week integer DEFAULT NULL::integer,
  p_digest_hour_local integer DEFAULT NULL::integer,
  p_timezone text DEFAULT NULL::text,
  p_email_enabled boolean DEFAULT NULL::boolean,
  p_inapp_enabled boolean DEFAULT NULL::boolean,
  p_digest_frequency text DEFAULT NULL::text,
  p_quiet_hours_start integer DEFAULT NULL::integer,
  p_quiet_hours_end integer DEFAULT NULL::integer,
  p_reminder_enabled boolean DEFAULT NULL::boolean,
  p_new_local_topic_enabled boolean DEFAULT NULL::boolean)
 RETURNS notification_preferences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notification_preferences (
    user_id,
    stance_change_enabled,
    weekly_digest_enabled,
    topic_follow_enabled,
    digest_day_of_week,
    digest_hour_local,
    timezone,
    email_enabled,
    inapp_enabled,
    digest_frequency,
    quiet_hours_start,
    quiet_hours_end,
    reminder_enabled,
    new_local_topic_enabled
  )
  values (
    auth.uid(),
    coalesce(p_stance_change_enabled,   true),
    coalesce(p_weekly_digest_enabled,   true),
    coalesce(p_topic_follow_enabled,    true),
    coalesce(p_digest_day_of_week,      1),
    coalesce(p_digest_hour_local,       9),
    coalesce(p_timezone,                'America/New_York'),
    coalesce(p_email_enabled,           false),
    coalesce(p_inapp_enabled,           true),
    coalesce(p_digest_frequency,        'weekly'),
    -- I-02: -1 means "no quiet hours"; null also means "no quiet hours" on a first insert.
    nullif(p_quiet_hours_start, -1),
    nullif(p_quiet_hours_end,   -1),
    coalesce(p_reminder_enabled,        true),
    coalesce(p_new_local_topic_enabled, true)
  )
  on conflict (user_id)
  do update set
    stance_change_enabled   = coalesce(p_stance_change_enabled,   notification_preferences.stance_change_enabled),
    weekly_digest_enabled   = coalesce(p_weekly_digest_enabled,   notification_preferences.weekly_digest_enabled),
    topic_follow_enabled    = coalesce(p_topic_follow_enabled,    notification_preferences.topic_follow_enabled),
    digest_day_of_week      = coalesce(p_digest_day_of_week,      notification_preferences.digest_day_of_week),
    digest_hour_local       = coalesce(p_digest_hour_local,       notification_preferences.digest_hour_local),
    timezone                = coalesce(p_timezone,                notification_preferences.timezone),
    email_enabled           = coalesce(p_email_enabled,           notification_preferences.email_enabled),
    inapp_enabled           = coalesce(p_inapp_enabled,           notification_preferences.inapp_enabled),
    digest_frequency        = coalesce(p_digest_frequency,        notification_preferences.digest_frequency),
    -- quiet hours: pass -1 to explicitly clear, null to leave unchanged
    quiet_hours_start       = case
                                when p_quiet_hours_start = -1 then null
                                when p_quiet_hours_start is null then notification_preferences.quiet_hours_start
                                else p_quiet_hours_start
                              end,
    quiet_hours_end         = case
                                when p_quiet_hours_end = -1 then null
                                when p_quiet_hours_end is null then notification_preferences.quiet_hours_end
                                else p_quiet_hours_end
                              end,
    reminder_enabled        = coalesce(p_reminder_enabled,        notification_preferences.reminder_enabled),
    new_local_topic_enabled = coalesce(p_new_local_topic_enabled, notification_preferences.new_local_topic_enabled),
    updated_at              = now();

  return (
    select np from public.notification_preferences np
    where np.user_id = auth.uid()
  );
end;
$function$;
