-- ORDERING CAVEAT: this filename's timestamp is when it was APPLIED to Prod
-- (2026-09-19), which sorts it AFTER f2_09, the migration it is a prerequisite
-- of. That is deliberate -- the filename matches Prod's schema_migrations row,
-- so repo and ledger agree and nothing re-applies. It is safe because this
-- migration corrects Prod-only drift: Dev and UAT already satisfy f2_09's
-- precondition, so on those environments this file is a no-op wherever it runs.
-- A from-zero rebuild would need it hoisted ahead of f2_09 by hand.
--
-- PROMOTION BLOCKER, found on Prod before applying any of the F2 set.
--
-- Prod carries TWO get_trending_questions_homepage functions:
--   (uuid,text,text,uuid,integer,integer)                      <- stale, pre-localization
--   (uuid,text,text,uuid,integer,integer,text DEFAULT 'en')    <- current
-- Dev and UAT have only the second; the first was removed there by
-- 20260907190000_backfill_missing_functions_from_dev.sql, which Prod never
-- applied. Two consequences:
--
-- 1. f2_09 rewrites the four feed readers BY NAME and asserts it rewrote
--    exactly 4. On Prod it would find 5 and abort -- and the stale body has no
--    rendition join to substitute, so it would fail either way. This migration
--    is what unblocks it.
--
-- 2. The same PostgREST ambiguity that broke stance submission in f2_23: a call
--    naming the six original arguments matches the 6-param exactly AND the
--    7-param, because its p_language_code carries a DEFAULT. It is not biting
--    today only because every caller on main passes p_language_code. Verified
--    no caller relies on the 6-param form: no database function, view or cron
--    references it, and the two edge-function hits (ugq-moderate, ugq-screen)
--    are both comments.
--
-- Its source predates the repo's migrations, so a plain DROP would not be
-- reversible from git. Rather than transcribe 9203 characters by hand -- which
-- is its own well-evidenced failure mode -- the definition is archived by the
-- database itself, verbatim. To restore: SELECT definition FROM
-- admin.dropped_function_archive WHERE ... then EXECUTE it.
--
-- Idempotent: on Dev and UAT the 6-param form is already gone, so nothing is
-- archived and nothing is dropped; only the assertions run.

create table if not exists admin.dropped_function_archive (
  id           bigint generated always as identity primary key,
  dropped_at   timestamptz not null default now(),
  identity_sig text        not null,
  reason       text        not null,
  definition   text        not null
);

comment on table admin.dropped_function_archive is
  'Verbatim pg_get_functiondef() of functions removed by migration, captured so a drop stays reversible when the original source is not in the repo. Restore with EXECUTE.';

do $arch$
declare
  v_oid oid;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_trending_questions_homepage'
    and p.pronargs = 6;

  if v_oid is null then
    raise notice 'stale 6-param overload not present; nothing to archive or drop';
    return;
  end if;

  insert into admin.dropped_function_archive (identity_sig, reason, definition)
  values (
    v_oid::regprocedure::text,
    'f2_28: stale pre-localization overload; blocked f2_09 and created a PostgREST ambiguity with the 7-param form (same class as f2_23)',
    pg_get_functiondef(v_oid)
  );

  drop function public.get_trending_questions_homepage(uuid, text, text, uuid, integer, integer);
end
$arch$;

do $chk$
declare
  n_total integer;
  n_args  integer;
begin
  select count(*) into n_total
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'get_trending_questions_homepage';

  if n_total <> 1 then
    raise exception 'f2_28: expected exactly one get_trending_questions_homepage, found %', n_total;
  end if;

  select p.pronargs into n_args
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'get_trending_questions_homepage';

  if n_args <> 7 then
    raise exception 'f2_28: the surviving get_trending_questions_homepage takes % args, expected the 7-arg localized form', n_args;
  end if;

  -- f2_09 will look for exactly these four names; prove the count is right now
  -- rather than discovering it mid-rewrite.
  select count(*) into n_total
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('get_live_questions_localized','get_question_localized',
                      'get_related_questions_localized','get_trending_questions_homepage');
  if n_total <> 4 then
    raise exception 'f2_28: f2_09 expects exactly 4 feed readers, found % -- it would abort', n_total;
  end if;
end
$chk$;
