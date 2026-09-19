-- questions.question was a SECOND SOURCE OF TRUTH and had already diverged on
-- 2 rows with nothing syncing it -- exactly the failure predicted when F2 was
-- designed. It took about a day to happen.
--
-- Direction of truth, stated once: the published ENGLISH rendition is
-- authoritative; questions.question mirrors it. Not the other way around.
-- Everything a reader sees comes from wording_for(), which reads renditions, so
-- the rendition is already what the product serves -- this just stops the
-- column beside it telling a different story to the 28 database functions and
-- 39 src files that still read it.
--
-- Fires only for a PUBLISHED English row, so:
--   * a draft/superseded/invalidated row never overwrites the mirror
--   * a Hindi-source question whose English is still pending keeps its last
--     known English rather than being blanked
--   * non-English renditions never touch it
--
-- No recursion: the only triggers on questions are AFTER INSERT
-- (stub_question_renditions, assert_question_has_original), so updating
-- questions here cannot re-enter this path.

create or replace function public.mirror_english_rendition_to_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.language_code <> 'en' or new.lifecycle_status <> 'published' then
    return null;
  end if;

  update public.questions q
     set question          = new.rendered_text,
         slider_low_label  = coalesce(new.slider_low_label,  q.slider_low_label),
         slider_high_label = coalesce(new.slider_high_label, q.slider_high_label),
         context_summary   = coalesce(new.context_summary,   q.context_summary)
   where q.id = new.question_id
     and (q.question          is distinct from new.rendered_text
       or q.slider_low_label  is distinct from coalesce(new.slider_low_label,  q.slider_low_label)
       or q.slider_high_label is distinct from coalesce(new.slider_high_label, q.slider_high_label)
       or q.context_summary   is distinct from coalesce(new.context_summary,   q.context_summary));

  return null;
end;
$$;

-- Slider labels and context_summary use coalesce rather than mirroring exactly:
-- a rendition with a null context_summary should not blank background text the
-- question already carries. rendered_text is mirrored exactly, because a
-- published rendition can never have empty text (publish gate).

drop trigger if exists trg_mirror_english_to_question on public.question_renditions;
create trigger trg_mirror_english_to_question
  after insert or update on public.question_renditions
  for each row execute function public.mirror_english_rendition_to_question();

-- Backfill the existing drift. The rendition wins: on both affected rows the
-- English was REGENERATED from the Hindi original and passed the equivalence
-- check, whereas questions.question still held the original unverified reframe.
update public.questions q
set question          = r.rendered_text,
    slider_low_label  = coalesce(r.slider_low_label,  q.slider_low_label),
    slider_high_label = coalesce(r.slider_high_label, q.slider_high_label),
    context_summary   = coalesce(r.context_summary,   q.context_summary)
from public.question_renditions r
where r.question_id = q.id
  and r.language_code = 'en'
  and r.lifecycle_status = 'published'
  and q.question is distinct from r.rendered_text;

do $$
declare n integer;
begin
  select count(*) into n
  from public.questions q
  join public.question_renditions r
    on r.question_id = q.id and r.language_code = 'en' and r.lifecycle_status = 'published'
  where q.question is distinct from r.rendered_text;
  if n <> 0 then
    raise exception 'F2: % question(s) still disagree with their published English rendition', n;
  end if;
end $$;
