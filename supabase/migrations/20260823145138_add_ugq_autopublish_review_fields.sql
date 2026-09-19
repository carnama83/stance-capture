-- Epic UGQ (Aug 2026): UGQ proposals that clear Gate 1 now publish immediately
-- using the unverified preview reframe, instead of waiting on admin approval.
-- These columns let admin review happen IN PARALLEL, after the question is
-- already live, rather than gating publication:
--   auto_published      — true when published via the new Gate-1-only path
--                          (as opposed to the existing admin-approved,
--                          fact-checked Stage A/B/C pipeline in ugq-moderate).
--   admin_reviewed_at   — set once an admin has looked at an auto-published
--                          question (confirm/edit/unpublish all set this).
--   admin_reviewed_by   — admin user id, for audit purposes.
-- Takedown mechanism: questions.status only allows 'active'/'archived' (see
-- questions_status_check) and both get_for_you_feed and
-- get_trending_questions_homepage filter strictly on status = 'active', so
-- flipping to 'archived' (already-existing archived_at/archive_reason columns)
-- reliably removes a question from every feed — this is what the new
-- ugq-moderate "unpublish" action uses.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS auto_published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by uuid;

COMMENT ON COLUMN public.questions.auto_published IS
  'True when this question was published immediately by ugq-screen using the unverified preview reframe (Aug 2026 UGQ instant-publish path), rather than through the admin-approved fact-checked pipeline. Surfaces in the parallel-review queue until admin_reviewed_at is set.';
COMMENT ON COLUMN public.questions.admin_reviewed_at IS
  'When an admin confirmed, edited, or unpublished an auto_published question. NULL = still pending parallel review.';
COMMENT ON COLUMN public.questions.admin_reviewed_by IS
  'Admin user id who last reviewed this auto_published question.';

CREATE INDEX IF NOT EXISTS idx_questions_needs_review
  ON public.questions (auto_published, admin_reviewed_at)
  WHERE auto_published = true AND admin_reviewed_at IS NULL;
