-- The previous migration called try_cast_jsonb(), which does not exist in this
-- database. plpgsql resolves function names at RUN time, so it was created
-- without complaint and would have thrown on the first real purge -- the same
-- trap that hid a profiles.id typo earlier in this epic. Replaced with an
-- explicit exception block, which is what the rest of this file already uses.

create or replace function admin.run_purge_orphaned_media(
  p_dry_run boolean default true,
  p_min_age_hours integer default 24,
  p_bucket text default null)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, extensions
as $$
declare
  base_url     text := private.get_secret('SUPABASE_URL');
  service_role text := private.get_secret('SERVICE_ROLE_KEY');
  secret       text := private.get_secret('CRON_SECRET');
  v_buckets    text[] := case when p_bucket is null
                          then array['ugq-voice-recordings','ugq-video-recordings']
                          else array[p_bucket] end;
  b            text;
  v_paths      text[];
  v_total      integer;
  r            extensions.http_response;
  v_res        jsonb;
  v_out        jsonb := '[]'::jsonb;
begin
  perform public._ensure_admin_or_service();

  if base_url is null or service_role is null or secret is null then
    raise exception 'Missing secret: SUPABASE_URL/SERVICE_ROLE_KEY/CRON_SECRET present = %/%/%',
      base_url is not null, service_role is not null, secret is not null;
  end if;

  foreach b in array v_buckets loop
    select coalesce(array_agg(path order by created_at), '{}') into v_paths
    from admin.list_orphaned_ugq_media(b, p_min_age_hours);

    select count(*) into v_total from storage.objects where bucket_id = b;

    if p_dry_run then
      v_out := v_out || jsonb_build_object(
        'bucket', b, 'dry_run', true, 'bucket_total', v_total,
        'orphaned', coalesce(array_length(v_paths, 1), 0),
        'would_keep', v_total - coalesce(array_length(v_paths, 1), 0));
      continue;
    end if;

    if coalesce(array_length(v_paths, 1), 0) = 0 then
      v_out := v_out || jsonb_build_object('bucket', b, 'orphaned', 0, 'deleted', 0);
      continue;
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
      jsonb_build_object('dry_run', false, 'bucket', b, 'paths', to_jsonb(v_paths))::text
    ));

    begin
      v_res := r.content::jsonb;
    exception when others then
      v_res := jsonb_build_object('raw', left(coalesce(r.content::text, ''), 500));
    end;

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values ('purge_orphaned_media', now(), (r.status = 200), r.status,
            b || ': ' || left(coalesce(r.content::text, ''), 1500));

    v_out := v_out || jsonb_build_object('bucket', b, 'http_status', r.status, 'result', v_res);
  end loop;

  return v_out;
end;
$$;

revoke all on function admin.run_purge_orphaned_media(boolean, integer, text) from public, anon;
grant execute on function admin.run_purge_orphaned_media(boolean, integer, text) to service_role;

-- The cron entry point sweeps both buckets too.
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
  b            text;
  v_paths      text[];
  r            extensions.http_response;
begin
  foreach b in array array['ugq-voice-recordings','ugq-video-recordings'] loop
    select coalesce(array_agg(path order by created_at), '{}') into v_paths
    from admin.list_orphaned_ugq_media(b, 24);

    if coalesce(array_length(v_paths, 1), 0) = 0 then
      insert into admin.cron_runs(job, finished_at, ok, message)
      values ('purge_orphaned_media', now(), true, b || ': nothing orphaned');
      continue;
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
      jsonb_build_object('dry_run', false, 'bucket', b, 'paths', to_jsonb(v_paths))::text
    ));

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values ('purge_orphaned_media', now(), (r.status = 200), r.status,
            b || ': ' || left(coalesce(r.content::text, ''), 1500));
  end loop;

exception when others then
  insert into admin.cron_runs(job, finished_at, ok, message)
  values ('purge_orphaned_media', now(), false, sqlerrm);
end;
$$;
