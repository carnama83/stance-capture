-- PR 2b.4 — stance_history records WHICH INSTRUMENT each measurement answered.
--
-- A score delta without provenance cannot be interpreted. "+1 in March, -1 in
-- June" reads as someone changing their mind; if the wording was replaced in
-- between, it may be two different people-shaped answers to two different
-- questions. The history table has carried old_score/new_score since it was
-- created and has never carried the rendition either score was chosen against.
--
-- TWO CHANGES, and the second matters more than it looks.
--
-- 1. old_rendition_id / new_rendition_id on every history event, not just the
--    current row. Existing rows stay NULL — never inferred. A timestamp-derived
--    guess would produce a column that LOOKS like provenance and is not, which
--    is strictly worse than an honest null because downstream analysis cannot
--    tell the two apart.
--
-- 2. The trigger condition. It fires today only when NEW.score <> OLD.score, so
--    a reconfirmation AT THE SAME SCORE against DIFFERENT wording produces no
--    row at all — the single most interesting event in the reconfirmation flow
--    PR 2b is built around, and it was invisible. It now also fires when the
--    rendition changes.
--
-- IS DISTINCT FROM, not <>: rendition_id is nullable on historical rows, and
-- `NULL <> NULL` is NULL, so a plain comparison silently skips every row where
-- either side is unknown.
--
-- Column names deliberately do NOT rename anything on question_stances. The
-- brief is explicit that renaming score/rendition_id there is a repo-wide
-- change touching every RPC, hook, DTO and component for a small clarity gain.

alter table public.stance_history
  add column if not exists old_rendition_id uuid references public.question_renditions(id),
  add column if not exists new_rendition_id uuid references public.question_renditions(id);

comment on column public.stance_history.old_rendition_id is
  'Rendition the PREVIOUS score was chosen against. NULL for rows written before PR 2b, and never back-inferred: an inferred value would be indistinguishable from an observed one.';
comment on column public.stance_history.new_rendition_id is
  'Rendition the NEW score was chosen against. Together with old_rendition_id this makes a score change interpretable — a move from +1 to -1 means something different when the wording also changed.';

create index if not exists idx_stance_history_new_rendition
  on public.stance_history (new_rendition_id);

create or replace function public.trg_log_stance_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  -- Defensive: never roll back a stance write over the identity CHECK.
  -- (Every real stance row carries user_id and/or whatsapp_phone_hash.)
  IF COALESCE(NEW.user_id::text, NEW.whatsapp_phone_hash,
              OLD.user_id::text, OLD.whatsapp_phone_hash) IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.stance_history
      (user_id, whatsapp_phone_hash, question_id, old_score, new_score, changed_at,
       old_rendition_id, new_rendition_id)
    VALUES
      (NEW.user_id, NEW.whatsapp_phone_hash, NEW.question_id, NULL, NEW.score, NEW.created_at,
       NULL, NEW.rendition_id);

  -- PR 2b.4: a rendition change is a measurement event even at an unchanged
  -- score. Someone re-reading replacement wording and confirming the same
  -- position is a NEW answer to a NEW instrument, and the previous condition
  -- (score change only) discarded it.
  ELSIF TG_OP = 'UPDATE'
        AND (NEW.score IS DISTINCT FROM OLD.score
             OR NEW.rendition_id IS DISTINCT FROM OLD.rendition_id) THEN
    INSERT INTO public.stance_history
      (user_id, whatsapp_phone_hash, question_id, old_score, new_score, changed_at,
       old_rendition_id, new_rendition_id)
    VALUES
      (NEW.user_id, NEW.whatsapp_phone_hash, NEW.question_id, OLD.score, NEW.score, NEW.updated_at,
       OLD.rendition_id, NEW.rendition_id);

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.stance_history
      (user_id, whatsapp_phone_hash, question_id, old_score, new_score, changed_at,
       old_rendition_id, new_rendition_id)
    VALUES
      (OLD.user_id, OLD.whatsapp_phone_hash, OLD.question_id, OLD.score, NULL, now(),
       OLD.rendition_id, NULL);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

comment on function public.trg_log_stance_history() is
  'Writes an immutable stance_history event per measurement, carrying the rendition each score was chosen against. Fires on score change OR rendition change (PR 2b.4) — a reconfirmation at the same score against replacement wording is a real event and was previously dropped.';
