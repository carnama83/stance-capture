-- Two Hindi-origin questions still carried canonical_language='en' while their
-- ORIGINAL rendition is 'hi'. Deferred during f2_02 to avoid widening that
-- migration; closing it now that stub_question_renditions() reads the column
-- to decide which language the original is created in.
--
-- Why it is not merely cosmetic: the stub trigger skips canonical_language when
-- creating translated stubs. With the column saying 'en' for a Hindi-source
-- question, a re-insert would stub 'hi' -- the question's own source language --
-- and generate-question-renditions now refuses that outright ("targets its
-- source language; the original is authoritative"). So the contradiction would
-- have produced a rendition job that can never succeed.
--
-- Safe: stub_question_renditions is the only reader in the database, and it
-- only runs at INSERT time, so changing it on existing rows affects nothing
-- retroactively. The admin rendition-review UI displays it as a label.
--
-- NOT the full retirement of §3 R15. questions.question is still the English
-- reframe and ugq-publish still writes canonical_language='en' for every new
-- proposal regardless of the language it was written in. Making a non-English
-- proposer's own wording the ORIGINAL at publish time -- with English demoted
-- to a rendition that must pass verification -- is a product-visible change
-- (those questions leave the English feed until their English is verified) and
-- is left as an explicit decision rather than slipped in here.

update public.questions q
set canonical_language = r.language_code
from public.question_renditions r
where r.question_id = q.id
  and r.rendition_type = 'original'
  and q.canonical_language <> r.language_code;

do $$
declare n integer;
begin
  select count(*) into n
  from public.questions q
  join public.question_renditions r on r.question_id = q.id and r.rendition_type = 'original'
  where q.canonical_language <> r.language_code;
  if n <> 0 then
    raise exception 'F2: % question(s) still disagree with their original rendition''s language', n;
  end if;
end $$;
