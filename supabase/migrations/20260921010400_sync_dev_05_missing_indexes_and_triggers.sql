-- Indexes and updated_at triggers present on Dev but missing downstream.
-- Promoted from Dev (stance-capture-dev) as part of the Dev -> UAT -> Prod sync, 2026-09-21.
-- Function bodies captured verbatim from Dev live catalog via pg_get_functiondef().

-- questions_content_type_idx is Dev-only (missing on UAT and Prod).
-- The other three are missing on Prod only. All are IF NOT EXISTS, so this is
-- safe to run in every environment.

CREATE INDEX IF NOT EXISTS questions_content_type_idx ON public.questions USING btree (content_type);
CREATE INDEX IF NOT EXISTS idx_questions_needs_review ON public.questions USING btree (auto_published, admin_reviewed_at) WHERE ((auto_published = true) AND (admin_reviewed_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_uqp_framing_flag_leading ON public.user_question_proposals USING btree (created_at) WHERE (framing_flag = 'leading'::text);
CREATE INDEX IF NOT EXISTS locations_parent_id_idx ON public.locations USING btree (parent_id);

-- Without these, authority_registry.updated_at and question_renditions.updated_at
-- never advance on Prod. set_updated_at() already exists in all three environments.
DROP TRIGGER IF EXISTS authority_registry_set_updated ON public.authority_registry;
CREATE TRIGGER authority_registry_set_updated BEFORE UPDATE ON public.authority_registry FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS question_renditions_set_updated ON public.question_renditions;
CREATE TRIGGER question_renditions_set_updated BEFORE UPDATE ON public.question_renditions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
