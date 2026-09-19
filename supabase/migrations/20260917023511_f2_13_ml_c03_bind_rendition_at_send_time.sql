-- Epic UGQ Design F2, UGQ-ML-C03: WhatsApp binds a rendition at SEND time.
--
-- Until now WhatsApp resolved a rendition when the RESPONSE came back. That is
-- weaker than it looks: the recipient answered whatever wording was in the card
-- they received, which may since have been superseded or invalidated. Resolving
-- at response time silently re-attributes their answer to the CURRENT wording --
-- so a later correction would make it appear those recipients saw the corrected
-- text. Provenance has to be captured at the moment the words go out.
--
-- whatsapp_flow_sessions is the right place: it already exists per-send and is
-- what the encrypted Flow callback correlates against, since Meta never sends
-- the recipient's number to a Flow endpoint.

alter table public.whatsapp_flow_sessions
  add column if not exists rendition_id uuid null
    references public.question_renditions(id);

comment on column public.whatsapp_flow_sessions.rendition_id is
  'The exact rendition whose wording was sent in this card. Bound at send time (UGQ-ML-C03) so a response is attributed to what the recipient actually read, not to whatever is current when they reply. Nullable only for sessions created before this column existed.';

create index if not exists idx_whatsapp_flow_sessions_rendition
  on public.whatsapp_flow_sessions (rendition_id);

-- What to SEND, as opposed to what to attribute a response to. Returns the
-- rendition id alongside its wording so the caller renders and records the same
-- row -- the two drifting apart is precisely the bug this closes.
create or replace function public.wording_to_send(
  p_question_id uuid,
  p_language_code text default 'en')
returns table (
  rendition_id uuid,
  language_code text,
  rendered_text text,
  slider_low_label text,
  slider_high_label text,
  context_summary text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.language_code, r.rendered_text,
         r.slider_low_label, r.slider_high_label, r.context_summary
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

grant execute on function public.wording_to_send(uuid, text) to anon, authenticated, service_role;
