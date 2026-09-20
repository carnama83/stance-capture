-- PR 1.5 (cont.) — RLS on topic_translations.
--
-- The table was created without it. Every sibling reference table in this
-- schema has RLS enabled (languages, topics, question_renditions), and a table
-- without it is reachable for INSERT/UPDATE/DELETE through PostgREST with the
-- anon key -- meaning anyone could rewrite the Hindi label of any topic.
--
-- Mirrors languages_public_read: readable by everyone, because topic labels are
-- public display metadata and the feed RPCs resolve them for signed-out
-- visitors too.
--
-- No write policy is defined on purpose. service_role and the table owner
-- bypass RLS, so seeding and any future admin tooling still work, while no
-- end-user JWT can write. When a topic-translation admin screen exists it
-- should add an explicit policy gated on the same admin check the other admin
-- surfaces use, rather than loosening this one.

alter table public.topic_translations enable row level security;

drop policy if exists topic_translations_public_read on public.topic_translations;

create policy topic_translations_public_read
  on public.topic_translations
  for select
  using (true);
