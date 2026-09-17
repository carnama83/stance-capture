-- Epic UGQ defect D1: ugq-screen emits notification_type='ugq_resubmit_requested'
-- (video leading-framing gate -> status 'resubmit_requested'), but that value was
-- missing from user_notifications_type_chk, so every such insert was rejected by the
-- CHECK and silently dropped (the supabase-js error was never inspected).
-- Widening the constraint only ADDS an accepted value, so all existing rows still pass.
DO $mig$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
    WHERE conrelid = 'public.user_notifications'::regclass
      AND conname  = 'user_notifications_type_chk';

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'user_notifications_type_chk not found — aborting rather than guessing';
    END IF;

    IF v_def LIKE '%ugq_resubmit_requested%' THEN
        RAISE NOTICE 'already widened; nothing to do';
        RETURN;
    END IF;

    IF v_def NOT LIKE '%ugq_unflagged%' THEN
        RAISE EXCEPTION 'unexpected constraint shape (no ugq_unflagged) — aborting: %', v_def;
    END IF;

    ALTER TABLE public.user_notifications DROP CONSTRAINT user_notifications_type_chk;

    ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_type_chk
        CHECK (notification_type = ANY (ARRAY[
            'stance_change'::text, 'weekly_digest'::text, 'topic_follow'::text,
            'reminder'::text, 'new_local_topic'::text, 'election_update'::text,
            'ugq_submitted'::text, 'ugq_published'::text, 'ugq_rejected'::text,
            'ugq_milestone'::text, 'ugq_flagged'::text, 'ugq_unflagged'::text,
            'ugq_resubmit_requested'::text,
            'campaign_approved'::text, 'campaign_rejected'::text,
            'campaign_budget_alert'::text, 'campaign_sync_failed'::text,
            'campaign_completed'::text, 'accountability_update'::text
        ]));
END
$mig$;
