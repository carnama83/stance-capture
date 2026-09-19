-- ORDERING CAVEAT: this filename's timestamp is when it was APPLIED to Prod
-- (2026-09-19), which sorts it AFTER f2_27, the migration it is a prerequisite
-- of. That is deliberate -- the filename matches Prod's schema_migrations row,
-- so repo and ledger agree and nothing re-applies. It is safe because this
-- migration corrects Prod-only drift: Dev and UAT already satisfy f2_27's
-- precondition, so on those environments this file is a no-op wherever it runs.
-- A from-zero rebuild would need it hoisted ahead of f2_27 by hand.
--
-- Another never-travelled artefact, found on Prod mid-promotion.
-- admin.cron_generate_renditions() exists on Dev and UAT but not here: it was
-- created by hand during the original UGQ build and never expressed as a
-- migration, so nothing carried it. f2_27 registers a cron that CALLS this
-- function and asserts the function exists, so f2_27 would abort without it.
--
-- Copied verbatim from Dev. Notes on the parts that matter:
--   * pg_try_advisory_lock, so a slow run cannot overlap the next minute's tick;
--     a busy lock is recorded as a skip rather than an error.
--   * statement_timeout 200s against a 180s curl timeout, so the HTTP call is
--     always the thing that gives up first and the failure is legible.
--   * every outcome, including the exception path, lands in admin.cron_runs --
--     a cron whose only record of failure is a discarded HTTP response is the
--     UGQ-O5 mistake repeated.
--
-- The secret assertion below failed on the first attempt here and correctly
-- rolled this back: Prod's private store lacked SUPABASE_URL and
-- SERVICE_ROLE_KEY under those names. Fixed by f2_27pre0.

create or replace function admin.cron_generate_renditions()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'admin', 'private'
set statement_timeout to '200s'
as $function$
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

do $chk$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'admin' and p.proname = 'cron_generate_renditions'
  ) then
    raise exception 'UGQ: admin.cron_generate_renditions() was not created';
  end if;
  if private.get_secret('CRON_SECRET') is null
     or private.get_secret('SUPABASE_URL') is null
     or private.get_secret('SERVICE_ROLE_KEY') is null then
    raise exception 'UGQ: CRON_SECRET / SUPABASE_URL / SERVICE_ROLE_KEY missing from private secrets';
  end if;
end
$chk$;
