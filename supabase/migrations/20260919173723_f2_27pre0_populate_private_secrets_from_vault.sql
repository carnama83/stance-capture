-- ORDERING CAVEAT: this filename's timestamp is when it was APPLIED to Prod
-- (2026-09-19), which sorts it AFTER f2_27pre, the migration it is a prerequisite
-- of. That is deliberate -- the filename matches Prod's schema_migrations row,
-- so repo and ledger agree and nothing re-applies. It is safe because this
-- migration corrects Prod-only drift: Dev and UAT already satisfy f2_27pre's
-- precondition, so on those environments this file is a no-op wherever it runs.
-- A from-zero rebuild would need it hoisted ahead of f2_27pre by hand.
--
-- SECRET-STORE DRIFT, found on Prod mid-promotion by an assertion rather than
-- by a broken cron at 3am.
--
-- private.get_secret(key) reads private.secrets then private.kv_secrets. It
-- never reads the vault. On Prod the values DO exist, but in the wrong store
-- and under the wrong names:
--   private.secrets   : dob_key only
--   private.kv_secrets: CRON_SECRET, service_role_key   <- lowercase
--   vault             : CRON_SECRET/cron_secret, SERVICE_ROLE_KEY/service_role_key,
--                       PROJECT_URL/project_url          <- no SUPABASE_URL at all
--
-- So get_secret('CRON_SECRET') resolves, but get_secret('SERVICE_ROLE_KEY') and
-- get_secret('SUPABASE_URL') both return NULL. Every admin.cron_* HTTP invoker
-- in the UGQ set reads those two names, so the rendition generator and the
-- media reaper would have failed silently on every tick -- they log to
-- admin.cron_runs and carry on, which is exactly the shape that hides this.
--
-- Dev and UAT fixed the same drift with the h19 migration; Prod never received
-- it. This is that fix, written to resolve ALIASES rather than assume one
-- spelling, so it works regardless of which casing an environment happens to
-- carry. Values are copied inside the database -- nothing is typed in, and no
-- secret is exposed to the migration text or its output.

do $sec$
declare
  canonical text;
  aliases   text[];
  v_val     text;
  pair      record;
begin
  for pair in
    select * from (values
      ('SUPABASE_URL',     array['SUPABASE_URL','PROJECT_URL','project_url','supabase_url']),
      ('SERVICE_ROLE_KEY', array['SERVICE_ROLE_KEY','service_role_key']),
      ('CRON_SECRET',      array['CRON_SECRET','cron_secret'])
    ) as t(canonical, aliases)
  loop
    canonical := pair.canonical;
    aliases   := pair.aliases;

    -- Already resolvable under the canonical name? Leave it completely alone.
    if private.get_secret(canonical) is not null then
      raise notice '% already resolvable; leaving untouched', canonical;
      continue;
    end if;

    v_val := null;

    -- Prefer an existing private-store value under any alias...
    select coalesce(
             (select s.val   from private.secrets    s where s.key = any(aliases) limit 1),
             (select k.value from private.kv_secrets k where k.key = any(aliases) limit 1)
           )
      into v_val;

    -- ...then fall back to the vault.
    if v_val is null then
      select vs.decrypted_secret into v_val
      from vault.decrypted_secrets vs
      where vs.name = any(aliases)
      limit 1;
    end if;

    if v_val is null then
      raise exception 'Secret % could not be resolved from any of %', canonical, aliases;
    end if;

    insert into private.secrets(key, val) values (canonical, v_val)
    on conflict (key) do update set val = excluded.val;
  end loop;
end
$sec$;

do $chk$
begin
  -- Assert resolvability, never the value. A null here means every UGQ cron
  -- would log a failure nobody reads.
  if private.get_secret('SUPABASE_URL') is null then
    raise exception 'SUPABASE_URL still unresolvable via private.get_secret';
  end if;
  if private.get_secret('SERVICE_ROLE_KEY') is null then
    raise exception 'SERVICE_ROLE_KEY still unresolvable via private.get_secret';
  end if;
  if private.get_secret('CRON_SECRET') is null then
    raise exception 'CRON_SECRET still unresolvable via private.get_secret';
  end if;
  -- Cheap sanity on shape, not content: a project URL that is not a URL would
  -- produce "http_request.uri is NULL"-class errors much later.
  if private.get_secret('SUPABASE_URL') not like 'http%' then
    raise exception 'SUPABASE_URL does not look like a URL';
  end if;
end
$chk$;
