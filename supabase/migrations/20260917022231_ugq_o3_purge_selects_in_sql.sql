-- UGQ-O3: the orphan set is now chosen HERE, in SQL, against storage.objects.
--
-- v1 let the edge function discover objects via the Storage list API. That API
-- is not recursive, and these objects live at <user_id>/<uuid>.webm, so it
-- returned four top-level FOLDERS, matched none against a claimed path, and
-- reported "4 orphans / 0 claimed" for a bucket holding 56 objects of which 10
-- are in use. Passing those folder names to the delete endpoint as prefixes
-- could have destroyed the lot. Only the dry-run default stopped it.
--
-- storage.objects is the authoritative listing and joins cleanly:
-- voice_recording_path is byte-identical to storage.objects.name.
-- The edge function still re-checks every path it is handed.

create or replace function admin.list_orphaned_voice_recordings(
  p_min_age_hours integer default 24)
returns table (path text, created_at timestamptz, size_bytes bigint)
language sql
stable
security definer
set search_path = admin, public, storage
as $$
  select o.name,
         o.created_at,
         coalesce((o.metadata->>'size')::bigint, 0)
  from storage.objects o
  where o.bucket_id = 'ugq-voice-recordings'
    -- never touch something still being worked on
    and o.created_at < now() - make_interval(hours => greatest(p_min_age_hours, 1))
    and not exists (
      select 1 from public.user_question_proposals p
      where p.voice_recording_path = o.name
    )
  order by o.created_at;
$$;

revoke all on function admin.list_orphaned_voice_recordings(integer) from public, anon;
grant execute on function admin.list_orphaned_voice_recordings(integer) to service_role;

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
  v_paths      text[];
  v_total      integer;
  r            extensions.http_response;
  v_body       jsonb;
begin
  perform public._ensure_admin_or_service();

  if base_url is null or service_role is null or secret is null then
    raise exception 'Missing secret: SUPABASE_URL/SERVICE_ROLE_KEY/CRON_SECRET present = %/%/%',
      base_url is not null, service_role is not null, secret is not null;
  end if;

  select coalesce(array_agg(path order by created_at), '{}')
    into v_paths
  from admin.list_orphaned_voice_recordings(p_min_age_hours);

  select count(*) into v_total from storage.objects where bucket_id = 'ugq-voice-recordings';

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'bucket_total', v_total,
      'orphaned', coalesce(array_length(v_paths, 1), 0),
      'would_keep', v_total - coalesce(array_length(v_paths, 1), 0),
      'sample', to_jsonb((select array_agg(p) from (select unnest(v_paths) as p limit 5) s))
    );
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

  begin
    v_body := r.content::jsonb;
  exception when others then
    v_body := jsonb_build_object('raw', left(coalesce(r.content::text, ''), 1000));
  end;

  insert into admin.cron_runs(job, finished_at, ok, http_status, message)
  values ('purge_orphaned_media', now(), (r.status = 200), r.status,
          left(coalesce(r.content::text, ''), 2000));

  return jsonb_build_object('http_status', r.status,
                            'bucket_total_before', v_total,
                            'result', v_body);
end;
$$;

revoke all on function admin.run_purge_orphaned_media(boolean, integer) from public, anon;
grant execute on function admin.run_purge_orphaned_media(boolean, integer) to service_role;
