-- pgsql-http hard-defaults CURLOPT_TIMEOUT_MS to 5000, same issue already
-- fixed on run_enrich_images_http(). generate-question-renditions does up
-- to BATCH_LIMIT=10 renditions per invocation, each with two sequential
-- Anthropic API calls (transform + axis-equivalence check) -- observed
-- ~10s for a single-row batch, so a full 10-row batch could realistically
-- run past a minute. The 5s default meant this cron's own http() call
-- ALWAYS timed out from Postgres's point of view even on a successful run
-- (confirmed: cron.job_run_details shows "Operation timed out after 5002
-- milliseconds" on every single invocation, yet the edge function kept
-- running server-side and completed the actual work independently, since
-- Supabase Edge Functions don't stop just because the original caller gave
-- up waiting). Functionally harmless so far -- admin_claim_rendition_jobs
-- only reclaims rows still 'pending', so no double-processing -- but it
-- means admin.cron_runs/job_run_details always logs a false failure, which
-- would hide a REAL failure in the noise. Raising the timeout here so a
-- genuine problem is distinguishable from normal batch processing time.
-- Runs as the 'postgres' role (cron.job.username = 'postgres'), which has
-- no role-level statement_timeout (unlike 'authenticated' -- see the
-- run_enrich_images_http() fix), so no statement_timeout override is
-- strictly required here; adding one anyway for defense in depth, same
-- pattern, well above the curl timeout so Postgres never cuts it off first.
CREATE OR REPLACE FUNCTION admin.cron_generate_renditions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'private'
 SET statement_timeout TO '200s'
AS $function$
declare
  lock_key      bigint := hashtext('admin.cron_generate_renditions');
  got_lock      boolean;
  secret        text := private.get_secret('CRON_SECRET');
  base_url      text := private.get_secret('SUPABASE_URL');
  service_role  text := private.get_secret('SERVICE_ROLE_KEY');
  r             extensions.http_response;
  v_status      int;
  v_body        text;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message) values ('generate_renditions', true, 'skipped: lock busy');
    return;
  end if;

  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '180000');

    r := extensions.http((
      'POST',
      base_url || '/functions/v1/generate-question-renditions',
      ARRAY[
        extensions.http_header('authorization', 'Bearer ' || service_role),
        extensions.http_header('apikey', service_role),
        extensions.http_header('x-cron-secret', secret),
        extensions.http_header('content-type', 'application/json')
      ],
      'application/json',
      '{}'
    ));

    v_status := r.status;
    v_body   := left(coalesce(r.content::text, ''), 2000);

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values ('generate_renditions', now(), (v_status = 200), v_status, v_body);

    if v_status <> 200 then
      raise warning 'generate_renditions non-200: % %', v_status, left(v_body, 200);
    end if;

  exception when others then
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('generate_renditions', now(), false, sqlerrm);
    perform pg_advisory_unlock(lock_key);
    raise;
  end;

  perform pg_advisory_unlock(lock_key);
end;
$function$;
;
