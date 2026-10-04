-- Facebook Campaign Manager, Phase 1: campaign links, visits, and first-stance
-- attribution on BOTH stance paths (signed-in and anonymous).
--
-- Rule (PDD v1.2 §4, §13): a submission is campaign-attributed when it is the
-- respondent's FIRST stance on that question and a campaign link for that
-- question was opened in the same browser within the previous 7 days. Later
-- updates are not re-attributed.
--
-- How:
--   * The browser opens /c/<code> -> /#/q/<id>?cv=<code>; the SPA calls
--     record_campaign_visit() and keeps the returned visit id for 7 days.
--   * set_question_stance / record_web_stance take an optional
--     p_campaign_visit_id. It is validated server-side
--     (campaign_visit_for_stance) and written ONLY in the INSERT of a new row.
--     The ON CONFLICT DO UPDATE list is unchanged, so an update never touches it,
--     and no follow-up UPDATE fires question_stances' AFTER triggers twice.
--   * The three commit_staged_* paths copy it from the pending row when they
--     create a new question_stances row.
--   * A BEFORE trigger pins the attribution columns against direct PostgREST
--     writes (the own-row RLS policies have no column limits).
--
-- Back-compat: the new parameter has a DEFAULT, and the old signatures are
-- DROPPED in the same transaction. Keeping both would make PostgREST fail with
-- PGRST203 on every 3-key call from cached frontend builds.
--
-- record_web_stance and the commit functions have drifted from the repo
-- (Epic AA patched them live). They are patched here by exact text
-- substitution of the LIVE definition, aborting if any anchor does not match
-- exactly once (same approach as 20260923110000_epic_aa_forward_chain_depth.sql).

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function public.social_new_link_code()
returns text language sql volatile set search_path to '' as $$
  select substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 10)
$$;
revoke all on function public.social_new_link_code() from public, anon, authenticated;

-- Internal: the visit (and paid campaign, if any) that may be credited for a
-- first stance on p_question_id. Empty when the visit is unknown, for another
-- question, or older than 7 days.
create or replace function public.campaign_visit_for_stance(p_visit_id uuid, p_question_id uuid)
returns table(visit_id uuid, paid_campaign_id uuid)
language sql stable security definer set search_path to '' as $$
  select v.id, l.paid_campaign_id
  from public.social_campaign_visits v
  join public.social_campaign_links l on l.id = v.link_id
  where p_visit_id is not null
    and v.id = p_visit_id
    and v.question_id = p_question_id
    and v.created_at > now() - interval '7 days'
$$;
revoke all on function public.campaign_visit_for_stance(uuid, uuid) from public, anon, authenticated;

-- ── public link RPCs ────────────────────────────────────────────────────────
-- Used by api/c/[code].js (server, anon key) to build the redirect + OG tags.
-- Does NOT record a visit: Facebook's crawler fetches every posted link.
create or replace function public.resolve_campaign_link(p_code text)
returns table(question_id uuid, language_code text)
language sql stable security definer set search_path to '' as $$
  select l.question_id, l.language_code
  from public.social_campaign_links l
  where l.code = lower(btrim(p_code))
$$;
revoke all on function public.resolve_campaign_link(text) from public;
grant execute on function public.resolve_campaign_link(text) to anon, authenticated, service_role;

-- Called from the browser. Best-effort: never raises for a bad code.
-- p_paid_campaign_id supports Epic Y ad URLs already running
-- (/#/q/<id>?ref=campaign&campaign_id=<uuid>); the paid link is minted lazily.
create or replace function public.record_campaign_visit(p_code text default null, p_paid_campaign_id uuid default null)
returns json
language plpgsql volatile security definer set search_path to '' as $$
declare
  v_link public.social_campaign_links;
  v_visit uuid;
begin
  if p_code is not null and btrim(p_code) <> '' then
    select * into v_link from public.social_campaign_links where code = lower(btrim(p_code));
  elsif p_paid_campaign_id is not null then
    select * into v_link from public.social_campaign_links
     where paid_campaign_id = p_paid_campaign_id
     order by created_at limit 1;
    if v_link.id is null then
      insert into public.social_campaign_links (code, paid_campaign_id, destination_kind, question_id, language_code)
      select public.social_new_link_code(), c.id, 'paid_ad', c.question_id, 'en'
        from public.campaigns c
       where c.id = p_paid_campaign_id
      on conflict do nothing
      returning * into v_link;
      if v_link.id is null then
        select * into v_link from public.social_campaign_links
         where paid_campaign_id = p_paid_campaign_id
         order by created_at limit 1;
      end if;
    end if;
  end if;

  if v_link.id is null then
    return null;
  end if;

  insert into public.social_campaign_visits (link_id, question_id)
  values (v_link.id, v_link.question_id)
  returning id into v_visit;

  return json_build_object(
    'visit_id', v_visit,
    'question_id', v_link.question_id,
    'language_code', v_link.language_code);
end $$;
revoke all on function public.record_campaign_visit(text, uuid) from public;
grant execute on function public.record_campaign_visit(text, uuid) to anon, authenticated, service_role;

-- ── set_question_stance: + p_campaign_visit_id ──────────────────────────────
-- Body identical to the live definition (20260919200000_pr2a_04) apart from the
-- attribution lookup and the two INSERT-only columns.
drop function if exists public.set_question_stance(uuid, integer, uuid);

create function public.set_question_stance(
  p_question_id uuid,
  p_score integer,
  p_rendition_id uuid,
  p_campaign_visit_id uuid default null)
returns public.question_stances
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_stance public.question_stances;
  v_status text;
  v_qid    uuid;
  v_cv_visit uuid;
  v_cv_paid  uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_score is null then
    delete from public.question_stances
    where user_id = auth.uid() and question_id = p_question_id
    returning * into v_stance;
    return v_stance;
  end if;

  if p_score < -2 or p_score > 2 then
    raise exception 'Invalid score. Must be between -2 and 2.' using errcode = '23514';
  end if;

  if p_rendition_id is null then
    raise exception
      'RENDITION_REQUIRED: a stance must record the exact rendition the respondent answered; the client supplied none'
      using errcode = '22023';
  end if;

  select r.lifecycle_status, r.question_id
    into v_status, v_qid
  from public.question_renditions r
  where r.id = p_rendition_id;

  if v_status is null then
    raise exception
      'RENDITION_INVALID_FOR_QUESTION: rendition % does not exist', p_rendition_id
      using errcode = '23503';
  end if;

  if v_qid <> p_question_id then
    raise exception
      'RENDITION_INVALID_FOR_QUESTION: rendition % belongs to question %, not %',
      p_rendition_id, v_qid, p_question_id
      using errcode = '23503';
  end if;

  if v_status = 'invalidated' then
    raise exception
      'RENDITION_INVALIDATED: rendition % was withdrawn as defective; the question must be re-read and re-answered',
      p_rendition_id
      using errcode = '23514';
  end if;

  if v_status not in ('published', 'superseded') then
    raise exception
      'RENDITION_NOT_ELIGIBLE: rendition % has lifecycle_status %, which cannot receive responses',
      p_rendition_id, v_status
      using errcode = '23514';
  end if;

  -- Campaign attribution: first stance only. No current row AND no history
  -- (a delete-then-re-answer is not a first stance).
  if p_campaign_visit_id is not null
     and not exists (select 1 from public.question_stances s
                      where s.user_id = auth.uid() and s.question_id = p_question_id)
     and not exists (select 1 from public.stance_history h
                      where h.user_id = auth.uid() and h.question_id = p_question_id)
  then
    select a.visit_id, a.paid_campaign_id into v_cv_visit, v_cv_paid
    from public.campaign_visit_for_stance(p_campaign_visit_id, p_question_id) a;
  end if;

  insert into public.question_stances (user_id, question_id, score, rendition_id, campaign_visit_id, campaign_id)
  values (auth.uid(), p_question_id, p_score, p_rendition_id, v_cv_visit, v_cv_paid)
  on conflict (user_id, question_id)
  do update set
    score        = excluded.score,
    rendition_id = excluded.rendition_id,
    updated_at   = now()
  returning * into v_stance;

  return v_stance;
end;
$function$;

revoke all on function public.set_question_stance(uuid, integer, uuid, uuid) from public;
grant execute on function public.set_question_stance(uuid, integer, uuid, uuid) to anon, authenticated, service_role;

-- ── live-definition patches ─────────────────────────────────────────────────
create or replace function pg_temp.sub1(p_def text, p_old text, p_new text, p_fn text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(p_def) - length(replace(p_def, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then
    raise exception 'patch anchor for % matched % times (expected 1): %', p_fn, n, p_old;
  end if;
  return replace(p_def, p_old, p_new);
end $$;

-- record_web_stance: + p_campaign_visit_id, set on NEW pending rows only.
do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef('public.record_web_stance(text,uuid,smallint,text,text,text,text,uuid)'::regprocedure)
    into v_def;

  v_def := pg_temp.sub1(v_def,
    'p_rendition_id uuid DEFAULT NULL::uuid)',
    'p_rendition_id uuid DEFAULT NULL::uuid, p_campaign_visit_id uuid DEFAULT NULL::uuid)',
    'record_web_stance/signature');

  v_def := pg_temp.sub1(v_def,
    E'DECLARE\n',
    E'DECLARE\n  v_cv_visit     uuid;\n  v_cv_paid      uuid;\n',
    'record_web_stance/declare');

  -- The ELSE branch is the device's first answer to this question.
  v_def := pg_temp.sub1(v_def,
    E'    v_my_ref := ''w_'' ||',
    E'    IF p_campaign_visit_id IS NOT NULL THEN\n'
    || E'      SELECT a.visit_id, a.paid_campaign_id INTO v_cv_visit, v_cv_paid\n'
    || E'        FROM public.campaign_visit_for_stance(p_campaign_visit_id, p_question_id) a;\n'
    || E'    END IF;\n'
    || E'    v_my_ref := ''w_'' ||',
    'record_web_stance/lookup');

  v_def := pg_temp.sub1(v_def,
    'responder_device_id, rendition_id)',
    'responder_device_id, rendition_id, campaign_visit_id, campaign_id)',
    'record_web_stance/insert-cols');

  v_def := pg_temp.sub1(v_def,
    'p_device_id, p_rendition_id);',
    'p_device_id, p_rendition_id, v_cv_visit, v_cv_paid);',
    'record_web_stance/insert-values');

  drop function public.record_web_stance(text, uuid, smallint, text, text, text, text, uuid);
  execute v_def;
end
$patch$;

revoke all on function public.record_web_stance(text, uuid, smallint, text, text, text, text, uuid, uuid) from public;
grant execute on function public.record_web_stance(text, uuid, smallint, text, text, text, text, uuid, uuid)
  to anon, authenticated, service_role;

-- commit_staged_*: copy the attribution when the commit creates a new row.
-- Same signatures, so CREATE OR REPLACE keeps the existing grants.
do $patch$
declare
  v_fn  text;
  v_def text;
begin
  foreach v_fn in array array[
    'public.commit_staged_stance(text,uuid,text)',
    'public.commit_staged_stances_for_device(text,text)',
    'public.commit_staged_stances_for_device_by_user(text,uuid)']
  loop
    select pg_get_functiondef(v_fn::regprocedure) into v_def;
    v_def := pg_temp.sub1(v_def,
      'user_id, whatsapp_phone_hash, rendition_id)',
      'user_id, whatsapp_phone_hash, rendition_id, campaign_visit_id, campaign_id)',
      v_fn || '/insert-cols');
    v_def := pg_temp.sub1(v_def,
      'r.rendition_id);',
      'r.rendition_id, r.campaign_visit_id, r.campaign_id);',
      v_fn || '/insert-values');
    execute v_def;
  end loop;
end
$patch$;

-- ── pin attribution columns against direct PostgREST writes ─────────────────
-- Inside a SECURITY DEFINER function current_user is the owner, so the RPCs
-- above are unaffected; service-role edge functions (embed-submit) also pass.
create or replace function public.trg_pin_stance_campaign_columns()
returns trigger language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.campaign_visit_id := null;
      new.campaign_id := null;
    else
      new.campaign_visit_id := old.campaign_visit_id;
      new.campaign_id := old.campaign_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists pin_stance_campaign_columns on public.question_stances;
create trigger pin_stance_campaign_columns
  before insert or update on public.question_stances
  for each row execute function public.trg_pin_stance_campaign_columns();

notify pgrst, 'reload schema';
