-- The /empty endpoint only QUEUES the work ("may take up to an hour"), so the
-- bucket delete that followed it failed with ResourceNotEmpty. Deleting the
-- objects explicitly by name is synchronous, so the bucket is actually empty
-- by the time we try to remove it.

create or replace function admin.retire_raw_video_bucket()
returns jsonb
language plpgsql
security definer
set search_path = admin, public, extensions
as $$
declare
  base_url     text := private.get_secret('SUPABASE_URL');
  service_role text := private.get_secret('SERVICE_ROLE_KEY');
  v_paths      text[];
  v_before     integer;
  r_objects    extensions.http_response;
  r_delete     extensions.http_response;
begin
  perform public._ensure_admin_or_service();

  select coalesce(array_agg(name), '{}'), count(*)
    into v_paths, v_before
  from storage.objects where bucket_id = 'ugq-video-recordings-raw';

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');

  if coalesce(array_length(v_paths, 1), 0) > 0 then
    r_objects := extensions.http((
      'DELETE',
      base_url || '/storage/v1/object/ugq-video-recordings-raw',
      ARRAY[
        extensions.http_header('authorization', 'Bearer ' || service_role),
        extensions.http_header('apikey', service_role),
        extensions.http_header('content-type', 'application/json')
      ],
      'application/json',
      jsonb_build_object('prefixes', to_jsonb(v_paths))::text
    ));
  end if;

  r_delete := extensions.http((
    'DELETE',
    base_url || '/storage/v1/bucket/ugq-video-recordings-raw',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || service_role),
      extensions.http_header('apikey', service_role)
    ],
    'application/json',
    '{}'
  ));

  return jsonb_build_object(
    'objects_before',  v_before,
    'objects_status',  coalesce(r_objects.status, 0),
    'objects_body',    left(coalesce(r_objects.content::text, '(none to delete)'), 300),
    'bucket_status',   r_delete.status,
    'bucket_body',     left(coalesce(r_delete.content::text, ''), 300),
    'objects_after',   (select count(*) from storage.objects where bucket_id = 'ugq-video-recordings-raw'),
    'bucket_exists',   exists (select 1 from storage.buckets where id = 'ugq-video-recordings-raw')
  );
end;
$$;

revoke all on function admin.retire_raw_video_bucket() from public, anon;
grant execute on function admin.retire_raw_video_bucket() to service_role;
