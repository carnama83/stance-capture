-- Epic UGQ Design F2, phase 4b: the canonical web write path records which
-- wording the respondent actually answered.
--
-- p_language_code is OPTIONAL and additive, so all five existing frontend call
-- sites keep working unchanged; when omitted it falls back to the respondent's
-- own preferred_language_code, which is what the feed used to choose the
-- wording it showed them. Callers that know the rendered language should pass
-- it explicitly -- that is an observation rather than an inference.

create or replace function public.set_question_stance(
  p_question_id uuid,
  p_score integer,
  p_language_code text default null)
returns public.question_stances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stance      public.question_stances;
  v_lang        text;
  v_rendition   uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_score is null then
    delete from public.question_stances
    where user_id = auth.uid()
      and question_id = p_question_id
    returning * into v_stance;
    return v_stance;
  end if;

  if p_score < -2 or p_score > 2 then
    raise exception 'Invalid score. Must be between -2 and 2.';
  end if;

  select coalesce(p_language_code, pr.preferred_language_code, 'en')
    into v_lang
  from public.profiles pr
  where pr.id = auth.uid();
  v_lang := coalesce(v_lang, p_language_code, 'en');

  v_rendition := public.resolve_response_rendition(p_question_id, v_lang);

  -- Refuse rather than attribute a response to wording that does not exist.
  -- Under F2 a question with no eligible wording in a language is not
  -- answerable in that language -- that is the point, not an edge case.
  if v_rendition is null then
    raise exception
      'Question % has no published wording to attribute a response to (language %)',
      p_question_id, v_lang
      using errcode = '23502';
  end if;

  insert into public.question_stances (user_id, question_id, score, rendition_id)
  values (auth.uid(), p_question_id, p_score, v_rendition)
  on conflict (user_id, question_id)
  do update set
    score        = excluded.score,
    rendition_id = excluded.rendition_id,
    updated_at   = now()
  returning * into v_stance;

  return v_stance;
end;
$$;
