-- public.run_ingest_http had NO authorization check at all, unlike every sibling
-- run_*_http. It is not currently granted to anon or authenticated so it was not
-- reachable over PostgREST, but a future grant would silently reopen the hole.
-- Defense in depth, matching run_generate_http / run_cluster_http /
-- run_enrich_images_http. Already applied to UAT and Prod.
--
-- Preserves the H-10/H-12 fixes just applied: correct (content_type, content)
-- order, CURLOPT_TIMEOUT_MS 45000, statement_timeout 60s.
CREATE OR REPLACE FUNCTION public.run_ingest_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_url text := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/ingest';
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_resp extensions.http_response;
begin
  if not (coalesce(public.is_admin_me(), false) or session_user = 'postgres') then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;

  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');

  v_resp := extensions.http((
    'POST',
    v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('x-cron-secret', v_cron)
    ]::extensions.http_header[],
    'application/json',
    '{}'::text
  ));

  if v_resp.status < 200 or v_resp.status >= 300 then
    raise exception 'ingest http failed: status=% body=%', v_resp.status, left(coalesce(v_resp.content,''), 500);
  end if;
end;
$function$;
