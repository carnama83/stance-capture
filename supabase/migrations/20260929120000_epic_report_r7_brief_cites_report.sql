-- Epic Report R7 — an authority brief cites the question's Insight Report.
--
-- A brief states only what the expectation ledger shows (which expectations
-- respondents selected). The Insight Report carries the rest of the picture —
-- how respondents answered, why, and how it moved. When a brief is generated,
-- generate-authority-brief now freezes the report (a question_report_prints
-- row, R6) and stores its id here, so the brief and the public brief page can
-- point to the exact report as it stood when the brief was written. The brief
-- text and its draft → approved → delivered workflow are unchanged.
--
-- NOTE for the planned proposer-only access rule for community questions:
-- get_report_print defers to can_view_question_report, so a report cited by
-- an approved or delivered brief would stop opening for the authority. That
-- rule change must keep cited prints readable.

alter table public.authority_briefs
  add column if not exists report_print_id uuid
  references public.question_report_prints(id) on delete set null;

-- get_authority_brief returns a TABLE, so adding a column means drop + create
-- (and re-granting). Body unchanged apart from the new column.
drop function if exists public.get_authority_brief(uuid);

create function public.get_authority_brief(p_brief_id uuid)
returns table (
  id uuid,
  question_id uuid,
  region_id uuid,
  question_text text,
  region_name text,
  authority_name text,
  brief_text text,
  approved_at timestamptz,
  ledger_published boolean,
  report_print_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.question_id, b.region_id, q.question, loc.name, a.name, b.brief_text, b.approved_at,
         exists (select 1 from public.expectation_ledgers l
                  where l.question_id = b.question_id and l.region_id = b.region_id and l.status = 'published'),
         b.report_print_id
  from public.authority_briefs b
  join public.questions q on q.id = b.question_id
  join public.authority_registry a on a.id = b.authority_id
  left join public.locations loc on loc.id = b.region_id
  where b.id = p_brief_id
    and b.status in ('approved', 'delivered')
    and nullif(btrim(coalesce(b.brief_text, '')), '') is not null;
$$;

grant execute on function public.get_authority_brief(uuid) to anon, authenticated;
