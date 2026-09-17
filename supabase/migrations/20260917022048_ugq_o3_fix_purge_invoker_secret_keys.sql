-- The first cut guessed the secret key names (project_url / service_role_key /
-- cron_secret) and got NULLs, which surfaced as "http_request.uri is NULL"
-- rather than anything mentioning secrets. The actual keys in private.secrets
-- are SUPABASE_URL / SERVICE_ROLE_KEY / CRON_SECRET.

create or replace function admin.run_purge_orphaned_media(
  p_dry_run boolean default true,
  p_min_age_hours integer default 24)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, extensions
as $$
declare
  base_url     text := private.get_secret('SUPABASE_URL');
  service_role text := private.get_secret('SERVICE_ROLE_KEY');
  secret       text := private.get_secret('CRON_SECRET');
  r            extensions.http_response;
  v_body       jsonb;
begin
  perform public._ensure_admin_or_service();

  if base_url is null or service_role is null or secret is null then
    raise exception 'Missing secret: SUPABASE_URL/SERVICE_ROLE_KEY/CRON_SECRET present = %/%/%',
      base_url is not null, service_role is not null, secret is not null;
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
