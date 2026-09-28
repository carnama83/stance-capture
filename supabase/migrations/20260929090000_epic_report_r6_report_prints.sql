-- Epic Report R6 — frozen report snapshots behind "Download PDF".
--
-- A PDF must keep saying exactly what it said when it was made, and anyone
-- holding it must be able to open that same report again. So "Download PDF"
-- first freezes the report into question_report_prints and prints the frozen
-- copy; the PDF footer carries the print's permanent link
-- (/#/q/:id/report?print=<id>).
--
-- Why a table of its own, not a pinned row in question_report_snapshots: a
-- snapshot row holds what the AI was shown, while a print must hold the WHOLE
-- report (distribution, trend, reasons, geography …) in the reader's
-- language, plus the AI summary that was on screen. Keeping prints separate
-- also leaves the AI cache logic untouched. The AI snapshot a print used is
-- marked pinned = true so it is never treated as disposable.
--
-- The figures are computed HERE, server-side, by get_question_insight_report
-- — a client cannot forge the numbers in a print. Identical prints are reused
-- (same question, language, figures and AI snapshot), so repeated clicks or
-- abuse cannot grow the table beyond the number of distinct report states.

create table if not exists public.question_report_prints (
  id                   uuid primary key default gen_random_uuid(),
  question_id          uuid not null references public.questions(id) on delete cascade,
  language_code        text not null,
  report_json          jsonb not null,
  report_hash          text not null,
  insights_json        jsonb,
  insights_language    text,
  insights_generated_at timestamptz,
  insights_snapshot_id uuid references public.question_report_snapshots(id) on delete set null,
  response_count       integer not null,
  last_response_at     timestamptz,
  created_at           timestamptz not null default now(),
  created_by_user_id   uuid references auth.users(id) on delete set null
);

create index if not exists question_report_prints_lookup_idx
  on public.question_report_prints (question_id, language_code, report_hash);

alter table public.question_report_prints enable row level security;
-- No policies: read and written only through the two functions below.

create or replace function public.create_report_print(
  p_question_id          uuid,
  p_language             text,
  p_insights_snapshot_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_report  jsonb;
  v_hash    text;
  v_snap    public.question_report_snapshots%rowtype;
  v_id      uuid;
  v_created timestamptz;
begin
  -- get_question_insight_report enforces can_view_question_report itself.
  v_report := public.get_question_insight_report(p_question_id, p_language);
  v_hash   := md5((v_report - 'generatedAt')::text);

  if p_insights_snapshot_id is not null then
    select * into v_snap
      from public.question_report_snapshots s
     where s.id = p_insights_snapshot_id
       and s.question_id = p_question_id
       and s.status = 'ok'
       and s.hidden = false;
  end if;

  select p.id, p.created_at into v_id, v_created
    from public.question_report_prints p
   where p.question_id = p_question_id
     and p.language_code = v_report ->> 'requestedLanguage'
     and p.report_hash = v_hash
     and p.insights_snapshot_id is not distinct from v_snap.id
   order by p.created_at
   limit 1;
  if found then
    return jsonb_build_object('id', v_id, 'created_at', v_created, 'reused', true);
  end if;

  insert into public.question_report_prints
    (question_id, language_code, report_json, report_hash, insights_json, insights_language,
     insights_generated_at, insights_snapshot_id, response_count, last_response_at, created_by_user_id)
  values
    (p_question_id, v_report ->> 'requestedLanguage', v_report, v_hash, v_snap.insights_json,
     v_snap.language_code, v_snap.generated_at, v_snap.id,
     coalesce((v_report -> 'responseSummary' ->> 'total')::int, 0),
     (v_report -> 'responseSummary' ->> 'lastResponseAt')::timestamptz,
     auth.uid())
  returning id, created_at into v_id, v_created;

  if v_snap.id is not null then
    update public.question_report_snapshots set pinned = true where id = v_snap.id;
  end if;

  return jsonb_build_object('id', v_id, 'created_at', v_created, 'reused', false);
end;
$$;

grant execute on function public.create_report_print(uuid, text, uuid) to anon, authenticated;

-- A print is readable by whoever may read the question's report today (so the
-- future proposer-only rule for community questions covers prints too).
create or replace function public.get_report_print(p_print_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.question_report_prints%rowtype;
begin
  select * into v from public.question_report_prints where id = p_print_id;
  if not found or not public.can_view_question_report(v.question_id) then
    raise exception 'print_not_available' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v.id,
    'questionId', v.question_id,
    'language', v.language_code,
    'createdAt', v.created_at,
    'responseCount', v.response_count,
    'lastResponseAt', v.last_response_at,
    'report', v.report_json,
    'insights', v.insights_json,
    'insightsLanguage', v.insights_language,
    'insightsGeneratedAt', v.insights_generated_at
  );
end;
$$;

grant execute on function public.get_report_print(uuid) to anon, authenticated;
