-- PR 3.6 — user-written text records the language it was written in.
--
-- §3.6 asks to preserve original_text + original_language, keep translations
-- separate, mark them visibly, and never overwrite.
--
-- WHAT IS ACTUALLY BUILT HERE, AND WHY IT IS ONLY HALF OF THAT.
--
-- Nothing translates user text today, and building an empty translation child
-- table would be machinery with no producer and no consumer. But
-- original_language is different in kind: it is the one part that CANNOT BE
-- ADDED LATER. Once a comment is stored with no record of the language its
-- author wrote in, that fact is gone. Script detection would guess Hindi from
-- Devanagari and then guess wrong on every Hindi comment typed in Latin script,
-- and an English-language comment is indistinguishable from an untranslated
-- one. So the capture lands now; the translation table can wait until something
-- needs it, because it can be added at any time without losing anything.
--
-- EXISTING ROWS STAY NULL. Backfilling a guess would be exactly the fabricated
-- provenance this whole plan exists to stop -- the same reason pr3_03 refused to
-- copy an English summary into a Hindi rendition. NULL here means "written
-- before this was recorded", which is true and legible, and it is why the column
-- is nullable rather than defaulted.
--
-- NO FOREIGN KEY TO languages, DELIBERATELY. languages lists what the PLATFORM
-- renders. This records what a PERSON wrote in, and those are not the same set:
-- someone may write Marathi in a Hindi UI long before Marathi is a supported
-- interface language. An FK would reject the honest value and push the write
-- toward a wrong one.
--
-- "NEVER OVERWRITE" is already satisfied for the rationale, which upserts with
-- coalesce and preserves the prior text when the new one is null. What was
-- missing is that an EDIT changes the language: the rationale is updated in
-- place, so original_language has to move with it or it would describe the
-- previous text. It is therefore updated exactly when the rationale itself is.

alter table public.comments
  add column if not exists original_language text;

alter table public.stance_texts
  add column if not exists original_language text;

comment on column public.comments.original_language is
  'The UI language the author was reading when they wrote this comment. NULL for rows written before PR 3.6 -- deliberately not backfilled, because a guess would be fabricated provenance. Not FK-constrained: what people write in is not the set of languages the platform renders.';

comment on column public.stance_texts.original_language is
  'The UI language the author was reading when they wrote this rationale. Moves with the text on edit, so it always describes the rationale currently stored. NULL for pre-PR-3.6 rows.';

-- ── rationale ───────────────────────────────────────────────────────────────
-- Appended last with a default, so a client that has not been updated yet keeps
-- resolving to this same function through PostgREST's body-key matching rather
-- than hitting a missing overload.
--
-- THE OLD SIGNATURE IS DROPPED, NOT LEFT BESIDE THE NEW ONE. Postgres identifies
-- a function by name AND argument types, so `create or replace` with an extra
-- parameter creates a SECOND function rather than replacing the first. PostgREST
-- then sees a 3-key body matching both and refuses with "could not choose the
-- best candidate function" -- the ambiguity PR 2a already had to clean up once.
drop function if exists public.upsert_stance_text(uuid, text, text[]);

create or replace function public.upsert_stance_text(
  p_question_id   uuid,
  p_rationale     text    default null,
  p_links         text[]  default '{}',
  p_language_code text    default null
)
returns public.stance_texts
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from public.question_stances
    where user_id = auth.uid() and question_id = p_question_id
  ) then
    raise exception 'You must answer the question before adding a rationale.'
      using errcode = '42501';
  end if;

  insert into public.stance_texts (user_id, question_id, rationale, links, original_language)
  values (auth.uid(), p_question_id, p_rationale, coalesce(p_links, '{}'), p_language_code)
  on conflict (user_id, question_id)
  do update set
    rationale  = coalesce(p_rationale, stance_texts.rationale),
    links      = coalesce(p_links, stance_texts.links),
    -- Only when the TEXT changed. An edit that only touches links must not
    -- relabel the language of prose nobody rewrote.
    original_language = case
      when p_rationale is not null then coalesce(p_language_code, stance_texts.original_language)
      else stance_texts.original_language
    end,
    updated_at = now();

  return (
    select st from public.stance_texts st
    where st.user_id = auth.uid() and st.question_id = p_question_id
  );
end;
$function$;

-- ── comments ────────────────────────────────────────────────────────────────
drop function if exists public.create_question_comment(uuid, text, uuid);

create or replace function public.create_question_comment(
  p_question_id       uuid,
  p_body              text,
  p_parent_comment_id uuid default null,
  p_language_code     text default null
)
returns public.comments
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
DECLARE
  v_user_id    uuid := auth.uid();
  v_comment    public.comments;
  v_random_id  text;
  v_username   text;
  v_mode       public.display_handle_mode_enum;
  v_display    text;
  v_depth      integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'Comment body is required';
  END IF;

  IF p_parent_comment_id IS NOT NULL THEN
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 1 AS depth
      FROM public.comments
      WHERE id = p_parent_comment_id

      UNION ALL

      SELECT c.id, c.parent_id, a.depth + 1
      FROM public.comments c
      JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT COALESCE(MAX(depth), 0)
    INTO v_depth
    FROM ancestors;

    IF v_depth >= 3 THEN
      RAISE EXCEPTION 'Maximum reply depth reached';
    END IF;
  END IF;

  SELECT random_id, username, display_handle_mode
  INTO v_random_id, v_username, v_mode
  FROM public.profiles
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    v_display := 'Someone';
  ELSE
    IF v_mode = 'username' AND v_username IS NOT NULL THEN
      v_display := v_username;
    ELSE
      v_display := v_random_id;
    END IF;
  END IF;

  INSERT INTO public.comments (
    topic_id,
    question_id,
    parent_id,
    user_id,
    user_display,
    body,
    original_language
  )
  VALUES (
    NULL,
    p_question_id,
    p_parent_comment_id,
    v_user_id,
    v_display,
    p_body,
    p_language_code
  )
  RETURNING * INTO v_comment;

  RETURN v_comment;
END;
$function$;

notify pgrst, 'reload schema';
