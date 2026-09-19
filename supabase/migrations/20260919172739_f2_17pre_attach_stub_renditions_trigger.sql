-- ORDERING CAVEAT: this filename's timestamp is when it was APPLIED to Prod
-- (2026-09-19), which sorts it AFTER f2_17, the migration it is a prerequisite
-- of. That is deliberate -- the filename matches Prod's schema_migrations row,
-- so repo and ledger agree and nothing re-applies. It is safe because this
-- migration corrects Prod-only drift: Dev and UAT already satisfy f2_17's
-- precondition, so on those environments this file is a no-op wherever it runs.
-- A from-zero rebuild would need it hoisted ahead of f2_17 by hand.
--
-- INFRASTRUCTURE REGISTRATION GAP, found on Prod mid-promotion and fixed here
-- because f2_17 is unsafe without it.
--
-- public.stub_question_renditions() existed on Prod but NO TRIGGER called it.
-- Dev and UAT both carry `questions_stub_renditions AFTER INSERT ON questions`;
-- on Prod the function was present and inert, so no question ever received
-- rendition stubs. Detected by a rollback-wrapped test INSERT after f2_15:
-- it succeeded but created 0 stubs, where UAT created 1.
--
-- Why this had to be fixed BEFORE f2_17 rather than noted afterwards: f2_17
-- adds trg_question_has_original, a deferred constraint trigger that raises if
-- a question commits without an original rendition. With the stub trigger
-- missing, stub_question_renditions() never runs, no original is ever created,
-- and that constraint trigger would have made EVERY question INSERT on
-- production fail. The two are only safe as a pair.
--
-- Same shape as f2_27 and UGQ-I06: correct function, missing registration,
-- differing per environment precisely because it was never a migration.
-- AFTER INSERT and FOR EACH ROW copied verbatim from Dev.

drop trigger if exists questions_stub_renditions on public.questions;

create trigger questions_stub_renditions
  after insert on public.questions
  for each row execute function public.stub_question_renditions();

do $chk$
declare n integer;
begin
  select count(*) into n
  from pg_trigger t
  where t.tgrelid = 'public.questions'::regclass
    and not t.tgisinternal
    and t.tgname = 'questions_stub_renditions';
  if n <> 1 then
    raise exception 'UGQ: questions_stub_renditions trigger not attached (found %)', n;
  end if;

  -- Assert the other half too: a trigger pointing at a missing function is
  -- just as inert as a function with no trigger.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'stub_question_renditions'
  ) then
    raise exception 'UGQ: stub_question_renditions() is missing; the trigger would fail on every insert';
  end if;
end
$chk$;
