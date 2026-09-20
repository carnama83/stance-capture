-- D1 — anonymous readers get the labelled fallback.
--
-- DECISION RECORDED: signed-in users keep the per-user
-- profiles.show_unavailable_language toggle, which already exists and is
-- surfaced in SettingsProfile. Anonymous readers now default to the permissive
-- branch instead of the strict one.
--
-- WHY the anonymous case needed deciding separately: an anonymous visitor has
-- no profile row, so the toggle resolves to NULL and coalesces to false. They
-- were permanently strict with no way to opt in — the one group that cannot
-- express a preference was given the most restrictive behaviour. A Hindi
-- visitor arriving on a shared link saw a near-empty feed and no explanation.
--
-- This is NOT a silent mixed-language page. PR 1.9 added the content-language
-- indicator, which renders in the reader's own language (अंग्रेज़ी में, never
-- "English"), and PR 2a records the exact rendition_id on any resulting stance.
-- So the fallback is labelled, provenance-recorded and filterable: analysis can
-- always tell which instrument a response answered.
--
-- Signed-in behaviour is deliberately unchanged. Someone who has set a language
-- preference has expressed an intent, and overriding it would be worse than the
-- default being wrong for people who have not.
--
-- Same signature and same return columns as the PR 2a.1 version, so this
-- REPLACES rather than creating an overload.

create or replace function public.wording_for(
  p_question_id  uuid,
  p_language_code text)
returns table (
  rendered_text     text,
  slider_low_label  text,
  slider_high_label text,
  context_summary   text,
  rendition_id      uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with allow as (
    select case
      -- D1: anonymous readers cannot opt in, so they default to the labelled
      -- fallback rather than to an empty feed.
      when auth.uid() is null then true
      else coalesce(
        (select pr.show_unavailable_language from public.profiles pr where pr.user_id = auth.uid()),
        false)
    end as fallback_ok
  ),
  match as (
    select r.rendered_text, r.slider_low_label, r.slider_high_label, r.context_summary, r.id
    from public.question_renditions r
    where r.question_id = p_question_id
      and r.lifecycle_status = 'published'
      and r.language_code = coalesce(p_language_code, 'en')
    limit 1
  ),
  original as (
    select r.rendered_text, r.slider_low_label, r.slider_high_label, r.context_summary, r.id
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
$function$;

comment on function public.wording_for(uuid, text) is
  'Returns the wording to DISPLAY for a question in a language, with the exact rendition_id it came from. Language policy (D1): signed-in users follow profiles.show_unavailable_language; anonymous readers default to the labelled fallback, because they have no profile in which to express a preference. A fallback is never silent — the client renders the content-language indicator and the resulting stance records the fallback rendition_id.';

notify pgrst, 'reload schema';
