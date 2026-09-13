-- =============================================================================================
-- Epic I - PROD execution test.  NOT A MIGRATION. Safe to re-run. Creates no data.
--
-- Run AFTER applying 20260913152914 (I-09).
--   supabase db execute --project-ref yzxzpnomcarnxixhjlba --file supabase/migrations/_manual/epic_i_prod_execution_test.sql
--
-- What it does: invokes all five notification Edge Functions with the service-role credential
-- read from the vault (the credential never leaves the database), records the HTTP status and
-- body for each, and reports whether any user_notifications row was created.
--
-- EXPECTED RESULT AT CURRENT PROD DATA VOLUMES: every function returns HTTP 200, and the
-- notification delta is 0. Prod has 0 qualifying stance shifts, 0 follows, 0 surging topics,
-- 0 recent context updates and 0 topic_regions, so there is genuinely nothing to notify about.
-- A 200 with zero output is the PASS condition here - it proves auth, routing and the job
-- bodies all work, without generating content for the 8 real users.
--
-- If you see HTTP 500 with PGRST200 -> the I-01 fix did not deploy; redeploy that function.
-- If you see HTTP 401 -> the credential or verify_jwt handling is wrong; do NOT set
--    verify_jwt=false to "fix" it, that breaks the H-04b guard.
-- If you see a transient HTTP 504 -> infrastructure noise, re-run once before concluding.
--    (Expect these for ~2 minutes right after the I-09 migration, while PostgREST reloads
--     its schema cache.)
--
-- The whole block ends in RAISE EXCEPTION so nothing it touches is committed; the Edge
-- Functions run out-of-process, so anything THEY write does persist - hence the delta check.
-- =============================================================================================
do $prod_exec_test$
declare
  v_key   text;
  v_url   text;
  r       extensions.http_response;
  out     text := '';
  f       text;
  fns     text[] := array[
            'notify-weekly-digest',
            'notify-stance-changes',
            'notify-topic-follows',
            'notify-reminders',
            'notify-new-local-topics'];
  n_before int;
  n_after  int;
  e_before int;
  e_after  int;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets
    where name in ('service_role_key','SERVICE_ROLE_KEY') order by name limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name in ('project_url','PROJECT_URL') order by name limit 1;
  if v_url is null then v_url := 'https://yzxzpnomcarnxixhjlba.supabase.co'; end if;
  if v_key is null then raise exception 'No service_role key in vault - cannot run the test.'; end if;

  select count(*) into n_before from public.user_notifications;
  select count(*) into e_before from public.notification_event_log;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '150000');

  foreach f in array fns loop
    begin
      select * into r from extensions.http((
        'POST',
        rtrim(v_url,'/') || '/functions/v1/' || f,
        ARRAY[
          extensions.http_header('authorization', 'Bearer ' || v_key),
          extensions.http_header('apikey', v_key),
          extensions.http_header('content-type', 'application/json')
        ]::extensions.http_header[],
        'application/json',
        '{}'::text));
      out := out || rpad(f, 26) || ' HTTP ' || (r).status || '  '
                 || left(coalesce((r).content::text,''), 110) || E'\n';
    exception when others then
      out := out || rpad(f, 26) || ' EXCEPTION ' || sqlerrm || E'\n';
    end;
  end loop;

  select count(*) into n_after from public.user_notifications;
  select count(*) into e_after from public.notification_event_log;

  raise exception E'\n===== Epic I PROD execution test =====\n%\nuser_notifications: % -> % (delta %)\nnotification_event_log: % -> % (delta %)\nEpic I notifications now: %\n\nPASS = every line HTTP 200. Deltas of 0 are expected at current Prod data volumes.',
    out,
    n_before, n_after, n_after - n_before,
    e_before, e_after, e_after - e_before,
    (select count(*) from public.user_notifications
      where notification_type in ('stance_change','weekly_digest','topic_follow','reminder','new_local_topic'));
end
$prod_exec_test$;
