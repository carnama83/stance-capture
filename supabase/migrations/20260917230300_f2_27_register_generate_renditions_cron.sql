-- INFRASTRUCTURE REGISTRATION GAP, found on UAT after the promotion.
-- admin.cron_generate_renditions() existed on UAT but nothing was SCHEDULED to
-- call it, so every 'hi' stub created by stub_question_renditions() would have
-- sat in draft forever: the question stays English-only, silently, with no
-- error anywhere. Dev has had the job since the original UGQ build; it was
-- registered there by hand rather than by migration, so it never travelled.
--
-- This is the same shape as UGQ-I06 and the Epic F/J cron gaps: correct code,
-- correct function, missing registration, and it differs per environment
-- precisely BECAUSE it was never expressed as a migration. Schedule and command
-- copied verbatim from Dev.
--
-- Every minute is deliberate: a rendition job is a short LLM call, the claim RPC
-- takes a bounded batch with FOR UPDATE SKIP LOCKED, and rows that fail five
-- times stop being claimed (ugq_o5), so a stuck job cannot spin.

do $$
begin
  perform cron.unschedule('generate-renditions');
exception when others then null;
end $$;

select cron.schedule(
  'generate-renditions',
  '* * * * *',
  $cron$SELECT admin.cron_generate_renditions();$cron$
);

do $chk$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'generate-renditions' and active;
  if n <> 1 then
    raise exception 'UGQ: expected generate-renditions scheduled and active, found % job(s)', n;
  end if;
  -- The job is useless if the function it calls is missing; assert both halves
  -- rather than only the half this migration happens to create.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'admin' and p.proname = 'cron_generate_renditions'
  ) then
    raise exception 'UGQ: admin.cron_generate_renditions() is missing; the schedule would fail every minute';
  end if;
end
$chk$;
