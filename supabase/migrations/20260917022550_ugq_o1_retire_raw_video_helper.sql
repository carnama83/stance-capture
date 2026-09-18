-- UGQ-O1: one-shot helper to retire the rolled-back anonymous-video residue.
--
-- The anonymous-video pipeline (client-side avatar/voice disguise) was removed
-- as unreliable. It left behind admin-ugq-raw-video-url with no caller and the
-- ugq-video-recordings-raw bucket holding UNMASKED camera footage -- the exact
-- recordings the feature existed to avoid ever storing. Retiring it was blocked
-- on a product decision, which has now been given: retire fully.
--
-- Goes through the Storage API rather than deleting storage.objects rows, so
-- the underlying blobs actually go rather than being stranded in S3.
--
-- Dropped again at the end of the retirement; it exists only to run once.

create or replace function admin.retire_raw_video_bucket()
returns jsonb
language plpgsql
security definer
set search_path = admin, public, extensions
as $$
declare
  base_url     text := private.get_secret('SUPABASE_URL');
  service_role text := private.get_secret('SERVICE_ROLE_KEY');
  v_before     integer;
  r_empty      extensions.http_response;
  r_delete     extensions.http_response;
begin
  perform public._ensure_admin_or_service();

  select count(*) into v_before from storage.objects
   where bucket_id = 'ugq-video-recordings-raw';

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');

  r_empty := extensions.http((
    'POST',
    base_url || '/storage/v1/bucket/ugq-video-recordings-raw/empty',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || service_role),
      extensions.http_header('apikey', service_role),
      extensions.http_header('content-type', 'application/json')
    ],
    'application/json',
    '{}'
  ));

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
    'objects_before', v_before,
    'empty_status',  r_empty.status,
    'empty_body',    left(coalesce(r_empty.content::text, ''), 300),
    'delete_status', r_delete.status,
    'delete_body',   left(coalesce(r_delete.content::text, ''), 300),
    'objects_after', (select count(*) from storage.objects where bucket_id = 'ugq-video-recordings-raw')
  );
end;
$$;

revoke all on function admin.retire_raw_video_bucket() from public, anon;
grant execute on function admin.retire_raw_video_bucket() to service_role;
