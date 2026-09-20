-- PR 0.4 — promote_ingested_stance() is disabled until D8 is answered.
--
-- This is the fifth broken writer, and unlike the other four it cannot simply
-- be fixed, because there is no honest value for rendition_id to take.
--
-- What it promotes: a person replied in free text to a social post. An AI
-- classifier read their prose and produced ingested_stances.stance_value
-- (numeric) with a confidence_score (numeric). promote_ingested_stance then
-- casts that to smallint, drops the confidence, and writes it into
-- question_stances with source = 'ingested'.
--
-- They never moved a slider against a rendition. There is no wording they
-- chose a score against, so there is no rendition_id to record. share_event_id
-- may identify a rendition they were EXPOSED to, but exposure is not response;
-- writing it into rendition_id would conflate the two.
--
-- It matters because the aggregate refresh functions do not filter on source:
--
--     refresh_question_stance_stats / _region
--       where coalesce(is_flagged,false) = false
--         and public.stance_counts_toward_aggregate(rendition_id)
--
-- -- so promoted rows would enter the community distribution indistinguishable
-- from real responses.
--
-- D8 decides where inferred stances live (a separate inferred_stances table
-- preserving numeric value and confidence is the leading option). That is a
-- product decision about research-data semantics and should not be rushed to
-- unblock a launch fix.
--
-- Both UAT and Prod have ZERO ingested_stances rows and the function already
-- fails with 23502, so disabling it regresses nothing. It replaces a confusing
-- constraint violation with an explanation. Re-enabling requires answering D8 --
-- and note that the source filter on both refresh functions is part of that
-- answer, not a separate cleanup.

create or replace function public.promote_ingested_stance(p_ingested_stance_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  RAISE EXCEPTION
    'promote_ingested_stance is disabled pending decision D8: an AI-inferred stance has no rendition the respondent chose a score against, so it cannot satisfy question_stances.rendition_id, and the aggregate refresh functions do not filter on source. See migration 20260919180300_pr0_04_disable_promote_ingested_stance_pending_d8.sql.'
    USING ERRCODE = '0A000';
END;
$function$;

comment on function public.promote_ingested_stance(uuid) is
  'DISABLED pending decision D8 (PR 0.4). Previously wrote AI-inferred stances into question_stances with source=''ingested'', without a rendition_id and without a source filter on the aggregate refresh functions -- so inferred measurements would have entered the canonical community distribution as though they were slider responses. Do not re-enable without answering D8 and adding the source filter.';

notify pgrst, 'reload schema';
