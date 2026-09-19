-- Epic UGQ Design F2, phase 4c: provenance becomes mandatory.
--
-- Deliberately separate from f2_05: every writer (set_question_stance,
-- embed-submit, whatsapp-flow-endpoint, record-stance-reveal-switch) had to be
-- deployed first, or this would have broken stance submission outright.
--
-- NOT NULL with no exemptions is possible only because the source language has
-- a rendition row too (phase 2). Without that, NULL would have had to mean
-- "answered in the original language", i.e. meaning hidden in a null.

alter table public.question_stances
  alter column rendition_id set not null;
