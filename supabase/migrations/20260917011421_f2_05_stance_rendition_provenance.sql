-- Epic UGQ Design F2, phase 4 of 6: every response records the exact wording
-- it was given.
--
-- NOT adding a response_channel column, contrary to the first draft of §8.4:
-- question_stances.source already carries it (native / ingested / embed /
-- whatsapp_flow / web_forward / campaign). A second channel column would be
-- precisely the duplicate source of truth UGQ-ML-15 exists to prevent.
--
-- Added nullable here. Writers are updated next, and NOT NULL is applied in a
-- following migration -- flipping it before the writers exist would break
-- stance submission outright.

alter table public.question_stances
  add column rendition_id uuid null references public.question_renditions(id);

create index idx_question_stances_rendition on public.question_stances (rendition_id);

-- Backfill. Honest limitation: which wording a past respondent actually saw was
-- never recorded, so this cannot be recovered -- it is INFERRED, not observed.
-- The question's original rendition is the best available inference, because
-- before this change every surface served questions.question (via the
-- coalesce fallback) and the original holds exactly that text for the 114
-- English-source questions. The 4 stances on Hindi-source questions are the
-- weakest cases and are called out in the epic doc rather than hidden here.
update public.question_stances s
set rendition_id = o.id
from public.question_renditions o
where o.question_id = s.question_id
  and o.rendition_type = 'original'
  and s.rendition_id is null;

comment on column public.question_stances.rendition_id is
  'The exact rendition presented to this respondent. Mandatory for new responses on every channel. Rows predating the F2 migration carry an INFERRED value (the question''s original rendition), because the wording shown was never recorded before this column existed.';

-- Resolve the wording to attribute a response to: the live published rendition
-- in the respondent's language, else the source-language original. Returns NULL
-- rather than guessing when the question has no eligible wording in that
-- language, so the caller fails loudly instead of silently attributing a
-- response to text the respondent never saw.
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
    and r.language_code = coalesce(p_language_code, 'en')
  union all
  select o.id
  from public.question_renditions o
  where o.question_id = p_question_id
    and o.lifecycle_status = 'published'
    and o.rendition_type = 'original'
  limit 1;
$$;

grant execute on function public.resolve_response_rendition(uuid, text) to anon, authenticated, service_role;

do $$
declare n integer;
begin
  select count(*) into n from public.question_stances where rendition_id is null;
  if n > 0 then
    raise exception 'F2 phase 4: % stance(s) could not be attributed to a rendition', n;
  end if;
end $$;
