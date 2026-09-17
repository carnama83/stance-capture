-- Eight functions in this DEV database hardcode the PROD project ref
-- (yzxzpnomcarnxixhjlba) in their Edge Function URLs - almost certainly copy-paste drift from a
-- Prod->Dev clone. Currently dormant: none of them has an ACTIVE cron job here, and Dev's Vault
-- secrets would not match Prod's anyway, so a call would 401. But enabling any of those jobs
-- would make Dev's scheduler drive PROD's pipeline.
--
-- This is the same class of hazard CLAUDE.md flags for supabase/config.toml's project_id, and
-- the reason the repo carries `supabase/config.toml merge=ours`.
--
-- Rewrites each function's OWN pg_get_functiondef() with the ref substituted, aborting on any
-- count mismatch. Only the project ref changes - no logic, grants, volatility or search_path is
-- touched. prokind='f' excludes aggregates (pg_get_functiondef errors on those).

do $mig$
declare
  prod_ref text := 'yzxzpnomcarnxixhjlba';
  dev_ref  text := 'essnvhvezxjcoqxvuxuq';
  r        record;
  def      text;
  newdef   text;
  before_n int;
  after_n  int;
  total    int := 0;
begin
  -- sanity: we really are on Dev
  if current_database() is null then raise exception 'no database'; end if;
  if not exists (select 1 from vault.decrypted_secrets
                 where name='project_url' and decrypted_secret like '%'||dev_ref||'%')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.prosrc like '%'||dev_ref||'%') then
    raise exception 'cannot confirm this is the Dev project - refusing';
  end if;

  for r in
    select p.oid, n.nspname, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','admin') and p.prokind='f'
      and p.prosrc like '%' || prod_ref || '%'
    order by n.nspname, p.proname
  loop
    def := pg_get_functiondef(r.oid);
    before_n := (length(def) - length(replace(def, prod_ref, ''))) / length(prod_ref);
    if before_n = 0 then
      raise exception '%.%: prod ref vanished between scan and patch - refusing', r.nspname, r.proname;
    end if;

    newdef := replace(def, prod_ref, dev_ref);
    if position(prod_ref in newdef) > 0 then
      raise exception '%.%: prod ref survived the replace - refusing', r.nspname, r.proname;
    end if;

    execute newdef;
    total := total + 1;
    raise notice 'repointed %.% (% occurrence(s))', r.nspname, r.proname, before_n;
  end loop;

  if total <> 8 then
    raise exception 'expected to repoint 8 functions, repointed % - refusing', total;
  end if;

  -- post-flight: no function in this database may reference the Prod ref any more
  select count(*) into after_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','admin') and p.prokind='f'
    and p.prosrc like '%' || prod_ref || '%';
  if after_n <> 0 then
    raise exception 'post: % function(s) still reference the Prod ref', after_n;
  end if;

  -- and the ones we touched must now carry the Dev ref
  select count(*) into after_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','admin') and p.prokind='f'
    and p.prosrc like '%' || dev_ref || '%';
  if after_n < 8 then
    raise exception 'post: only % function(s) carry the Dev ref, expected at least 8', after_n;
  end if;
end
$mig$;
