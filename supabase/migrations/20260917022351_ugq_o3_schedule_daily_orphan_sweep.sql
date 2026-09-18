-- UGQ-O3: schedule the sweep so the leak stays closed.
--
-- One purge fixes today. Orphans accrue every time someone records and does not
-- submit, so without a schedule this is back to 46 in a few weeks.
--
-- admin.run_purge_orphaned_media keeps its _ensure_admin_or_service guard for
-- human callers. pg_cron runs as postgres, which is neither an admin row nor
-- auth.role()='service_role', so it gets its own entry point in the admin
-- schema -- the same arrangement as admin.cron_generate_renditions. The admin
-- schema is not exposed over PostgREST, so this is not reachable from outside.

create or replace function admin.cron_purge_orphaned_media()
returns void
language plpgsql
security definer
set search_path = admin, public, extensions
as $$
declare
  base_url     text := private.get_secret('SUPABASE_URL');
  service_role text := private.get_secret('SERVICE_ROLE_KEY');
  secret       text := private.get_secret('CRON_SECRET');
  v_paths      text[];
  r            extensions.http_response;
begin
  select coalesce(array_agg(path order by created_at), '{}')
    into v_paths
  from admin.list_orphaned_voice_recordings(24);

  if coalesce(array_length(v_paths, 1), 0) = 0 then
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('purge_orphaned_media', now(), true, 'nothing orphaned');
    return;
  end if;

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
    jsonb_build_object('dry_run', false, 'paths', to_jsonb(v_paths))::text
  ));

  insert into admin.cron_runs(job, finished_at, ok, http_status, message)
  values ('purge_orphaned_media', now(), (r.status = 200), r.status,
          left(coalesce(r.content::text, ''), 2000));

exception when others then
  insert into admin.cron_runs(job, finished_at, ok, message)
  values ('purge_orphaned_media', now(), false, sqlerrm);
end;
$$;

-- 03:40 UTC: off the hour, and clear of the notification crons at 06:00.
do $$
begin
  perform cron.unschedule('ugq_purge_orphaned_media');
exception when others then null;
end $$;

select cron.schedule(
  'ugq_purge_orphaned_media',
  '40 3 * * *',
  $cron$select admin.cron_purge_orphaned_media();$cron$
);

do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'ugq_purge_orphaned_media' and active;
  if n <> 1 then
    raise exception 'UGQ-O3: expected the sweep to be scheduled and active, found % job(s)', n;
  end if;
end $$;
