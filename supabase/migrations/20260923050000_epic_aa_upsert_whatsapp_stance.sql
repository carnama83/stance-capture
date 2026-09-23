-- Epic AA defects AA-01 + AA-02 (Dev reconciliation, 23 Sep 2026).
--
-- AA-01: whatsapp-flow-endpoint wrote the stance with a PostgREST upsert on
--   onConflict "whatsapp_phone_hash,question_id". The only unique index on those
--   columns is PARTIAL (question_stances_whatsapp_dedup_idx ... WHERE
--   whatsapp_phone_hash IS NOT NULL), which ON CONFLICT cannot infer without the
--   predicate, so every write raised 42P10 - and the endpoint ignored the error
--   and told the user "Your stance is in".
-- AA-02: the account lookup selected profiles.id, a column that does not exist,
--   so every Flow stance would have been anonymous.
--
-- Fix: one SECURITY DEFINER function owns the whole write, atomically, without
-- ON CONFLICT. It resolves the account itself (profiles.user_id by
-- verified_phone_hash) and applies "one stance per person per question, latest
-- answer wins":
--   1. the person already has an account row for this question  -> update it
--      (this is the case a naive attributed insert would break on, via
--      UNIQUE (user_id, question_id));
--   2. else this phone already answered                          -> update that row
--      (and attach the account if one now exists);
--   3. else                                                       -> insert.
-- source is left unchanged on an update: it records how the row was first
-- captured. rendition_id always moves with the score (stance_history logs both).
-- broadcast_id / forward_chain_id are only ever filled in, never cleared.
--
-- Only the service role (Edge Functions) may call it - see the AA-04 lesson.

create or replace function public.upsert_whatsapp_stance(
  p_question_id      uuid,
  p_phone_hash       text,
  p_score            smallint,
  p_rendition_id     uuid,
  p_broadcast_id     uuid default null,
  p_forward_chain_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id   uuid;
  v_user_row  uuid;
  v_phone_row uuid;
  v_id        uuid;
  v_action    text;
begin
  -- Direct API callers arrive through PostgREST as 'authenticator'; only the
  -- service role may write here. Internal sessions (postgres, cron) are allowed.
  if session_user = 'authenticator' and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'upsert_whatsapp_stance: service role only' using errcode = '42501';
  end if;

  if p_question_id is null or p_phone_hash is null or p_rendition_id is null then
    raise exception 'upsert_whatsapp_stance: question_id, phone_hash and rendition_id are required';
  end if;
  if p_score is null or p_score < -2 or p_score > 2 then
    raise exception 'upsert_whatsapp_stance: score out of range (-2..2)';
  end if;

  -- AA-02: profiles is keyed by user_id; verified_phone_hash is unique.
  select p.user_id into v_user_id
    from public.profiles p
   where p.verified_phone_hash = p_phone_hash;

  select qs.id into v_phone_row
    from public.question_stances qs
   where qs.whatsapp_phone_hash = p_phone_hash
     and qs.question_id = p_question_id
   for update;

  if v_user_id is not null then
    select qs.id into v_user_row
      from public.question_stances qs
     where qs.user_id = v_user_id
       and qs.question_id = p_question_id
     for update;
  end if;

  if v_user_row is not null then
    update public.question_stances qs
       set score               = p_score,
           rendition_id        = p_rendition_id,
           -- link the phone to this row unless another row already holds it
           whatsapp_phone_hash = case when v_phone_row is null or v_phone_row = v_user_row
                                      then p_phone_hash else qs.whatsapp_phone_hash end,
           broadcast_id        = coalesce(p_broadcast_id, qs.broadcast_id),
           forward_chain_id    = coalesce(p_forward_chain_id, qs.forward_chain_id),
           updated_at          = now()
     where qs.id = v_user_row;
    v_id := v_user_row;
    v_action := 'updated';

  elsif v_phone_row is not null then
    update public.question_stances qs
       set score            = p_score,
           rendition_id     = p_rendition_id,
           user_id          = coalesce(qs.user_id, v_user_id),
           broadcast_id     = coalesce(p_broadcast_id, qs.broadcast_id),
           forward_chain_id = coalesce(p_forward_chain_id, qs.forward_chain_id),
           updated_at       = now()
     where qs.id = v_phone_row;
    v_id := v_phone_row;
    v_action := 'updated';

  else
    begin
      insert into public.question_stances
        (question_id, user_id, whatsapp_phone_hash, score, source,
         rendition_id, broadcast_id, forward_chain_id)
      values
        (p_question_id, v_user_id, p_phone_hash, p_score, 'whatsapp_flow',
         p_rendition_id, p_broadcast_id, p_forward_chain_id)
      returning id into v_id;
      v_action := 'inserted';
    exception when unique_violation then
      -- A concurrent submission for the same phone/account won the insert.
      -- Latest answer wins: apply this one on top of it.
      -- Prefer the account row, as case 1 does; exactly one row is updated.
      select qs.id into v_id
        from public.question_stances qs
       where qs.question_id = p_question_id
         and (qs.whatsapp_phone_hash = p_phone_hash
              or (v_user_id is not null and qs.user_id = v_user_id))
       order by (qs.user_id is not distinct from v_user_id and v_user_id is not null) desc
       limit 1
       for update;
      update public.question_stances qs
         set score        = p_score,
             rendition_id = p_rendition_id,
             updated_at   = now()
       where qs.id = v_id;
      v_action := 'updated';
    end;
  end if;

  return jsonb_build_object('stance_id', v_id, 'user_id', v_user_id, 'action', v_action);
end;
$function$;

revoke all on function public.upsert_whatsapp_stance(uuid, text, smallint, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.upsert_whatsapp_stance(uuid, text, smallint, uuid, uuid, text) to service_role;
