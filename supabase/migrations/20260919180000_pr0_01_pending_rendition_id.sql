-- PR 0.1 — question_stances_pending learns which rendition the respondent saw.
--
-- Staged stances (record_web_stance, forward-chain captures) record no rendition
-- and no language. That is why the commit paths in PR 0.2 cannot satisfy
-- question_stances.rendition_id NOT NULL: they have nothing truthful to put
-- there. This column is where that provenance will live.
--
-- Deliberately NULLABLE for now. The frontend cannot populate it until the feed
-- RPCs return a rendition id (PR 2a.1) and the frontend threads it through to
-- the staging call (PR 2a.2). Until then, rows staged with a NULL rendition are
-- SKIPPED at commit time and left pending, rather than committed with a
-- fabricated value. A follow-up migration tightens this to NOT NULL once
-- capture is verified live.
--
-- The alternative considered and rejected: resolving a rendition at commit time
-- via resolve_response_rendition(). That function filters lifecycle_status =
-- 'published', so it cannot return a superseded rendition even when that is
-- exactly what the respondent read. Using it here would spread fabricated
-- provenance from one write path to four.

alter table public.question_stances_pending
  add column if not exists rendition_id uuid
    references public.question_renditions(id);

comment on column public.question_stances_pending.rendition_id is
  'The exact rendition whose wording the respondent saw when they staged this stance. Captured at stage time, never resolved at commit time -- resolving would attribute the answer to whatever wording is current when they later sign in. Nullable only until PR 2a threads rendition ids through the feed RPCs; rows with NULL here are skipped by the commit paths rather than committed with an inferred value.';
