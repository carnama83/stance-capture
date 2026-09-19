-- H-10 backport from Prod. PL/pgSQL composite-assignment trap:
--     r extensions.http_response;
--     SELECT extensions.http(( ... )) INTO r;
-- extensions.http() returns ONE column of composite type http_response. When the INTO target is
-- itself composite, PL/pgSQL assigns COLUMN-BY-COLUMN and tries to store the whole tuple into
-- r's first field (status integer), raising
--     invalid input syntax for type integer: "(200,application/json,...)"
-- The HTTP call SUCCEEDS; only the status handling blows up, and EXCEPTION WHEN OTHERS then logs
-- the run as a failure. On Prod this produced 110 failures / 0 successes in 24h while the work
-- was actually being done - the exact inverse of H-04.
--
-- Fix: SELECT * FROM extensions.http(...) expands the composite into its columns, which map
-- field-by-field onto r. The outbound request is byte-identical; nothing new is triggered.
--
-- Driven off THIS database's own catalog rather than replaying Prod's hardcoded target list,
-- because Dev has drifted from Prod (Dev has admin.cron_generate_renditions, Prod does not;
-- Prod has run_create_drafts_http_debug, Dev does not). Aborts on any anchor-count mismatch.
-- prokind='f' excludes aggregates/procedures - pg_get_functiondef() errors on an aggregate.

do $mig$
declare
  anchor text := 'SELECT extensions.http((';
  fixed  text := 'SELECT * FROM extensions.http((';
  r      record;
  def    text;
  hits   int;
  n      int := 0;
begin
  for r in
    select p.oid, n2.nspname, p.proname
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname in ('public','admin')
      and p.prokind = 'f'
      and p.prosrc like '%' || anchor || '%'
    order by n2.nspname, p.proname
  loop
    def  := pg_get_functiondef(r.oid);
    hits := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
    if hits <> 1 then
      raise exception '%.%: expected exactly 1 anchor, found % - refusing', r.nspname, r.proname, hits;
    end if;
    if position(fixed in def) > 0 then
      raise exception '%.%: already patched - refusing', r.nspname, r.proname;
    end if;
    execute replace(def, anchor, fixed);
    n := n + 1;
  end loop;

  if n = 0 then raise exception 'no functions carried the broken anchor - refusing (nothing to do)'; end if;
  raise notice 'patched % function(s)', n;

  -- post-flight: the broken form must be gone, and each patched body must keep its shape
  select count(*) into hits
  from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
  where n2.nspname in ('public','admin') and p.prokind = 'f'
    and p.prosrc like '%' || anchor || '%';
  if hits <> 0 then raise exception 'post: % function(s) still carry the broken form', hits; end if;

  select count(*) into hits
  from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
  where n2.nspname in ('public','admin') and p.prokind = 'f'
    and p.prosrc like '%' || fixed || '%';
  if hits <> n then
    raise exception 'post: expected % patched functions, found %', n, hits;
  end if;
end
$mig$;
