-- PR 1.5 — topic display names become localizable.
--
-- Topic labels are Class 3 metadata: a lookup, not an instrument. Nobody
-- chooses a -2..+2 score against a topic name, so it gets none of the
-- append-only apparatus that question_renditions carries -- no lineage, no
-- supersession, no review gating. Regenerating a topic label is cheap and
-- carries no measurement consequence; that is exactly why it must NOT live in
-- question_renditions.
--
-- Today public.topics has `title` plus a single `lang` column. A single lang
-- column on the parent is the shape that forces duplicate parent rows to hold a
-- second language, which would break every FK pointing at a topic and break
-- topic dedup. A child table keyed on (topic_id, language_code) avoids that.
--
-- NOTE THE FOREIGN KEY: languages(language_code). The column is not called
-- `code` -- an earlier draft of this work specified languages(code) and would
-- have failed to apply.

create table if not exists public.topic_translations (
  topic_id      uuid not null references public.topics(id) on delete cascade,
  language_code text not null references public.languages(language_code),
  display_name  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (topic_id, language_code)
);

comment on table public.topic_translations is
  'Localized display names for topics (content Class 3: platform metadata). Plain lookup -- no lineage, no supersession, no review queue, because no respondent scores against a topic label. Falls back to topics.title when a language has no row.';

create index if not exists idx_topic_translations_language
  on public.topic_translations (language_code);

-- Resolution in ONE place, so no caller re-implements the fallback rule.
--
-- Unlike wording_for(), this deliberately DOES fall back to the canonical title
-- rather than returning zero rows. Hiding a question because its topic chip has
-- no Hindi label would be absurd: the instrument is translated, only its
-- category label is not. Instrument integrity and metadata convenience are
-- different problems and get different answers.
create or replace function public.topic_title_for(
  p_topic_id      uuid,
  p_language_code text default 'en')
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select tt.display_name
       from public.topic_translations tt
      where tt.topic_id = p_topic_id
        and tt.language_code = coalesce(p_language_code, 'en')),
    (select t.title from public.topics t where t.id = p_topic_id)
  );
$function$;

comment on function public.topic_title_for(uuid, text) is
  'Localized topic label, falling back to topics.title. Deliberately falls back rather than returning nothing: an untranslated topic chip must not remove a translated question from the feed.';

-- Seeding is intentionally NOT done here.
--
-- Topic labels carry civic-political register ("Caste Reservation Policy",
-- "Biometric Surveillance Policy"). A machine-chosen Hindi label is exactly the
-- kind of loaded or awkward framing that undermines neutrality as surely as
-- loaded question wording does, and this brief already requires native-speaker
-- review for far simpler UI chrome. Seed via the same reviewed path that
-- produces question renditions, or by hand, before Hindi topic labels ship.
--
-- Until a row exists, topic_title_for() returns the English title and the DOM
-- scan will flag it -- which is the correct signal, not a failure.
