-- "Refine this suggestion" (question-edit action "refine") adjusts a pending
-- suggestion instead of regenerating from the live question. Record which
-- suggestion each refinement came from, so a chain of refinements can be read
-- back in order. The refined-from row is marked 'superseded' by the function.
alter table public.question_edit_suggestions
  add column if not exists refined_from uuid references public.question_edit_suggestions(id) on delete set null;

create index if not exists idx_question_edit_suggestions_refined_from
  on public.question_edit_suggestions (refined_from) where refined_from is not null;

notify pgrst, 'reload schema';
