-- G-01 (P2): the supabase_realtime publication existed but contained ZERO tables, so
-- every Realtime feature in the app was silently dead. The client code is correct and
-- the channel handshake succeeds (the console logs "SUBSCRIBED"), which is exactly why
-- this looks healthy - but Postgres never publishes WAL changes for an unregistered
-- table, so no postgres_changes event is ever delivered. Same class as Epic F's F-01:
-- correct code, missing infrastructure registration.
--
-- Five tables are subscribed to across the app:
--   comment_reactions            - Epic G, M-G06 (QuestionCommentsPanel)
--   question_comment_sentiment   - Epic G      (QuestionCommentsPanel)
--   question_stance_stats        - Epic F      (QuestionDetailPage)
--   question_stance_stats_region - Epic F      (QuestionDetailPage, useHeroController)
--   questions                    - lifecycle   (useQuestionLifecycle)
--
-- Safety: all five have RLS enabled with a public-read policy, and Realtime applies RLS
-- per subscriber, so registering them exposes nothing that a plain SELECT did not already
-- return. Checked before applying.
--
-- REPLICA IDENTITY: comment_reactions is the one table whose subscription is UNFILTERED -
-- it has no question_id column, so the client subscribes to all rows and compares
-- payload.new ?? payload.old against the comment ids on screen. Its PK is `id`, so with
-- the default replica identity a DELETE would publish only {id} and the handler's
-- record.comment_id would be undefined - meaning un-reacting (the toggle-off path, a very
-- common action) would never refresh. FULL replica identity makes the old row complete.
-- The other four filter on question_id, which is part of each of their primary keys, so
-- their DELETE events already carry enough to match and they keep the default.

DO $mig$
DECLARE
  v_tbl   text;
  v_added int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'G-01: publication supabase_realtime does not exist - refusing to create it here';
  END IF;

  FOREACH v_tbl IN ARRAY ARRAY[
    'comment_reactions',
    'question_comment_sentiment',
    'question_stance_stats',
    'question_stance_stats_region',
    'questions'
  ] LOOP
    -- table must exist in this environment
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION 'G-01: table public.% not found - refusing', v_tbl;
    END IF;

    -- idempotent: skip anything already registered
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_tbl
    ) THEN
      RAISE NOTICE 'G-01: public.% already published, skipping', v_tbl;
    ELSE
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tbl);
      v_added := v_added + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'G-01: added % table(s) to supabase_realtime', v_added;
END
$mig$;

ALTER TABLE public.comment_reactions REPLICA IDENTITY FULL;
