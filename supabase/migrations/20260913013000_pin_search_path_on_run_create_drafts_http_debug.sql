-- Same as the Prod migration of this name. public.run_create_drafts_http_debug() is
-- SECURITY DEFINER, fires HTTP via an UNQUALIFIED http((...)) call, and had no pinned
-- search_path. EXECUTE is already revoked from PUBLIC/anon/authenticated by the H-09/H-09b
-- backport, so only postgres and service_role can reach it.
--
-- ALTER FUNCTION so the body is untouched. 'extensions' must be present because the call and the
-- http_response type are unqualified - that same unqualified shape is why both earlier audit
-- sweeps were blind to this function.
--
-- Zero callers here too (no DB caller, no cron job, no src/ reference). Dropping it is the
-- better end state on both environments; left for an explicit decision.

do $pre$
declare cfg text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='run_create_drafts_http_debug') then
    raise exception 'run_create_drafts_http_debug not found - refusing';
  end if;
  select p.proconfig::text into cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='run_create_drafts_http_debug';
  if cfg is not null and cfg like '%search_path%' then
    raise exception 'search_path already pinned - refusing';
  end if;
  if has_function_privilege('anon','public.run_create_drafts_http_debug()','EXECUTE') then
    raise exception 'anon unexpectedly has EXECUTE - refusing until that is understood';
  end if;
end $pre$;

alter function public.run_create_drafts_http_debug()
  set search_path = 'public', 'extensions', 'vault', 'pg_temp';

do $post$
declare cfg text;
begin
  select p.proconfig::text into cfg from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='run_create_drafts_http_debug';
  if cfg is null or cfg not like '%search_path%' then
    raise exception 'post: search_path still not pinned'; end if;
  if cfg not like '%extensions%' then
    raise exception 'post: extensions missing from search_path - unqualified http() would break'; end if;
  if has_function_privilege('anon','public.run_create_drafts_http_debug()','EXECUTE')
     or has_function_privilege('authenticated','public.run_create_drafts_http_debug()','EXECUTE') then
    raise exception 'post: web role regained EXECUTE'; end if;
end $post$;
