-- Epic UGQ Design F2, UGQ-ML-16: relative divergence canary.
--
-- The point of the requirement, restated so nobody "simplifies" it later:
-- ABSOLUTE divergence between two languages is NOT a signal. Speakers of
-- different languages genuinely hold different views, so an absolute threshold
-- fires constantly on real cultural difference and trains admins to ignore it.
-- What is a signal is a question whose divergence is unusual FOR THAT LANGUAGE
-- PAIR, compared with how far apart that pair normally sits -- which is what
-- a bad rendition looks like: one question suddenly measuring something else in
-- one language while every other question behaves normally.
--
-- Region is controlled for because a hi/en gap among an Indian audience and the
-- same gap among a global audience are not comparable quantities.
--
-- HONEST STATUS: this cannot be validated against Dev data. Dev holds ~35
-- stances, effectively all in one language, so every function here correctly
-- returns nothing. The arithmetic is verified separately against synthetic
-- data. Until it runs somewhere with real multilingual traffic, treat the
-- thresholds below as placeholders to be CALIBRATED, not as tuned values.

-- Step 1: how each language answered each question. Quarantined responses
-- (invalidated rendition) and flagged stances are excluded, so a bad rendition
-- that has already been caught does not also skew the canary.
create or replace function admin.question_language_stance_stats()
returns table (
  question_id uuid,
  language_code text,
  audience_region text,
  responses bigint,
  mean_score numeric)
language sql
stable
security definer
set search_path = admin, public
as $$
  select s.question_id,
         r.language_code,
         coalesce(q.audience_location_label, q.location_label, 'Global'),
         count(*),
         round(avg(s.score)::numeric, 4)
  from public.question_stances s
  join public.question_renditions r on r.id = s.rendition_id
  join public.questions q          on q.id = s.question_id
  where coalesce(s.is_flagged, false) = false
    and public.stance_counts_toward_aggregate(s.rendition_id)
  group by 1, 2, 3;
$$;

-- Step 2: per question, how far apart each pair of languages landed.
-- Ordered (a < b) so each pair appears once.
create or replace function admin.question_language_divergence(
  p_min_responses integer default 20)
returns table (
  question_id uuid,
  audience_region text,
  lang_a text,
  lang_b text,
  responses_a bigint,
  responses_b bigint,
  divergence numeric)
language sql
stable
security definer
set search_path = admin, public
as $$
  with st as (select * from admin.question_language_stance_stats())
  select a.question_id, a.audience_region, a.language_code, b.language_code,
         a.responses, b.responses,
         round(abs(a.mean_score - b.mean_score), 4)
  from st a
  join st b
    on b.question_id = a.question_id
   and b.audience_region = a.audience_region
   and a.language_code < b.language_code
  -- Both sides need enough responses for the mean to mean anything. Two
  -- respondents disagreeing is noise, not divergence.
  where a.responses >= greatest(p_min_responses, 1)
    and b.responses >= greatest(p_min_responses, 1);
$$;

-- Step 3: what "normal" looks like for that pair, in that region.
create or replace function admin.language_divergence_baseline(
  p_min_responses integer default 20)
returns table (
  audience_region text,
  lang_a text,
  lang_b text,
  questions_in_baseline bigint,
  mean_divergence numeric,
  stddev_divergence numeric)
language sql
stable
security definer
set search_path = admin, public
as $$
  select d.audience_region, d.lang_a, d.lang_b,
         count(*),
         round(avg(d.divergence), 4),
         round(coalesce(stddev_samp(d.divergence), 0), 4)
  from admin.question_language_divergence(p_min_responses) d
  group by 1, 2, 3;
$$;

-- Step 4: the canary itself.
create or replace function admin.language_divergence_canary(
  p_z numeric default 2.0,
  p_min_responses integer default 20,
  p_min_baseline_questions integer default 10)
returns table (
  question_id uuid,
  audience_region text,
  lang_a text,
  lang_b text,
  divergence numeric,
  baseline_mean numeric,
  baseline_stddev numeric,
  z_score numeric,
  responses_a bigint,
  responses_b bigint)
language sql
stable
security definer
set search_path = admin, public
as $$
  with d as (select * from admin.question_language_divergence(p_min_responses)),
       b as (select * from admin.language_divergence_baseline(p_min_responses))
  select d.question_id, d.audience_region, d.lang_a, d.lang_b,
         d.divergence, b.mean_divergence, b.stddev_divergence,
         round((d.divergence - b.mean_divergence) / b.stddev_divergence, 3),
         d.responses_a, d.responses_b
  from d
  join b on b.audience_region = d.audience_region
        and b.lang_a = d.lang_a
        and b.lang_b = d.lang_b
  -- A baseline built from a handful of questions is not a baseline; firing off
  -- one would just be absolute divergence wearing a disguise.
  where b.questions_in_baseline >= greatest(p_min_baseline_questions, 3)
    -- Zero spread means every question in this pair diverges identically,
    -- which is a data artifact rather than a distribution to test against.
    and b.stddev_divergence > 0
    and (d.divergence - b.mean_divergence) / b.stddev_divergence >= p_z
  order by 8 desc;
$$;

revoke all on function admin.question_language_stance_stats()                      from public, anon;
revoke all on function admin.question_language_divergence(integer)                 from public, anon;
revoke all on function admin.language_divergence_baseline(integer)                 from public, anon;
revoke all on function admin.language_divergence_canary(numeric, integer, integer) from public, anon;
grant execute on function admin.question_language_stance_stats()                      to service_role;
grant execute on function admin.question_language_divergence(integer)                 to service_role;
grant execute on function admin.language_divergence_baseline(integer)                 to service_role;
grant execute on function admin.language_divergence_canary(numeric, integer, integer) to service_role;

comment on function admin.language_divergence_canary(numeric, integer, integer) is
  'UGQ-ML-16. Flags a question whose divergence between two languages is unusual FOR THAT PAIR in that region, not merely large. z=2.0, min 20 responses per language and min 10 questions of baseline are PLACEHOLDERS awaiting calibration against real multilingual traffic -- Dev has none, so this correctly returns zero rows here.';
