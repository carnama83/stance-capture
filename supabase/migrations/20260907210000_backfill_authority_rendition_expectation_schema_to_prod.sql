-- Backfill 14 tables + 3 views that exist on UAT/dev but never made it to prod.
-- prod's baseline predates the entire authority-accountability system, the
-- multi-language rendition system, WhatsApp sign-in, and collective-action
-- opt-ins. Reconstructed via catalog introspection against UAT (same
-- technique used for the earlier dev->UAT backfill), in FK dependency order.

-- ── languages / language_regions ────────────────────────────────────────────
CREATE TABLE public.languages (
  language_code text NOT NULL,
  display_name_native text NOT NULL,
  display_name_english text NOT NULL,
  script text NOT NULL,
  whatsapp_template_code text,
  is_active_for_ugq boolean NOT NULL DEFAULT false,
  is_active_for_ui boolean NOT NULL DEFAULT false,
  transform_model text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT languages_pkey PRIMARY KEY (language_code)
);

CREATE TABLE public.language_regions (
  language_code text NOT NULL,
  region_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT language_regions_pkey PRIMARY KEY (language_code, region_id),
  CONSTRAINT language_regions_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.languages(language_code) ON DELETE CASCADE,
  CONSTRAINT language_regions_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.locations(id) ON DELETE CASCADE
);
CREATE INDEX language_regions_language_code_idx ON public.language_regions USING btree (language_code);
CREATE INDEX language_regions_region_id_idx ON public.language_regions USING btree (region_id);

-- ── authority_registry / authority_briefs / authority_responses ────────────
CREATE TABLE public.authority_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  jurisdiction_level text NOT NULL,
  region_id uuid,
  domain text NOT NULL,
  contact_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT authority_registry_pkey PRIMARY KEY (id),
  CONSTRAINT authority_registry_domain_check CHECK ((domain = ANY (ARRAY['water'::text, 'health'::text, 'policing'::text, 'transport'::text, 'environment'::text, 'education'::text, 'other'::text]))),
  CONSTRAINT authority_registry_jurisdiction_level_check CHECK ((jurisdiction_level = ANY (ARRAY['local'::text, 'state'::text, 'national'::text, 'international'::text])))
);
CREATE INDEX authority_registry_domain_idx ON public.authority_registry USING btree (domain);
CREATE INDEX authority_registry_region_id_idx ON public.authority_registry USING btree (region_id);

CREATE TABLE public.authority_briefs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  region_id uuid,
  authority_id uuid NOT NULL,
  brief_text text,
  generated_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  status text NOT NULL DEFAULT 'draft'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT authority_briefs_pkey PRIMARY KEY (id),
  CONSTRAINT authority_briefs_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT authority_briefs_authority_id_fkey FOREIGN KEY (authority_id) REFERENCES public.authority_registry(id) ON DELETE CASCADE,
  CONSTRAINT authority_briefs_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT authority_briefs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'delivered'::text])))
);
CREATE INDEX authority_briefs_question_id_idx ON public.authority_briefs USING btree (question_id);
CREATE INDEX authority_briefs_status_idx ON public.authority_briefs USING btree (status);

CREATE TABLE public.authority_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  authority_id uuid NOT NULL,
  region_id uuid,
  response_status text NOT NULL DEFAULT 'unacknowledged'::text,
  status_updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid,
  notes text,
  CONSTRAINT authority_responses_pkey PRIMARY KEY (id),
  CONSTRAINT authority_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT authority_responses_authority_id_fkey FOREIGN KEY (authority_id) REFERENCES public.authority_registry(id) ON DELETE CASCADE,
  CONSTRAINT authority_responses_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT authority_responses_response_status_check CHECK ((response_status = ANY (ARRAY['unacknowledged'::text, 'under_review'::text, 'action_announced'::text, 'action_completed'::text, 'no_response'::text])))
);
CREATE INDEX authority_responses_question_id_idx ON public.authority_responses USING btree (question_id);
CREATE UNIQUE INDEX authority_responses_unique_named_region ON public.authority_responses USING btree (question_id, authority_id, region_id) WHERE (region_id IS NOT NULL);
CREATE UNIQUE INDEX authority_responses_unique_null_region ON public.authority_responses USING btree (question_id, authority_id) WHERE (region_id IS NULL);

-- ── question_authority_map / pending_authority_suggestions / user_authority_suggestions
CREATE TABLE public.question_authority_map (
  question_id uuid NOT NULL,
  authority_id uuid NOT NULL,
  confidence_level text NOT NULL DEFAULT 'confirmed'::text,
  assigned_by uuid,
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT question_authority_map_pkey PRIMARY KEY (question_id, authority_id),
  CONSTRAINT question_authority_map_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT question_authority_map_authority_id_fkey FOREIGN KEY (authority_id) REFERENCES public.authority_registry(id) ON DELETE CASCADE,
  CONSTRAINT question_authority_map_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT question_authority_map_confidence_level_check CHECK ((confidence_level = ANY (ARRAY['confirmed'::text, 'likely'::text, 'unclear'::text])))
);
CREATE INDEX question_authority_map_authority_id_idx ON public.question_authority_map USING btree (authority_id);

CREATE TABLE public.pending_authority_suggestions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  candidate_name text NOT NULL,
  candidate_type text NOT NULL,
  source_article_id uuid,
  status text NOT NULL DEFAULT 'pending'::text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pending_authority_suggestions_pkey PRIMARY KEY (id),
  CONSTRAINT pending_authority_suggestions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT pending_authority_suggestions_source_article_id_fkey FOREIGN KEY (source_article_id) REFERENCES public.news_items(id) ON DELETE SET NULL,
  CONSTRAINT pending_authority_suggestions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT pending_authority_suggestions_candidate_type_check CHECK ((candidate_type = ANY (ARRAY['institution'::text, 'named_official'::text]))),
  CONSTRAINT pending_authority_suggestions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text])))
);
CREATE INDEX pending_authority_suggestions_question_id_idx ON public.pending_authority_suggestions USING btree (question_id);
CREATE INDEX pending_authority_suggestions_status_idx ON public.pending_authority_suggestions USING btree (status);

CREATE TABLE public.user_authority_suggestions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  authority_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'suggested'::text,
  suggested_by text NOT NULL DEFAULT 'ai'::text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_authority_suggestions_pkey PRIMARY KEY (id),
  CONSTRAINT user_authority_suggestions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT user_authority_suggestions_authority_id_fkey FOREIGN KEY (authority_id) REFERENCES public.authority_registry(id) ON DELETE CASCADE,
  CONSTRAINT user_authority_suggestions_question_id_authority_id_key UNIQUE (question_id, authority_id),
  CONSTRAINT user_authority_suggestions_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'user_tagged'::text, 'approved'::text, 'rejected'::text]))),
  CONSTRAINT user_authority_suggestions_suggested_by_check CHECK ((suggested_by = ANY (ARRAY['ai'::text, 'user'::text])))
);
CREATE INDEX idx_user_authority_suggestions_question ON public.user_authority_suggestions USING btree (question_id);
CREATE INDEX idx_user_authority_suggestions_pending_review ON public.user_authority_suggestions USING btree (status) WHERE (status = 'user_tagged'::text);

-- ── collective_action_optins / question_expectations / expectation_ledgers ──
CREATE TABLE public.collective_action_optins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  region_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT collective_action_optins_pkey PRIMARY KEY (id),
  CONSTRAINT collective_action_optins_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT collective_action_optins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT collective_action_optins_user_question_key UNIQUE (user_id, question_id)
);
CREATE INDEX collective_action_optins_question_id_idx ON public.collective_action_optins USING btree (question_id);

CREATE TABLE public.question_expectations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  question_id uuid NOT NULL,
  expectation_type text NOT NULL,
  region_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT question_expectations_pkey PRIMARY KEY (id),
  CONSTRAINT question_expectations_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT question_expectations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT question_expectations_user_question_type_key UNIQUE (user_id, question_id, expectation_type),
  CONSTRAINT question_expectations_expectation_type_check CHECK ((expectation_type = ANY (ARRAY['investigation'::text, 'compensation'::text, 'policy_reform'::text, 'transparency'::text, 'infrastructure_fix'::text, 'accountability'::text, 'legal_action'::text, 'no_action'::text, 'unsure'::text, 'criminal_prosecution'::text, 'departmental_suspension'::text, 'independent_investigation'::text, 'compensation_only'::text, 'administrative_transfer'::text, 'no_accountability_expected'::text])))
);
CREATE INDEX question_expectations_question_id_idx ON public.question_expectations USING btree (question_id);
CREATE INDEX question_expectations_region_id_idx ON public.question_expectations USING btree (region_id);
CREATE INDEX question_expectations_user_id_idx ON public.question_expectations USING btree (user_id);

CREATE TABLE public.expectation_ledgers (
  question_id uuid NOT NULL,
  region_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft'::text,
  snapshot_summary jsonb,
  participation_count integer,
  time_window_start timestamp with time zone,
  time_window_end timestamp with time zone,
  published_at timestamp with time zone,
  published_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  optin_count integer DEFAULT 0,
  CONSTRAINT expectation_ledgers_pkey PRIMARY KEY (question_id, region_id),
  CONSTRAINT expectation_ledgers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT expectation_ledgers_published_by_fkey FOREIGN KEY (published_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT expectation_ledgers_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);
CREATE INDEX expectation_ledgers_status_idx ON public.expectation_ledgers USING btree (status);

-- ── question_renditions ─────────────────────────────────────────────────────
CREATE TABLE public.question_renditions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  language_code text NOT NULL,
  rendered_text text,
  slider_low_label text,
  slider_high_label text,
  transform_status text NOT NULL DEFAULT 'pending'::text,
  transform_model text,
  transform_prompt_version text,
  generation_reason text,
  axis_equivalence_check text,
  axis_equivalence_notes text,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  claimed_at timestamp with time zone,
  context_summary text,
  CONSTRAINT question_renditions_pkey PRIMARY KEY (id),
  CONSTRAINT question_renditions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE,
  CONSTRAINT question_renditions_language_code_fkey FOREIGN KEY (language_code) REFERENCES public.languages(language_code),
  CONSTRAINT question_renditions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(user_id),
  CONSTRAINT question_renditions_unique UNIQUE (question_id, language_code),
  CONSTRAINT question_renditions_axis_equivalence_check_check CHECK (((axis_equivalence_check IS NULL) OR (axis_equivalence_check = ANY (ARRAY['pass'::text, 'needs_review'::text, 'failed'::text])))),
  CONSTRAINT question_renditions_generation_reason_check CHECK (((generation_reason IS NULL) OR (generation_reason = ANY (ARRAY['editorial_pipeline'::text, 'community_proposer'::text, 'manual_admin'::text])))),
  CONSTRAINT question_renditions_transform_status_check CHECK ((transform_status = ANY (ARRAY['pending'::text, 'transformed'::text, 'verified'::text, 'flagged'::text, 'published'::text]))),
  CONSTRAINT question_renditions_publish_requires_text CHECK (((transform_status <> 'published'::text) OR ((rendered_text IS NOT NULL) AND (btrim(rendered_text) <> ''::text))))
);
CREATE INDEX idx_question_renditions_question ON public.question_renditions USING btree (question_id);
CREATE INDEX idx_question_renditions_review_queue ON public.question_renditions USING btree (transform_status, axis_equivalence_check) WHERE (transform_status <> 'published'::text);

-- ── whatsapp_card_cache / whatsapp_signin_tokens ────────────────────────────
CREATE TABLE public.whatsapp_card_cache (
  question_id uuid NOT NULL,
  image_url text,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '01:00:00'::interval),
  cached_total_responses integer NOT NULL DEFAULT 0,
  regenerating_since timestamp with time zone,
  render_version integer NOT NULL DEFAULT 0,
  stats_updated_at timestamp with time zone,
  CONSTRAINT whatsapp_card_cache_pkey PRIMARY KEY (question_id)
);

CREATE TABLE public.whatsapp_signin_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token text NOT NULL,
  user_id uuid NOT NULL,
  device_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  question_id uuid,
  CONSTRAINT whatsapp_signin_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_signin_tokens_token_key UNIQUE (token),
  CONSTRAINT whatsapp_signin_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT whatsapp_signin_tokens_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE SET NULL
);
CREATE INDEX whatsapp_signin_tokens_pending_idx ON public.whatsapp_signin_tokens USING btree (expires_at) WHERE (used_at IS NULL);

-- ── RLS: enable + policies (content verified identical to UAT) ─────────────
ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY languages_public_read ON public.languages FOR SELECT USING (true);

ALTER TABLE public.language_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY epicb_admin_language_regions_all ON public.language_regions FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

ALTER TABLE public.authority_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY authority_registry_public_read ON public.authority_registry FOR SELECT USING (true);
CREATE POLICY authority_registry_admin_write ON public.authority_registry FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

ALTER TABLE public.authority_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY authority_briefs_admin_all ON public.authority_briefs FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

ALTER TABLE public.authority_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY authority_responses_public_read ON public.authority_responses FOR SELECT USING (true);
CREATE POLICY authority_responses_admin_write ON public.authority_responses FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

ALTER TABLE public.question_authority_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY question_authority_map_public_read ON public.question_authority_map FOR SELECT USING (true);
CREATE POLICY question_authority_map_admin_write ON public.question_authority_map FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

ALTER TABLE public.pending_authority_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_authority_suggestions_admin_all ON public.pending_authority_suggestions FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

ALTER TABLE public.user_authority_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_authority_suggestions_admin_write ON public.user_authority_suggestions FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
CREATE POLICY user_authority_suggestions_read ON public.user_authority_suggestions FOR SELECT USING (is_admin(auth.uid()) OR (EXISTS ( SELECT 1 FROM questions q WHERE ((q.id = user_authority_suggestions.question_id) AND (q.proposed_by = auth.uid())))));

ALTER TABLE public.collective_action_optins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own opt-in" ON public.collective_action_optins FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own opt-in" ON public.collective_action_optins FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.question_expectations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own expectations" ON public.question_expectations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own expectations" ON public.question_expectations FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.expectation_ledgers ENABLE ROW LEVEL SECURITY;
CREATE POLICY expectation_ledgers_public_read_published ON public.expectation_ledgers FOR SELECT USING (status = 'published'::text);
CREATE POLICY expectation_ledgers_admin_all ON public.expectation_ledgers FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

ALTER TABLE public.question_renditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY question_renditions_public_read ON public.question_renditions FOR SELECT USING (transform_status = 'published'::text);
CREATE POLICY question_renditions_admin_write ON public.question_renditions FOR ALL USING (is_admin_me());

-- whatsapp_card_cache / whatsapp_signin_tokens: no RLS policies on UAT either
-- (service-role-only tables, accessed exclusively via edge functions using the
-- service key, which always bypasses RLS) — enabling RLS with zero policies
-- here correctly blocks anon/authenticated entirely, matching UAT's behavior.
ALTER TABLE public.whatsapp_card_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_signin_tokens ENABLE ROW LEVEL SECURITY;

-- ── Views ────────────────────────────────────────────────────────────────────
CREATE VIEW public.question_expectation_summary AS
 WITH totals AS (
         SELECT question_expectations.question_id,
            question_expectations.region_id,
            count(DISTINCT question_expectations.user_id) AS total_respondents
           FROM question_expectations
          GROUP BY question_expectations.question_id, question_expectations.region_id
        )
 SELECT qe.question_id,
    qe.region_id,
    qe.expectation_type,
    (count(*))::integer AS response_count,
    t.total_respondents,
    round((((count(*))::numeric / (NULLIF(t.total_respondents, 0))::numeric) * (100)::numeric), 2) AS pct_of_respondents,
    min(qe.created_at) AS first_response_at,
    max(qe.created_at) AS last_response_at
   FROM (question_expectations qe
     JOIN totals t ON (((t.question_id = qe.question_id) AND (NOT (t.region_id IS DISTINCT FROM qe.region_id)))))
  GROUP BY qe.question_id, qe.region_id, qe.expectation_type, t.total_respondents;

COMMENT ON VIEW public.question_expectation_summary IS
  'SECURITY DEFINER by design: aggregates question_expectations (RLS: '
  'owner-only SELECT) into the public, no-login Expectation Ledger '
  '(/ledger/:questionId/:regionId, see PublicLedgerPage.tsx). Converting to '
  'SECURITY INVOKER would return empty results for every anonymous visitor.';

CREATE VIEW public.region_expectation_strength AS
 WITH cfg AS (
         SELECT COALESCE(max(app_config_trending.value) FILTER (WHERE (app_config_trending.key = 'expectation_threshold_pct'::text)), (65)::numeric) AS threshold_pct,
            COALESCE(max(app_config_trending.value) FILTER (WHERE (app_config_trending.key = 'expectation_min_respondents'::text)), (100)::numeric) AS min_respondents,
            COALESCE(max(app_config_trending.value) FILTER (WHERE (app_config_trending.key = 'expectation_persistence_hours'::text)), (72)::numeric) AS persistence_hours
           FROM app_config_trending
        ), ranked AS (
         SELECT s.question_id,
            s.region_id,
            s.expectation_type,
            s.response_count,
            s.total_respondents,
            s.pct_of_respondents,
            s.first_response_at,
            s.last_response_at,
            row_number() OVER (PARTITION BY s.question_id, s.region_id ORDER BY s.pct_of_respondents DESC NULLS LAST, s.response_count DESC) AS rn
           FROM question_expectation_summary s
        )
 SELECT r.question_id,
    r.region_id,
    r.expectation_type AS dominant_expectation_type,
    r.pct_of_respondents AS signal_strength_score,
    r.total_respondents,
    ((r.pct_of_respondents >= cfg.threshold_pct) AND ((r.total_respondents)::numeric >= cfg.min_respondents) AND ((EXTRACT(epoch FROM (r.last_response_at - r.first_response_at)) / 3600.0) >= cfg.persistence_hours)) AS signal_crossed
   FROM (ranked r
     CROSS JOIN cfg)
  WHERE (r.rn = 1);

CREATE VIEW public.admin_rendition_review_queue AS
 SELECT qr.id AS rendition_id,
    qr.question_id,
    qr.language_code,
    l.display_name_english AS language_name,
    qr.rendered_text,
    qr.slider_low_label,
    qr.slider_high_label,
    qr.transform_status,
    qr.axis_equivalence_check,
    qr.axis_equivalence_notes,
    qr.review_notes,
    qr.generation_reason,
    qr.created_at AS rendition_created_at,
    qr.updated_at AS rendition_updated_at,
    q.question AS canonical_text,
    q.slider_low_label AS canonical_slider_low_label,
    q.slider_high_label AS canonical_slider_high_label,
    q.canonical_language
   FROM ((question_renditions qr
     JOIN questions q ON ((q.id = qr.question_id)))
     JOIN languages l ON ((l.language_code = qr.language_code)))
  WHERE (qr.transform_status = ANY (ARRAY['transformed'::text, 'flagged'::text]))
  ORDER BY
        CASE qr.axis_equivalence_check
            WHEN 'failed'::text THEN 0
            WHEN 'needs_review'::text THEN 1
            ELSE 2
        END, qr.created_at;

-- Now that question_expectation_summary exists, restore the documentation
-- comment the earlier harden_rls_and_views migration had to skip on prod.
