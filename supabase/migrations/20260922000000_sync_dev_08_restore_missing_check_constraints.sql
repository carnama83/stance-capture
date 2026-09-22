-- Restore the CHECK constraints missing from Prod, and widen uqp_status_check.
--
-- Found by a constraint-level comparison (Sep 22 2026). The earlier Dev->UAT->Prod
-- sync compared columns, function bodies, RLS policies, indexes, triggers, crons and
-- enums, but NOT constraints -- so this drift went undetected by it.
--
-- The live defect: Prod's uqp_status_check omits 'resubmit_requested', even though
-- Prod has ugq_d1_allow_resubmit_requested_notification applied. The notification half
-- of that feature shipped and the constraint half did not, so setting that status on
-- Prod raises 23514 and the UGQ resubmit flow fails.
--
-- UAT holds the correct definitions and is the reference here. Verified against Prod
-- data before writing: 12 user_question_proposals rows and 2 questions rows, zero
-- violations of any constraint below, and no row already using 'resubmit_requested'.
--
-- Idempotent by construction: each ADD is guarded by a catalog check, and the status
-- constraint is dropped and recreated to the canonical definition. Safe to run in any
-- environment whatever its current state. Constraints are added VALIDATED (not NOT
-- VALID) deliberately -- if an environment holds violating rows this must fail loudly
-- rather than leave an unenforced constraint behind.

DO $$
BEGIN
  ----------------------------------------------------------------------------
  -- 1) user_question_proposals.status -- widen to include 'resubmit_requested'
  --    Always recreated so every environment converges on one definition.
  ----------------------------------------------------------------------------
  ALTER TABLE public.user_question_proposals
    DROP CONSTRAINT IF EXISTS uqp_status_check;

  ALTER TABLE public.user_question_proposals
    ADD CONSTRAINT uqp_status_check CHECK (
      status = ANY (ARRAY[
        'proposed', 'screening', 'in_review', 'approved', 'reframing',
        'reframed', 'published', 'rejected', 'withdrawn', 'resubmit_requested'
      ]::text[])
    );

  ----------------------------------------------------------------------------
  -- 2) user_question_proposals -- three constraints absent on Prod
  ----------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uqp_framing_flag_check'
      AND conrelid = 'public.user_question_proposals'::regclass
  ) THEN
    ALTER TABLE public.user_question_proposals
      ADD CONSTRAINT uqp_framing_flag_check CHECK (
        framing_flag IS NULL
        OR framing_flag = ANY (ARRAY['clean', 'leading', 'rejected']::text[])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uqp_input_mode_check'
      AND conrelid = 'public.user_question_proposals'::regclass
  ) THEN
    ALTER TABLE public.user_question_proposals
      ADD CONSTRAINT uqp_input_mode_check CHECK (
        input_mode = ANY (ARRAY['text', 'voice', 'video']::text[])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uqp_video_publish_choice_check'
      AND conrelid = 'public.user_question_proposals'::regclass
  ) THEN
    ALTER TABLE public.user_question_proposals
      ADD CONSTRAINT uqp_video_publish_choice_check CHECK (
        video_publish_choice IS NULL
        OR video_publish_choice = ANY (ARRAY['raw_only', 'raw_plus_overlay']::text[])
      );
  END IF;

  ----------------------------------------------------------------------------
  -- 3) questions -- two constraints absent on Prod
  ----------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'questions_content_type_check'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_content_type_check CHECK (
        content_type = ANY (ARRAY['incident', 'policy', 'election', 'general', 'video']::text[])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'questions_video_publish_choice_check'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_video_publish_choice_check CHECK (
        video_publish_choice IS NULL
        OR video_publish_choice = ANY (ARRAY['raw_only', 'raw_plus_overlay']::text[])
      );
  END IF;
END
$$;

-- Assert the end state, so a partial apply cannot pass silently.
DO $$
DECLARE
  v_uqp      integer;
  v_q        integer;
  v_resubmit boolean;
BEGIN
  SELECT count(*) INTO v_uqp FROM pg_constraint
   WHERE conrelid = 'public.user_question_proposals'::regclass AND contype = 'c';

  SELECT count(*) INTO v_q FROM pg_constraint
   WHERE conrelid = 'public.questions'::regclass AND contype = 'c';

  SELECT pg_get_constraintdef(oid) LIKE '%resubmit_requested%' INTO v_resubmit
    FROM pg_constraint
   WHERE conname = 'uqp_status_check'
     AND conrelid = 'public.user_question_proposals'::regclass;

  IF v_uqp < 7 THEN
    RAISE EXCEPTION 'expected >= 7 CHECK constraints on user_question_proposals, found %', v_uqp;
  END IF;
  IF v_q < 6 THEN
    RAISE EXCEPTION 'expected >= 6 CHECK constraints on questions, found %', v_q;
  END IF;
  IF NOT coalesce(v_resubmit, false) THEN
    RAISE EXCEPTION 'uqp_status_check does not permit resubmit_requested';
  END IF;

  RAISE NOTICE 'sync_dev_08 OK: uqp checks=%, questions checks=%, resubmit_requested allowed', v_uqp, v_q;
END
$$;
