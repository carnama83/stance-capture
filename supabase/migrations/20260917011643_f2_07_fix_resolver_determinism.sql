-- The first cut used UNION ALL + LIMIT 1 to express "prefer the respondent's
-- language, else the original". Append order is an implementation detail, not
-- a guarantee, so that could silently attribute a response to the original
-- even when a published rendition in the right language existed. Made the
-- precedence explicit.

create or replace function public.resolve_response_rendition(
  p_question_id uuid,
  p_language_code text default 'en')
returns uuid
language sql
stable
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.resolve_response_rendition(uuid, text) to anon, authenticated, service_role;
