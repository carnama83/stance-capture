-- Epic J remediation, Sep 2026 — J-14.
-- run_ingest_http() blocked the calling session on a synchronous extensions.http()
-- POST with a 45s curl timeout. admin-run-pipeline invokes it over PostgREST and then
-- makes a further 25s call to ingest-worker, so a slow ingest pushed the Edge Function
-- past its wall-clock limit: the admin saw "Edge Function returned a non-2xx status
-- code" while the ingestion itself completed successfully server-side.
--
-- Switch to pg_net's net.http_post, which enqueues the request and returns immediately.
-- This matches the pattern already used by admin_ingest_source() and run_cluster_http().
--
-- Behavioural note: the call is now fire-and-forget, so a non-2xx from the ingest
-- function is no longer raised to the caller. That trade is deliberate — the previous
-- synchronous check did not reliably surface failures either (it timed out first), and
-- per-source health is already recorded by admin_finish_ingest_job() in topic_sources
-- and by pipeline_jobs. Callers should treat this as "ingest requested", not
-- "ingest completed".
create or replace function public.run_ingest_http()
returns void
language plpgsql
security definer
set search_path = public, auth, vault, net, pg_temp
as $fn$
declare
  v_base   text;
  v_cron   text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc    text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_req_id bigint;
begin
  perform public.assert_admin_caller();

  v_base := rtrim((select decrypted_secret from vault.decrypted_secrets where name='PROJECT_URL' limit 1), '/');
  if v_base is null or v_base = '' then raise exception 'vault secret PROJECT_URL missing'; end if;
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  select net.http_post(
      timeout_milliseconds := 45000,
      url     := v_base || '/functions/v1/ingest',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || v_svc,
                   'apikey',        v_svc,
                   'x-cron-secret', v_cron,
                   'content-type',  'application/json')
    )
  into v_req_id;
end
$fn$;

revoke all on function public.run_ingest_http() from public, anon;
grant execute on function public.run_ingest_http() to authenticated, service_role;
