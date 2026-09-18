-- UGQ-O3: invoker for the orphaned-media reaper.
--
-- Same shape as admin.cron_generate_renditions: secrets come from
-- private.get_secret so they are never written into a function body, a cron
-- job command, or a migration file.
--
-- Deliberately DRY RUN by default. A sweeper that deletes user media should
-- have to be asked twice: once to see what it would remove, once to remove it.

create or replace function admin.run_purge_orphaned_media(
  p_dry_run boolean default true,
  p_min_age_hours integer default 24)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, extensions
as $$
declare
  base_url     text := private.get_secret('project_url');
  service_role text := private.get_secret('service_role_key');
  secret       text := private.get_secret('cron_secret');
  r            extensions.http_response;
  v_body       jsonb;
begin
  perform public._ensure_admin_or_service();

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
  r := extensions.http((
    'POST',
    base_url || '/functions/v1/ugq-purge-orphaned-media',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || service_role),
      extensions.http_header('apikey', service_role),
      extensions.http_header('x-cron-secret', secret),
      extensions.http_header('content-type', 'application/json')
    ],
    'application/json',
    jsonb_build_object('dry_run', p_dry_run, 'min_age_hours', p_min_age_hours)::text
  ));

  begin
    v_body := r.content::jsonb;
  exception when others then
    v_body := jsonb_build_object('raw', left(coalesce(r.content::text, ''), 1000));
  end;

  insert into admin.cron_runs(job, finished_at, ok, http_status, message)
  values ('purge_orphaned_media', now(), (r.status = 200), r.status,
          left(coalesce(r.content::text, ''), 2000));

  return jsonb_build_object('http_status', r.status, 'result', v_body);
end;
$$;

revoke all on function admin.run_purge_orphaned_media(boolean, integer) from public, anon;
grant execute on function admin.run_purge_orphaned_media(boolean, integer) to service_role;
