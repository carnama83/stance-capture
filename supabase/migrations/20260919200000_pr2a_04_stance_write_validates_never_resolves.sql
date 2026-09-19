-- PR 2a.3 / 2a.4 — a stance write that VALIDATES a supplied rendition instead
-- of resolving one. This is the fix for Defect A.
--
-- The existing set_question_stance(uuid, integer, text) takes a language and
-- calls resolve_response_rendition(), which filters lifecycle_status =
-- 'published'. A superseded rendition is therefore structurally unselectable:
--
--   12:00  respondent loads the question, sees R82
--   12:01  admin publishes R103; R82 -> superseded
--   12:02  respondent submits
--          -> R82 is unreachable, so the stance records R103
--
-- The stored provenance is what the system believes they probably saw. P3 fails
-- deterministically today, not as a narrow race.
--
-- ADDITIVE, NOT A REPLACEMENT. The old three-argument form stays live. Supabase
-- migrations and Vercel deploys are not atomic, and dropping it here would 404
-- every stance write between this migration and the frontend going out.
-- PostgREST resolves overloads by the JSON body's key set, and {p_language_code}
-- versus {p_rendition_id} are unambiguous, so the two coexist safely. A later
-- migration drops the old form once its traffic is zero.
--
-- p_language_code is NOT carried forward. Once the rendition is supplied the
-- rendition IS the language; a parameter documented as must-not-be-used is a
-- trap someone will eventually spring.
--
-- ERROR CONTRACT (pulled forward from PR 2b deliberately). PR 2b requires the
-- client to distinguish "this rendition was invalidated, reload the question"
-- from "this rendition id is wrong, you have a bug". Emitting distinct
-- SQLSTATEs now costs three lines; retrofitting them later is a client-contract
-- change. Codes are chosen so PostgREST maps them to 4xx rather than 500, and
-- each message begins with a stable machine-readable token:
--
--   22023  RENDITION_REQUIRED               p_rendition_id was null
--   23503  RENDITION_INVALID_FOR_QUESTION   unknown id, or belongs elsewhere
--   23514  RENDITION_INVALIDATED            found, but withdrawn as defective
--   23514  RENDITION_NOT_ELIGIBLE           found, but still a draft
--
-- Eligibility follows PR 2b table 2b.1: published YES, superseded YES (the
-- respondent genuinely read it before it was replaced), invalidated NO.
--
-- SECURITY DEFINER hardening: search_path is empty and every reference is
-- schema-qualified. The reason is hardening, not name resolution -- auth.uid()
-- is already qualified and resolves regardless.

-- ── 1 · the resolver gets an honest name ────────────────────────────────────
-- resolve_response_rendition() is correct for choosing what to DISPLAY or what
-- to SEND. It is wrong in a write path, because "what is published now" is not
-- "what this respondent read". The new name makes that misuse visibly wrong.
--
-- The old name is kept for now and dropped in a later migration: the old
-- set_question_stance still calls it, as do embed-submit, whatsapp-flow-endpoint
-- and record-stance-reveal-switch. Edge functions resolve RPCs by name at call
-- time, so renaming without redeploying them would fail in production, not at
-- deploy time.
create or replace function public.select_rendition_to_display(
  p_question_id   uuid,
  p_language_code text default 'en')
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select r.id
  from public.question_renditions r
  where r.question_id = p_question_id
    and r.lifecycle_status = 'published'
    and (r.language_code = coalesce(p_language_code, 'en')
         or r.rendition_type = 'original')
  order by (r.language_code = coalesce(p_language_code, 'en')) desc,
           (r.rendition_type = 'original') desc,
           r.version desc
  limit 1;
$function$;

comment on function public.select_rendition_to_display(uuid, text) is
  'Chooses which rendition to SHOW (or send) for a question in a language. Never valid in a write path: it returns what is published NOW, which is not what a respondent read if the wording was superseded in between. Stance writes take the rendition the client actually rendered -- see set_question_stance(uuid, integer, uuid).';

comment on function public.resolve_response_rendition(uuid, text) is
  'DEPRECATED (PR 2a). Renamed to select_rendition_to_display() to stop it being reused in write paths, where resolving fabricates provenance (Defect A). Kept live only until the old set_question_stance overload and the three edge-function callers (embed-submit, whatsapp-flow-endpoint, record-stance-reveal-switch) are migrated.';

-- ── 2 · the new write path ──────────────────────────────────────────────────
create or replace function public.set_question_stance(
  p_question_id  uuid,
  p_score        integer,
  p_rendition_id uuid)
returns public.question_stances
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_stance public.question_stances;
  v_status text;
  v_qid    uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Clearing a stance needs no provenance: there is no measurement left to
  -- attribute. Handled before the rendition checks so the client can always
  -- pass a null score to withdraw.
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

  -- published and superseded only. A superseded rendition is valid historical
  -- wording -- the respondent genuinely read it -- and accepting it is the
  -- whole point of this function.
  if v_status not in ('published', 'superseded') then
    raise exception
      'RENDITION_NOT_ELIGIBLE: rendition % has lifecycle_status %, which cannot receive responses',
      p_rendition_id, v_status
      using errcode = '23514';
  end if;

  insert into public.question_stances (user_id, question_id, score, rendition_id)
  values (auth.uid(), p_question_id, p_score, p_rendition_id)
  on conflict (user_id, question_id)
  do update set
    score        = excluded.score,
    rendition_id = excluded.rendition_id,
    updated_at   = now()
  returning * into v_stance;

  return v_stance;
end;
$function$;

comment on function public.set_question_stance(uuid, integer, uuid) is
  'Records a stance against the EXACT rendition the client rendered. Validates that rendition and never substitutes one: resolving here would attribute the answer to whatever wording is current at submit time, which is Defect A. Accepts published and superseded renditions, rejects invalidated ones with SQLSTATE 23514 and a RENDITION_INVALIDATED token so the client can tell "reload the question" from "you have a bug". Supersedes set_question_stance(uuid, integer, text), which is kept live only until frontend traffic on it reaches zero.';

comment on function public.set_question_stance(uuid, integer, text) is
  'DEPRECATED (PR 2a). Derives a rendition by resolving whatever is published at submit time, which fabricates provenance when the wording was superseded between render and submit (Defect A), and derives language from the profile rather than from what was displayed (Defect C). Kept live only so deploys stay non-atomic-safe; drop once the frontend sends p_rendition_id.';

notify pgrst, 'reload schema';
