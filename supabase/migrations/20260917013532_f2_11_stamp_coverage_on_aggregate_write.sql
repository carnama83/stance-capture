-- Coverage is stamped by a trigger rather than by editing the refreshers.
-- "Which languages were live when this number was computed" is precisely
-- "which languages were live when this row was written", so the trigger
-- expresses the requirement more directly than threading a column through a
-- 10KB function -- and it cannot be forgotten by a future refresher.

create or replace function public.stamp_stance_stats_coverage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.coverage_languages := public.question_language_coverage(new.question_id);
  return new;
end;
$$;

drop trigger if exists trg_stamp_coverage on public.question_stance_stats;
create trigger trg_stamp_coverage
  before insert or update on public.question_stance_stats
  for each row execute function public.stamp_stance_stats_coverage();

drop trigger if exists trg_stamp_coverage_region on public.question_stance_stats_region;
create trigger trg_stamp_coverage_region
  before insert or update on public.question_stance_stats_region
  for each row execute function public.stamp_stance_stats_coverage();
