-- Epic UGQ Design F2, phase 5 of 6: a question enters a language feed only via
-- approved source text or a verified rendition (UGQ-ML-12), with the English
-- fallback demoted from a silent default to an explicit opt-in (UGQ-ML-13).
--
-- coalesce(rendition, canonical) turned translation failure into invisible
-- product degradation: the reader saw English and had no way to know the Hindi
-- rendition had failed verification. Under a shared stance pool that is not a
-- UX wrinkle -- it is people answering a different question into one aggregate.
--
-- Also fixes a latent bug shipped in f2_06: set_question_stance referenced
-- profiles.id, but the column is profiles.user_id. plpgsql defers name
-- resolution to run time, so it was created without complaint and would have
-- thrown on the first real stance submission. wording_for below is LANGUAGE SQL,
-- which validates at creation -- that is what surfaced it.

alter table public.profiles
  add column if not exists show_unavailable_language boolean not null default false;

comment on column public.profiles.show_unavailable_language is
  'Opt-in: show questions that have no verified rendition in my language, in the original language. Default false -- English must never be a silent fallback, but a multilingual reader should be able to widen their own feed.';

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
  v_stance    public.question_stances;
  v_lang      text;
  v_rendition uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_score is null then
    delete from public.question_stances
    where user_id = auth.uid() and question_id = p_question_id
    returning * into v_stance;
    return v_stance;
  end if;

  if p_score < -2 or p_score > 2 then
    raise exception 'Invalid score. Must be between -2 and 2.';
  end if;

  select coalesce(p_language_code, pr.preferred_language_code, 'en')
    into v_lang
  from public.profiles pr
  where pr.user_id = auth.uid();
  v_lang := coalesce(v_lang, p_language_code, 'en');

  v_rendition := public.resolve_response_rendition(p_question_id, v_lang);

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

-- The eligibility rule lives HERE, once. Four feed functions each carried their
-- own copy of it; two of them were missed when this design was first written
-- down, which is exactly what duplicating a rule buys you. Returns ZERO rows
-- when the question is not answerable in this language, so callers join it
-- LATERALLY and the row simply drops out -- no WHERE clause to forget, no NULL
-- to mistake for "available".
create or replace function public.wording_for(
  p_question_id uuid,
  p_language_code text)
returns table (
  rendered_text text,
  slider_low_label text,
  slider_high_label text,
  context_summary text)
language sql
stable
security definer
set search_path = public
as $$
  with allow as (
    select coalesce(
      (select pr.show_unavailable_language from public.profiles pr where pr.user_id = auth.uid()),
      false) as fallback_ok
  ),
  match as (
    select r.rendered_text, r.slider_low_label, r.slider_high_label, r.context_summary
    from public.question_renditions r
    where r.question_id = p_question_id
      and r.lifecycle_status = 'published'
      and r.language_code = coalesce(p_language_code, 'en')
    limit 1
  ),
  original as (
    select r.rendered_text, r.slider_low_label, r.slider_high_label, r.context_summary
    from public.question_renditions r
    where r.question_id = p_question_id
      and r.lifecycle_status = 'published'
      and r.rendition_type = 'original'
    limit 1
  )
  select * from match
  union all
  select o.* from original o, allow
  where allow.fallback_ok and not exists (select 1 from match);
$$;

grant execute on function public.wording_for(uuid, text) to anon, authenticated, service_role;

-- Rewrite the four readers mechanically from their own definitions rather than
-- by hand: the same four substitutions in each, asserted to have applied. One
-- of these bodies is 8.7KB and retyping it to change three lines is how
-- unrelated regressions get introduced. Signatures are resolved from the
-- catalogue rather than hardcoded, so this runs unchanged on UAT and Prod.
do $$
declare
  rec   record;
  def   text;
  orig  text;
  n     integer := 0;
begin
  for rec in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in ('get_live_questions_localized','get_question_localized',
                        'get_related_questions_localized','get_trending_questions_homepage')
  loop
    def  := pg_get_functiondef(rec.sig);
    orig := def;

    -- LEFT JOIN -> INNER LATERAL: no eligible wording means the question is not
    -- in this feed at all, rather than appearing in the wrong language.
    def := regexp_replace(def,
      'left join public\.question_renditions r\s+on r\.question_id = ([vq])\.id\s+and r\.language_code = p_language_code\s+and r\.transform_status = ''published''',
      'join lateral public.wording_for(\1.id, p_language_code) r on true',
      'g');

    def := regexp_replace(def, 'coalesce\(r\.rendered_text, [vq]\.question\)',              'r.rendered_text',     'g');
    def := regexp_replace(def, 'coalesce\(r\.slider_low_label, [vq]\.slider_low_label\)',   'r.slider_low_label',  'g');
    def := regexp_replace(def, 'coalesce\(r\.slider_high_label, [vq]\.slider_high_label\)', 'r.slider_high_label', 'g');
    def := regexp_replace(def, 'coalesce\(r\.context_summary, [vq]\.context_summary\)',     'r.context_summary',   'g');

    if def = orig then
      raise exception 'F2 phase 5: no substitution applied to %', rec.sig;
    end if;
    if def ~ 'question_renditions r' or def ~ 'r\.transform_status' then
      raise exception 'F2 phase 5: % still references the rendition table directly', rec.sig;
    end if;

    execute def;
    n := n + 1;
  end loop;

  if n <> 4 then
    raise exception 'F2 phase 5: expected to rewrite 4 readers, rewrote %', n;
  end if;
end $$;

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_live_questions_localized','get_question_localized',
                      'get_related_questions_localized','get_trending_questions_homepage')
    and (p.prosrc ~ 'coalesce\(r\.rendered_text' or p.prosrc ~ 'transform_status');
  if bad is not null then
    raise exception 'F2 phase 5: silent fallback still present in %', bad;
  end if;
end $$;
