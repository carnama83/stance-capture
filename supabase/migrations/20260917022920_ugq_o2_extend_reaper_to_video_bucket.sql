-- UGQ-O2: ugq-resubmit-video overwrites video_recording_path without deleting
-- the object it replaces, so every re-record strands the previous take. Same
-- class as O3, slower: 3 of 14 video objects orphaned, newest 11 days old.
--
-- Fixed by extending the reaper rather than by deleting inline at resubmit
-- time. Deleting the old take the instant the path is overwritten means that
-- if the resubmit then fails, the proposer's only recording is already gone.
-- The sweeper's 24h age guard makes the ordering safe: the replacement has
-- long since succeeded or failed by the time anything is removed.
--
-- A video object counts as claimed if EITHER a proposal or a published question
-- points at it -- questions.video_recording_path carries it forward past the
-- proposal, and checking only proposals would delete live question media.

drop function if exists admin.list_orphaned_voice_recordings(integer);

create or replace function admin.list_orphaned_ugq_media(
  p_bucket text,
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
  where o.bucket_id = p_bucket
    and o.created_at < now() - make_interval(hours => greatest(p_min_age_hours, 1))
    and not exists (
      select 1 from public.user_question_proposals p
      where (p_bucket = 'ugq-voice-recordings' and p.voice_recording_path = o.name)
         or (p_bucket = 'ugq-video-recordings' and p.video_recording_path = o.name)
    )
    and not exists (
      select 1 from public.questions q
      where p_bucket = 'ugq-video-recordings' and q.video_recording_path = o.name
    )
  order by o.created_at;
$$;

revoke all on function admin.list_orphaned_ugq_media(text, integer) from public, anon;
grant execute on function admin.list_orphaned_ugq_media(text, integer) to service_role;

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

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values ('purge_orphaned_media', now(), (r.status = 200), r.status,
            b || ': ' || left(coalesce(r.content::text, ''), 1500));

    v_out := v_out || jsonb_build_object(
      'bucket', b, 'http_status', r.status,
      'result', (case when r.content is null then '{}'::jsonb
                      else coalesce(try_cast_jsonb(r.content::text), '{}'::jsonb) end));
  end loop;

  return v_out;
end;
$$;

revoke all on function admin.run_purge_orphaned_media(boolean, integer, text) from public, anon;
grant execute on function admin.run_purge_orphaned_media(boolean, integer, text) to service_role;
