-- run_reframe_http: Dev PROJECT_URL guard plus Prod hardened secret accessor.
-- Promoted from Dev (stance-capture-dev) as part of the Dev -> UAT -> Prod sync, 2026-09-21.
-- Function bodies captured verbatim from Dev live catalog via pg_get_functiondef().

-- NOT a verbatim copy of Dev. Dev adds the PROJECT_URL guard but still reads
-- vault.decrypted_secrets inline for the service-role key; Prod already uses the
-- hardened private.get_secret(). Copying Dev verbatim would REGRESS Prod, so this
-- merges both improvements. private.get_secret() is confirmed present on Dev, UAT
-- and Prod.
--
-- Applied to all three environments, Dev included. Dev was initially left out, which
-- would have made it the only environment still reading vault.decrypted_secrets inline
-- for the service-role key -- i.e. the sync would have fixed UAT and Prod while leaving
-- the source environment behind. This migration is idempotent (CREATE OR REPLACE, no
-- return-type change, so existing grants are preserved) and is safe to re-run anywhere.

CREATE OR REPLACE FUNCTION public.run_reframe_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _base_url text;
  _svc      text;
begin
  perform public.assert_admin_caller();

  select rtrim(decrypted_secret, '/') into _base_url
  from vault.decrypted_secrets where name = 'PROJECT_URL' limit 1;
  if _base_url is null or _base_url = '' then
    raise exception 'Missing vault secret: PROJECT_URL';
  end if;

  _svc := private.get_secret('service_role_key');
  if _svc is null or _svc = '' then
    raise exception 'Missing secret: service_role_key';
  end if;

  perform net.http_post(
    url     := _base_url || '/functions/v1/reframe',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || _svc),
    body    := '{}'::jsonb,
    timeout_milliseconds := 45000);
end;
$function$
;
