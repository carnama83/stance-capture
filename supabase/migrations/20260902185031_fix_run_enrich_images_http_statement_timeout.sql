-- The 'authenticated' role has statement_timeout = 8s at the role level,
-- which was canceling this function's own extensions.http() call (already
-- raised to CURLOPT_TIMEOUT_MS = 45000 internally) well before curl's own
-- timeout could ever fire -- Postgres cancels the whole statement,
-- including the in-flight HTTP request, at the 8s role-level mark. Adding
-- a function-scoped statement_timeout override (reverted automatically
-- when the function returns, same mechanism as the existing SET
-- search_path clause) fixes this without touching the role-level setting
-- used by everything else.
CREATE OR REPLACE FUNCTION public.run_enrich_images_http()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
declare
  v_url    text := 'https://essnvhvezxjcoqxvuxuq.supabase.co/functions/v1/enrich-images';
  v_cron   text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1);
  v_svc    text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1);
  r        extensions.http_response;
  v_status int;
  v_body   text;
begin
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');

  r := extensions.http((
    'POST',
    v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('apikey', v_svc),
      extensions.http_header('x-cron-secret', v_cron),
      extensions.http_header('content-type', 'application/json')
    ]::extensions.http_header[],
    'application/json',
    '{}'
  ));

  v_status := (r).status;
  v_body   := coalesce((r).content::text, '');

  if v_status <> 200 then
    raise exception 'enrich-images non-200 (%): %', v_status, left(v_body, 500);
  end if;

  return v_body::jsonb;
end;
$function$;
;
