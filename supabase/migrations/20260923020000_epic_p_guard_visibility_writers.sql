-- Epic P v1.3 defects P-01..P-05: close the anon-reachable write paths into
-- feed visibility and the trending config.
--
-- Since 20260922040000 every feed honours question_visibility_rules, so any
-- unguarded writer of that table is a site-wide content control. Four
-- SECURITY DEFINER functions wrote it (or archived questions) with no
-- authorization check and EXECUTE granted to anon:
--
--   P-01 ensure_question_visibility  - upsert that OVERWRITES visibility
--   P-02 manually_archive_question   - archives + trusts caller's p_admin_id
--   P-03 update_visibility_rules     - rewrites every scored question
--   P-04 apply_feed_hygiene          - suppress/archive on demand
--
-- and P-05: app_config_trending had RLS disabled with anon DML grants.
--
-- The guard is assert_admin_caller(), NOT _ensure_admin_or_service():
-- the latter requires auth.role() = 'service_role', which is NULL for the
-- pg_cron session, so feed-hygiene-6h would start failing. assert_admin_caller
-- allows service_role, internal (non-authenticator) sessions, and admin_users.
--
-- Bodies are patched in place from each environment's own prosrc with counted
-- anchors, so the same migration applies to Dev, UAT and Prod; a mismatch
-- RAISEs instead of half-applying, and an already-patched body is skipped.

do $mig$
declare
  r record;
  src text;
  newsrc text;
  n int;
  cfg text;
begin
  for r in
    select p.oid, p.proname, pg_get_function_arguments(p.oid) as args
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('ensure_question_visibility', 'manually_archive_question',
                        'update_visibility_rules', 'apply_feed_hygiene')
  loop
    src := replace((select prosrc from pg_proc where oid = r.oid), chr(13), '');

    if src like '%assert_admin_caller()%' then
      raise notice '% already guarded - skipped', r.proname;
      continue;
    end if;

    -- Guard goes immediately after the body's first top-level BEGIN.
    n := (select count(*) from regexp_matches(src, '^BEGIN$', 'gmi'));
    if n <> 1 then
      raise exception '%: expected exactly 1 top-level BEGIN line, found %', r.proname, n;
    end if;
    newsrc := regexp_replace(src, '^BEGIN$',
      E'BEGIN\n  -- Epic P P-01..P-04: admin, service_role or internal (cron) only.\n  PERFORM public.assert_admin_caller();\n',
      'mi');

    -- P-02: never trust the caller-supplied actor id when a JWT identifies one.
    if r.proname = 'manually_archive_question' then
      n := (select count(*) from regexp_matches(newsrc, 'p_admin_id\s*\n\s*\);', 'g'));
      if n <> 1 then
        raise exception 'manually_archive_question: expected 1 p_admin_id VALUES anchor, found %', n;
      end if;
      newsrc := regexp_replace(newsrc, 'p_admin_id(\s*\n\s*\);)', 'coalesce(auth.uid(), p_admin_id)\1');
    end if;

    -- CREATE OR REPLACE drops any SET clause it is not given: carry proconfig over.
    select coalesce(string_agg(format(' set %s to %s', split_part(c, '=', 1), substr(c, strpos(c, '=') + 1)), ''), '')
      into cfg
      from unnest((select proconfig from pg_proc where oid = r.oid)) c;

    execute format('create or replace function public.%I(%s) returns %s language plpgsql security definer%s as %L',
      r.proname, r.args, pg_get_function_result(r.oid), cfg, newsrc);
    raise notice '% patched', r.proname;
  end loop;
end
$mig$;

-- These two SECURITY DEFINER functions had no pinned search_path.
alter function public.manually_archive_question(uuid, text, uuid) set search_path = public, pg_temp;
alter function public.update_visibility_rules() set search_path = public, pg_temp;

-- EXECUTE: no anonymous caller needs any of these.
revoke execute on function public.ensure_question_visibility(uuid, public.question_visibility_enum) from public, anon, authenticated;
revoke execute on function public.manually_archive_question(uuid, text, uuid) from public, anon;
revoke execute on function public.update_visibility_rules() from public, anon;
revoke execute on function public.apply_feed_hygiene(boolean) from public, anon;
-- authenticated keeps EXECUTE on the last three: the admin dashboard calls them
-- with an admin JWT, and the in-body guard rejects non-admins.
-- ensure_question_visibility is only called from set_question_visibility
-- (SECURITY DEFINER, runs as owner), so no client role needs it.

-- P-05: app_config_trending (ScoringConfigPage store).
alter table public.app_config_trending enable row level security;

drop policy if exists app_config_trending_read on public.app_config_trending;
create policy app_config_trending_read on public.app_config_trending
  for select to anon, authenticated using (true);

drop policy if exists app_config_trending_admin_write on public.app_config_trending;
create policy app_config_trending_admin_write on public.app_config_trending
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- TRUNCATE bypasses RLS, and anon never writes config.
revoke insert, update, delete, truncate on public.app_config_trending from anon;
revoke truncate on public.app_config_trending from authenticated;
