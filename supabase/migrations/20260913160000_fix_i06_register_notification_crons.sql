-- Epic I defect I-06 (P1): register the five notification Edge Functions with pg_cron.
--
-- ============================================================================================
-- NOT YET APPLIED TO ANY ENVIRONMENT. Run this by hand (Supabase SQL editor, or
--   supabase db execute --project-ref <ref> --file <this file>)
-- against Dev (essnvhvezxjcoqxvuxuq) and UAT (kodyqyqcuzmygtbzpebt).
-- Claude's tooling could not apply it: the permission classifier blocks migrations that read
-- the service-role credential, which this function must do in order to call the functions.
-- ============================================================================================
--
-- None of the five jobs was registered with any scheduler, so every cadence in the Epic I
-- document was aspirational - they only ran when invoked by hand. This follows the existing
-- admin.cron_* pattern and uses private.get_secret() exactly as admin.cron_generate_renditions
-- does, so the credential stays inside the database rather than sitting as a static secret in
-- cron.job command text (see the H-04b note in the function sources).
--
-- I-12 (P1), found while scheduling: notify-weekly-digest only emits for users whose LOCAL time
-- is within DIGEST_WINDOW_MINUTES (default 30) of their digest_hour_local. A once-daily run at a
-- fixed UTC hour can therefore only reach users whose (tz offset + digest_hour_local) lands on
-- that single UTC hour. An America/New_York user would have to set digest_hour_local = 4 to get
-- anything from the documented 08:00 UTC run - and the column default is 9. The documented
-- cadence would silently deliver nothing to almost every user. It is scheduled HOURLY here,
-- which is what makes the per-user local window work.
--
-- Repeating the digest hourly is safe: weekly_digests is unique on
-- (user_id, week_start, week_end) and the insert now names that constraint (I-11), and an empty
-- digest no longer burns the dedup key (I-07).
--
-- AFTER RUNNING, verify with:
--   select jobname, schedule, active from cron.job where jobname like 'notify-%' order by jobname;
--   select job, ok, http_status, left(message,120), finished_at
--     from admin.cron_runs where job like 'notify%' order by finished_at desc limit 20;

create or replace function admin.cron_invoke_notification(p_slug text, p_job text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'admin', 'private', 'pg_temp'
 set statement_timeout to '240s'
as $fn$
declare
  lock_key bigint := hashtext('admin.cron_invoke_notification:' || p_slug);
  got_lock boolean;
  v_key    text;
  v_url    text;
  r        extensions.http_response;
  v_status int;
  v_body   text;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message, finished_at)
    values (p_job, true, 'skipped: lock busy', now());
    return;
  end if;

  begin
    v_key := coalesce(private.get_secret('SERVICE_ROLE_KEY'), private.get_secret('service_role_key'));
    v_url := coalesce(private.get_secret('PROJECT_URL'),      private.get_secret('SUPABASE_URL'));

    if v_url is null then
      v_url := 'https://' || current_setting('app.settings.project_ref', true) || '.supabase.co';
    end if;

    if v_key is null then
      insert into admin.cron_runs(job, finished_at, ok, message)
      values (p_job, now(), false, 'no service_role key available');
      perform pg_advisory_unlock(lock_key);
      return;
    end if;

    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '180000');

    select * into r from extensions.http((
      'POST',
      rtrim(v_url, '/') || '/functions/v1/' || p_slug,
      ARRAY[
        extensions.http_header('authorization', 'Bearer ' || v_key),
        extensions.http_header('apikey', v_key),
        extensions.http_header('content-type', 'application/json')
      ]::extensions.http_header[],
      'application/json',
      '{}'::text
    ));

    v_status := (r).status;
    v_body   := left(coalesce((r).content::text, ''), 2000);

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values (p_job, now(), (v_status = 200), v_status, v_body);

    if v_status <> 200 then
      raise warning '% non-200: % %', p_job, v_status, left(v_body, 200);
    end if;

  exception when others then
    -- A failing notification job must never abort the cron worker.
    insert into admin.cron_runs(job, finished_at, ok, message)
    values (p_job, now(), false, sqlerrm);
  end;

  perform pg_advisory_unlock(lock_key);
end;
$fn$;

revoke all on function admin.cron_invoke_notification(text, text) from public, anon, authenticated;

-- I-12: hourly, so every user's local digest window is reached once per day.
select cron.schedule('notify-weekly-digest-hourly', '0 * * * *',
  $$select admin.cron_invoke_notification('notify-weekly-digest','notify_weekly_digest')$$);

select cron.schedule('notify-stance-changes-daily', '30 8 * * *',
  $$select admin.cron_invoke_notification('notify-stance-changes','notify_stance_changes')$$);

select cron.schedule('notify-topic-follows-4h', '0 */4 * * *',
  $$select admin.cron_invoke_notification('notify-topic-follows','notify_topic_follows')$$);

select cron.schedule('notify-reminders-daily', '0 7 * * *',
  $$select admin.cron_invoke_notification('notify-reminders','notify_reminders')$$);

-- offset from the existing feed-hygiene-6h job so the two do not start together
select cron.schedule('notify-new-local-topics-6h', '15 */6 * * *',
  $$select admin.cron_invoke_notification('notify-new-local-topics','notify_new_local_topics')$$);
