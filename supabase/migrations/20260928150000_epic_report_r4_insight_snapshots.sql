-- Epic Report R4 — AI insight snapshots (cache + snapshot in one table).
--
-- Each row is one AI summary of one question's report, in one language,
-- together with the exact statistics payload the model was shown
-- (stats_json). The English row is generated first; other languages are
-- translations of a specific English row (source_snapshot_id), so every
-- language says the same thing about the same numbers.
--
-- Written only by the question-report-insights edge function (service role).
-- Clients never read this table directly: the function returns what the
-- report page may show, after checking access with the caller's own JWT.
--
--   status  generating  a generation is in flight (unique per question+language)
--           ok          insights_json passed the validator
--           failed      two attempts failed validation; kept so the report does
--                       not retry on every view (retried after an hour)
--   hidden  an admin suppressed this summary (decision D6); a later
--           regeneration produces a new, visible row
--   pinned  referenced by a PDF or brief — never regenerated or deleted (R6)

create table if not exists public.question_report_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  question_id         uuid not null references public.questions(id) on delete cascade,
  language_code       text not null,
  source_snapshot_id  uuid references public.question_report_snapshots(id) on delete cascade,
  status              text not null check (status in ('generating', 'ok', 'failed')),
  generated_at        timestamptz not null default now(),
  response_count      integer not null,
  reason_count        integer not null default 0,
  response_cutoff_at  timestamptz,
  current_rendition_id uuid references public.question_renditions(id) on delete set null,
  stats_json          jsonb not null,
  insights_json       jsonb,
  desired_outcomes    text[],
  failure_reason      text,
  model               text,
  prompt_version      text,
  pinned              boolean not null default false,
  hidden              boolean not null default false,
  hidden_by           uuid references auth.users(id) on delete set null,
  hidden_at           timestamptz,
  created_by_user_id  uuid references auth.users(id) on delete set null
);

create index if not exists question_report_snapshots_latest_idx
  on public.question_report_snapshots (question_id, language_code, generated_at desc);

-- One generation in flight per question + language: the edge function claims
-- this slot by inserting a 'generating' row; a concurrent caller gets a
-- conflict and serves the previous snapshot instead of paying for a second
-- model call.
create unique index if not exists question_report_snapshots_one_generating
  on public.question_report_snapshots (question_id, language_code)
  where status = 'generating';

alter table public.question_report_snapshots enable row level security;
-- No policies: service role only.

-- D6: admins can hide (or unhide) an AI summary.
create or replace function public.admin_set_report_snapshot_hidden(p_snapshot_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_q uuid; v_src uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  select question_id, coalesce(source_snapshot_id, id) into v_q, v_src
    from public.question_report_snapshots where id = p_snapshot_id;
  if v_q is null then
    raise exception 'snapshot_not_found' using errcode = 'P0002';
  end if;
  -- Hiding the English summary hides its translations too, and vice versa.
  update public.question_report_snapshots
     set hidden    = p_hidden,
         hidden_by = case when p_hidden then auth.uid() end,
         hidden_at = case when p_hidden then now() end
   where id = v_src or source_snapshot_id = v_src;
end;
$$;
revoke all on function public.admin_set_report_snapshot_hidden(uuid, boolean) from public, anon;
grant execute on function public.admin_set_report_snapshot_hidden(uuid, boolean) to authenticated;
