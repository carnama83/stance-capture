create extension if not exists "pg_cron" with schema "pg_catalog";
create extension if not exists "http" with schema "extensions";
create extension if not exists "vector" with schema "extensions";
create schema if not exists "admin";
create schema if not exists "private";
create extension if not exists "pg_trgm" with schema "public";
create type "public"."cognitive_state_status" as enum ('current', 'historical', 'computing');
create type "public"."display_handle_mode_enum" as enum ('random_id', 'username');
create type "public"."election_country_enum" as enum ('IN', 'US');
create type "public"."election_state_enum" as enum ('UPCOMING', 'CAMPAIGN_ACTIVE', 'MCC_ACTIVE', 'SILENCE', 'POLLING', 'COUNTING', 'POST_ELECTION_RESULT_PENDING', 'POST_ELECTION_COALITION_FORMING', 'RESULT_DECLARED', 'ARCHIVED');
create type "public"."election_subtype_enum" as enum ('GENERAL', 'BY_ELECTION', 'PRIMARY', 'RUNOFF', 'SNAP');
create type "public"."election_tier_code_enum" as enum ('IN_VIDHAN_SABHA', 'IN_LOK_SABHA', 'IN_GRAM_PANCHAYAT', 'IN_BLOCK_PANCHAYAT', 'IN_ZILA_PANCHAYAT', 'IN_MUNICIPAL', 'IN_VIDHAN_PARISHAD', 'US_PRESIDENTIAL', 'US_SENATE', 'US_HOUSE', 'US_GOVERNOR', 'US_STATE_SENATE', 'US_STATE_HOUSE');
create type "public"."follow_type_enum" as enum ('topic', 'region', 'tag');
create type "public"."location_tier_enum" as enum ('city', 'county', 'state', 'country', 'global');
create type "public"."mfa_type_enum" as enum ('totp', 'passkey', 'sms');
create type "public"."precision_enum" as enum ('city', 'county', 'state', 'country', 'none');
create type "public"."publisher_status" as enum ('pending', 'approved', 'suspended');
create type "public"."question_state" as enum ('new', 'active', 'dormant', 'archived', 'cooling', 'historical');
create type "public"."question_state_enum" as enum ('active', 'cooling', 'dormant', 'archived', 'historical');
create type "public"."question_visibility_enum" as enum ('visible', 'suppressed', 'archived', 'manual_only');
create type "public"."share_platform" as enum ('twitter', 'facebook', 'whatsapp', 'linkedin', 'copy', 'native');
create type "public"."share_type" as enum ('question', 'stance');
create type "public"."social_provider" as enum ('google', 'facebook', 'apple', 'twitter');
create type "public"."user_status_enum" as enum ('active', 'suspended', 'deleted');
create sequence "admin"."audit_log_id_seq";
create sequence "admin"."cron_runs_id_seq";
create sequence "admin"."fn_perf_id_seq";
create sequence "admin"."rpc_perf_id_seq";
create sequence "public"."ai_question_draft_versions_id_seq";
create table "admin"."audit_log" (
    "id" bigint not null default nextval('admin.audit_log_id_seq'::regclass),
    "user_id" uuid,
    "action" text not null,
    "table_name" text,
    "record_id" text,
    "details" jsonb,
    "ip_address" inet,
    "created_at" timestamp with time zone default now()
      );
create table "admin"."cron_runs" (
    "id" bigint not null default nextval('admin.cron_runs_id_seq'::regclass),
    "job" text not null,
    "started_at" timestamp with time zone not null default now(),
    "finished_at" timestamp with time zone,
    "ok" boolean,
    "http_status" integer,
    "message" text
      );
create table "admin"."fn_perf" (
    "id" bigint not null default nextval('admin.fn_perf_id_seq'::regclass),
    "func" text not null,
    "trace_id" uuid,
    "at" timestamp with time zone not null default now(),
    "items" integer,
    "duration_ms" integer not null,
    "external_ms" integer,
    "db_ms" integer,
    "compute_ms" integer,
    "ok" boolean default true,
    "note" text
      );
create table "admin"."rpc_perf" (
    "id" bigint not null default nextval('admin.rpc_perf_id_seq'::regclass),
    "name" text not null,
    "at" timestamp with time zone not null default now(),
    "duration_ms" integer not null,
    "ok" boolean default true,
    "note" text
      );
create table "private"."kv_secrets" (
    "key" text not null,
    "value" text not null
      );
create table "private"."secrets" (
    "key" text not null,
    "val" text not null
      );
create table "public"."admin_fn_perf" (
    "id" uuid not null default gen_random_uuid(),
    "func" text not null,
    "trace_id" uuid not null,
    "duration_ms" integer,
    "external_ms" integer,
    "db_ms" integer,
    "compute_ms" integer,
    "items" integer,
    "ok" boolean default true,
    "note" text,
    "created_at" timestamp with time zone default now()
      );
create table "public"."admin_users" (
    "user_id" uuid not null,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."admin_users" enable row level security;
create table "public"."ai_prompts" (
    "id" uuid not null default gen_random_uuid(),
    "prompt_key" text not null,
    "version" integer not null default 1,
    "label" text not null,
    "description" text,
    "system_prompt" text not null,
    "user_prompt_template" text not null,
    "model" text not null default 'gpt-4o-mini'::text,
    "temperature" numeric not null default 0.7,
    "max_tokens" integer not null default 800,
    "is_active" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "notes" text
      );
alter table "public"."ai_prompts" enable row level security;
create table "public"."ai_question_draft_versions" (
    "id" bigint not null default nextval('public.ai_question_draft_versions_id_seq'::regclass),
    "draft_id" uuid not null,
    "snapshot" jsonb not null,
    "edited_by" uuid,
    "edited_at" timestamp with time zone not null default now()
      );
alter table "public"."ai_question_draft_versions" enable row level security;
create table "public"."ai_question_drafts" (
    "id" uuid not null default gen_random_uuid(),
    "cluster_id" uuid,
    "title" text not null,
    "summary" text,
    "tags" text[] default '{}'::text[],
    "sources" jsonb not null,
    "lang" text default 'en'::text,
    "state" text not null default 'draft'::text,
    "reason" text,
    "guardrail_flags" text[] default '{}'::text[],
    "qa_passed" boolean,
    "created_at" timestamp with time zone not null default now(),
    "created_by" uuid default auth.uid()
      );
alter table "public"."ai_question_drafts" enable row level security;
create table "public"."app_config_trending" (
    "key" text not null,
    "value" numeric not null,
    "updated_at" timestamp with time zone not null default now(),
    "description" text
      );
create table "public"."audience_segments" (
    "id" uuid not null default gen_random_uuid(),
    "key" text not null,
    "name" text not null,
    "description" text,
    "status" text not null default 'active'::text,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."audience_segments" enable row level security;
create table "public"."avatars" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "url" text not null,
    "alt_text" text,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."avatars" enable row level security;
create table "public"."backup_codes" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "code_hash" text not null,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."backup_codes" enable row level security;
create table "public"."cognitive_state_snapshots" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "snapshot_at" timestamp with time zone not null default now(),
    "question_count" integer not null,
    "mean_stance" numeric(4,2),
    "active_topics" text[],
    "last_stance_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."cognitive_state_snapshots" enable row level security;
create table "public"."comment_reactions" (
    "id" uuid not null default gen_random_uuid(),
    "comment_id" uuid not null,
    "user_id" uuid not null,
    "reaction" text not null,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."comment_reactions" enable row level security;
create table "public"."comment_reports" (
    "id" uuid not null default gen_random_uuid(),
    "comment_id" uuid not null,
    "reporter_id" uuid not null,
    "reason" text not null,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."comment_reports" enable row level security;
create table "public"."comments" (
    "id" uuid not null default gen_random_uuid(),
    "topic_id" uuid,
    "parent_id" uuid,
    "user_id" uuid,
    "user_display" text,
    "body" text not null,
    "created_at" timestamp with time zone not null default now(),
    "question_id" uuid,
    "edited_at" timestamp with time zone,
    "is_deleted" boolean not null default false,
    "sentiment_score" numeric,
    "sentiment_label" text
      );
alter table "public"."comments" enable row level security;
create table "public"."community_trends" (
    "id" uuid not null default gen_random_uuid(),
    "snapshot_date" date not null,
    "region_scope" text not null,
    "region_key" text not null,
    "region_label" text not null,
    "total_questions" integer not null default 0,
    "total_responses" integer not null default 0,
    "avg_pct_support" numeric,
    "avg_pct_neutral" numeric,
    "avg_pct_oppose" numeric,
    "avg_score" numeric,
    "score_stddev" numeric,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."community_trends" enable row level security;
create table "public"."consent_logs" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "consent_key" text not null,
    "granted" boolean not null,
    "version" text,
    "source_ip" inet,
    "ua" text,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."consent_logs" enable row level security;
create table "public"."contribution_acknowledgements" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "trigger_type" text not null,
    "context" jsonb,
    "shown_at" timestamp with time zone not null default now(),
    "dismissed_at" timestamp with time zone
      );
alter table "public"."contribution_acknowledgements" enable row level security;
create table "public"."daily_curated_questions" (
    "date" date not null,
    "question_ids" uuid[] not null default '{}'::uuid[],
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."daily_curated_questions" enable row level security;
create table "public"."deletion_requests" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "requested_at" timestamp with time zone not null default now(),
    "execute_after" timestamp with time zone not null,
    "cancelled_at" timestamp with time zone,
    "executed_at" timestamp with time zone,
    "status" text not null default 'pending'::text
      );
alter table "public"."deletion_requests" enable row level security;
create table "public"."demographic_breakdowns" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid not null,
    "snapshot_date" date not null,
    "dimension" text not null,
    "dimension_value" text not null,
    "total_responses" integer not null default 0,
    "pct_support" numeric,
    "pct_neutral" numeric,
    "pct_oppose" numeric,
    "avg_score" numeric,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."demographic_breakdowns" enable row level security;
create table "public"."devices" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "device_fingerprint" text not null,
    "last_seen_at" timestamp with time zone
      );
alter table "public"."devices" enable row level security;
create table "public"."election_anomaly_events" (
    "id" uuid not null default gen_random_uuid(),
    "election_id" uuid,
    "question_id" uuid,
    "anomaly_type" text not null,
    "user_id" uuid,
    "evidence" jsonb not null default '{}'::jsonb,
    "severity" text not null default 'MEDIUM'::text,
    "reviewed" boolean not null default false,
    "reviewed_by" uuid,
    "reviewed_at" timestamp with time zone,
    "review_action" text,
    "review_notes" text,
    "affected_stance_ids" uuid[],
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."election_anomaly_events" enable row level security;
create table "public"."election_audit_log" (
    "id" uuid not null default gen_random_uuid(),
    "election_id" uuid,
    "action" text not null,
    "actor_id" uuid,
    "target_table" text,
    "target_id" uuid,
    "old_value" jsonb,
    "new_value" jsonb,
    "notes" text,
    "ip_address" inet,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."election_audit_log" enable row level security;
create table "public"."election_candidates" (
    "id" uuid not null default gen_random_uuid(),
    "election_id" uuid not null,
    "constituency_id" uuid not null,
    "party_id" uuid,
    "previous_party_id" uuid,
    "party_switched_at" timestamp with time zone,
    "party_switch_notes" text,
    "full_name" text not null,
    "full_name_local" text,
    "display_name" text,
    "date_of_birth" date,
    "gender" text,
    "photo_path" text,
    "affidavit_url" text,
    "website_url" text,
    "status" text not null default 'DECLARED'::text,
    "status_changed_at" timestamp with time zone not null default now(),
    "import_batch_id" text,
    "import_source" text default 'manual'::text,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_candidates" enable row level security;
create table "public"."election_compliance_rules" (
    "id" uuid not null default gen_random_uuid(),
    "election_id" uuid not null,
    "rule_type" text not null,
    "silence_hours" integer,
    "override_start_at" timestamp with time zone,
    "exit_poll_gate_minutes" integer,
    "disclaimer_text" text,
    "legal_citation" text not null,
    "notes" text,
    "created_by" uuid not null,
    "approved_by" uuid,
    "approved_at" timestamp with time zone,
    "is_active" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_compliance_rules" enable row level security;
create table "public"."election_constituencies" (
    "id" uuid not null default gen_random_uuid(),
    "tier_code" public.election_tier_code_enum not null,
    "constituency_code" text not null,
    "name" text not null,
    "name_local" text,
    "state_code" text,
    "state_name" text,
    "district_name" text,
    "parent_constituency_id" uuid,
    "valid_from" date not null default '2008-01-01'::date,
    "valid_to" date,
    "ev_count" integer,
    "latitude" numeric(9,6),
    "longitude" numeric(9,6),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_constituencies" enable row level security;
create table "public"."election_issue_tag_allowlists" (
    "id" uuid not null default gen_random_uuid(),
    "tier_code" public.election_tier_code_enum not null,
    "tag" text not null,
    "tag_local" text,
    "description" text,
    "is_active" boolean not null default true,
    "sort_order" integer not null default 0,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."election_issue_tag_allowlists" enable row level security;
create table "public"."election_parties" (
    "id" uuid not null default gen_random_uuid(),
    "country" public.election_country_enum not null,
    "party_type" text not null default 'PARTY'::text,
    "name" text not null,
    "abbreviation" text not null,
    "name_local" text,
    "eci_party_id" text,
    "fec_committee_id" text,
    "logo_path" text,
    "symbol_path" text,
    "banner_path" text,
    "brand_colour" text,
    "description" text,
    "website_url" text,
    "is_active" boolean not null default true,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_parties" enable row level security;
create table "public"."election_party_elections" (
    "id" uuid not null default gen_random_uuid(),
    "party_id" uuid not null,
    "election_id" uuid not null,
    "participation_type" text not null default 'CONTESTING'::text,
    "contesting_as_alliance_id" uuid,
    "seats_contested" integer,
    "notes" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_party_elections" enable row level security;
create table "public"."election_party_regions" (
    "id" uuid not null default gen_random_uuid(),
    "party_id" uuid not null,
    "state_code" text not null,
    "state_name" text not null,
    "tier_codes" public.election_tier_code_enum[] not null default '{}'::public.election_tier_code_enum[],
    "alliance_party_id" uuid,
    "alliance_role" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_party_regions" enable row level security;
create table "public"."election_question_drafts" (
    "id" uuid not null default gen_random_uuid(),
    "election_id" uuid not null,
    "source_document_id" uuid,
    "party_id" uuid,
    "candidate_id" uuid,
    "constituency_id" uuid,
    "question" text not null,
    "context_summary" text,
    "slider_low_label" text not null default 'Strongly disagree'::text,
    "slider_high_label" text not null default 'Strongly agree'::text,
    "issue_tag" text,
    "framing_style" text,
    "question_type" text not null default 'PARTY_POLICY'::text,
    "confidence_score" numeric(3,2),
    "potential_contradiction" boolean not null default false,
    "status" text not null default 'DRAFT'::text,
    "reviewed_by" uuid,
    "reviewed_at" timestamp with time zone,
    "review_notes" text,
    "superseded_by" uuid,
    "version" integer not null default 1,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_question_drafts" enable row level security;
create table "public"."election_source_documents" (
    "id" uuid not null default gen_random_uuid(),
    "party_id" uuid,
    "candidate_id" uuid,
    "election_id" uuid not null,
    "document_type" text not null,
    "source_url" text,
    "file_path" text,
    "original_filename" text,
    "file_size_bytes" bigint,
    "detected_language" text,
    "original_language" text,
    "scope_region" text,
    "scope_constituency_id" uuid,
    "ingestion_status" text not null default 'PENDING'::text,
    "ingestion_started_at" timestamp with time zone,
    "ingestion_completed_at" timestamp with time zone,
    "ingestion_error" text,
    "extracted_text" text,
    "page_count" integer,
    "translation_status" text not null default 'PENDING'::text,
    "translation_started_at" timestamp with time zone,
    "translation_completed_at" timestamp with time zone,
    "translation_error" text,
    "extracted_text_en" text,
    "ai_processing_status" text not null default 'PENDING'::text,
    "ai_processing_started_at" timestamp with time zone,
    "ai_processing_completed_at" timestamp with time zone,
    "ai_processing_error" text,
    "ai_question_drafts_count" integer default 0,
    "total_pipeline_seconds" integer,
    "notes" text,
    "is_active" boolean not null default true,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_source_documents" enable row level security;
create table "public"."election_stance_aggregates" (
    "id" uuid not null default gen_random_uuid(),
    "election_id" uuid not null,
    "question_id" uuid not null,
    "constituency_id" uuid,
    "constituency_code" text,
    "state_code" text,
    "scope" text not null default 'constituency'::text,
    "parent_constituency_id" uuid,
    "party_id" uuid,
    "total_responses" integer not null default 0,
    "count_strong_support" integer not null default 0,
    "count_support" integer not null default 0,
    "count_neutral" integer not null default 0,
    "count_oppose" integer not null default 0,
    "count_strong_oppose" integer not null default 0,
    "count_nota" integer not null default 0,
    "pct_support" numeric(5,2),
    "pct_neutral" numeric(5,2),
    "pct_oppose" numeric(5,2),
    "avg_score" numeric(6,4),
    "total_revealed" integer not null default 0,
    "switched_count" integer not null default 0,
    "pct_switched" numeric(5,2),
    "is_gated" boolean not null default true,
    "gate_lifted_at" timestamp with time zone,
    "meets_minimum_threshold" boolean generated always as ((total_responses >= 10)) stored,
    "last_refreshed_at" timestamp with time zone not null default now(),
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."election_stance_aggregates" enable row level security;
create table "public"."election_tiers" (
    "id" uuid not null default gen_random_uuid(),
    "tier_code" public.election_tier_code_enum not null,
    "country" public.election_country_enum not null,
    "display_name" text not null,
    "display_name_local" text,
    "description" text,
    "governing_body" text,
    "seat_count" integer,
    "compliance_track" text not null,
    "default_silence_hours" integer default 0,
    "has_mcc" boolean not null default false,
    "has_nota" boolean not null default false,
    "supports_multi_phase" boolean not null default false,
    "parent_tier_code" public.election_tier_code_enum,
    "is_active" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."election_tiers" enable row level security;
create table "public"."elections" (
    "id" uuid not null default gen_random_uuid(),
    "tier_id" uuid not null,
    "tier_code" public.election_tier_code_enum not null,
    "country" public.election_country_enum not null,
    "name" text not null,
    "election_subtype" public.election_subtype_enum not null default 'GENERAL'::public.election_subtype_enum,
    "is_snap" boolean not null default false,
    "parent_election_id" uuid,
    "phase_number" integer,
    "phase_label" text,
    "total_phases" integer,
    "announced_at" timestamp with time zone,
    "campaign_start_at" timestamp with time zone,
    "mcc_start_at" timestamp with time zone,
    "silence_start_at" timestamp with time zone,
    "polling_start_at" timestamp with time zone,
    "polling_end_at" timestamp with time zone,
    "result_declaration_at" timestamp with time zone,
    "last_phase_close_at" timestamp with time zone,
    "governing_body_code" text,
    "state" public.election_state_enum not null default 'UPCOMING'::public.election_state_enum,
    "state_changed_at" timestamp with time zone not null default now(),
    "state_changed_by" uuid,
    "legal_review_completed" boolean not null default false,
    "legal_review_completed_at" timestamp with time zone,
    "legal_review_notes" text,
    "legal_review_by" uuid,
    "sec_code_start_at" timestamp with time zone,
    "custom_silence_hours" integer,
    "disclosure_text" text,
    "anti_funding_disclaimer" text,
    "ai_generation_enabled" boolean not null default true,
    "issue_tag_allowlist_override" text[],
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."elections" enable row level security;
create table "public"."email_events" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "notification_id" uuid,
    "digest_id" uuid,
    "event_type" text not null,
    "provider_message_id" text,
    "link_url" text,
    "metadata" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."email_events" enable row level security;
create table "public"."embed_cta_events" (
    "id" uuid not null default gen_random_uuid(),
    "embedded_stance_id" uuid,
    "clicked_at" timestamp with time zone not null default now(),
    "converted_at" timestamp with time zone,
    "new_user_id" uuid
      );
alter table "public"."embed_cta_events" enable row level security;
create table "public"."embed_impressions" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid not null,
    "publisher_ref" text,
    "device_fingerprint" text not null,
    "loaded_at" timestamp with time zone not null default now(),
    "viewed_at" timestamp with time zone
      );
alter table "public"."embed_impressions" enable row level security;
create table "public"."embed_rate_limits" (
    "id" uuid not null default gen_random_uuid(),
    "key" text not null,
    "limit_type" text not null,
    "count" integer not null default 1,
    "window_start" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone not null
      );
alter table "public"."embed_rate_limits" enable row level security;
create table "public"."embed_snippet_versions" (
    "version" text not null,
    "cdn_url" text not null,
    "released_at" timestamp with time zone not null default now(),
    "deprecated_at" timestamp with time zone
      );
create table "public"."embedded_stances" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid not null,
    "stance_value" numeric not null,
    "device_fingerprint" text not null,
    "ip_hash" text not null,
    "publisher_ref" text,
    "attributed_user_id" uuid,
    "merged_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."embedded_stances" enable row level security;
create table "public"."feed_policies" (
    "id" uuid not null default gen_random_uuid(),
    "key" text not null,
    "name" text not null,
    "description" text,
    "default_audience_segment_id" uuid,
    "status" text not null default 'active'::text,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."feed_policies" enable row level security;
create table "public"."feed_policy_lanes" (
    "id" uuid not null default gen_random_uuid(),
    "policy_id" uuid not null,
    "lane_key" text not null,
    "lane_name" text not null,
    "target_percentage" numeric not null,
    "min_relevance_tier" text,
    "context_filter" jsonb,
    "sort_order" integer not null default 0,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."feed_policy_lanes" enable row level security;
create table "public"."ingested_stances" (
    "id" uuid not null default gen_random_uuid(),
    "reply_inbox_id" uuid not null,
    "question_id" uuid not null,
    "attributed_user_id" uuid,
    "stance_value" numeric not null,
    "confidence_score" numeric not null,
    "classification_reason" text,
    "status" text not null default 'pending_review'::text,
    "ingested_at" timestamp with time zone not null default now(),
    "reviewed_at" timestamp with time zone,
    "promoted_at" timestamp with time zone
      );
alter table "public"."ingested_stances" enable row level security;
create table "public"."ingestion_queue" (
    "id" uuid not null default gen_random_uuid(),
    "source_id" uuid not null,
    "external_id" text,
    "title" text not null,
    "summary" text,
    "url" text not null,
    "published_at" timestamp with time zone,
    "lang" text default 'en'::text,
    "raw" jsonb,
    "normalized" jsonb,
    "dedupe_key" text,
    "status" text not null default 'new'::text,
    "created_at" timestamp with time zone not null default now(),
    "embedding" extensions.vector(1536),
    "reason" text,
    "payload" jsonb,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "error_msg" text,
    "entities" jsonb,
    "embed_status" text,
    "embed_attempts" integer not null default 0,
    "embedded_at" timestamp with time zone,
    "embed_error" text,
    "embed_model" text,
    "entity_attempts" integer default 0
      );
alter table "public"."ingestion_queue" enable row level security;
create table "public"."location_audits" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "location_id" uuid not null,
    "override" boolean not null default false,
    "source" text,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."location_audits" enable row level security;
create table "public"."locations" (
    "id" uuid not null default gen_random_uuid(),
    "type" public.location_tier_enum not null,
    "name" text not null,
    "parent_id" uuid,
    "iso_code" text,
    "centroid" text
      );
alter table "public"."locations" enable row level security;
create table "public"."mfa_methods" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "type" public.mfa_type_enum not null,
    "public_key" text,
    "secret" text,
    "phone_e164" text,
    "added_at" timestamp with time zone not null default now(),
    "last_used_at" timestamp with time zone
      );
alter table "public"."mfa_methods" enable row level security;
create table "public"."moderation_actions" (
    "id" uuid not null default gen_random_uuid(),
    "report_id" uuid,
    "comment_id" uuid,
    "target_user_id" uuid,
    "moderator_id" uuid,
    "action" text not null,
    "reason" text,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."moderation_actions" enable row level security;
create table "public"."moderators" (
    "user_id" uuid not null,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."moderators" enable row level security;
create table "public"."news_items" (
    "id" uuid not null default gen_random_uuid(),
    "source_id" uuid not null,
    "title" text not null,
    "url" text not null,
    "summary" text,
    "lang" text not null default 'en'::text,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "image_url" text,
    "image_meta" jsonb,
    "image_checked_at" timestamp with time zone,
    "resolved_url" text
      );
alter table "public"."news_items" enable row level security;
create table "public"."notification_event_log" (
    "id" uuid not null default gen_random_uuid(),
    "event_type" text not null,
    "event_key" text not null,
    "payload" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."notification_event_log" enable row level security;
create table "public"."notification_preferences" (
    "user_id" uuid not null,
    "stance_change_enabled" boolean not null default true,
    "weekly_digest_enabled" boolean not null default true,
    "topic_follow_enabled" boolean not null default true,
    "digest_day_of_week" integer not null default 1,
    "digest_hour_local" integer not null default 9,
    "timezone" text not null default 'America/New_York'::text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "email_enabled" boolean not null default false,
    "inapp_enabled" boolean not null default true,
    "digest_frequency" text not null default 'weekly'::text,
    "quiet_hours_start" integer,
    "quiet_hours_end" integer,
    "reminder_enabled" boolean not null default true,
    "new_local_topic_enabled" boolean not null default true
      );
alter table "public"."notification_preferences" enable row level security;
create table "public"."notification_topic_prefs" (
    "user_id" uuid not null,
    "topic_id" uuid not null,
    "muted" boolean not null default true,
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."notification_topic_prefs" enable row level security;
create table "public"."og_image_cache" (
    "question_id" uuid not null,
    "image_url" text not null,
    "generated_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone not null default (now() + '01:00:00'::interval)
      );
alter table "public"."og_image_cache" enable row level security;
create table "public"."party_alliance_members" (
    "id" uuid not null default gen_random_uuid(),
    "alliance_party_id" uuid not null,
    "member_party_id" uuid not null,
    "state_code" text,
    "role" text not null default 'PARTNER'::text,
    "seat_sharing_notes" text,
    "valid_from" date not null default CURRENT_DATE,
    "valid_to" date,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."party_alliance_members" enable row level security;
create table "public"."password_resets" (
    "user_id" uuid not null,
    "token_hash" text not null,
    "expires_at" timestamp with time zone not null,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."password_resets" enable row level security;
create table "public"."pipeline_jobs" (
    "id" uuid not null default gen_random_uuid(),
    "job_type" text not null,
    "source_id" uuid,
    "status" text not null default 'running'::text,
    "started_at" timestamp with time zone not null default now(),
    "finished_at" timestamp with time zone,
    "duration_ms" integer,
    "items_processed" integer default 0,
    "error_message" text,
    "error_code" text,
    "retry_count" integer default 0,
    "resolved" boolean not null default false,
    "resolved_note" text,
    "resolved_at" timestamp with time zone,
    "metadata" jsonb default '{}'::jsonb
      );
alter table "public"."pipeline_jobs" enable row level security;
create table "public"."profiles" (
    "user_id" uuid not null,
    "random_id" text not null,
    "username" text,
    "display_handle_mode" public.display_handle_mode_enum not null default 'random_id'::public.display_handle_mode_enum,
    "bio" text,
    "avatar_url" text,
    "dob_encrypted" bytea,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "gender" text,
    "gender_self" text,
    "dob_checked" boolean not null default false,
    "last_seen_at" timestamp with time zone default now(),
    "avatar_path" text,
    "show_age" boolean not null default false,
    "audience_segment_id" uuid,
    "primary_constituency_id" uuid,
    "secondary_constituency_id" uuid,
    "tertiary_constituency_id" uuid,
    "postal_voter" boolean not null default false,
    "election_notifications_enabled" boolean not null default true,
    "verified_phone_hash" text,
    "whatsapp_flow_enabled" boolean not null default true
      );
alter table "public"."profiles" enable row level security;
create table "public"."publishers" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "domains" text[] not null default '{}'::text[],
    "contact_email" text not null,
    "status" public.publisher_status not null default 'pending'::public.publisher_status,
    "publisher_ref" text not null,
    "created_at" timestamp with time zone not null default now(),
    "approved_at" timestamp with time zone
      );
alter table "public"."publishers" enable row level security;
create table "public"."question_audience_fit" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid not null,
    "audience_segment_id" uuid not null,
    "relevance_tier" text not null,
    "reason" text,
    "source" text not null default 'ai_pipeline'::text,
    "reviewed_by_admin" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."question_audience_fit" enable row level security;
create table "public"."question_comment_sentiment" (
    "question_id" uuid not null,
    "avg_sentiment" numeric,
    "sentiment_variance" numeric,
    "comment_count" integer,
    "last_run_at" timestamp with time zone not null default now(),
    "last_model" text,
    "summary_text" text
      );
alter table "public"."question_comment_sentiment" enable row level security;
create table "public"."question_context_updates" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid not null,
    "updated_by" uuid,
    "old_phase" text,
    "new_phase" text not null,
    "new_context" text not null,
    "supporting_links" text[],
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."question_context_updates" enable row level security;
create table "public"."question_draft_audience_fit" (
    "id" uuid not null default gen_random_uuid(),
    "question_draft_id" uuid not null,
    "audience_segment_id" uuid not null,
    "relevance_tier" text not null,
    "reason" text,
    "source" text not null default 'ai_pipeline'::text,
    "reviewed_by_admin" boolean not null default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."question_draft_audience_fit" enable row level security;
create table "public"."question_drafts" (
    "id" uuid not null default gen_random_uuid(),
    "topic_draft_id" uuid not null,
    "topic_id" uuid,
    "question" text not null,
    "summary" text,
    "tags" text[] not null default '{}'::text[],
    "location_label" text,
    "status" text not null default 'draft'::text,
    "ai_version" text,
    "ai_input" jsonb,
    "ai_output" jsonb,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "framing_type" text default 'tradeoff'::text,
    "cover_image_url" text,
    "cover_news_item_id" uuid,
    "origin_location_label" text,
    "audience_location_label" text,
    "audience_reason" text,
    "raw_question" text,
    "framing_style" text,
    "core_tension" text,
    "primary_value" text,
    "secondary_value" text,
    "question_quality_score" numeric(4,2),
    "quality_notes" text,
    "reframe_prompt_id" uuid,
    "reframe_ai_output" jsonb,
    "reframed_at" timestamp with time zone,
    "scope" text,
    "reason" text,
    "created_by" uuid,
    "guardrail_flags" text[] not null default '{}'::text[],
    "qa_passed" boolean,
    "slider_low_label" text,
    "slider_high_label" text
      );
alter table "public"."question_drafts" enable row level security;
create table "public"."question_duplicates" (
    "id" uuid not null default gen_random_uuid(),
    "draft_id" uuid,
    "existing_question_id" uuid,
    "dedup_key" text not null,
    "dedup_bucket" text not null,
    "reason" text default 'duplicate_in_time_window'::text,
    "created_at" timestamp with time zone default now()
      );
create table "public"."question_engagement_metrics" (
    "question_id" uuid not null,
    "responses_last_24h" integer not null default 0,
    "responses_last_7d" integer not null default 0,
    "responses_total" integer not null default 0,
    "response_rate_24h" numeric not null default 0,
    "response_rate_7d" numeric not null default 0,
    "trending_detected_at" timestamp without time zone,
    "trending_peak_rate" numeric default 0,
    "last_major_update" timestamp without time zone,
    "update_count" integer not null default 0,
    "created_at" timestamp without time zone not null default now(),
    "updated_at" timestamp without time zone not null default now()
      );
create table "public"."question_lifecycle_config" (
    "id" uuid not null default gen_random_uuid(),
    "topic_category" text,
    "region_tier" text,
    "new_duration" numeric not null default 1,
    "active_max_age" numeric not null default 30,
    "dormant_max_age" numeric not null default 90,
    "force_archive_age" numeric not null default 90,
    "active_threshold" numeric not null default 10,
    "trending_threshold" numeric not null default 50,
    "dormant_threshold" numeric not null default 2,
    "allow_resurrection" boolean not null default true,
    "resurrection_max_age" numeric not null default 90,
    "auto_archive_on_resolution" boolean not null default true,
    "created_at" timestamp without time zone not null default now(),
    "updated_at" timestamp without time zone not null default now()
      );
create table "public"."question_links" (
    "id" uuid not null default gen_random_uuid(),
    "from_question_id" uuid,
    "to_question_id" uuid,
    "link_type" text not null,
    "score" numeric not null,
    "method" text default 'jaccard'::text,
    "created_at" timestamp with time zone default now(),
    "created_by" text default 'system'::text,
    "embedding_score" numeric
      );
create table "public"."question_stance_confidence" (
    "user_id" uuid not null,
    "question_id" uuid not null,
    "confidence" smallint not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."question_stance_confidence" enable row level security;
create table "public"."question_stance_stats" (
    "question_id" uuid not null,
    "total_responses" integer not null default 0,
    "pct_agree" numeric,
    "pct_disagree" numeric,
    "pct_neutral" numeric,
    "avg_score" numeric,
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."question_stance_stats" enable row level security;
create table "public"."question_stance_stats_history" (
    "question_id" uuid not null,
    "region_scope" text not null,
    "region_key" text not null,
    "snapshot_date" date not null,
    "total_responses" integer not null default 0,
    "avg_score" numeric,
    "pct_support" numeric,
    "pct_neutral" numeric,
    "pct_oppose" numeric,
    "created_at" timestamp with time zone not null default now()
      );
create table "public"."question_stance_stats_region" (
    "question_id" uuid not null,
    "region_scope" text not null,
    "region_key" text not null,
    "region_label" text not null,
    "total_responses" integer not null default 0,
    "pct_agree" numeric,
    "pct_disagree" numeric,
    "pct_neutral" numeric,
    "avg_score" numeric,
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."question_stance_stats_region" enable row level security;
create table "public"."question_stances" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "question_id" uuid not null,
    "score" smallint not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "source" text not null default 'native'::text,
    "original_stance_before_reveal" smallint,
    "switched_after_reveal" boolean not null default false,
    "reveal_timing_ms" integer,
    "is_flagged" boolean not null default false,
    "flagged_at" timestamp with time zone,
    "flag_reason" text,
    "whatsapp_phone_hash" text,
    "broadcast_id" uuid,
    "forward_chain_id" text
      );
alter table "public"."question_stances" enable row level security;
create table "public"."question_state_history" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid not null,
    "old_state" public.question_state,
    "new_state" public.question_state not null,
    "reason" text not null,
    "response_count" integer,
    "response_rate" numeric,
    "age_days" numeric,
    "created_at" timestamp without time zone not null default now(),
    "created_by" uuid
      );
create table "public"."question_tradeoffs" (
    "question_id" uuid not null,
    "tradeoffs" jsonb not null default '[]'::jsonb,
    "generated_at" timestamp with time zone not null default now()
      );
alter table "public"."question_tradeoffs" enable row level security;
create table "public"."question_trending_metrics" (
    "question_id" uuid not null,
    "responses_total" bigint default 0,
    "responses_24h" bigint default 0,
    "responses_7d" bigint default 0,
    "responses_prev_24h" bigint default 0,
    "unique_users_24h" bigint default 0,
    "unique_users_7d" bigint default 0,
    "velocity_score" numeric default 0,
    "recency_score" numeric default 0,
    "volume_score" numeric default 0,
    "diversity_score" numeric default 0,
    "trending_score" numeric default 0,
    "last_calculated_at" timestamp with time zone default now()
      );
create table "public"."question_view_events" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "question_id" uuid not null,
    "viewed_at" timestamp with time zone not null default now(),
    "duration_seconds" integer
      );
create table "public"."question_visibility_rules" (
    "question_id" uuid not null,
    "visibility" public.question_visibility_enum not null default 'visible'::public.question_visibility_enum,
    "reason" text,
    "last_evaluated_at" timestamp with time zone not null default now()
      );
alter table "public"."question_visibility_rules" enable row level security;
create table "public"."questions" (
    "id" uuid not null default gen_random_uuid(),
    "question_draft_id" uuid,
    "topic_draft_id" uuid,
    "news_item_id" uuid,
    "question" text not null,
    "summary" text,
    "tags" text[] not null default '{}'::text[],
    "location_label" text,
    "status" text not null default 'active'::text,
    "created_at" timestamp with time zone not null default now(),
    "created_by" uuid,
    "published_at" timestamp with time zone not null default now(),
    "state" public.question_state not null default 'new'::public.question_state,
    "state_changed_at" timestamp without time zone not null default now(),
    "archived_at" timestamp without time zone,
    "archive_reason" text,
    "is_resolved" boolean not null default false,
    "resolved_at" timestamp without time zone,
    "resolution_summary" text,
    "is_trending" boolean not null default false,
    "trending_since" timestamp without time zone,
    "trending_score" numeric default 0,
    "is_featured" boolean not null default false,
    "featured_at" timestamp without time zone,
    "featured_by" uuid,
    "featured_reason" text,
    "dedup_key" text,
    "dedup_bucket" text,
    "context_summary" text,
    "supporting_links" text[] default ARRAY[]::text[],
    "last_context_refresh_at" timestamp with time zone,
    "context_version" integer default 1,
    "topic_id" uuid not null,
    "search_vector" tsvector,
    "phase" text default 'initial'::text,
    "engagement_score" numeric default 0,
    "tier" text,
    "framing_type" text default 'tradeoff'::text,
    "cover_image_url" text,
    "cover_news_item_id" uuid,
    "origin_location_label" text,
    "audience_location_label" text,
    "audience_reason" text,
    "slider_low_label" text,
    "slider_high_label" text,
    "election_id" uuid,
    "election_party_id" uuid,
    "election_candidate_id" uuid,
    "election_constituency_id" uuid,
    "election_draft_id" uuid,
    "is_election_question" boolean not null default false,
    "election_issue_tag" text,
    "election_framing_style" text,
    "election_disclosure_text" text,
    "election_party_colour" text,
    "election_party_abbreviation" text,
    "election_candidate_name" text,
    "election_constituency_name" text,
    "election_question_type" text
      );
alter table "public"."questions" enable row level security;
create table "public"."reserved_usernames" (
    "username" text not null,
    "reason" text
      );
alter table "public"."reserved_usernames" enable row level security;
create table "public"."sessions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "created_at" timestamp with time zone not null default now(),
    "last_seen_at" timestamp with time zone,
    "ip" inet,
    "ua" text
      );
alter table "public"."sessions" enable row level security;
create table "public"."share_click_events" (
    "id" uuid not null default gen_random_uuid(),
    "share_event_id" uuid not null,
    "clicked_at" timestamp with time zone not null default now(),
    "resulted_in_signup" boolean not null default false,
    "resulted_in_stance" boolean not null default false,
    "new_user_id" uuid
      );
alter table "public"."share_click_events" enable row level security;
create table "public"."share_events" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid not null,
    "shared_by_user_id" uuid,
    "platform" public.share_platform not null,
    "share_type" public.share_type not null default 'question'::public.share_type,
    "click_count" integer not null default 0,
    "created_at" timestamp with time zone not null default now(),
    "tweet_id" text,
    "post_status" text,
    "posted_at" timestamp with time zone
      );
alter table "public"."share_events" enable row level security;
create table "public"."social_auth_tokens" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "provider" public.social_provider not null,
    "provider_user_id" text not null,
    "access_token" text not null,
    "refresh_token" text,
    "token_expires_at" timestamp with time zone,
    "scopes" text[] default '{}'::text[],
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."social_auth_tokens" enable row level security;
create table "public"."social_reply_inbox" (
    "id" uuid not null default gen_random_uuid(),
    "share_event_id" uuid not null,
    "question_id" uuid not null,
    "platform" text not null default 'twitter'::text,
    "external_post_id" text not null,
    "external_user_id" text,
    "reply_text" text not null,
    "reply_timestamp" timestamp with time zone not null,
    "raw_payload" jsonb not null default '{}'::jsonb,
    "fetched_at" timestamp with time zone not null default now(),
    "processing_status" text not null default 'pending'::text
      );
alter table "public"."social_reply_inbox" enable row level security;
create table "public"."societal_pulse_config" (
    "key" text not null,
    "value" numeric not null,
    "description" text,
    "updated_at" timestamp with time zone default now()
      );
create table "public"."stance_history" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "question_id" uuid not null,
    "old_score" smallint,
    "new_score" smallint,
    "changed_at" timestamp with time zone not null default now()
      );
alter table "public"."stance_history" enable row level security;
create table "public"."stance_texts" (
    "user_id" uuid not null,
    "question_id" uuid not null,
    "rationale" text,
    "links" text[] not null default '{}'::text[],
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."stance_texts" enable row level security;
create table "public"."topic_cluster_items" (
    "cluster_id" uuid not null,
    "ingestion_id" uuid not null,
    "similarity" numeric,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."topic_cluster_items" enable row level security;
create table "public"."topic_clusters" (
    "id" uuid not null default gen_random_uuid(),
    "story_id" text,
    "method" text not null default 'keywords'::text,
    "confidence" numeric,
    "centroid" jsonb,
    "centroid_vec" extensions.vector(1536),
    "created_at" timestamp with time zone not null default now(),
    "title" text
      );
alter table "public"."topic_clusters" enable row level security;
create table "public"."topic_drafts" (
    "id" uuid not null default gen_random_uuid(),
    "news_item_id" uuid not null,
    "title" text not null,
    "summary" text,
    "tags" text[] not null default '{}'::text[],
    "location_label" text,
    "status" text not null default 'draft'::text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "approved_by" uuid,
    "rejected_by" uuid,
    "ai_version" text,
    "ai_input" jsonb,
    "ai_output" jsonb,
    "notes" text,
    "cluster_id" uuid,
    "parent_topic_id" uuid,
    "parent_topic_confidence" numeric,
    "parent_topic_reason" text
      );
alter table "public"."topic_drafts" enable row level security;
create table "public"."topic_impact_scores" (
    "topic_id" uuid,
    "impact_score" numeric,
    "stance_potential_score" numeric,
    "cluster_density_score" numeric,
    "region_relevance_score" numeric,
    "engagement_prediction_score" numeric,
    "composite_score" numeric,
    "explanation" text,
    "updated_at" timestamp with time zone not null default now(),
    "question_id" uuid,
    "id" uuid not null default gen_random_uuid()
      );
alter table "public"."topic_impact_scores" enable row level security;
create table "public"."topic_region_trends" (
    "topic_id" uuid not null,
    "location_id" uuid not null,
    "agree" integer not null default 0,
    "neutral" integer not null default 0,
    "disagree" integer not null default 0,
    "total" integer not null default 0,
    "updated_at" timestamp with time zone not null default now(),
    "agree_24h" integer not null default 0,
    "neutral_24h" integer not null default 0,
    "disagree_24h" integer not null default 0,
    "total_24h" integer not null default 0,
    "momentum_24h" numeric generated always as (((total_24h)::numeric / 24.0)) stored,
    "momentum_7d" numeric generated always as (((total)::numeric / (7.0 * 24.0))) stored,
    "delta_24h_per_hour" numeric generated always as ((((total_24h)::numeric / 24.0) - ((total)::numeric / (7.0 * 24.0)))) stored,
    "polarization_score" numeric generated always as (
CASE
    WHEN (total > 0) THEN
    CASE
        WHEN ((((neutral)::numeric / (total)::numeric) < 0.2) AND (abs((((agree)::numeric / (total)::numeric) - ((disagree)::numeric / (total)::numeric))) < 0.3)) THEN 0.80
        WHEN (((neutral)::numeric / (total)::numeric) < 0.3) THEN 0.60
        ELSE 0.20
    END
    ELSE 0.0
END) stored,
    "movement_score" numeric generated always as ((((0.7 * COALESCE(((total_24h)::numeric / 24.0), (0)::numeric)) + (0.3 * COALESCE(((total)::numeric / (7.0 * 24.0)), (0)::numeric))) + (0.6 * GREATEST(COALESCE((((total_24h)::numeric / 24.0) - ((total)::numeric / (7.0 * 24.0))), (0)::numeric), (0)::numeric)))) stored
      );
alter table "public"."topic_region_trends" enable row level security;
create table "public"."topic_regions" (
    "topic_id" uuid not null,
    "region_id" uuid not null
      );
alter table "public"."topic_regions" enable row level security;
create table "public"."topic_sources" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "kind" text not null,
    "endpoint" text not null,
    "is_enabled" boolean not null default true,
    "last_polled_at" timestamp with time zone,
    "last_status" text,
    "last_error" text,
    "success_count" integer default 0,
    "failure_count" integer default 0,
    "created_at" timestamp with time zone not null default now(),
    "created_by" uuid default auth.uid(),
    "country_name" text,
    "country_code" text,
    "polling_interval" text default 'daily'::text
      );
alter table "public"."topic_sources" enable row level security;
create table "public"."topics" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "summary" text,
    "created_at" timestamp with time zone not null default now(),
    "tier" text not null,
    "location_label" text,
    "tags" text[] default '{}'::text[],
    "sources" jsonb not null default '[]'::jsonb,
    "lang" text default 'en'::text,
    "published_at" timestamp with time zone default now(),
    "cluster_id" uuid,
    "draft_id" uuid,
    "parent_topic_id" uuid,
    "trending_score" numeric default 0,
    "activity_7d" integer default 0,
    "search_vector" tsvector,
    "slug" text,
    "status" text not null default 'approved'::text,
    "description" text
      );
alter table "public"."topics" enable row level security;
create table "public"."toxicity_scores" (
    "comment_id" uuid not null,
    "flagged" boolean not null default false,
    "toxicity_score" numeric(4,3),
    "categories" jsonb default '{}'::jsonb,
    "scored_at" timestamp with time zone not null default now()
      );
alter table "public"."toxicity_scores" enable row level security;
create table "public"."user_cognitive_states" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "evaluated_at" timestamp with time zone not null default now(),
    "evaluation_period_start" timestamp with time zone not null,
    "evaluation_period_end" timestamp with time zone not null,
    "cognitive_profile" jsonb not null,
    "overall_mean_stance" numeric(4,2),
    "overall_median_stance" numeric(4,2),
    "stance_consistency_score" numeric(3,2),
    "total_questions_answered" integer not null default 0,
    "active_topic_count" integer not null default 0,
    "prior_state_id" uuid,
    "state_status" public.cognitive_state_status not null default 'current'::public.cognitive_state_status,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."user_cognitive_states" enable row level security;
create table "public"."user_follows" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "follow_type" public.follow_type_enum not null,
    "follow_id" uuid not null,
    "created_at" timestamp with time zone not null default now()
      );
create table "public"."user_location_settings" (
    "user_id" uuid not null,
    "location_id" uuid not null,
    "precision" public.precision_enum not null default 'none'::public.precision_enum
      );
alter table "public"."user_location_settings" enable row level security;
create table "public"."user_notifications" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "notification_type" text not null,
    "title" text not null,
    "body" text,
    "href" text,
    "topic_id" uuid,
    "question_id" uuid,
    "digest_id" uuid,
    "metadata" jsonb not null default '{}'::jsonb,
    "is_read" boolean not null default false,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "clicked_at" timestamp with time zone
      );
alter table "public"."user_notifications" enable row level security;
create table "public"."user_privacy" (
    "user_id" uuid not null,
    "display_mode" text not null default 'anonymous'::text,
    "stance_visibility" text not null default 'aggregate_only'::text,
    "comment_visibility" text not null default 'display_mode'::text,
    "profile_visibility" text not null default 'private'::text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "allow_social_ingestion" boolean not null default true
      );
alter table "public"."user_privacy" enable row level security;
create table "public"."user_region_follows" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "region_scope" text not null,
    "region_key" text not null,
    "followed_at" timestamp with time zone not null default now()
      );
alter table "public"."user_region_follows" enable row level security;
create table "public"."user_region_preferences" (
    "user_id" uuid not null,
    "extra_region_ids" uuid[] default '{}'::uuid[],
    "allow_out_of_region" boolean default false,
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."user_region_preferences" enable row level security;
create table "public"."user_restrictions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "restriction_type" text not null,
    "reason" text,
    "moderator_id" uuid,
    "created_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone,
    "lifted_at" timestamp with time zone
      );
alter table "public"."user_restrictions" enable row level security;
create table "public"."user_topic_follows" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "topic_id" uuid not null,
    "followed_at" timestamp with time zone not null default now()
      );
alter table "public"."user_topic_follows" enable row level security;
create table "public"."user_topic_interactions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "topic_id" uuid not null,
    "last_interacted_at" timestamp with time zone not null default now(),
    "last_question_phase_seen" text,
    "answered" boolean default false,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );
create table "public"."username_history" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "username" text not null,
    "changed_at" timestamp with time zone not null default now(),
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."username_history" enable row level security;
create table "public"."users" (
    "id" uuid not null,
    "email" text not null,
    "hash" text,
    "status" public.user_status_enum not null default 'active'::public.user_status_enum,
    "created_at" timestamp with time zone not null default now(),
    "last_seen_at" timestamp with time zone,
    "ip" inet,
    "ua" text
      );
alter table "public"."users" enable row level security;
create table "public"."v_total_articles" (
    "count" bigint
      );
create table "public"."weekly_digests" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "week_start" date not null,
    "week_end" date not null,
    "summary" jsonb not null default '{}'::jsonb,
    "delivered_in_app_at" timestamp with time zone,
    "delivered_email_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."weekly_digests" enable row level security;
create table "public"."whatsapp_active_sessions" (
    "whatsapp_phone_hash" text not null,
    "last_question_id" uuid,
    "updated_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone not null default (now() + '00:30:00'::interval)
      );
alter table "public"."whatsapp_active_sessions" enable row level security;
create table "public"."whatsapp_broadcasts" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid not null,
    "contact_list_id" uuid,
    "name" text not null,
    "status" text not null default 'draft'::text,
    "scheduled_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "total_contacts" integer not null default 0,
    "total_sent" integer not null default 0,
    "total_delivered" integer not null default 0,
    "total_failed" integer not null default 0,
    "total_opened" integer not null default 0,
    "total_completed" integer not null default 0,
    "total_stances" integer not null default 0,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."whatsapp_broadcasts" enable row level security;
create table "public"."whatsapp_config" (
    "id" uuid not null default gen_random_uuid(),
    "waba_id" text,
    "phone_number_id" text,
    "access_token" text,
    "flow_id" text,
    "template_id" text,
    "template_name" text default 'stance_question_flow'::text,
    "status" text not null default 'disconnected'::text,
    "webhook_secret" text,
    "updated_at" timestamp with time zone not null default now()
      );
alter table "public"."whatsapp_config" enable row level security;
create table "public"."whatsapp_contact_list_numbers" (
    "id" uuid not null default gen_random_uuid(),
    "contact_list_id" uuid not null,
    "phone_number" text not null,
    "phone_hash" text not null,
    "is_valid" boolean not null default true,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."whatsapp_contact_list_numbers" enable row level security;
create table "public"."whatsapp_contact_lists" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "row_count" integer not null default 0,
    "valid_count" integer not null default 0,
    "created_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "last_used_at" timestamp with time zone
      );
alter table "public"."whatsapp_contact_lists" enable row level security;
create table "public"."whatsapp_delivery_log" (
    "id" uuid not null default gen_random_uuid(),
    "broadcast_id" uuid not null,
    "phone_hash" text not null,
    "status" text not null,
    "failure_reason" text,
    "flow_opened_at" timestamp with time zone,
    "flow_completed_at" timestamp with time zone,
    "sent_at" timestamp with time zone not null default now(),
    "purge_after" date not null default (now() + '90 days'::interval)
      );
alter table "public"."whatsapp_delivery_log" enable row level security;
create table "public"."whatsapp_forward_chains" (
    "id" text not null,
    "question_id" uuid not null,
    "root_phone_hash" text not null,
    "parent_forward_chain_id" text,
    "depth" integer not null default 0,
    "child_stance_count" integer not null default 0,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."whatsapp_forward_chains" enable row level security;
create table "public"."whatsapp_optouts" (
    "phone_hash" text not null,
    "opted_out_at" timestamp with time zone not null default now(),
    "opted_in_at" timestamp with time zone,
    "is_active" boolean not null default true
      );
alter table "public"."whatsapp_optouts" enable row level security;
create table "public"."whatsapp_phone_verifications" (
    "id" uuid not null default gen_random_uuid(),
    "verification_token" uuid not null default gen_random_uuid(),
    "phone_hash" text not null,
    "otp_code" text not null,
    "expires_at" timestamp with time zone not null default (now() + '00:10:00'::interval),
    "used" boolean not null default false,
    "created_at" timestamp with time zone not null default now()
      );
alter table "public"."whatsapp_phone_verifications" enable row level security;
create table "public"."whatsapp_question_subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "whatsapp_phone_hash" text not null,
    "question_id" uuid not null,
    "subscribed_at" timestamp with time zone not null default now(),
    "last_notified_at" timestamp with time zone,
    "last_agree_pct" numeric(5,2),
    "last_disagree_pct" numeric(5,2),
    "last_neutral_pct" numeric(5,2),
    "last_response_count" integer,
    "notification_count" integer not null default 0,
    "last_weekly_digest_at" timestamp with time zone,
    "is_active" boolean not null default true
      );
alter table "public"."whatsapp_question_subscriptions" enable row level security;
create table "public"."whatsapp_webhook_errors" (
    "id" uuid not null default gen_random_uuid(),
    "received_at" timestamp with time zone not null default now(),
    "error_type" text not null,
    "payload_preview" text,
    "resolved" boolean not null default false
      );
alter table "public"."whatsapp_webhook_errors" enable row level security;
alter sequence "admin"."audit_log_id_seq" owned by "admin"."audit_log"."id";
alter sequence "admin"."cron_runs_id_seq" owned by "admin"."cron_runs"."id";
alter sequence "admin"."fn_perf_id_seq" owned by "admin"."fn_perf"."id";
alter sequence "admin"."rpc_perf_id_seq" owned by "admin"."rpc_perf"."id";
alter sequence "public"."ai_question_draft_versions_id_seq" owned by "public"."ai_question_draft_versions"."id";
CREATE UNIQUE INDEX audit_log_pkey ON admin.audit_log USING btree (id);
CREATE UNIQUE INDEX cron_runs_pkey ON admin.cron_runs USING btree (id);
CREATE INDEX fn_perf_func_at_idx ON admin.fn_perf USING btree (func, at DESC);
CREATE UNIQUE INDEX fn_perf_pkey ON admin.fn_perf USING btree (id);
CREATE INDEX idx_audit_log_action ON admin.audit_log USING btree (action);
CREATE INDEX idx_audit_log_created_at ON admin.audit_log USING btree (created_at DESC);
CREATE INDEX idx_audit_log_user_id ON admin.audit_log USING btree (user_id);
CREATE UNIQUE INDEX rpc_perf_pkey ON admin.rpc_perf USING btree (id);
CREATE UNIQUE INDEX kv_secrets_pkey ON private.kv_secrets USING btree (key);
CREATE UNIQUE INDEX secrets_pkey ON private.secrets USING btree (key);
CREATE UNIQUE INDEX admin_fn_perf_pkey ON public.admin_fn_perf USING btree (id);
CREATE UNIQUE INDEX admin_users_pkey ON public.admin_users USING btree (user_id);
CREATE INDEX ai_prompts_key_active_idx ON public.ai_prompts USING btree (prompt_key, is_active);
CREATE UNIQUE INDEX ai_prompts_one_active_per_key ON public.ai_prompts USING btree (prompt_key) WHERE (is_active = true);
CREATE UNIQUE INDEX ai_prompts_pkey ON public.ai_prompts USING btree (id);
CREATE UNIQUE INDEX ai_question_draft_versions_pkey ON public.ai_question_draft_versions USING btree (id);
CREATE UNIQUE INDEX ai_question_drafts_pkey ON public.ai_question_drafts USING btree (id);
CREATE UNIQUE INDEX app_config_trending_pkey ON public.app_config_trending USING btree (key);
CREATE INDEX aqd_state_created_idx ON public.ai_question_drafts USING btree (state, created_at DESC);
CREATE UNIQUE INDEX audience_segments_key_unique ON public.audience_segments USING btree (key);
CREATE UNIQUE INDEX audience_segments_pkey ON public.audience_segments USING btree (id);
CREATE UNIQUE INDEX avatars_pkey ON public.avatars USING btree (id);
CREATE INDEX avatars_user_idx ON public.avatars USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX backup_codes_pkey ON public.backup_codes USING btree (id);
CREATE INDEX backup_codes_user_idx ON public.backup_codes USING btree (user_id, used_at);
CREATE UNIQUE INDEX cognitive_state_snapshots_pkey ON public.cognitive_state_snapshots USING btree (id);
CREATE UNIQUE INDEX comment_reactions_comment_id_user_id_key ON public.comment_reactions USING btree (comment_id, user_id);
CREATE UNIQUE INDEX comment_reactions_pkey ON public.comment_reactions USING btree (id);
CREATE UNIQUE INDEX comment_reports_comment_id_reporter_id_key ON public.comment_reports USING btree (comment_id, reporter_id);
CREATE UNIQUE INDEX comment_reports_pkey ON public.comment_reports USING btree (id);
CREATE UNIQUE INDEX comments_pkey ON public.comments USING btree (id);
CREATE UNIQUE INDEX community_trends_pkey ON public.community_trends USING btree (id);
CREATE UNIQUE INDEX community_trends_unique ON public.community_trends USING btree (snapshot_date, region_scope, region_key);
CREATE UNIQUE INDEX consent_logs_pkey ON public.consent_logs USING btree (id);
CREATE INDEX consent_user_key_idx ON public.consent_logs USING btree (user_id, consent_key, created_at DESC);
CREATE UNIQUE INDEX contribution_acknowledgements_pkey ON public.contribution_acknowledgements USING btree (id);
CREATE INDEX daily_curated_questions_created_at_idx ON public.daily_curated_questions USING btree (created_at DESC);
CREATE UNIQUE INDEX daily_curated_questions_pkey ON public.daily_curated_questions USING btree (date);
CREATE UNIQUE INDEX deletion_requests_pkey ON public.deletion_requests USING btree (id);
CREATE UNIQUE INDEX demographic_breakdowns_pkey ON public.demographic_breakdowns USING btree (id);
CREATE UNIQUE INDEX demographic_breakdowns_unique ON public.demographic_breakdowns USING btree (question_id, snapshot_date, dimension, dimension_value);
CREATE UNIQUE INDEX devices_pkey ON public.devices USING btree (id);
CREATE UNIQUE INDEX devices_user_fingerprint_key ON public.devices USING btree (user_id, device_fingerprint);
CREATE INDEX devices_user_seen_idx ON public.devices USING btree (user_id, last_seen_at DESC);
CREATE INDEX eae_election_id_idx ON public.election_anomaly_events USING btree (election_id, created_at DESC);
CREATE INDEX eae_question_id_idx ON public.election_anomaly_events USING btree (question_id) WHERE (question_id IS NOT NULL);
CREATE INDEX eae_unreviewed_idx ON public.election_anomaly_events USING btree (reviewed, severity) WHERE (reviewed = false);
CREATE INDEX eae_user_id_idx ON public.election_anomaly_events USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX eitl_tier_active_idx ON public.election_issue_tag_allowlists USING btree (tier_code, is_active) WHERE (is_active = true);
CREATE UNIQUE INDEX election_anomaly_events_pkey ON public.election_anomaly_events USING btree (id);
CREATE INDEX election_audit_log_action_idx ON public.election_audit_log USING btree (action, created_at DESC);
CREATE INDEX election_audit_log_actor_idx ON public.election_audit_log USING btree (actor_id, created_at DESC);
CREATE INDEX election_audit_log_election_id_idx ON public.election_audit_log USING btree (election_id, created_at DESC);
CREATE UNIQUE INDEX election_audit_log_pkey ON public.election_audit_log USING btree (id);
CREATE UNIQUE INDEX election_candidates_constituency_election_unique ON public.election_candidates USING btree (election_id, constituency_id, party_id);
CREATE INDEX election_candidates_constituency_id_idx ON public.election_candidates USING btree (constituency_id);
CREATE INDEX election_candidates_election_id_idx ON public.election_candidates USING btree (election_id);
CREATE INDEX election_candidates_import_batch_idx ON public.election_candidates USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);
CREATE INDEX election_candidates_party_id_idx ON public.election_candidates USING btree (party_id) WHERE (party_id IS NOT NULL);
CREATE UNIQUE INDEX election_candidates_pkey ON public.election_candidates USING btree (id);
CREATE INDEX election_candidates_status_idx ON public.election_candidates USING btree (election_id, status);
CREATE INDEX election_compliance_rules_active_idx ON public.election_compliance_rules USING btree (election_id, rule_type) WHERE (is_active = true);
CREATE INDEX election_compliance_rules_election_id_idx ON public.election_compliance_rules USING btree (election_id);
CREATE UNIQUE INDEX election_compliance_rules_pkey ON public.election_compliance_rules USING btree (id);
CREATE INDEX election_constituencies_active_idx ON public.election_constituencies USING btree (tier_code, state_code) WHERE (valid_to IS NULL);
CREATE INDEX election_constituencies_parent_id_idx ON public.election_constituencies USING btree (parent_constituency_id) WHERE (parent_constituency_id IS NOT NULL);
CREATE UNIQUE INDEX election_constituencies_pkey ON public.election_constituencies USING btree (id);
CREATE INDEX election_constituencies_state_code_idx ON public.election_constituencies USING btree (state_code);
CREATE INDEX election_constituencies_tier_code_idx ON public.election_constituencies USING btree (tier_code);
CREATE UNIQUE INDEX election_constituencies_tier_code_unique ON public.election_constituencies USING btree (tier_code, constituency_code);
CREATE UNIQUE INDEX election_issue_tag_allowlists_pkey ON public.election_issue_tag_allowlists USING btree (id);
CREATE UNIQUE INDEX election_issue_tag_allowlists_unique ON public.election_issue_tag_allowlists USING btree (tier_code, tag);
CREATE UNIQUE INDEX election_parties_abbreviation_country_unique ON public.election_parties USING btree (country, abbreviation);
CREATE INDEX election_parties_active_idx ON public.election_parties USING btree (country, is_active) WHERE (is_active = true);
CREATE INDEX election_parties_country_idx ON public.election_parties USING btree (country);
CREATE UNIQUE INDEX election_parties_pkey ON public.election_parties USING btree (id);
CREATE INDEX election_party_elections_election_idx ON public.election_party_elections USING btree (election_id);
CREATE INDEX election_party_elections_party_idx ON public.election_party_elections USING btree (party_id);
CREATE UNIQUE INDEX election_party_elections_pkey ON public.election_party_elections USING btree (id);
CREATE UNIQUE INDEX election_party_elections_unique ON public.election_party_elections USING btree (party_id, election_id);
CREATE INDEX election_party_regions_alliance_idx ON public.election_party_regions USING btree (alliance_party_id) WHERE (alliance_party_id IS NOT NULL);
CREATE INDEX election_party_regions_party_id_idx ON public.election_party_regions USING btree (party_id);
CREATE UNIQUE INDEX election_party_regions_party_state_unique ON public.election_party_regions USING btree (party_id, state_code);
CREATE UNIQUE INDEX election_party_regions_pkey ON public.election_party_regions USING btree (id);
CREATE INDEX election_party_regions_state_code_idx ON public.election_party_regions USING btree (state_code);
CREATE UNIQUE INDEX election_question_drafts_pkey ON public.election_question_drafts USING btree (id);
CREATE UNIQUE INDEX election_source_documents_pkey ON public.election_source_documents USING btree (id);
CREATE UNIQUE INDEX election_stance_aggregates_pkey ON public.election_stance_aggregates USING btree (id);
CREATE INDEX election_tiers_country_idx ON public.election_tiers USING btree (country);
CREATE INDEX election_tiers_is_active_idx ON public.election_tiers USING btree (is_active) WHERE (is_active = true);
CREATE UNIQUE INDEX election_tiers_pkey ON public.election_tiers USING btree (id);
CREATE UNIQUE INDEX election_tiers_tier_code_key ON public.election_tiers USING btree (tier_code);
CREATE INDEX elections_active_idx ON public.elections USING btree (tier_code, state) WHERE (state <> ALL (ARRAY['ARCHIVED'::public.election_state_enum, 'RESULT_DECLARED'::public.election_state_enum]));
CREATE INDEX elections_country_idx ON public.elections USING btree (country);
CREATE INDEX elections_parent_id_idx ON public.elections USING btree (parent_election_id) WHERE (parent_election_id IS NOT NULL);
CREATE UNIQUE INDEX elections_pkey ON public.elections USING btree (id);
CREATE INDEX elections_silence_idx ON public.elections USING btree (silence_start_at) WHERE (silence_start_at IS NOT NULL);
CREATE INDEX elections_state_idx ON public.elections USING btree (state);
CREATE INDEX elections_tier_code_idx ON public.elections USING btree (tier_code);
CREATE INDEX elections_tier_id_idx ON public.elections USING btree (tier_id);
CREATE UNIQUE INDEX email_events_pkey ON public.email_events USING btree (id);
CREATE UNIQUE INDEX embed_cta_events_pkey ON public.embed_cta_events USING btree (id);
CREATE UNIQUE INDEX embed_impressions_pkey ON public.embed_impressions USING btree (id);
CREATE INDEX embed_impressions_publisher_idx ON public.embed_impressions USING btree (publisher_ref) WHERE (publisher_ref IS NOT NULL);
CREATE INDEX embed_impressions_question_idx ON public.embed_impressions USING btree (question_id);
CREATE INDEX embed_rate_limits_expires_idx ON public.embed_rate_limits USING btree (expires_at);
CREATE UNIQUE INDEX embed_rate_limits_key_type_window_idx ON public.embed_rate_limits USING btree (key, limit_type, window_start);
CREATE UNIQUE INDEX embed_rate_limits_pkey ON public.embed_rate_limits USING btree (id);
CREATE UNIQUE INDEX embed_snippet_versions_pkey ON public.embed_snippet_versions USING btree (version);
CREATE INDEX embedded_stances_device_idx ON public.embedded_stances USING btree (device_fingerprint);
CREATE UNIQUE INDEX embedded_stances_device_question_unique ON public.embedded_stances USING btree (device_fingerprint, question_id) WHERE (attributed_user_id IS NULL);
CREATE UNIQUE INDEX embedded_stances_pkey ON public.embedded_stances USING btree (id);
CREATE INDEX embedded_stances_question_idx ON public.embedded_stances USING btree (question_id);
CREATE INDEX embedded_stances_user_idx ON public.embedded_stances USING btree (attributed_user_id) WHERE (attributed_user_id IS NOT NULL);
CREATE INDEX eqd_candidate_id_idx ON public.election_question_drafts USING btree (candidate_id) WHERE (candidate_id IS NOT NULL);
CREATE INDEX eqd_confidence_idx ON public.election_question_drafts USING btree (election_id, confidence_score) WHERE (status = 'DRAFT'::text);
CREATE INDEX eqd_contradiction_idx ON public.election_question_drafts USING btree (election_id, potential_contradiction) WHERE ((potential_contradiction = true) AND (status = 'DRAFT'::text));
CREATE INDEX eqd_election_id_idx ON public.election_question_drafts USING btree (election_id, status);
CREATE INDEX eqd_issue_tag_idx ON public.election_question_drafts USING btree (election_id, issue_tag) WHERE (status = 'DRAFT'::text);
CREATE INDEX eqd_party_id_idx ON public.election_question_drafts USING btree (party_id) WHERE (party_id IS NOT NULL);
CREATE INDEX esa_constituency_idx ON public.election_stance_aggregates USING btree (constituency_id) WHERE (constituency_id IS NOT NULL);
CREATE INDEX esa_election_id_idx ON public.election_stance_aggregates USING btree (election_id);
CREATE INDEX esa_gated_idx ON public.election_stance_aggregates USING btree (election_id, is_gated) WHERE (is_gated = false);
CREATE UNIQUE INDEX esa_question_constituency_unique ON public.election_stance_aggregates USING btree (question_id, constituency_id, scope);
CREATE INDEX esa_question_id_idx ON public.election_stance_aggregates USING btree (question_id);
CREATE INDEX esa_state_code_idx ON public.election_stance_aggregates USING btree (state_code, scope);
CREATE INDEX esd_ai_processing_pending_idx ON public.election_source_documents USING btree (election_id, ai_processing_status) WHERE ((ai_processing_status = 'PENDING'::text) AND (ingestion_status = 'DONE'::text));
CREATE INDEX esd_candidate_id_idx ON public.election_source_documents USING btree (candidate_id) WHERE (candidate_id IS NOT NULL);
CREATE INDEX esd_election_id_idx ON public.election_source_documents USING btree (election_id);
CREATE INDEX esd_party_id_idx ON public.election_source_documents USING btree (party_id) WHERE (party_id IS NOT NULL);
CREATE INDEX esd_translation_pending_idx ON public.election_source_documents USING btree (election_id, translation_status) WHERE ((translation_status = 'PENDING'::text) AND (ingestion_status = 'DONE'::text));
CREATE UNIQUE INDEX feed_policies_key_unique ON public.feed_policies USING btree (key);
CREATE UNIQUE INDEX feed_policies_pkey ON public.feed_policies USING btree (id);
CREATE UNIQUE INDEX feed_policy_lanes_pkey ON public.feed_policy_lanes USING btree (id);
CREATE UNIQUE INDEX feed_policy_lanes_unique ON public.feed_policy_lanes USING btree (policy_id, lane_key);
CREATE INDEX idx_cognitive_state_snapshots_user_snapshot ON public.cognitive_state_snapshots USING btree (user_id, snapshot_at DESC);
CREATE INDEX idx_comments_question_created ON public.comments USING btree (question_id, created_at DESC);
CREATE INDEX idx_community_trends_scope_date ON public.community_trends USING btree (region_scope, region_key, snapshot_date DESC);
CREATE INDEX idx_contribution_ack_shown_at ON public.contribution_acknowledgements USING btree (shown_at);
CREATE INDEX idx_contribution_ack_user_id ON public.contribution_acknowledgements USING btree (user_id);
CREATE INDEX idx_contribution_ack_user_trigger ON public.contribution_acknowledgements USING btree (user_id, trigger_type, shown_at DESC);
CREATE INDEX idx_demographic_breakdowns_dimension ON public.demographic_breakdowns USING btree (dimension, dimension_value, snapshot_date DESC);
CREATE INDEX idx_demographic_breakdowns_question_date ON public.demographic_breakdowns USING btree (question_id, snapshot_date DESC);
CREATE INDEX idx_email_events_notification ON public.email_events USING btree (notification_id) WHERE (notification_id IS NOT NULL);
CREATE INDEX idx_email_events_type_created ON public.email_events USING btree (event_type, created_at DESC);
CREATE INDEX idx_email_events_user_created ON public.email_events USING btree (user_id, created_at DESC);
CREATE INDEX idx_engagement_trending ON public.question_engagement_metrics USING btree (response_rate_24h DESC);
CREATE INDEX idx_engagement_updated ON public.question_engagement_metrics USING btree (updated_at);
CREATE INDEX idx_ingestion_queue_created_at ON public.ingestion_queue USING btree (created_at DESC);
CREATE INDEX idx_ingestion_queue_entities ON public.ingestion_queue USING gin (entities);
CREATE INDEX idx_ingestion_queue_entity_extraction ON public.ingestion_queue USING btree (created_at DESC) WHERE ((embedding IS NOT NULL) AND (embed_status = 'done'::text) AND (entities IS NULL));
CREATE INDEX idx_ingestion_queue_published_at ON public.ingestion_queue USING btree (published_at DESC) WHERE (published_at IS NOT NULL);
CREATE INDEX idx_ingestion_queue_source_published ON public.ingestion_queue USING btree (source_id, published_at DESC) WHERE (published_at IS NOT NULL);
CREATE INDEX idx_ingestion_queue_status ON public.ingestion_queue USING btree (status) WHERE (status = 'done'::text);
CREATE INDEX idx_locations_iso ON public.locations USING btree (iso_code);
CREATE INDEX idx_locations_parent ON public.locations USING btree (parent_id);
CREATE INDEX idx_locations_type_col ON public.locations USING btree (type);
CREATE INDEX idx_news_items_checked_no_url ON public.news_items USING btree (image_checked_at DESC) WHERE ((image_url IS NULL) AND (image_checked_at IS NOT NULL));
CREATE INDEX idx_news_items_image_unchecked ON public.news_items USING btree (created_at DESC) WHERE ((image_url IS NULL) AND (image_checked_at IS NULL));
CREATE INDEX idx_pipeline_jobs_job_type ON public.pipeline_jobs USING btree (job_type, started_at DESC);
CREATE INDEX idx_pipeline_jobs_status ON public.pipeline_jobs USING btree (status, started_at DESC);
CREATE INDEX idx_profiles_last_seen_at ON public.profiles USING btree (last_seen_at) WHERE (last_seen_at IS NOT NULL);
CREATE INDEX idx_qd_framing_state ON public.question_drafts USING btree (status) WHERE (status = ANY (ARRAY['draft'::text, 'reframing'::text, 'reframed'::text, 'reframe_failed'::text]));
CREATE INDEX idx_qd_quality_score ON public.question_drafts USING btree (question_quality_score) WHERE (question_quality_score IS NOT NULL);
CREATE INDEX idx_question_context_updates_question_id ON public.question_context_updates USING btree (question_id);
CREATE INDEX idx_question_context_updates_updated_at ON public.question_context_updates USING btree (updated_at DESC);
CREATE INDEX idx_question_drafts_scope ON public.question_drafts USING btree (scope) WHERE (scope IS NOT NULL);
CREATE INDEX idx_question_drafts_topic_id_created_at ON public.question_drafts USING btree (topic_id, created_at DESC);
CREATE INDEX idx_question_duplicates_created ON public.question_duplicates USING btree (created_at DESC);
CREATE INDEX idx_question_duplicates_draft ON public.question_duplicates USING btree (draft_id);
CREATE INDEX idx_question_duplicates_existing ON public.question_duplicates USING btree (existing_question_id);
CREATE INDEX idx_question_links_from ON public.question_links USING btree (from_question_id);
CREATE INDEX idx_question_links_method ON public.question_links USING btree (method);
CREATE INDEX idx_question_links_score ON public.question_links USING btree (score DESC);
CREATE INDEX idx_question_links_to ON public.question_links USING btree (to_question_id);
CREATE INDEX idx_question_links_type ON public.question_links USING btree (link_type);
CREATE INDEX idx_question_stances_created_at ON public.question_stances USING btree (created_at);
CREATE INDEX idx_question_stances_question_created ON public.question_stances USING btree (question_id, created_at DESC);
CREATE INDEX idx_question_stances_question_id ON public.question_stances USING btree (question_id);
CREATE INDEX idx_question_stances_user_created ON public.question_stances USING btree (user_id, created_at DESC);
CREATE INDEX idx_question_stances_user_id ON public.question_stances USING btree (user_id);
CREATE INDEX idx_question_stances_user_question ON public.question_stances USING btree (user_id, question_id);
CREATE INDEX idx_question_views_question ON public.question_view_events USING btree (question_id, viewed_at DESC);
CREATE INDEX idx_question_views_user ON public.question_view_events USING btree (user_id, viewed_at DESC);
CREATE INDEX idx_questions_archived ON public.questions USING btree (archived_at) WHERE (archived_at IS NOT NULL);
CREATE INDEX idx_questions_audience_published ON public.questions USING btree (audience_location_label, published_at DESC) WHERE ((phase IS DISTINCT FROM 'archived'::text) AND (published_at IS NOT NULL));
CREATE INDEX idx_questions_context_refresh ON public.questions USING btree (last_context_refresh_at DESC);
CREATE INDEX idx_questions_dedup_bucket ON public.questions USING btree (dedup_bucket);
CREATE INDEX idx_questions_dedup_key ON public.questions USING btree (dedup_key);
CREATE INDEX idx_questions_dedup_key_bucket ON public.questions USING btree (dedup_key, dedup_bucket);
CREATE INDEX idx_questions_featured ON public.questions USING btree (is_featured, state) WHERE (is_featured = true);
CREATE INDEX idx_questions_framing_type ON public.questions USING btree (framing_type);
CREATE INDEX idx_questions_id_topic ON public.questions USING btree (id, topic_id);
CREATE INDEX idx_questions_resolved ON public.questions USING btree (is_resolved, resolved_at) WHERE (is_resolved = true);
CREATE INDEX idx_questions_search_vector ON public.questions USING gin (search_vector);
CREATE INDEX idx_questions_state ON public.questions USING btree (state) WHERE (state <> 'archived'::public.question_state);
CREATE INDEX idx_questions_state_changed ON public.questions USING btree (state_changed_at DESC, state);
CREATE INDEX idx_questions_state_changed_at ON public.questions USING btree (state_changed_at DESC, state);
CREATE INDEX idx_questions_state_published ON public.questions USING btree (state, published_at DESC);
CREATE INDEX idx_questions_state_tier ON public.questions USING btree (state, tier);
CREATE INDEX idx_questions_text_search ON public.questions USING gin (to_tsvector('english'::regconfig, ((((COALESCE(question, ''::text) || ' '::text) || COALESCE(summary, ''::text)) || ' '::text) || COALESCE(context_summary, ''::text))));
CREATE INDEX idx_questions_tier ON public.questions USING btree (tier);
CREATE INDEX idx_questions_topic_id ON public.questions USING btree (topic_id) WHERE (topic_id IS NOT NULL);
CREATE INDEX idx_questions_topic_id_published_at ON public.questions USING btree (topic_id, published_at DESC);
CREATE INDEX idx_questions_topic_id_state ON public.questions USING btree (topic_id, state);
CREATE INDEX idx_questions_topic_phase ON public.questions USING btree (topic_id, phase, state);
CREATE INDEX idx_questions_topic_published ON public.questions USING btree (topic_id, published_at DESC);
CREATE INDEX idx_questions_topic_state ON public.questions USING btree (topic_id, state);
CREATE INDEX idx_questions_topic_status ON public.questions USING btree (topic_id, status) WHERE (status = 'active'::text);
CREATE INDEX idx_questions_topic_status_published ON public.questions USING btree (topic_id, status, published_at DESC);
CREATE INDEX idx_questions_trending ON public.questions USING btree (is_trending, state) WHERE (is_trending = true);
CREATE INDEX idx_sessions_user_last_seen ON public.sessions USING btree (user_id, last_seen_at DESC);
CREATE INDEX idx_snapshots_snapshot_at ON public.cognitive_state_snapshots USING btree (snapshot_at DESC);
CREATE INDEX idx_snapshots_user_id ON public.cognitive_state_snapshots USING btree (user_id);
CREATE INDEX idx_stance_history_question_date ON public.question_stance_stats_history USING btree (question_id, snapshot_date DESC);
CREATE INDEX idx_stance_history_region ON public.question_stance_stats_history USING btree (region_scope, region_key, snapshot_date DESC);
CREATE INDEX idx_stance_history_user_changed ON public.stance_history USING btree (user_id, changed_at DESC);
CREATE INDEX idx_stance_history_user_question ON public.stance_history USING btree (user_id, question_id, changed_at DESC);
CREATE INDEX idx_stance_texts_user ON public.stance_texts USING btree (user_id);
CREATE INDEX idx_state_history_created ON public.question_state_history USING btree (created_at DESC);
CREATE INDEX idx_state_history_question ON public.question_state_history USING btree (question_id, created_at DESC);
CREATE INDEX idx_state_history_transition ON public.question_state_history USING btree (old_state, new_state);
CREATE INDEX idx_topic_cluster_items_cluster ON public.topic_cluster_items USING btree (cluster_id);
CREATE INDEX idx_topic_cluster_items_cluster_created ON public.topic_cluster_items USING btree (cluster_id, created_at);
CREATE INDEX idx_topic_cluster_items_created_at ON public.topic_cluster_items USING btree (created_at);
CREATE INDEX idx_topic_cluster_items_ingestion ON public.topic_cluster_items USING btree (ingestion_id);
CREATE INDEX idx_topic_drafts_cluster_id ON public.topic_drafts USING btree (cluster_id);
CREATE INDEX idx_topic_drafts_parent_topic_id ON public.topic_drafts USING btree (parent_topic_id) WHERE (parent_topic_id IS NOT NULL);
CREATE INDEX idx_topic_impact_scores_composite ON public.topic_impact_scores USING btree (composite_score DESC NULLS LAST);
CREATE INDEX idx_topic_impact_scores_question_id ON public.topic_impact_scores USING btree (question_id);
CREATE INDEX idx_topic_impact_scores_question_updated ON public.topic_impact_scores USING btree (question_id, updated_at DESC);
CREATE INDEX idx_topic_impact_scores_question_updated_at ON public.topic_impact_scores USING btree (question_id, updated_at DESC) WHERE (question_id IS NOT NULL);
CREATE INDEX idx_topic_region_trends_delta ON public.topic_region_trends USING btree (delta_24h_per_hour DESC NULLS LAST);
CREATE INDEX idx_topic_region_trends_momentum_24h ON public.topic_region_trends USING btree (momentum_24h DESC NULLS LAST);
CREATE INDEX idx_topic_region_trends_movement_score ON public.topic_region_trends USING btree (movement_score DESC NULLS LAST);
CREATE INDEX idx_topic_region_trends_polarization ON public.topic_region_trends USING btree (polarization_score DESC NULLS LAST) WHERE (polarization_score >= 0.60);
CREATE INDEX idx_topic_sources_country ON public.topic_sources USING btree (country_name) WHERE (country_name IS NOT NULL);
CREATE INDEX idx_topic_sources_country_code ON public.topic_sources USING btree (country_code) WHERE (country_code IS NOT NULL);
CREATE INDEX idx_topics_location ON public.topics USING btree (location_label) WHERE (location_label IS NOT NULL);
CREATE INDEX idx_topics_parent ON public.topics USING btree (parent_topic_id);
CREATE INDEX idx_topics_parent_topic_id ON public.topics USING btree (parent_topic_id);
CREATE INDEX idx_topics_search_vector ON public.topics USING gin (search_vector);
CREATE INDEX idx_topics_slug ON public.topics USING btree (slug);
CREATE INDEX idx_topics_status ON public.topics USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]));
CREATE INDEX idx_topics_tier_trending ON public.topics USING btree (tier, trending_score DESC);
CREATE INDEX idx_topics_trending ON public.topics USING btree (trending_score DESC) WHERE (trending_score > (0)::numeric);
CREATE INDEX idx_trending_metrics_score ON public.question_trending_metrics USING btree (trending_score DESC) WHERE (trending_score > (0)::numeric);
CREATE INDEX idx_user_cognitive_states_current ON public.user_cognitive_states USING btree (user_id, state_status) WHERE (state_status = 'current'::public.cognitive_state_status);
CREATE INDEX idx_user_cognitive_states_evaluated_at ON public.user_cognitive_states USING btree (evaluated_at DESC);
CREATE INDEX idx_user_cognitive_states_profile ON public.user_cognitive_states USING gin (cognitive_profile);
CREATE INDEX idx_user_cognitive_states_user_eval ON public.user_cognitive_states USING btree (user_id, evaluated_at DESC);
CREATE INDEX idx_user_cognitive_states_user_id ON public.user_cognitive_states USING btree (user_id);
CREATE INDEX idx_user_follows_item ON public.user_follows USING btree (follow_id, follow_type);
CREATE INDEX idx_user_follows_user ON public.user_follows USING btree (user_id, follow_type);
CREATE INDEX idx_user_notifications_type_created ON public.user_notifications USING btree (notification_type, created_at DESC);
CREATE INDEX idx_user_notifications_user_created ON public.user_notifications USING btree (user_id, created_at DESC);
CREATE INDEX idx_user_notifications_user_unread ON public.user_notifications USING btree (user_id, is_read, created_at DESC);
CREATE INDEX idx_user_region_follows_region ON public.user_region_follows USING btree (region_scope, region_key);
CREATE INDEX idx_user_region_follows_user ON public.user_region_follows USING btree (user_id);
CREATE INDEX idx_user_restrictions_user_id ON public.user_restrictions USING btree (user_id);
CREATE INDEX idx_user_topic_follows_topic ON public.user_topic_follows USING btree (topic_id);
CREATE INDEX idx_user_topic_follows_user ON public.user_topic_follows USING btree (user_id);
CREATE INDEX idx_user_topic_interactions_topic ON public.user_topic_interactions USING btree (topic_id);
CREATE INDEX idx_user_topic_interactions_user ON public.user_topic_interactions USING btree (user_id, last_interacted_at DESC);
CREATE INDEX idx_username_history_user_30d ON public.username_history USING btree (user_id, changed_at DESC);
CREATE INDEX idx_username_history_user_recent ON public.username_history USING btree (user_id, created_at DESC);
CREATE INDEX idx_weekly_digests_user_created ON public.weekly_digests USING btree (user_id, created_at DESC);
CREATE INDEX ingested_stances_attributed_user_idx ON public.ingested_stances USING btree (attributed_user_id) WHERE (attributed_user_id IS NOT NULL);
CREATE INDEX ingested_stances_pending_promotion_idx ON public.ingested_stances USING btree (id) WHERE ((status = 'accepted'::text) AND (promoted_at IS NULL));
CREATE UNIQUE INDEX ingested_stances_pkey ON public.ingested_stances USING btree (id);
CREATE INDEX ingested_stances_question_idx ON public.ingested_stances USING btree (question_id);
CREATE INDEX ingested_stances_status_idx ON public.ingested_stances USING btree (status) WHERE (status = 'pending_review'::text);
CREATE UNIQUE INDEX ingested_stances_unique_reply ON public.ingested_stances USING btree (reply_inbox_id);
CREATE INDEX ingestion_queue_embed_pending_idx ON public.ingestion_queue USING btree (created_at DESC) WHERE (embedding IS NULL);
CREATE INDEX ingestion_queue_embedding_ivfflat ON public.ingestion_queue USING ivfflat (embedding extensions.vector_cosine_ops);
CREATE UNIQUE INDEX ingestion_queue_pkey ON public.ingestion_queue USING btree (id);
CREATE UNIQUE INDEX ingestion_queue_source_id_external_id_key ON public.ingestion_queue USING btree (source_id, external_id);
CREATE INDEX ingestion_queue_source_id_idx ON public.ingestion_queue USING btree (source_id);
CREATE INDEX ingestion_queue_status_created_at_idx ON public.ingestion_queue USING btree (status, created_at DESC);
CREATE INDEX iq_status_published_idx ON public.ingestion_queue USING btree (status, published_at DESC);
CREATE INDEX la_user_idx ON public.location_audits USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX location_audits_pkey ON public.location_audits USING btree (id);
CREATE INDEX locations_parent_idx ON public.locations USING btree (parent_id);
CREATE UNIQUE INDEX locations_pkey ON public.locations USING btree (id);
CREATE INDEX locations_type_name_idx ON public.locations USING btree (type, name);
CREATE UNIQUE INDEX mfa_methods_pkey ON public.mfa_methods USING btree (id);
CREATE INDEX mfa_user_type_idx ON public.mfa_methods USING btree (user_id, type);
CREATE UNIQUE INDEX moderation_actions_pkey ON public.moderation_actions USING btree (id);
CREATE UNIQUE INDEX moderators_pkey ON public.moderators USING btree (user_id);
CREATE UNIQUE INDEX news_items_pkey ON public.news_items USING btree (id);
CREATE INDEX news_items_published_idx ON public.news_items USING btree (published_at DESC);
CREATE INDEX news_items_source_idx ON public.news_items USING btree (source_id);
CREATE UNIQUE INDEX news_items_source_url_uidx ON public.news_items USING btree (source_id, url);
CREATE UNIQUE INDEX notification_event_log_pkey ON public.notification_event_log USING btree (id);
CREATE UNIQUE INDEX notification_event_log_unique ON public.notification_event_log USING btree (event_type, event_key);
CREATE UNIQUE INDEX notification_preferences_pkey ON public.notification_preferences USING btree (user_id);
CREATE UNIQUE INDEX notification_topic_prefs_pkey ON public.notification_topic_prefs USING btree (user_id, topic_id);
CREATE INDEX notification_topic_prefs_user_idx ON public.notification_topic_prefs USING btree (user_id);
CREATE UNIQUE INDEX og_image_cache_pkey ON public.og_image_cache USING btree (question_id);
CREATE INDEX party_alliance_members_active_idx ON public.party_alliance_members USING btree (alliance_party_id) WHERE (valid_to IS NULL);
CREATE INDEX party_alliance_members_alliance_idx ON public.party_alliance_members USING btree (alliance_party_id);
CREATE INDEX party_alliance_members_member_idx ON public.party_alliance_members USING btree (member_party_id);
CREATE UNIQUE INDEX party_alliance_members_pkey ON public.party_alliance_members USING btree (id);
CREATE UNIQUE INDEX party_alliance_members_unique ON public.party_alliance_members USING btree (alliance_party_id, member_party_id, state_code);
CREATE UNIQUE INDEX password_resets_pkey ON public.password_resets USING btree (user_id, token_hash);
CREATE UNIQUE INDEX pipeline_jobs_pkey ON public.pipeline_jobs USING btree (id);
CREATE INDEX pr_expires_idx ON public.password_resets USING btree (expires_at);
CREATE INDEX profiles_audience_segment_idx ON public.profiles USING btree (audience_segment_id);
CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (user_id);
CREATE INDEX profiles_primary_constituency_idx ON public.profiles USING btree (primary_constituency_id) WHERE (primary_constituency_id IS NOT NULL);
CREATE INDEX profiles_random_id_idx ON public.profiles USING btree (random_id);
CREATE UNIQUE INDEX profiles_random_id_key ON public.profiles USING btree (random_id);
CREATE INDEX profiles_username_idx ON public.profiles USING btree (username);
CREATE UNIQUE INDEX profiles_username_key ON public.profiles USING btree (username);
CREATE UNIQUE INDEX profiles_verified_phone_hash_idx ON public.profiles USING btree (verified_phone_hash) WHERE (verified_phone_hash IS NOT NULL);
CREATE UNIQUE INDEX publishers_pkey ON public.publishers USING btree (id);
CREATE UNIQUE INDEX publishers_publisher_ref_key ON public.publishers USING btree (publisher_ref);
CREATE INDEX publishers_ref_idx ON public.publishers USING btree (publisher_ref);
CREATE INDEX question_audience_fit_feed_idx ON public.question_audience_fit USING btree (question_id, audience_segment_id, relevance_tier);
CREATE UNIQUE INDEX question_audience_fit_pkey ON public.question_audience_fit USING btree (id);
CREATE INDEX question_audience_fit_question_idx ON public.question_audience_fit USING btree (question_id);
CREATE INDEX question_audience_fit_segment_idx ON public.question_audience_fit USING btree (audience_segment_id);
CREATE UNIQUE INDEX question_audience_fit_unique ON public.question_audience_fit USING btree (question_id, audience_segment_id);
CREATE UNIQUE INDEX question_comment_sentiment_pkey ON public.question_comment_sentiment USING btree (question_id);
CREATE UNIQUE INDEX question_context_updates_pkey ON public.question_context_updates USING btree (id);
CREATE INDEX question_draft_audience_fit_draft_idx ON public.question_draft_audience_fit USING btree (question_draft_id);
CREATE UNIQUE INDEX question_draft_audience_fit_pkey ON public.question_draft_audience_fit USING btree (id);
CREATE INDEX question_draft_audience_fit_segment_idx ON public.question_draft_audience_fit USING btree (audience_segment_id);
CREATE UNIQUE INDEX question_draft_audience_fit_unique ON public.question_draft_audience_fit USING btree (question_draft_id, audience_segment_id);
CREATE UNIQUE INDEX question_drafts_pkey ON public.question_drafts USING btree (id);
CREATE INDEX question_drafts_status_created_at_idx ON public.question_drafts USING btree (status, created_at DESC);
CREATE INDEX question_drafts_topic_draft_id_idx ON public.question_drafts USING btree (topic_draft_id);
CREATE UNIQUE INDEX question_duplicates_pkey ON public.question_duplicates USING btree (id);
CREATE UNIQUE INDEX question_engagement_metrics_pkey ON public.question_engagement_metrics USING btree (question_id);
CREATE UNIQUE INDEX question_lifecycle_config_pkey ON public.question_lifecycle_config USING btree (id);
CREATE UNIQUE INDEX question_links_pkey ON public.question_links USING btree (id);
CREATE UNIQUE INDEX question_stance_confidence_pkey ON public.question_stance_confidence USING btree (user_id, question_id);
CREATE INDEX question_stance_confidence_question_idx ON public.question_stance_confidence USING btree (question_id);
CREATE UNIQUE INDEX question_stance_stats_history_pkey ON public.question_stance_stats_history USING btree (question_id, region_scope, region_key, snapshot_date);
CREATE UNIQUE INDEX question_stance_stats_pkey ON public.question_stance_stats USING btree (question_id);
CREATE UNIQUE INDEX question_stance_stats_region_pkey ON public.question_stance_stats_region USING btree (question_id, region_scope, region_key);
CREATE INDEX question_stances_flagged_idx ON public.question_stances USING btree (question_id, is_flagged) WHERE (is_flagged = false);
CREATE INDEX question_stances_forward_chain_idx ON public.question_stances USING btree (forward_chain_id) WHERE (forward_chain_id IS NOT NULL);
CREATE UNIQUE INDEX question_stances_pkey ON public.question_stances USING btree (id);
CREATE UNIQUE INDEX question_stances_user_id_question_id_key ON public.question_stances USING btree (user_id, question_id);
CREATE UNIQUE INDEX question_stances_whatsapp_dedup_idx ON public.question_stances USING btree (whatsapp_phone_hash, question_id) WHERE (whatsapp_phone_hash IS NOT NULL);
CREATE UNIQUE INDEX question_state_history_pkey ON public.question_state_history USING btree (id);
CREATE UNIQUE INDEX question_tradeoffs_pkey ON public.question_tradeoffs USING btree (question_id);
CREATE UNIQUE INDEX question_trending_metrics_pkey ON public.question_trending_metrics USING btree (question_id);
CREATE UNIQUE INDEX question_view_events_pkey ON public.question_view_events USING btree (id);
CREATE UNIQUE INDEX question_visibility_rules_pkey ON public.question_visibility_rules USING btree (question_id);
CREATE INDEX question_visibility_rules_question_id_last_eval_idx ON public.question_visibility_rules USING btree (question_id, last_evaluated_at DESC);
CREATE INDEX question_visibility_rules_visibility_idx ON public.question_visibility_rules USING btree (visibility, last_evaluated_at DESC);
CREATE INDEX questions_election_constituency_idx ON public.questions USING btree (election_constituency_id, is_election_question) WHERE (is_election_question = true);
CREATE INDEX questions_election_id_idx ON public.questions USING btree (election_id) WHERE (election_id IS NOT NULL);
CREATE INDEX questions_election_party_idx ON public.questions USING btree (election_party_id) WHERE (election_party_id IS NOT NULL);
CREATE INDEX questions_news_item_id_idx ON public.questions USING btree (news_item_id);
CREATE UNIQUE INDEX questions_pkey ON public.questions USING btree (id);
CREATE INDEX questions_status_created_at_idx ON public.questions USING btree (status, created_at DESC);
CREATE INDEX questions_status_published_idx ON public.questions USING btree (status, published_at DESC);
CREATE UNIQUE INDEX reserved_usernames_pkey ON public.reserved_usernames USING btree (username);
CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (id);
CREATE UNIQUE INDEX sessions_user_id_key ON public.sessions USING btree (user_id);
CREATE INDEX sessions_user_seen_idx ON public.sessions USING btree (user_id, last_seen_at DESC);
CREATE UNIQUE INDEX share_click_events_pkey ON public.share_click_events USING btree (id);
CREATE INDEX share_click_events_share_idx ON public.share_click_events USING btree (share_event_id);
CREATE UNIQUE INDEX share_events_pkey ON public.share_events USING btree (id);
CREATE INDEX share_events_question_idx ON public.share_events USING btree (question_id);
CREATE INDEX share_events_user_idx ON public.share_events USING btree (shared_by_user_id) WHERE (shared_by_user_id IS NOT NULL);
CREATE UNIQUE INDEX social_auth_tokens_pkey ON public.social_auth_tokens USING btree (id);
CREATE INDEX social_auth_tokens_provider_user_idx ON public.social_auth_tokens USING btree (provider, provider_user_id);
CREATE UNIQUE INDEX social_auth_tokens_user_provider_unique ON public.social_auth_tokens USING btree (user_id, provider);
CREATE UNIQUE INDEX social_reply_inbox_pkey ON public.social_reply_inbox USING btree (id);
CREATE INDEX social_reply_inbox_question_idx ON public.social_reply_inbox USING btree (question_id);
CREATE INDEX social_reply_inbox_share_event_idx ON public.social_reply_inbox USING btree (share_event_id);
CREATE INDEX social_reply_inbox_status_idx ON public.social_reply_inbox USING btree (processing_status) WHERE (processing_status = 'pending'::text);
CREATE UNIQUE INDEX social_reply_inbox_unique_post ON public.social_reply_inbox USING btree (share_event_id, external_post_id);
CREATE UNIQUE INDEX societal_pulse_config_pkey ON public.societal_pulse_config USING btree (key);
CREATE UNIQUE INDEX stance_history_pkey ON public.stance_history USING btree (id);
CREATE UNIQUE INDEX stance_texts_pkey ON public.stance_texts USING btree (user_id, question_id);
CREATE UNIQUE INDEX topic_cluster_items_pkey ON public.topic_cluster_items USING btree (cluster_id, ingestion_id);
CREATE INDEX topic_clusters_centroid_vec_ivfflat ON public.topic_clusters USING ivfflat (centroid_vec extensions.vector_cosine_ops);
CREATE UNIQUE INDEX topic_clusters_pkey ON public.topic_clusters USING btree (id);
CREATE UNIQUE INDEX topic_clusters_story_id_key ON public.topic_clusters USING btree (story_id);
CREATE INDEX topic_drafts_news_item_created_idx ON public.topic_drafts USING btree (news_item_id, created_at DESC);
CREATE UNIQUE INDEX topic_drafts_one_active_per_news ON public.topic_drafts USING btree (news_item_id) WHERE (status = ANY (ARRAY['draft'::text, 'approved'::text]));
CREATE UNIQUE INDEX topic_drafts_pkey ON public.topic_drafts USING btree (id);
CREATE INDEX topic_drafts_status_created_at_idx ON public.topic_drafts USING btree (status, created_at DESC);
CREATE INDEX topic_impact_scores_composite_idx ON public.topic_impact_scores USING btree (composite_score DESC NULLS LAST, updated_at DESC);
CREATE UNIQUE INDEX topic_impact_scores_pkey ON public.topic_impact_scores USING btree (id);
CREATE UNIQUE INDEX topic_impact_scores_question_id_key ON public.topic_impact_scores USING btree (question_id);
CREATE INDEX topic_impact_scores_question_id_updated_at_idx ON public.topic_impact_scores USING btree (question_id, updated_at DESC);
CREATE UNIQUE INDEX topic_impact_scores_topic_id_key ON public.topic_impact_scores USING btree (topic_id) WHERE (topic_id IS NOT NULL);
CREATE UNIQUE INDEX topic_region_trends_pkey ON public.topic_region_trends USING btree (topic_id, location_id);
CREATE UNIQUE INDEX topic_regions_pkey ON public.topic_regions USING btree (topic_id, region_id);
CREATE UNIQUE INDEX topic_sources_pkey ON public.topic_sources USING btree (id);
CREATE UNIQUE INDEX topics_pkey ON public.topics USING btree (id);
CREATE INDEX topics_published_idx ON public.topics USING btree (published_at DESC);
CREATE UNIQUE INDEX topics_slug_unique ON public.topics USING btree (slug);
CREATE UNIQUE INDEX toxicity_scores_pkey ON public.toxicity_scores USING btree (comment_id);
CREATE INDEX ts_last_polled_idx ON public.topic_sources USING btree (is_enabled, last_polled_at DESC);
CREATE INDEX uls_location_idx ON public.user_location_settings USING btree (location_id);
CREATE INDEX uls_user_idx ON public.user_location_settings USING btree (user_id);
CREATE UNIQUE INDEX unique_config ON public.question_lifecycle_config USING btree (topic_category, region_tier) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX unique_link ON public.question_links USING btree (from_question_id, to_question_id, link_type);
CREATE UNIQUE INDEX uq_ingestion_queue_dedupe_key ON public.ingestion_queue USING btree (dedupe_key);
CREATE UNIQUE INDEX user_cognitive_states_pkey ON public.user_cognitive_states USING btree (id);
CREATE UNIQUE INDEX user_follows_pkey ON public.user_follows USING btree (id);
CREATE UNIQUE INDEX user_follows_user_id_follow_type_follow_id_key ON public.user_follows USING btree (user_id, follow_type, follow_id);
CREATE UNIQUE INDEX user_location_settings_pkey ON public.user_location_settings USING btree (user_id, location_id);
CREATE UNIQUE INDEX user_notifications_pkey ON public.user_notifications USING btree (id);
CREATE UNIQUE INDEX user_privacy_pkey ON public.user_privacy USING btree (user_id);
CREATE UNIQUE INDEX user_region_follows_pkey ON public.user_region_follows USING btree (id);
CREATE UNIQUE INDEX user_region_follows_user_id_region_scope_region_key_key ON public.user_region_follows USING btree (user_id, region_scope, region_key);
CREATE UNIQUE INDEX user_region_preferences_pkey ON public.user_region_preferences USING btree (user_id);
CREATE UNIQUE INDEX user_restrictions_pkey ON public.user_restrictions USING btree (id);
CREATE UNIQUE INDEX user_topic_follows_pkey ON public.user_topic_follows USING btree (id);
CREATE UNIQUE INDEX user_topic_follows_user_id_topic_id_key ON public.user_topic_follows USING btree (user_id, topic_id);
CREATE UNIQUE INDEX user_topic_interactions_pkey ON public.user_topic_interactions USING btree (id);
CREATE UNIQUE INDEX user_topic_interactions_user_id_topic_id_key ON public.user_topic_interactions USING btree (user_id, topic_id);
CREATE UNIQUE INDEX username_history_pkey ON public.username_history USING btree (id);
CREATE INDEX username_history_user_created_desc ON public.username_history USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);
CREATE INDEX users_last_seen_idx ON public.users USING btree (last_seen_at);
CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);
CREATE INDEX users_status_idx ON public.users USING btree (status);
CREATE UNIQUE INDEX ux_profiles_username_ci ON public.profiles USING btree (lower(username)) WHERE (username IS NOT NULL);
CREATE UNIQUE INDEX weekly_digests_pkey ON public.weekly_digests USING btree (id);
CREATE UNIQUE INDEX weekly_digests_unique_user_week ON public.weekly_digests USING btree (user_id, week_start, week_end);
CREATE UNIQUE INDEX whatsapp_active_sessions_pkey ON public.whatsapp_active_sessions USING btree (whatsapp_phone_hash);
CREATE UNIQUE INDEX whatsapp_broadcasts_pkey ON public.whatsapp_broadcasts USING btree (id);
CREATE INDEX whatsapp_broadcasts_question_idx ON public.whatsapp_broadcasts USING btree (question_id);
CREATE INDEX whatsapp_broadcasts_status_idx ON public.whatsapp_broadcasts USING btree (status) WHERE (status = ANY (ARRAY['scheduled'::text, 'sending'::text]));
CREATE UNIQUE INDEX whatsapp_config_pkey ON public.whatsapp_config USING btree (id);
CREATE UNIQUE INDEX whatsapp_config_singleton_idx ON public.whatsapp_config USING btree ((true));
CREATE UNIQUE INDEX whatsapp_contact_list_numbers_dedup_idx ON public.whatsapp_contact_list_numbers USING btree (contact_list_id, phone_hash);
CREATE INDEX whatsapp_contact_list_numbers_list_idx ON public.whatsapp_contact_list_numbers USING btree (contact_list_id);
CREATE UNIQUE INDEX whatsapp_contact_list_numbers_pkey ON public.whatsapp_contact_list_numbers USING btree (id);
CREATE UNIQUE INDEX whatsapp_contact_lists_pkey ON public.whatsapp_contact_lists USING btree (id);
CREATE INDEX whatsapp_delivery_log_broadcast_idx ON public.whatsapp_delivery_log USING btree (broadcast_id);
CREATE INDEX whatsapp_delivery_log_phone_hash_idx ON public.whatsapp_delivery_log USING btree (phone_hash);
CREATE UNIQUE INDEX whatsapp_delivery_log_pkey ON public.whatsapp_delivery_log USING btree (id);
CREATE INDEX whatsapp_delivery_log_purge_idx ON public.whatsapp_delivery_log USING btree (purge_after);
CREATE INDEX whatsapp_forward_chains_parent_idx ON public.whatsapp_forward_chains USING btree (parent_forward_chain_id) WHERE (parent_forward_chain_id IS NOT NULL);
CREATE UNIQUE INDEX whatsapp_forward_chains_pkey ON public.whatsapp_forward_chains USING btree (id);
CREATE INDEX whatsapp_forward_chains_question_depth_idx ON public.whatsapp_forward_chains USING btree (question_id, depth);
CREATE INDEX whatsapp_optouts_active_idx ON public.whatsapp_optouts USING btree (phone_hash) WHERE (is_active = true);
CREATE UNIQUE INDEX whatsapp_optouts_pkey ON public.whatsapp_optouts USING btree (phone_hash);
CREATE UNIQUE INDEX whatsapp_phone_verifications_pkey ON public.whatsapp_phone_verifications USING btree (id);
CREATE INDEX whatsapp_phone_verifications_token_idx ON public.whatsapp_phone_verifications USING btree (verification_token) WHERE (used = false);
CREATE UNIQUE INDEX whatsapp_phone_verifications_verification_token_key ON public.whatsapp_phone_verifications USING btree (verification_token);
CREATE UNIQUE INDEX whatsapp_question_subscriptio_whatsapp_phone_hash_question__key ON public.whatsapp_question_subscriptions USING btree (whatsapp_phone_hash, question_id);
CREATE INDEX whatsapp_question_subscriptions_active_idx ON public.whatsapp_question_subscriptions USING btree (question_id) WHERE (is_active = true);
CREATE INDEX whatsapp_question_subscriptions_notify_idx ON public.whatsapp_question_subscriptions USING btree (last_notified_at NULLS FIRST) WHERE (is_active = true);
CREATE UNIQUE INDEX whatsapp_question_subscriptions_pkey ON public.whatsapp_question_subscriptions USING btree (id);
CREATE UNIQUE INDEX whatsapp_webhook_errors_pkey ON public.whatsapp_webhook_errors USING btree (id);
CREATE INDEX whatsapp_webhook_errors_resolved_idx ON public.whatsapp_webhook_errors USING btree (resolved, received_at DESC) WHERE (resolved = false);
alter table "admin"."audit_log" add constraint "audit_log_pkey" PRIMARY KEY using index "audit_log_pkey";
alter table "admin"."cron_runs" add constraint "cron_runs_pkey" PRIMARY KEY using index "cron_runs_pkey";
alter table "admin"."fn_perf" add constraint "fn_perf_pkey" PRIMARY KEY using index "fn_perf_pkey";
alter table "admin"."rpc_perf" add constraint "rpc_perf_pkey" PRIMARY KEY using index "rpc_perf_pkey";
alter table "private"."kv_secrets" add constraint "kv_secrets_pkey" PRIMARY KEY using index "kv_secrets_pkey";
alter table "private"."secrets" add constraint "secrets_pkey" PRIMARY KEY using index "secrets_pkey";
alter table "public"."admin_fn_perf" add constraint "admin_fn_perf_pkey" PRIMARY KEY using index "admin_fn_perf_pkey";
alter table "public"."admin_users" add constraint "admin_users_pkey" PRIMARY KEY using index "admin_users_pkey";
alter table "public"."ai_prompts" add constraint "ai_prompts_pkey" PRIMARY KEY using index "ai_prompts_pkey";
alter table "public"."ai_question_draft_versions" add constraint "ai_question_draft_versions_pkey" PRIMARY KEY using index "ai_question_draft_versions_pkey";
alter table "public"."ai_question_drafts" add constraint "ai_question_drafts_pkey" PRIMARY KEY using index "ai_question_drafts_pkey";
alter table "public"."app_config_trending" add constraint "app_config_trending_pkey" PRIMARY KEY using index "app_config_trending_pkey";
alter table "public"."audience_segments" add constraint "audience_segments_pkey" PRIMARY KEY using index "audience_segments_pkey";
alter table "public"."avatars" add constraint "avatars_pkey" PRIMARY KEY using index "avatars_pkey";
alter table "public"."backup_codes" add constraint "backup_codes_pkey" PRIMARY KEY using index "backup_codes_pkey";
alter table "public"."cognitive_state_snapshots" add constraint "cognitive_state_snapshots_pkey" PRIMARY KEY using index "cognitive_state_snapshots_pkey";
alter table "public"."comment_reactions" add constraint "comment_reactions_pkey" PRIMARY KEY using index "comment_reactions_pkey";
alter table "public"."comment_reports" add constraint "comment_reports_pkey" PRIMARY KEY using index "comment_reports_pkey";
alter table "public"."comments" add constraint "comments_pkey" PRIMARY KEY using index "comments_pkey";
alter table "public"."community_trends" add constraint "community_trends_pkey" PRIMARY KEY using index "community_trends_pkey";
alter table "public"."consent_logs" add constraint "consent_logs_pkey" PRIMARY KEY using index "consent_logs_pkey";
alter table "public"."contribution_acknowledgements" add constraint "contribution_acknowledgements_pkey" PRIMARY KEY using index "contribution_acknowledgements_pkey";
alter table "public"."daily_curated_questions" add constraint "daily_curated_questions_pkey" PRIMARY KEY using index "daily_curated_questions_pkey";
alter table "public"."deletion_requests" add constraint "deletion_requests_pkey" PRIMARY KEY using index "deletion_requests_pkey";
alter table "public"."demographic_breakdowns" add constraint "demographic_breakdowns_pkey" PRIMARY KEY using index "demographic_breakdowns_pkey";
alter table "public"."devices" add constraint "devices_pkey" PRIMARY KEY using index "devices_pkey";
alter table "public"."election_anomaly_events" add constraint "election_anomaly_events_pkey" PRIMARY KEY using index "election_anomaly_events_pkey";
alter table "public"."election_audit_log" add constraint "election_audit_log_pkey" PRIMARY KEY using index "election_audit_log_pkey";
alter table "public"."election_candidates" add constraint "election_candidates_pkey" PRIMARY KEY using index "election_candidates_pkey";
alter table "public"."election_compliance_rules" add constraint "election_compliance_rules_pkey" PRIMARY KEY using index "election_compliance_rules_pkey";
alter table "public"."election_constituencies" add constraint "election_constituencies_pkey" PRIMARY KEY using index "election_constituencies_pkey";
alter table "public"."election_issue_tag_allowlists" add constraint "election_issue_tag_allowlists_pkey" PRIMARY KEY using index "election_issue_tag_allowlists_pkey";
alter table "public"."election_parties" add constraint "election_parties_pkey" PRIMARY KEY using index "election_parties_pkey";
alter table "public"."election_party_elections" add constraint "election_party_elections_pkey" PRIMARY KEY using index "election_party_elections_pkey";
alter table "public"."election_party_regions" add constraint "election_party_regions_pkey" PRIMARY KEY using index "election_party_regions_pkey";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_pkey" PRIMARY KEY using index "election_question_drafts_pkey";
alter table "public"."election_source_documents" add constraint "election_source_documents_pkey" PRIMARY KEY using index "election_source_documents_pkey";
alter table "public"."election_stance_aggregates" add constraint "election_stance_aggregates_pkey" PRIMARY KEY using index "election_stance_aggregates_pkey";
alter table "public"."election_tiers" add constraint "election_tiers_pkey" PRIMARY KEY using index "election_tiers_pkey";
alter table "public"."elections" add constraint "elections_pkey" PRIMARY KEY using index "elections_pkey";
alter table "public"."email_events" add constraint "email_events_pkey" PRIMARY KEY using index "email_events_pkey";
alter table "public"."embed_cta_events" add constraint "embed_cta_events_pkey" PRIMARY KEY using index "embed_cta_events_pkey";
alter table "public"."embed_impressions" add constraint "embed_impressions_pkey" PRIMARY KEY using index "embed_impressions_pkey";
alter table "public"."embed_rate_limits" add constraint "embed_rate_limits_pkey" PRIMARY KEY using index "embed_rate_limits_pkey";
alter table "public"."embed_snippet_versions" add constraint "embed_snippet_versions_pkey" PRIMARY KEY using index "embed_snippet_versions_pkey";
alter table "public"."embedded_stances" add constraint "embedded_stances_pkey" PRIMARY KEY using index "embedded_stances_pkey";
alter table "public"."feed_policies" add constraint "feed_policies_pkey" PRIMARY KEY using index "feed_policies_pkey";
alter table "public"."feed_policy_lanes" add constraint "feed_policy_lanes_pkey" PRIMARY KEY using index "feed_policy_lanes_pkey";
alter table "public"."ingested_stances" add constraint "ingested_stances_pkey" PRIMARY KEY using index "ingested_stances_pkey";
alter table "public"."ingestion_queue" add constraint "ingestion_queue_pkey" PRIMARY KEY using index "ingestion_queue_pkey";
alter table "public"."location_audits" add constraint "location_audits_pkey" PRIMARY KEY using index "location_audits_pkey";
alter table "public"."locations" add constraint "locations_pkey" PRIMARY KEY using index "locations_pkey";
alter table "public"."mfa_methods" add constraint "mfa_methods_pkey" PRIMARY KEY using index "mfa_methods_pkey";
alter table "public"."moderation_actions" add constraint "moderation_actions_pkey" PRIMARY KEY using index "moderation_actions_pkey";
alter table "public"."moderators" add constraint "moderators_pkey" PRIMARY KEY using index "moderators_pkey";
alter table "public"."news_items" add constraint "news_items_pkey" PRIMARY KEY using index "news_items_pkey";
alter table "public"."notification_event_log" add constraint "notification_event_log_pkey" PRIMARY KEY using index "notification_event_log_pkey";
alter table "public"."notification_preferences" add constraint "notification_preferences_pkey" PRIMARY KEY using index "notification_preferences_pkey";
alter table "public"."notification_topic_prefs" add constraint "notification_topic_prefs_pkey" PRIMARY KEY using index "notification_topic_prefs_pkey";
alter table "public"."og_image_cache" add constraint "og_image_cache_pkey" PRIMARY KEY using index "og_image_cache_pkey";
alter table "public"."party_alliance_members" add constraint "party_alliance_members_pkey" PRIMARY KEY using index "party_alliance_members_pkey";
alter table "public"."password_resets" add constraint "password_resets_pkey" PRIMARY KEY using index "password_resets_pkey";
alter table "public"."pipeline_jobs" add constraint "pipeline_jobs_pkey" PRIMARY KEY using index "pipeline_jobs_pkey";
alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";
alter table "public"."publishers" add constraint "publishers_pkey" PRIMARY KEY using index "publishers_pkey";
alter table "public"."question_audience_fit" add constraint "question_audience_fit_pkey" PRIMARY KEY using index "question_audience_fit_pkey";
alter table "public"."question_comment_sentiment" add constraint "question_comment_sentiment_pkey" PRIMARY KEY using index "question_comment_sentiment_pkey";
alter table "public"."question_context_updates" add constraint "question_context_updates_pkey" PRIMARY KEY using index "question_context_updates_pkey";
alter table "public"."question_draft_audience_fit" add constraint "question_draft_audience_fit_pkey" PRIMARY KEY using index "question_draft_audience_fit_pkey";
alter table "public"."question_drafts" add constraint "question_drafts_pkey" PRIMARY KEY using index "question_drafts_pkey";
alter table "public"."question_duplicates" add constraint "question_duplicates_pkey" PRIMARY KEY using index "question_duplicates_pkey";
alter table "public"."question_engagement_metrics" add constraint "question_engagement_metrics_pkey" PRIMARY KEY using index "question_engagement_metrics_pkey";
alter table "public"."question_lifecycle_config" add constraint "question_lifecycle_config_pkey" PRIMARY KEY using index "question_lifecycle_config_pkey";
alter table "public"."question_links" add constraint "question_links_pkey" PRIMARY KEY using index "question_links_pkey";
alter table "public"."question_stance_confidence" add constraint "question_stance_confidence_pkey" PRIMARY KEY using index "question_stance_confidence_pkey";
alter table "public"."question_stance_stats" add constraint "question_stance_stats_pkey" PRIMARY KEY using index "question_stance_stats_pkey";
alter table "public"."question_stance_stats_history" add constraint "question_stance_stats_history_pkey" PRIMARY KEY using index "question_stance_stats_history_pkey";
alter table "public"."question_stance_stats_region" add constraint "question_stance_stats_region_pkey" PRIMARY KEY using index "question_stance_stats_region_pkey";
alter table "public"."question_stances" add constraint "question_stances_pkey" PRIMARY KEY using index "question_stances_pkey";
alter table "public"."question_state_history" add constraint "question_state_history_pkey" PRIMARY KEY using index "question_state_history_pkey";
alter table "public"."question_tradeoffs" add constraint "question_tradeoffs_pkey" PRIMARY KEY using index "question_tradeoffs_pkey";
alter table "public"."question_trending_metrics" add constraint "question_trending_metrics_pkey" PRIMARY KEY using index "question_trending_metrics_pkey";
alter table "public"."question_view_events" add constraint "question_view_events_pkey" PRIMARY KEY using index "question_view_events_pkey";
alter table "public"."question_visibility_rules" add constraint "question_visibility_rules_pkey" PRIMARY KEY using index "question_visibility_rules_pkey";
alter table "public"."questions" add constraint "questions_pkey" PRIMARY KEY using index "questions_pkey";
alter table "public"."reserved_usernames" add constraint "reserved_usernames_pkey" PRIMARY KEY using index "reserved_usernames_pkey";
alter table "public"."sessions" add constraint "sessions_pkey" PRIMARY KEY using index "sessions_pkey";
alter table "public"."share_click_events" add constraint "share_click_events_pkey" PRIMARY KEY using index "share_click_events_pkey";
alter table "public"."share_events" add constraint "share_events_pkey" PRIMARY KEY using index "share_events_pkey";
alter table "public"."social_auth_tokens" add constraint "social_auth_tokens_pkey" PRIMARY KEY using index "social_auth_tokens_pkey";
alter table "public"."social_reply_inbox" add constraint "social_reply_inbox_pkey" PRIMARY KEY using index "social_reply_inbox_pkey";
alter table "public"."societal_pulse_config" add constraint "societal_pulse_config_pkey" PRIMARY KEY using index "societal_pulse_config_pkey";
alter table "public"."stance_history" add constraint "stance_history_pkey" PRIMARY KEY using index "stance_history_pkey";
alter table "public"."stance_texts" add constraint "stance_texts_pkey" PRIMARY KEY using index "stance_texts_pkey";
alter table "public"."topic_cluster_items" add constraint "topic_cluster_items_pkey" PRIMARY KEY using index "topic_cluster_items_pkey";
alter table "public"."topic_clusters" add constraint "topic_clusters_pkey" PRIMARY KEY using index "topic_clusters_pkey";
alter table "public"."topic_drafts" add constraint "topic_drafts_pkey" PRIMARY KEY using index "topic_drafts_pkey";
alter table "public"."topic_impact_scores" add constraint "topic_impact_scores_pkey" PRIMARY KEY using index "topic_impact_scores_pkey";
alter table "public"."topic_region_trends" add constraint "topic_region_trends_pkey" PRIMARY KEY using index "topic_region_trends_pkey";
alter table "public"."topic_regions" add constraint "topic_regions_pkey" PRIMARY KEY using index "topic_regions_pkey";
alter table "public"."topic_sources" add constraint "topic_sources_pkey" PRIMARY KEY using index "topic_sources_pkey";
alter table "public"."topics" add constraint "topics_pkey" PRIMARY KEY using index "topics_pkey";
alter table "public"."toxicity_scores" add constraint "toxicity_scores_pkey" PRIMARY KEY using index "toxicity_scores_pkey";
alter table "public"."user_cognitive_states" add constraint "user_cognitive_states_pkey" PRIMARY KEY using index "user_cognitive_states_pkey";
alter table "public"."user_follows" add constraint "user_follows_pkey" PRIMARY KEY using index "user_follows_pkey";
alter table "public"."user_location_settings" add constraint "user_location_settings_pkey" PRIMARY KEY using index "user_location_settings_pkey";
alter table "public"."user_notifications" add constraint "user_notifications_pkey" PRIMARY KEY using index "user_notifications_pkey";
alter table "public"."user_privacy" add constraint "user_privacy_pkey" PRIMARY KEY using index "user_privacy_pkey";
alter table "public"."user_region_follows" add constraint "user_region_follows_pkey" PRIMARY KEY using index "user_region_follows_pkey";
alter table "public"."user_region_preferences" add constraint "user_region_preferences_pkey" PRIMARY KEY using index "user_region_preferences_pkey";
alter table "public"."user_restrictions" add constraint "user_restrictions_pkey" PRIMARY KEY using index "user_restrictions_pkey";
alter table "public"."user_topic_follows" add constraint "user_topic_follows_pkey" PRIMARY KEY using index "user_topic_follows_pkey";
alter table "public"."user_topic_interactions" add constraint "user_topic_interactions_pkey" PRIMARY KEY using index "user_topic_interactions_pkey";
alter table "public"."username_history" add constraint "username_history_pkey" PRIMARY KEY using index "username_history_pkey";
alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";
alter table "public"."weekly_digests" add constraint "weekly_digests_pkey" PRIMARY KEY using index "weekly_digests_pkey";
alter table "public"."whatsapp_active_sessions" add constraint "whatsapp_active_sessions_pkey" PRIMARY KEY using index "whatsapp_active_sessions_pkey";
alter table "public"."whatsapp_broadcasts" add constraint "whatsapp_broadcasts_pkey" PRIMARY KEY using index "whatsapp_broadcasts_pkey";
alter table "public"."whatsapp_config" add constraint "whatsapp_config_pkey" PRIMARY KEY using index "whatsapp_config_pkey";
alter table "public"."whatsapp_contact_list_numbers" add constraint "whatsapp_contact_list_numbers_pkey" PRIMARY KEY using index "whatsapp_contact_list_numbers_pkey";
alter table "public"."whatsapp_contact_lists" add constraint "whatsapp_contact_lists_pkey" PRIMARY KEY using index "whatsapp_contact_lists_pkey";
alter table "public"."whatsapp_delivery_log" add constraint "whatsapp_delivery_log_pkey" PRIMARY KEY using index "whatsapp_delivery_log_pkey";
alter table "public"."whatsapp_forward_chains" add constraint "whatsapp_forward_chains_pkey" PRIMARY KEY using index "whatsapp_forward_chains_pkey";
alter table "public"."whatsapp_optouts" add constraint "whatsapp_optouts_pkey" PRIMARY KEY using index "whatsapp_optouts_pkey";
alter table "public"."whatsapp_phone_verifications" add constraint "whatsapp_phone_verifications_pkey" PRIMARY KEY using index "whatsapp_phone_verifications_pkey";
alter table "public"."whatsapp_question_subscriptions" add constraint "whatsapp_question_subscriptions_pkey" PRIMARY KEY using index "whatsapp_question_subscriptions_pkey";
alter table "public"."whatsapp_webhook_errors" add constraint "whatsapp_webhook_errors_pkey" PRIMARY KEY using index "whatsapp_webhook_errors_pkey";
alter table "admin"."audit_log" add constraint "audit_log_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) not valid;
alter table "admin"."audit_log" validate constraint "audit_log_user_id_fkey";
alter table "public"."admin_users" add constraint "admin_users_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."admin_users" validate constraint "admin_users_user_id_fkey";
alter table "public"."ai_prompts" add constraint "ai_prompts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."ai_prompts" validate constraint "ai_prompts_created_by_fkey";
alter table "public"."ai_prompts" add constraint "ai_prompts_temperature_check" CHECK (((temperature >= (0)::numeric) AND (temperature <= (2)::numeric))) not valid;
alter table "public"."ai_prompts" validate constraint "ai_prompts_temperature_check";
alter table "public"."ai_question_draft_versions" add constraint "ai_question_draft_versions_draft_id_fkey" FOREIGN KEY (draft_id) REFERENCES public.ai_question_drafts(id) ON DELETE CASCADE not valid;
alter table "public"."ai_question_draft_versions" validate constraint "ai_question_draft_versions_draft_id_fkey";
alter table "public"."ai_question_drafts" add constraint "ai_question_drafts_cluster_id_fkey" FOREIGN KEY (cluster_id) REFERENCES public.topic_clusters(id) ON DELETE SET NULL not valid;
alter table "public"."ai_question_drafts" validate constraint "ai_question_drafts_cluster_id_fkey";
alter table "public"."ai_question_drafts" add constraint "ai_question_drafts_state_check" CHECK ((state = ANY (ARRAY['draft'::text, 'hold'::text, 'rejected'::text, 'published'::text]))) not valid;
alter table "public"."ai_question_drafts" validate constraint "ai_question_drafts_state_check";
alter table "public"."ai_question_drafts" add constraint "chk_ai_draft_title_len" CHECK (((char_length(title) >= 8) AND (char_length(title) <= 140))) not valid;
alter table "public"."ai_question_drafts" validate constraint "chk_ai_draft_title_len";
alter table "public"."ai_question_drafts" add constraint "chk_ai_question_drafts_sources_nonempty" CHECK (((jsonb_typeof(sources) = 'array'::text) AND (jsonb_array_length(sources) > 0))) not valid;
alter table "public"."ai_question_drafts" validate constraint "chk_ai_question_drafts_sources_nonempty";
alter table "public"."audience_segments" add constraint "audience_segments_key_format" CHECK ((key ~ '^[a-z][a-z0-9_]*$'::text)) not valid;
alter table "public"."audience_segments" validate constraint "audience_segments_key_format";
alter table "public"."audience_segments" add constraint "audience_segments_key_unique" UNIQUE using index "audience_segments_key_unique";
alter table "public"."audience_segments" add constraint "audience_segments_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text]))) not valid;
alter table "public"."audience_segments" validate constraint "audience_segments_status_check";
alter table "public"."avatars" add constraint "avatars_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."avatars" validate constraint "avatars_user_id_fkey";
alter table "public"."backup_codes" add constraint "backup_codes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."backup_codes" validate constraint "backup_codes_user_id_fkey";
alter table "public"."cognitive_state_snapshots" add constraint "cognitive_state_snapshots_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."cognitive_state_snapshots" validate constraint "cognitive_state_snapshots_user_id_fkey";
alter table "public"."comment_reactions" add constraint "comment_reactions_comment_id_fkey" FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE CASCADE not valid;
alter table "public"."comment_reactions" validate constraint "comment_reactions_comment_id_fkey";
alter table "public"."comment_reactions" add constraint "comment_reactions_comment_id_user_id_key" UNIQUE using index "comment_reactions_comment_id_user_id_key";
alter table "public"."comment_reactions" add constraint "comment_reactions_reaction_check" CHECK ((reaction = ANY (ARRAY['up'::text, 'down'::text]))) not valid;
alter table "public"."comment_reactions" validate constraint "comment_reactions_reaction_check";
alter table "public"."comment_reactions" add constraint "comment_reactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."comment_reactions" validate constraint "comment_reactions_user_id_fkey";
alter table "public"."comment_reports" add constraint "comment_reports_comment_id_fkey" FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE CASCADE not valid;
alter table "public"."comment_reports" validate constraint "comment_reports_comment_id_fkey";
alter table "public"."comment_reports" add constraint "comment_reports_comment_id_reporter_id_key" UNIQUE using index "comment_reports_comment_id_reporter_id_key";
alter table "public"."comment_reports" add constraint "comment_reports_reason_check" CHECK ((reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate_speech'::text, 'other'::text]))) not valid;
alter table "public"."comment_reports" validate constraint "comment_reports_reason_check";
alter table "public"."comment_reports" add constraint "comment_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."comment_reports" validate constraint "comment_reports_reporter_id_fkey";
alter table "public"."comments" add constraint "comments_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.comments(id) ON DELETE CASCADE not valid;
alter table "public"."comments" validate constraint "comments_parent_id_fkey";
alter table "public"."comments" add constraint "comments_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."comments" validate constraint "comments_question_id_fkey";
alter table "public"."comments" add constraint "comments_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;
alter table "public"."comments" validate constraint "comments_topic_id_fkey";
alter table "public"."community_trends" add constraint "community_trends_scope_chk" CHECK ((region_scope = ANY (ARRAY['city'::text, 'county'::text, 'state'::text, 'country'::text, 'global'::text]))) not valid;
alter table "public"."community_trends" validate constraint "community_trends_scope_chk";
alter table "public"."community_trends" add constraint "community_trends_unique" UNIQUE using index "community_trends_unique";
alter table "public"."consent_logs" add constraint "consent_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."consent_logs" validate constraint "consent_logs_user_id_fkey";
alter table "public"."contribution_acknowledgements" add constraint "acknowledgements_trigger_type_check" CHECK ((trigger_type = ANY (ARRAY['early_responder'::text, 'trending_contribution'::text, 'threshold_met'::text, 'region_signal'::text]))) not valid;
alter table "public"."contribution_acknowledgements" validate constraint "acknowledgements_trigger_type_check";
alter table "public"."contribution_acknowledgements" add constraint "contribution_acknowledgements_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."contribution_acknowledgements" validate constraint "contribution_acknowledgements_user_id_fkey";
alter table "public"."daily_curated_questions" add constraint "daily_curated_questions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) not valid;
alter table "public"."daily_curated_questions" validate constraint "daily_curated_questions_created_by_fkey";
alter table "public"."deletion_requests" add constraint "deletion_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'cancelled'::text, 'executed'::text]))) not valid;
alter table "public"."deletion_requests" validate constraint "deletion_requests_status_check";
alter table "public"."deletion_requests" add constraint "deletion_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."deletion_requests" validate constraint "deletion_requests_user_id_fkey";
alter table "public"."demographic_breakdowns" add constraint "demographic_breakdowns_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."demographic_breakdowns" validate constraint "demographic_breakdowns_question_id_fkey";
alter table "public"."demographic_breakdowns" add constraint "demographic_breakdowns_unique" UNIQUE using index "demographic_breakdowns_unique";
alter table "public"."devices" add constraint "devices_user_fingerprint_key" UNIQUE using index "devices_user_fingerprint_key";
alter table "public"."devices" add constraint "devices_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."devices" validate constraint "devices_user_id_fkey";
alter table "public"."election_anomaly_events" add constraint "eae_severity_check" CHECK ((severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text]))) not valid;
alter table "public"."election_anomaly_events" validate constraint "eae_severity_check";
alter table "public"."election_anomaly_events" add constraint "eae_type_check" CHECK ((anomaly_type = ANY (ARRAY['VELOCITY_BURST'::text, 'GEO_CLUSTER'::text, 'COORDINATED_SUBMISSION'::text, 'DUPLICATE_USER'::text, 'UNVERIFIED_EMAIL'::text, 'SUSPICIOUS_REVERSAL'::text, 'BULK_ACCOUNT_CREATION'::text]))) not valid;
alter table "public"."election_anomaly_events" validate constraint "eae_type_check";
alter table "public"."election_anomaly_events" add constraint "election_anomaly_events_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE SET NULL not valid;
alter table "public"."election_anomaly_events" validate constraint "election_anomaly_events_election_id_fkey";
alter table "public"."election_anomaly_events" add constraint "election_anomaly_events_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE SET NULL not valid;
alter table "public"."election_anomaly_events" validate constraint "election_anomaly_events_question_id_fkey";
alter table "public"."election_anomaly_events" add constraint "election_anomaly_events_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."election_anomaly_events" validate constraint "election_anomaly_events_reviewed_by_fkey";
alter table "public"."election_anomaly_events" add constraint "election_anomaly_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."election_anomaly_events" validate constraint "election_anomaly_events_user_id_fkey";
alter table "public"."election_audit_log" add constraint "election_audit_log_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."election_audit_log" validate constraint "election_audit_log_actor_id_fkey";
alter table "public"."election_audit_log" add constraint "election_audit_log_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE SET NULL not valid;
alter table "public"."election_audit_log" validate constraint "election_audit_log_election_id_fkey";
alter table "public"."election_candidates" add constraint "election_candidates_constituency_election_unique" UNIQUE using index "election_candidates_constituency_election_unique";
alter table "public"."election_candidates" add constraint "election_candidates_constituency_id_fkey" FOREIGN KEY (constituency_id) REFERENCES public.election_constituencies(id) ON DELETE RESTRICT not valid;
alter table "public"."election_candidates" validate constraint "election_candidates_constituency_id_fkey";
alter table "public"."election_candidates" add constraint "election_candidates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."election_candidates" validate constraint "election_candidates_created_by_fkey";
alter table "public"."election_candidates" add constraint "election_candidates_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE CASCADE not valid;
alter table "public"."election_candidates" validate constraint "election_candidates_election_id_fkey";
alter table "public"."election_candidates" add constraint "election_candidates_gender_check" CHECK (((gender IS NULL) OR (gender = ANY (ARRAY['M'::text, 'F'::text, 'OTHER'::text])))) not valid;
alter table "public"."election_candidates" validate constraint "election_candidates_gender_check";
alter table "public"."election_candidates" add constraint "election_candidates_import_source_check" CHECK ((import_source = ANY (ARRAY['manual'::text, 'csv_import'::text, 'api'::text]))) not valid;
alter table "public"."election_candidates" validate constraint "election_candidates_import_source_check";
alter table "public"."election_candidates" add constraint "election_candidates_party_id_fkey" FOREIGN KEY (party_id) REFERENCES public.election_parties(id) ON DELETE SET NULL not valid;
alter table "public"."election_candidates" validate constraint "election_candidates_party_id_fkey";
alter table "public"."election_candidates" add constraint "election_candidates_previous_party_id_fkey" FOREIGN KEY (previous_party_id) REFERENCES public.election_parties(id) ON DELETE SET NULL not valid;
alter table "public"."election_candidates" validate constraint "election_candidates_previous_party_id_fkey";
alter table "public"."election_candidates" add constraint "election_candidates_status_check" CHECK ((status = ANY (ARRAY['DECLARED'::text, 'CONFIRMED'::text, 'WITHDRAWN'::text, 'DISQUALIFIED'::text, 'ELECTED'::text, 'DEFEATED'::text]))) not valid;
alter table "public"."election_candidates" validate constraint "election_candidates_status_check";
alter table "public"."election_compliance_rules" add constraint "election_compliance_active_requires_approval" CHECK (((NOT is_active) OR (approved_at IS NOT NULL))) not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_active_requires_approval";
alter table "public"."election_compliance_rules" add constraint "election_compliance_disclaimer_params" CHECK (((rule_type <> 'DISCLAIMER_OVERRIDE'::text) OR (disclaimer_text IS NOT NULL))) not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_disclaimer_params";
alter table "public"."election_compliance_rules" add constraint "election_compliance_exit_poll_params" CHECK (((rule_type <> 'EXIT_POLL_GATE'::text) OR (exit_poll_gate_minutes IS NOT NULL))) not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_exit_poll_params";
alter table "public"."election_compliance_rules" add constraint "election_compliance_rules_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_rules_approved_by_fkey";
alter table "public"."election_compliance_rules" add constraint "election_compliance_rules_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.admin_users(user_id) ON DELETE RESTRICT not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_rules_created_by_fkey";
alter table "public"."election_compliance_rules" add constraint "election_compliance_rules_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE CASCADE not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_rules_election_id_fkey";
alter table "public"."election_compliance_rules" add constraint "election_compliance_rules_type_check" CHECK ((rule_type = ANY (ARRAY['SILENCE_OVERRIDE'::text, 'EXIT_POLL_GATE'::text, 'MCC_DATE_OVERRIDE'::text, 'DISCLAIMER_OVERRIDE'::text, 'SEC_CODE_DATE'::text, 'CUSTOM_QUIET_PERIOD'::text]))) not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_rules_type_check";
alter table "public"."election_compliance_rules" add constraint "election_compliance_silence_params" CHECK (((rule_type <> 'SILENCE_OVERRIDE'::text) OR ((silence_hours IS NOT NULL) OR (override_start_at IS NOT NULL)))) not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_silence_params";
alter table "public"."election_compliance_rules" add constraint "election_compliance_two_admin" CHECK (((approved_by IS NULL) OR (approved_by <> created_by))) not valid;
alter table "public"."election_compliance_rules" validate constraint "election_compliance_two_admin";
alter table "public"."election_constituencies" add constraint "election_constituencies_parent_constituency_id_fkey" FOREIGN KEY (parent_constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."election_constituencies" validate constraint "election_constituencies_parent_constituency_id_fkey";
alter table "public"."election_constituencies" add constraint "election_constituencies_tier_code_unique" UNIQUE using index "election_constituencies_tier_code_unique";
alter table "public"."election_issue_tag_allowlists" add constraint "election_issue_tag_allowlists_unique" UNIQUE using index "election_issue_tag_allowlists_unique";
alter table "public"."election_parties" add constraint "election_parties_abbreviation_country_unique" UNIQUE using index "election_parties_abbreviation_country_unique";
alter table "public"."election_parties" add constraint "election_parties_brand_colour_check" CHECK (((brand_colour IS NULL) OR (brand_colour ~ '^#[0-9A-Fa-f]{6}$'::text))) not valid;
alter table "public"."election_parties" validate constraint "election_parties_brand_colour_check";
alter table "public"."election_parties" add constraint "election_parties_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."election_parties" validate constraint "election_parties_created_by_fkey";
alter table "public"."election_parties" add constraint "election_parties_type_check" CHECK ((party_type = ANY (ARRAY['PARTY'::text, 'ALLIANCE'::text, 'INDEPENDENT'::text]))) not valid;
alter table "public"."election_parties" validate constraint "election_parties_type_check";
alter table "public"."election_party_elections" add constraint "election_party_elections_contesting_as_alliance_id_fkey" FOREIGN KEY (contesting_as_alliance_id) REFERENCES public.election_parties(id) ON DELETE SET NULL not valid;
alter table "public"."election_party_elections" validate constraint "election_party_elections_contesting_as_alliance_id_fkey";
alter table "public"."election_party_elections" add constraint "election_party_elections_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE CASCADE not valid;
alter table "public"."election_party_elections" validate constraint "election_party_elections_election_id_fkey";
alter table "public"."election_party_elections" add constraint "election_party_elections_party_id_fkey" FOREIGN KEY (party_id) REFERENCES public.election_parties(id) ON DELETE CASCADE not valid;
alter table "public"."election_party_elections" validate constraint "election_party_elections_party_id_fkey";
alter table "public"."election_party_elections" add constraint "election_party_elections_type_check" CHECK ((participation_type = ANY (ARRAY['CONTESTING'::text, 'SUPPORTING'::text, 'OUTSIDE_SUPPORT'::text]))) not valid;
alter table "public"."election_party_elections" validate constraint "election_party_elections_type_check";
alter table "public"."election_party_elections" add constraint "election_party_elections_unique" UNIQUE using index "election_party_elections_unique";
alter table "public"."election_party_regions" add constraint "election_party_regions_alliance_party_id_fkey" FOREIGN KEY (alliance_party_id) REFERENCES public.election_parties(id) ON DELETE SET NULL not valid;
alter table "public"."election_party_regions" validate constraint "election_party_regions_alliance_party_id_fkey";
alter table "public"."election_party_regions" add constraint "election_party_regions_alliance_role_check" CHECK (((alliance_role IS NULL) OR (alliance_role = ANY (ARRAY['LEADER'::text, 'PARTNER'::text, 'OUTSIDE_SUPPORT'::text])))) not valid;
alter table "public"."election_party_regions" validate constraint "election_party_regions_alliance_role_check";
alter table "public"."election_party_regions" add constraint "election_party_regions_party_id_fkey" FOREIGN KEY (party_id) REFERENCES public.election_parties(id) ON DELETE CASCADE not valid;
alter table "public"."election_party_regions" validate constraint "election_party_regions_party_id_fkey";
alter table "public"."election_party_regions" add constraint "election_party_regions_party_state_unique" UNIQUE using index "election_party_regions_party_state_unique";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.election_candidates(id) ON DELETE SET NULL not valid;
alter table "public"."election_question_drafts" validate constraint "election_question_drafts_candidate_id_fkey";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_confidence_score_check" CHECK (((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric))) not valid;
alter table "public"."election_question_drafts" validate constraint "election_question_drafts_confidence_score_check";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_constituency_id_fkey" FOREIGN KEY (constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."election_question_drafts" validate constraint "election_question_drafts_constituency_id_fkey";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE CASCADE not valid;
alter table "public"."election_question_drafts" validate constraint "election_question_drafts_election_id_fkey";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_party_id_fkey" FOREIGN KEY (party_id) REFERENCES public.election_parties(id) ON DELETE SET NULL not valid;
alter table "public"."election_question_drafts" validate constraint "election_question_drafts_party_id_fkey";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."election_question_drafts" validate constraint "election_question_drafts_reviewed_by_fkey";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_source_document_id_fkey" FOREIGN KEY (source_document_id) REFERENCES public.election_source_documents(id) ON DELETE SET NULL not valid;
alter table "public"."election_question_drafts" validate constraint "election_question_drafts_source_document_id_fkey";
alter table "public"."election_question_drafts" add constraint "election_question_drafts_superseded_by_fkey" FOREIGN KEY (superseded_by) REFERENCES public.election_question_drafts(id) ON DELETE SET NULL not valid;
alter table "public"."election_question_drafts" validate constraint "election_question_drafts_superseded_by_fkey";
alter table "public"."election_question_drafts" add constraint "eqd_framing_style_check" CHECK (((framing_style IS NULL) OR (framing_style = ANY (ARRAY['value_tradeoff'::text, 'risk_vs_risk'::text, 'boundary_line'::text, 'trust_authority'::text, 'future_consequence'::text, 'moral_consistency'::text, 'personal_stake'::text, 'evidence_threshold'::text])))) not valid;
alter table "public"."election_question_drafts" validate constraint "eqd_framing_style_check";
alter table "public"."election_question_drafts" add constraint "eqd_question_type_check" CHECK ((question_type = ANY (ARRAY['PARTY_POLICY'::text, 'CANDIDATE_STATEMENT'::text, 'ALLIANCE_POSITION'::text, 'MANUAL'::text]))) not valid;
alter table "public"."election_question_drafts" validate constraint "eqd_question_type_check";
alter table "public"."election_question_drafts" add constraint "eqd_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text, 'REJECTED'::text, 'ARCHIVED'::text]))) not valid;
alter table "public"."election_question_drafts" validate constraint "eqd_status_check";
alter table "public"."election_source_documents" add constraint "election_source_documents_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES public.election_candidates(id) ON DELETE CASCADE not valid;
alter table "public"."election_source_documents" validate constraint "election_source_documents_candidate_id_fkey";
alter table "public"."election_source_documents" add constraint "election_source_documents_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."election_source_documents" validate constraint "election_source_documents_created_by_fkey";
alter table "public"."election_source_documents" add constraint "election_source_documents_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE CASCADE not valid;
alter table "public"."election_source_documents" validate constraint "election_source_documents_election_id_fkey";
alter table "public"."election_source_documents" add constraint "election_source_documents_party_id_fkey" FOREIGN KEY (party_id) REFERENCES public.election_parties(id) ON DELETE CASCADE not valid;
alter table "public"."election_source_documents" validate constraint "election_source_documents_party_id_fkey";
alter table "public"."election_source_documents" add constraint "election_source_documents_scope_check" CHECK ((((party_id IS NOT NULL) AND (candidate_id IS NULL)) OR ((party_id IS NULL) AND (candidate_id IS NOT NULL)))) not valid;
alter table "public"."election_source_documents" validate constraint "election_source_documents_scope_check";
alter table "public"."election_source_documents" add constraint "election_source_documents_scope_constituency_id_fkey" FOREIGN KEY (scope_constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."election_source_documents" validate constraint "election_source_documents_scope_constituency_id_fkey";
alter table "public"."election_source_documents" add constraint "election_source_documents_type_check" CHECK ((document_type = ANY (ARRAY['manifesto'::text, 'candidate_statement'::text, 'party_policy_brief'::text, 'leadership_speech'::text, 'candidate_speech'::text, 'expenditure_disclosure'::text, 'affidavit'::text, 'fec_filing'::text, 'voting_record'::text, 'legislative_record'::text, 'interview'::text, 'press_release'::text]))) not valid;
alter table "public"."election_source_documents" validate constraint "election_source_documents_type_check";
alter table "public"."election_source_documents" add constraint "esd_ai_processing_status_check" CHECK ((ai_processing_status = ANY (ARRAY['PENDING'::text, 'IN_PROGRESS'::text, 'DONE'::text, 'FAILED'::text, 'SKIPPED'::text]))) not valid;
alter table "public"."election_source_documents" validate constraint "esd_ai_processing_status_check";
alter table "public"."election_source_documents" add constraint "esd_ingestion_status_check" CHECK ((ingestion_status = ANY (ARRAY['PENDING'::text, 'IN_PROGRESS'::text, 'DONE'::text, 'FAILED'::text]))) not valid;
alter table "public"."election_source_documents" validate constraint "esd_ingestion_status_check";
alter table "public"."election_source_documents" add constraint "esd_translation_status_check" CHECK ((translation_status = ANY (ARRAY['PENDING'::text, 'NOT_NEEDED'::text, 'IN_PROGRESS'::text, 'DONE'::text, 'FAILED'::text]))) not valid;
alter table "public"."election_source_documents" validate constraint "esd_translation_status_check";
alter table "public"."election_stance_aggregates" add constraint "election_stance_aggregates_constituency_id_fkey" FOREIGN KEY (constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."election_stance_aggregates" validate constraint "election_stance_aggregates_constituency_id_fkey";
alter table "public"."election_stance_aggregates" add constraint "election_stance_aggregates_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE CASCADE not valid;
alter table "public"."election_stance_aggregates" validate constraint "election_stance_aggregates_election_id_fkey";
alter table "public"."election_stance_aggregates" add constraint "election_stance_aggregates_parent_constituency_id_fkey" FOREIGN KEY (parent_constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."election_stance_aggregates" validate constraint "election_stance_aggregates_parent_constituency_id_fkey";
alter table "public"."election_stance_aggregates" add constraint "election_stance_aggregates_party_id_fkey" FOREIGN KEY (party_id) REFERENCES public.election_parties(id) ON DELETE SET NULL not valid;
alter table "public"."election_stance_aggregates" validate constraint "election_stance_aggregates_party_id_fkey";
alter table "public"."election_stance_aggregates" add constraint "election_stance_aggregates_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."election_stance_aggregates" validate constraint "election_stance_aggregates_question_id_fkey";
alter table "public"."election_stance_aggregates" add constraint "esa_question_constituency_unique" UNIQUE using index "esa_question_constituency_unique";
alter table "public"."election_stance_aggregates" add constraint "esa_scope_check" CHECK ((scope = ANY (ARRAY['constituency'::text, 'pc_rollup'::text, 'state'::text, 'national'::text]))) not valid;
alter table "public"."election_stance_aggregates" validate constraint "esa_scope_check";
alter table "public"."election_tiers" add constraint "election_tiers_compliance_track_check" CHECK ((compliance_track = ANY (ARRAY['ECI'::text, 'SEC'::text, 'FEC'::text, 'STATE_SOS'::text, 'NONE'::text]))) not valid;
alter table "public"."election_tiers" validate constraint "election_tiers_compliance_track_check";
alter table "public"."election_tiers" add constraint "election_tiers_tier_code_key" UNIQUE using index "election_tiers_tier_code_key";
alter table "public"."elections" add constraint "elections_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."elections" validate constraint "elections_created_by_fkey";
alter table "public"."elections" add constraint "elections_legal_review_by_fkey" FOREIGN KEY (legal_review_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."elections" validate constraint "elections_legal_review_by_fkey";
alter table "public"."elections" add constraint "elections_parent_election_id_fkey" FOREIGN KEY (parent_election_id) REFERENCES public.elections(id) ON DELETE RESTRICT not valid;
alter table "public"."elections" validate constraint "elections_parent_election_id_fkey";
alter table "public"."elections" add constraint "elections_phase_consistency" CHECK ((((phase_number IS NULL) AND (parent_election_id IS NULL)) OR ((phase_number = 1) AND (parent_election_id IS NULL)) OR ((phase_number > 1) AND (parent_election_id IS NOT NULL)))) not valid;
alter table "public"."elections" validate constraint "elections_phase_consistency";
alter table "public"."elections" add constraint "elections_polling_date_order" CHECK (((polling_end_at IS NULL) OR (polling_start_at IS NULL) OR (polling_end_at >= polling_start_at))) not valid;
alter table "public"."elections" validate constraint "elections_polling_date_order";
alter table "public"."elections" add constraint "elections_result_after_polling" CHECK (((result_declaration_at IS NULL) OR (polling_end_at IS NULL) OR (result_declaration_at >= polling_end_at))) not valid;
alter table "public"."elections" validate constraint "elections_result_after_polling";
alter table "public"."elections" add constraint "elections_snap_subtype" CHECK (((NOT is_snap) OR (election_subtype = 'SNAP'::public.election_subtype_enum))) not valid;
alter table "public"."elections" validate constraint "elections_snap_subtype";
alter table "public"."elections" add constraint "elections_state_changed_by_fkey" FOREIGN KEY (state_changed_by) REFERENCES public.admin_users(user_id) ON DELETE SET NULL not valid;
alter table "public"."elections" validate constraint "elections_state_changed_by_fkey";
alter table "public"."elections" add constraint "elections_tier_code_consistent" CHECK ((tier_code IS NOT NULL)) not valid;
alter table "public"."elections" validate constraint "elections_tier_code_consistent";
alter table "public"."elections" add constraint "elections_tier_id_fkey" FOREIGN KEY (tier_id) REFERENCES public.election_tiers(id) ON DELETE RESTRICT not valid;
alter table "public"."elections" validate constraint "elections_tier_id_fkey";
alter table "public"."email_events" add constraint "email_events_digest_id_fkey" FOREIGN KEY (digest_id) REFERENCES public.weekly_digests(id) ON DELETE SET NULL not valid;
alter table "public"."email_events" validate constraint "email_events_digest_id_fkey";
alter table "public"."email_events" add constraint "email_events_notification_id_fkey" FOREIGN KEY (notification_id) REFERENCES public.user_notifications(id) ON DELETE SET NULL not valid;
alter table "public"."email_events" validate constraint "email_events_notification_id_fkey";
alter table "public"."email_events" add constraint "email_events_type_chk" CHECK ((event_type = ANY (ARRAY['sent'::text, 'delivered'::text, 'bounced'::text, 'complained'::text, 'opened'::text, 'clicked'::text, 'unsubscribed'::text]))) not valid;
alter table "public"."email_events" validate constraint "email_events_type_chk";
alter table "public"."email_events" add constraint "email_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."email_events" validate constraint "email_events_user_id_fkey";
alter table "public"."embed_cta_events" add constraint "embed_cta_events_embedded_stance_id_fkey" FOREIGN KEY (embedded_stance_id) REFERENCES public.embedded_stances(id) ON DELETE CASCADE not valid;
alter table "public"."embed_cta_events" validate constraint "embed_cta_events_embedded_stance_id_fkey";
alter table "public"."embed_cta_events" add constraint "embed_cta_events_new_user_id_fkey" FOREIGN KEY (new_user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."embed_cta_events" validate constraint "embed_cta_events_new_user_id_fkey";
alter table "public"."embed_impressions" add constraint "embed_impressions_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."embed_impressions" validate constraint "embed_impressions_question_id_fkey";
alter table "public"."embed_rate_limits" add constraint "embed_rate_limits_limit_type_check" CHECK ((limit_type = ANY (ARRAY['device_question'::text, 'ip_hourly'::text]))) not valid;
alter table "public"."embed_rate_limits" validate constraint "embed_rate_limits_limit_type_check";
alter table "public"."embedded_stances" add constraint "embedded_stances_attributed_user_id_fkey" FOREIGN KEY (attributed_user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."embedded_stances" validate constraint "embedded_stances_attributed_user_id_fkey";
alter table "public"."embedded_stances" add constraint "embedded_stances_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."embedded_stances" validate constraint "embedded_stances_question_id_fkey";
alter table "public"."embedded_stances" add constraint "embedded_stances_stance_value_check" CHECK (((stance_value >= ('-2'::integer)::numeric) AND (stance_value <= (2)::numeric))) not valid;
alter table "public"."embedded_stances" validate constraint "embedded_stances_stance_value_check";
alter table "public"."feed_policies" add constraint "feed_policies_default_audience_segment_id_fkey" FOREIGN KEY (default_audience_segment_id) REFERENCES public.audience_segments(id) not valid;
alter table "public"."feed_policies" validate constraint "feed_policies_default_audience_segment_id_fkey";
alter table "public"."feed_policies" add constraint "feed_policies_key_unique" UNIQUE using index "feed_policies_key_unique";
alter table "public"."feed_policies" add constraint "feed_policies_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text]))) not valid;
alter table "public"."feed_policies" validate constraint "feed_policies_status_check";
alter table "public"."feed_policy_lanes" add constraint "feed_policy_lanes_min_relevance_tier_check" CHECK ((min_relevance_tier = ANY (ARRAY['direct'::text, 'adjacent'::text, 'general'::text]))) not valid;
alter table "public"."feed_policy_lanes" validate constraint "feed_policy_lanes_min_relevance_tier_check";
alter table "public"."feed_policy_lanes" add constraint "feed_policy_lanes_policy_id_fkey" FOREIGN KEY (policy_id) REFERENCES public.feed_policies(id) ON DELETE CASCADE not valid;
alter table "public"."feed_policy_lanes" validate constraint "feed_policy_lanes_policy_id_fkey";
alter table "public"."feed_policy_lanes" add constraint "feed_policy_lanes_target_percentage_check" CHECK (((target_percentage > (0)::numeric) AND (target_percentage <= (100)::numeric))) not valid;
alter table "public"."feed_policy_lanes" validate constraint "feed_policy_lanes_target_percentage_check";
alter table "public"."feed_policy_lanes" add constraint "feed_policy_lanes_unique" UNIQUE using index "feed_policy_lanes_unique";
alter table "public"."ingested_stances" add constraint "ingested_stances_attributed_user_id_fkey" FOREIGN KEY (attributed_user_id) REFERENCES public.users(id) ON DELETE SET NULL not valid;
alter table "public"."ingested_stances" validate constraint "ingested_stances_attributed_user_id_fkey";
alter table "public"."ingested_stances" add constraint "ingested_stances_confidence_chk" CHECK (((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric))) not valid;
alter table "public"."ingested_stances" validate constraint "ingested_stances_confidence_chk";
alter table "public"."ingested_stances" add constraint "ingested_stances_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."ingested_stances" validate constraint "ingested_stances_question_id_fkey";
alter table "public"."ingested_stances" add constraint "ingested_stances_reply_inbox_id_fkey" FOREIGN KEY (reply_inbox_id) REFERENCES public.social_reply_inbox(id) ON DELETE CASCADE not valid;
alter table "public"."ingested_stances" validate constraint "ingested_stances_reply_inbox_id_fkey";
alter table "public"."ingested_stances" add constraint "ingested_stances_status_chk" CHECK ((status = ANY (ARRAY['pending_review'::text, 'accepted'::text, 'rejected'::text, 'conflict'::text]))) not valid;
alter table "public"."ingested_stances" validate constraint "ingested_stances_status_chk";
alter table "public"."ingested_stances" add constraint "ingested_stances_unique_reply" UNIQUE using index "ingested_stances_unique_reply";
alter table "public"."ingested_stances" add constraint "ingested_stances_value_chk" CHECK (((stance_value >= ('-2'::integer)::numeric) AND (stance_value <= (2)::numeric))) not valid;
alter table "public"."ingested_stances" validate constraint "ingested_stances_value_chk";
alter table "public"."ingestion_queue" add constraint "ingestion_queue_source_id_external_id_key" UNIQUE using index "ingestion_queue_source_id_external_id_key";
alter table "public"."ingestion_queue" add constraint "ingestion_queue_source_id_fkey" FOREIGN KEY (source_id) REFERENCES public.topic_sources(id) ON DELETE CASCADE not valid;
alter table "public"."ingestion_queue" validate constraint "ingestion_queue_source_id_fkey";
alter table "public"."ingestion_queue" add constraint "ingestion_queue_status_check" CHECK ((status = ANY (ARRAY['new'::text, 'pending'::text, 'running'::text, 'done'::text, 'error'::text]))) not valid;
alter table "public"."ingestion_queue" validate constraint "ingestion_queue_status_check";
alter table "public"."ingestion_queue" add constraint "uq_ingestion_queue_dedupe_key" UNIQUE using index "uq_ingestion_queue_dedupe_key";
alter table "public"."location_audits" add constraint "location_audits_location_id_fkey" FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE not valid;
alter table "public"."location_audits" validate constraint "location_audits_location_id_fkey";
alter table "public"."location_audits" add constraint "location_audits_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."location_audits" validate constraint "location_audits_user_id_fkey";
alter table "public"."locations" add constraint "locations_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.locations(id) ON DELETE SET NULL not valid;
alter table "public"."locations" validate constraint "locations_parent_id_fkey";
alter table "public"."mfa_methods" add constraint "mfa_methods_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."mfa_methods" validate constraint "mfa_methods_user_id_fkey";
alter table "public"."moderation_actions" add constraint "moderation_actions_action_check" CHECK ((action = ANY (ARRAY['hide_comment'::text, 'restore_comment'::text, 'warn_user'::text, 'restrict_user'::text, 'ban_user'::text, 'dismiss_report'::text]))) not valid;
alter table "public"."moderation_actions" validate constraint "moderation_actions_action_check";
alter table "public"."moderation_actions" add constraint "moderation_actions_comment_id_fkey" FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE SET NULL not valid;
alter table "public"."moderation_actions" validate constraint "moderation_actions_comment_id_fkey";
alter table "public"."moderation_actions" add constraint "moderation_actions_moderator_id_fkey" FOREIGN KEY (moderator_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."moderation_actions" validate constraint "moderation_actions_moderator_id_fkey";
alter table "public"."moderation_actions" add constraint "moderation_actions_report_id_fkey" FOREIGN KEY (report_id) REFERENCES public.comment_reports(id) ON DELETE SET NULL not valid;
alter table "public"."moderation_actions" validate constraint "moderation_actions_report_id_fkey";
alter table "public"."moderation_actions" add constraint "moderation_actions_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."moderation_actions" validate constraint "moderation_actions_target_user_id_fkey";
alter table "public"."moderators" add constraint "moderators_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."moderators" validate constraint "moderators_user_id_fkey";
alter table "public"."notification_event_log" add constraint "notification_event_log_unique" UNIQUE using index "notification_event_log_unique";
alter table "public"."notification_preferences" add constraint "notification_preferences_digest_day_chk" CHECK (((digest_day_of_week >= 0) AND (digest_day_of_week <= 6))) not valid;
alter table "public"."notification_preferences" validate constraint "notification_preferences_digest_day_chk";
alter table "public"."notification_preferences" add constraint "notification_preferences_digest_frequency_chk" CHECK ((digest_frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'off'::text]))) not valid;
alter table "public"."notification_preferences" validate constraint "notification_preferences_digest_frequency_chk";
alter table "public"."notification_preferences" add constraint "notification_preferences_digest_hour_chk" CHECK (((digest_hour_local >= 0) AND (digest_hour_local <= 23))) not valid;
alter table "public"."notification_preferences" validate constraint "notification_preferences_digest_hour_chk";
alter table "public"."notification_preferences" add constraint "notification_preferences_quiet_end_chk" CHECK (((quiet_hours_end >= 0) AND (quiet_hours_end <= 23))) not valid;
alter table "public"."notification_preferences" validate constraint "notification_preferences_quiet_end_chk";
alter table "public"."notification_preferences" add constraint "notification_preferences_quiet_start_chk" CHECK (((quiet_hours_start >= 0) AND (quiet_hours_start <= 23))) not valid;
alter table "public"."notification_preferences" validate constraint "notification_preferences_quiet_start_chk";
alter table "public"."notification_preferences" add constraint "notification_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."notification_preferences" validate constraint "notification_preferences_user_id_fkey";
alter table "public"."notification_topic_prefs" add constraint "notification_topic_prefs_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;
alter table "public"."notification_topic_prefs" validate constraint "notification_topic_prefs_topic_id_fkey";
alter table "public"."notification_topic_prefs" add constraint "notification_topic_prefs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."notification_topic_prefs" validate constraint "notification_topic_prefs_user_id_fkey";
alter table "public"."og_image_cache" add constraint "og_image_cache_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."og_image_cache" validate constraint "og_image_cache_question_id_fkey";
alter table "public"."party_alliance_members" add constraint "party_alliance_members_alliance_party_id_fkey" FOREIGN KEY (alliance_party_id) REFERENCES public.election_parties(id) ON DELETE CASCADE not valid;
alter table "public"."party_alliance_members" validate constraint "party_alliance_members_alliance_party_id_fkey";
alter table "public"."party_alliance_members" add constraint "party_alliance_members_member_party_id_fkey" FOREIGN KEY (member_party_id) REFERENCES public.election_parties(id) ON DELETE CASCADE not valid;
alter table "public"."party_alliance_members" validate constraint "party_alliance_members_member_party_id_fkey";
alter table "public"."party_alliance_members" add constraint "party_alliance_members_no_self_ref" CHECK ((alliance_party_id <> member_party_id)) not valid;
alter table "public"."party_alliance_members" validate constraint "party_alliance_members_no_self_ref";
alter table "public"."party_alliance_members" add constraint "party_alliance_members_role_check" CHECK ((role = ANY (ARRAY['LEADER'::text, 'PARTNER'::text, 'OUTSIDE_SUPPORT'::text]))) not valid;
alter table "public"."party_alliance_members" validate constraint "party_alliance_members_role_check";
alter table "public"."party_alliance_members" add constraint "party_alliance_members_unique" UNIQUE using index "party_alliance_members_unique";
alter table "public"."password_resets" add constraint "password_resets_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."password_resets" validate constraint "password_resets_user_id_fkey";
alter table "public"."pipeline_jobs" add constraint "pipeline_jobs_job_type_check" CHECK ((job_type = ANY (ARRAY['ingest'::text, 'cluster'::text, 'generate'::text, 'score'::text, 'notify'::text, 'other'::text]))) not valid;
alter table "public"."pipeline_jobs" validate constraint "pipeline_jobs_job_type_check";
alter table "public"."pipeline_jobs" add constraint "pipeline_jobs_source_id_fkey" FOREIGN KEY (source_id) REFERENCES public.topic_sources(id) ON DELETE SET NULL not valid;
alter table "public"."pipeline_jobs" validate constraint "pipeline_jobs_source_id_fkey";
alter table "public"."pipeline_jobs" add constraint "pipeline_jobs_status_check" CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'retrying'::text]))) not valid;
alter table "public"."pipeline_jobs" validate constraint "pipeline_jobs_status_check";
alter table "public"."profiles" add constraint "profiles_audience_segment_id_fkey" FOREIGN KEY (audience_segment_id) REFERENCES public.audience_segments(id) not valid;
alter table "public"."profiles" validate constraint "profiles_audience_segment_id_fkey";
alter table "public"."profiles" add constraint "profiles_gender_check" CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'nonbinary'::text, 'prefer_not_to_say'::text, 'self_described'::text]))) not valid;
alter table "public"."profiles" validate constraint "profiles_gender_check";
alter table "public"."profiles" add constraint "profiles_primary_constituency_id_fkey" FOREIGN KEY (primary_constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."profiles" validate constraint "profiles_primary_constituency_id_fkey";
alter table "public"."profiles" add constraint "profiles_random_id_key" UNIQUE using index "profiles_random_id_key";
alter table "public"."profiles" add constraint "profiles_secondary_constituency_id_fkey" FOREIGN KEY (secondary_constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."profiles" validate constraint "profiles_secondary_constituency_id_fkey";
alter table "public"."profiles" add constraint "profiles_tertiary_constituency_id_fkey" FOREIGN KEY (tertiary_constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."profiles" validate constraint "profiles_tertiary_constituency_id_fkey";
alter table "public"."profiles" add constraint "profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."profiles" validate constraint "profiles_user_id_fkey";
alter table "public"."profiles" add constraint "profiles_username_key" UNIQUE using index "profiles_username_key";
alter table "public"."profiles" add constraint "random_id_len_chk" CHECK (((char_length(random_id) >= 8) AND (char_length(random_id) <= 12))) not valid;
alter table "public"."profiles" validate constraint "random_id_len_chk";
alter table "public"."profiles" add constraint "username_chars_chk" CHECK (((username IS NULL) OR (username ~ '^[a-zA-Z0-9_\\.]+$'::text))) not valid;
alter table "public"."profiles" validate constraint "username_chars_chk";
alter table "public"."profiles" add constraint "username_len_chk" CHECK (((username IS NULL) OR ((char_length(username) >= 3) AND (char_length(username) <= 20)))) not valid;
alter table "public"."profiles" validate constraint "username_len_chk";
alter table "public"."publishers" add constraint "publishers_publisher_ref_key" UNIQUE using index "publishers_publisher_ref_key";
alter table "public"."question_audience_fit" add constraint "question_audience_fit_audience_segment_id_fkey" FOREIGN KEY (audience_segment_id) REFERENCES public.audience_segments(id) not valid;
alter table "public"."question_audience_fit" validate constraint "question_audience_fit_audience_segment_id_fkey";
alter table "public"."question_audience_fit" add constraint "question_audience_fit_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_audience_fit" validate constraint "question_audience_fit_question_id_fkey";
alter table "public"."question_audience_fit" add constraint "question_audience_fit_relevance_tier_check" CHECK ((relevance_tier = ANY (ARRAY['direct'::text, 'adjacent'::text, 'general'::text]))) not valid;
alter table "public"."question_audience_fit" validate constraint "question_audience_fit_relevance_tier_check";
alter table "public"."question_audience_fit" add constraint "question_audience_fit_source_check" CHECK ((source = ANY (ARRAY['ai_pipeline'::text, 'admin_override'::text, 'backfill'::text]))) not valid;
alter table "public"."question_audience_fit" validate constraint "question_audience_fit_source_check";
alter table "public"."question_audience_fit" add constraint "question_audience_fit_unique" UNIQUE using index "question_audience_fit_unique";
alter table "public"."question_comment_sentiment" add constraint "question_comment_sentiment_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_comment_sentiment" validate constraint "question_comment_sentiment_question_id_fkey";
alter table "public"."question_context_updates" add constraint "question_context_updates_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_context_updates" validate constraint "question_context_updates_question_id_fkey";
alter table "public"."question_context_updates" add constraint "question_context_updates_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) not valid;
alter table "public"."question_context_updates" validate constraint "question_context_updates_updated_by_fkey";
alter table "public"."question_context_updates" add constraint "valid_phase" CHECK ((new_phase = ANY (ARRAY['initial'::text, 'update'::text, 'resolution'::text, 'follow_up'::text]))) not valid;
alter table "public"."question_context_updates" validate constraint "valid_phase";
alter table "public"."question_draft_audience_fit" add constraint "question_draft_audience_fit_audience_segment_id_fkey" FOREIGN KEY (audience_segment_id) REFERENCES public.audience_segments(id) not valid;
alter table "public"."question_draft_audience_fit" validate constraint "question_draft_audience_fit_audience_segment_id_fkey";
alter table "public"."question_draft_audience_fit" add constraint "question_draft_audience_fit_question_draft_id_fkey" FOREIGN KEY (question_draft_id) REFERENCES public.question_drafts(id) ON DELETE CASCADE not valid;
alter table "public"."question_draft_audience_fit" validate constraint "question_draft_audience_fit_question_draft_id_fkey";
alter table "public"."question_draft_audience_fit" add constraint "question_draft_audience_fit_relevance_tier_check" CHECK ((relevance_tier = ANY (ARRAY['direct'::text, 'adjacent'::text, 'general'::text]))) not valid;
alter table "public"."question_draft_audience_fit" validate constraint "question_draft_audience_fit_relevance_tier_check";
alter table "public"."question_draft_audience_fit" add constraint "question_draft_audience_fit_source_check" CHECK ((source = ANY (ARRAY['ai_pipeline'::text, 'admin_override'::text]))) not valid;
alter table "public"."question_draft_audience_fit" validate constraint "question_draft_audience_fit_source_check";
alter table "public"."question_draft_audience_fit" add constraint "question_draft_audience_fit_unique" UNIQUE using index "question_draft_audience_fit_unique";
alter table "public"."question_drafts" add constraint "chk_qd_framing_style" CHECK (((framing_style IS NULL) OR (framing_style = ANY (ARRAY['value_tradeoff'::text, 'risk_vs_risk'::text, 'boundary_line'::text, 'trust_authority'::text, 'future_consequence'::text, 'moral_consistency'::text, 'personal_stake'::text, 'evidence_threshold'::text])))) not valid;
alter table "public"."question_drafts" validate constraint "chk_qd_framing_style";
alter table "public"."question_drafts" add constraint "question_drafts_framing_type_check" CHECK ((framing_type = ANY (ARRAY['tradeoff'::text, 'risk'::text, 'outcome'::text, 'identity'::text, 'scenario'::text, 'prediction'::text]))) not valid;
alter table "public"."question_drafts" validate constraint "question_drafts_framing_type_check";
alter table "public"."question_drafts" add constraint "question_drafts_reframe_prompt_id_fkey" FOREIGN KEY (reframe_prompt_id) REFERENCES public.ai_prompts(id) not valid;
alter table "public"."question_drafts" validate constraint "question_drafts_reframe_prompt_id_fkey";
alter table "public"."question_drafts" add constraint "question_drafts_scope_check" CHECK (((scope IS NULL) OR (scope = ANY (ARRAY['global'::text, 'national'::text, 'local'::text])))) not valid;
alter table "public"."question_drafts" validate constraint "question_drafts_scope_check";
alter table "public"."question_drafts" add constraint "question_drafts_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'reframing'::text, 'reframed'::text, 'reframe_failed'::text, 'approved'::text, 'rejected'::text]))) not valid;
alter table "public"."question_drafts" validate constraint "question_drafts_status_check";
alter table "public"."question_drafts" add constraint "question_drafts_topic_draft_id_fkey" FOREIGN KEY (topic_draft_id) REFERENCES public.topic_drafts(id) ON DELETE CASCADE not valid;
alter table "public"."question_drafts" validate constraint "question_drafts_topic_draft_id_fkey";
alter table "public"."question_drafts" add constraint "question_drafts_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) not valid;
alter table "public"."question_drafts" validate constraint "question_drafts_topic_id_fkey";
alter table "public"."question_duplicates" add constraint "question_duplicates_existing_question_id_fkey" FOREIGN KEY (existing_question_id) REFERENCES public.questions(id) not valid;
alter table "public"."question_duplicates" validate constraint "question_duplicates_existing_question_id_fkey";
alter table "public"."question_engagement_metrics" add constraint "positive_rates" CHECK (((response_rate_24h >= (0)::numeric) AND (response_rate_7d >= (0)::numeric))) not valid;
alter table "public"."question_engagement_metrics" validate constraint "positive_rates";
alter table "public"."question_engagement_metrics" add constraint "positive_responses" CHECK (((responses_last_24h >= 0) AND (responses_last_7d >= 0) AND (responses_total >= 0))) not valid;
alter table "public"."question_engagement_metrics" validate constraint "positive_responses";
alter table "public"."question_engagement_metrics" add constraint "question_engagement_metrics_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_engagement_metrics" validate constraint "question_engagement_metrics_question_id_fkey";
alter table "public"."question_lifecycle_config" add constraint "unique_config" UNIQUE using index "unique_config";
alter table "public"."question_links" add constraint "no_self_link" CHECK ((from_question_id <> to_question_id)) not valid;
alter table "public"."question_links" validate constraint "no_self_link";
alter table "public"."question_links" add constraint "question_links_from_question_id_fkey" FOREIGN KEY (from_question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_links" validate constraint "question_links_from_question_id_fkey";
alter table "public"."question_links" add constraint "question_links_link_type_check" CHECK ((link_type = ANY (ARRAY['related'::text, 'follow_up'::text, 'same_event_different_angle'::text, 'supersedes'::text]))) not valid;
alter table "public"."question_links" validate constraint "question_links_link_type_check";
alter table "public"."question_links" add constraint "question_links_score_check" CHECK (((score >= (0)::numeric) AND (score <= (1)::numeric))) not valid;
alter table "public"."question_links" validate constraint "question_links_score_check";
alter table "public"."question_links" add constraint "question_links_to_question_id_fkey" FOREIGN KEY (to_question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_links" validate constraint "question_links_to_question_id_fkey";
alter table "public"."question_links" add constraint "unique_link" UNIQUE using index "unique_link";
alter table "public"."question_stance_confidence" add constraint "question_stance_confidence_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_stance_confidence" validate constraint "question_stance_confidence_question_id_fkey";
alter table "public"."question_stance_confidence" add constraint "question_stance_confidence_range_check" CHECK (((confidence >= 1) AND (confidence <= 5))) not valid;
alter table "public"."question_stance_confidence" validate constraint "question_stance_confidence_range_check";
alter table "public"."question_stance_confidence" add constraint "question_stance_confidence_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."question_stance_confidence" validate constraint "question_stance_confidence_user_id_fkey";
alter table "public"."question_stance_stats" add constraint "question_stance_stats_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_stance_stats" validate constraint "question_stance_stats_question_id_fkey";
alter table "public"."question_stance_stats_history" add constraint "question_stance_stats_history_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_stance_stats_history" validate constraint "question_stance_stats_history_question_id_fkey";
alter table "public"."question_stance_stats_history" add constraint "question_stance_stats_history_region_scope_check" CHECK ((region_scope = ANY (ARRAY['city'::text, 'county'::text, 'state'::text, 'country'::text, 'global'::text]))) not valid;
alter table "public"."question_stance_stats_history" validate constraint "question_stance_stats_history_region_scope_check";
alter table "public"."question_stance_stats_region" add constraint "question_stance_stats_region_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_stance_stats_region" validate constraint "question_stance_stats_region_question_id_fkey";
alter table "public"."question_stance_stats_region" add constraint "question_stance_stats_region_region_scope_check" CHECK ((region_scope = ANY (ARRAY['city'::text, 'county'::text, 'state'::text, 'country'::text, 'global'::text]))) not valid;
alter table "public"."question_stance_stats_region" validate constraint "question_stance_stats_region_region_scope_check";
alter table "public"."question_stances" add constraint "question_stances_broadcast_id_fkey" FOREIGN KEY (broadcast_id) REFERENCES public.whatsapp_broadcasts(id) ON DELETE SET NULL not valid;
alter table "public"."question_stances" validate constraint "question_stances_broadcast_id_fkey";
alter table "public"."question_stances" add constraint "question_stances_forward_chain_id_fkey" FOREIGN KEY (forward_chain_id) REFERENCES public.whatsapp_forward_chains(id) ON DELETE SET NULL not valid;
alter table "public"."question_stances" validate constraint "question_stances_forward_chain_id_fkey";
alter table "public"."question_stances" add constraint "question_stances_identity_check" CHECK (((user_id IS NOT NULL) OR (whatsapp_phone_hash IS NOT NULL))) not valid;
alter table "public"."question_stances" validate constraint "question_stances_identity_check";
alter table "public"."question_stances" add constraint "question_stances_original_stance_before_reveal_check" CHECK (((original_stance_before_reveal >= '-2'::integer) AND (original_stance_before_reveal <= 2))) not valid;
alter table "public"."question_stances" validate constraint "question_stances_original_stance_before_reveal_check";
alter table "public"."question_stances" add constraint "question_stances_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_stances" validate constraint "question_stances_question_id_fkey";
alter table "public"."question_stances" add constraint "question_stances_score_check" CHECK (((score >= '-2'::integer) AND (score <= 2))) not valid;
alter table "public"."question_stances" validate constraint "question_stances_score_check";
alter table "public"."question_stances" add constraint "question_stances_source_check" CHECK ((source = ANY (ARRAY['native'::text, 'ingested'::text, 'embed'::text, 'whatsapp_flow'::text]))) not valid;
alter table "public"."question_stances" validate constraint "question_stances_source_check";
alter table "public"."question_stances" add constraint "question_stances_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."question_stances" validate constraint "question_stances_user_id_fkey";
alter table "public"."question_stances" add constraint "question_stances_user_id_question_id_key" UNIQUE using index "question_stances_user_id_question_id_key";
alter table "public"."question_state_history" add constraint "question_state_history_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.admin_users(user_id) not valid;
alter table "public"."question_state_history" validate constraint "question_state_history_created_by_fkey";
alter table "public"."question_state_history" add constraint "question_state_history_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_state_history" validate constraint "question_state_history_question_id_fkey";
alter table "public"."question_tradeoffs" add constraint "question_tradeoffs_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_tradeoffs" validate constraint "question_tradeoffs_question_id_fkey";
alter table "public"."question_trending_metrics" add constraint "question_trending_metrics_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_trending_metrics" validate constraint "question_trending_metrics_question_id_fkey";
alter table "public"."question_trending_metrics" add constraint "trending_score_range" CHECK (((trending_score >= (0)::numeric) AND (trending_score <= (100)::numeric))) not valid;
alter table "public"."question_trending_metrics" validate constraint "trending_score_range";
alter table "public"."question_view_events" add constraint "question_view_events_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_view_events" validate constraint "question_view_events_question_id_fkey";
alter table "public"."question_view_events" add constraint "question_view_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."question_view_events" validate constraint "question_view_events_user_id_fkey";
alter table "public"."question_visibility_rules" add constraint "question_visibility_rules_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."question_visibility_rules" validate constraint "question_visibility_rules_question_id_fkey";
alter table "public"."questions" add constraint "questions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) not valid;
alter table "public"."questions" validate constraint "questions_created_by_fkey";
alter table "public"."questions" add constraint "questions_election_candidate_id_fkey" FOREIGN KEY (election_candidate_id) REFERENCES public.election_candidates(id) ON DELETE SET NULL not valid;
alter table "public"."questions" validate constraint "questions_election_candidate_id_fkey";
alter table "public"."questions" add constraint "questions_election_constituency_id_fkey" FOREIGN KEY (election_constituency_id) REFERENCES public.election_constituencies(id) ON DELETE SET NULL not valid;
alter table "public"."questions" validate constraint "questions_election_constituency_id_fkey";
alter table "public"."questions" add constraint "questions_election_draft_id_fkey" FOREIGN KEY (election_draft_id) REFERENCES public.election_question_drafts(id) ON DELETE SET NULL not valid;
alter table "public"."questions" validate constraint "questions_election_draft_id_fkey";
alter table "public"."questions" add constraint "questions_election_id_fkey" FOREIGN KEY (election_id) REFERENCES public.elections(id) ON DELETE SET NULL not valid;
alter table "public"."questions" validate constraint "questions_election_id_fkey";
alter table "public"."questions" add constraint "questions_election_party_id_fkey" FOREIGN KEY (election_party_id) REFERENCES public.election_parties(id) ON DELETE SET NULL not valid;
alter table "public"."questions" validate constraint "questions_election_party_id_fkey";
alter table "public"."questions" add constraint "questions_featured_by_fkey" FOREIGN KEY (featured_by) REFERENCES public.admin_users(user_id) not valid;
alter table "public"."questions" validate constraint "questions_featured_by_fkey";
alter table "public"."questions" add constraint "questions_framing_type_check" CHECK ((framing_type = ANY (ARRAY['tradeoff'::text, 'risk'::text, 'outcome'::text, 'identity'::text, 'scenario'::text, 'prediction'::text]))) not valid;
alter table "public"."questions" validate constraint "questions_framing_type_check";
alter table "public"."questions" add constraint "questions_news_item_id_fkey" FOREIGN KEY (news_item_id) REFERENCES public.news_items(id) ON DELETE SET NULL not valid;
alter table "public"."questions" validate constraint "questions_news_item_id_fkey";
alter table "public"."questions" add constraint "questions_phase_check" CHECK ((phase = ANY (ARRAY['initial'::text, 'update'::text, 'resolution'::text, 'follow_up'::text]))) not valid;
alter table "public"."questions" validate constraint "questions_phase_check";
alter table "public"."questions" add constraint "questions_question_draft_id_fkey" FOREIGN KEY (question_draft_id) REFERENCES public.question_drafts(id) ON DELETE SET NULL not valid;
alter table "public"."questions" validate constraint "questions_question_draft_id_fkey";
alter table "public"."questions" add constraint "questions_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text]))) not valid;
alter table "public"."questions" validate constraint "questions_status_check";
alter table "public"."questions" add constraint "questions_tier_check" CHECK (((tier IS NULL) OR (tier = ANY (ARRAY['city'::text, 'county'::text, 'state'::text, 'country'::text, 'global'::text])))) not valid;
alter table "public"."questions" validate constraint "questions_tier_check";
alter table "public"."questions" add constraint "questions_topic_draft_id_fkey" FOREIGN KEY (topic_draft_id) REFERENCES public.topic_drafts(id) ON DELETE SET NULL not valid;
alter table "public"."questions" validate constraint "questions_topic_draft_id_fkey";
alter table "public"."questions" add constraint "questions_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE RESTRICT not valid;
alter table "public"."questions" validate constraint "questions_topic_id_fkey";
alter table "public"."sessions" add constraint "sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."sessions" validate constraint "sessions_user_id_fkey";
alter table "public"."sessions" add constraint "sessions_user_id_key" UNIQUE using index "sessions_user_id_key";
alter table "public"."share_click_events" add constraint "share_click_events_new_user_id_fkey" FOREIGN KEY (new_user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."share_click_events" validate constraint "share_click_events_new_user_id_fkey";
alter table "public"."share_click_events" add constraint "share_click_events_share_event_id_fkey" FOREIGN KEY (share_event_id) REFERENCES public.share_events(id) ON DELETE CASCADE not valid;
alter table "public"."share_click_events" validate constraint "share_click_events_share_event_id_fkey";
alter table "public"."share_events" add constraint "share_events_post_status_chk" CHECK ((post_status = ANY (ARRAY['pending'::text, 'posted'::text, 'failed'::text]))) not valid;
alter table "public"."share_events" validate constraint "share_events_post_status_chk";
alter table "public"."share_events" add constraint "share_events_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."share_events" validate constraint "share_events_question_id_fkey";
alter table "public"."share_events" add constraint "share_events_shared_by_user_id_fkey" FOREIGN KEY (shared_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."share_events" validate constraint "share_events_shared_by_user_id_fkey";
alter table "public"."social_auth_tokens" add constraint "social_auth_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."social_auth_tokens" validate constraint "social_auth_tokens_user_id_fkey";
alter table "public"."social_auth_tokens" add constraint "social_auth_tokens_user_provider_unique" UNIQUE using index "social_auth_tokens_user_provider_unique";
alter table "public"."social_reply_inbox" add constraint "social_reply_inbox_platform_chk" CHECK ((platform = 'twitter'::text)) not valid;
alter table "public"."social_reply_inbox" validate constraint "social_reply_inbox_platform_chk";
alter table "public"."social_reply_inbox" add constraint "social_reply_inbox_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."social_reply_inbox" validate constraint "social_reply_inbox_question_id_fkey";
alter table "public"."social_reply_inbox" add constraint "social_reply_inbox_share_event_id_fkey" FOREIGN KEY (share_event_id) REFERENCES public.share_events(id) ON DELETE CASCADE not valid;
alter table "public"."social_reply_inbox" validate constraint "social_reply_inbox_share_event_id_fkey";
alter table "public"."social_reply_inbox" add constraint "social_reply_inbox_status_chk" CHECK ((processing_status = ANY (ARRAY['pending'::text, 'classified'::text, 'skipped'::text, 'error'::text]))) not valid;
alter table "public"."social_reply_inbox" validate constraint "social_reply_inbox_status_chk";
alter table "public"."social_reply_inbox" add constraint "social_reply_inbox_unique_post" UNIQUE using index "social_reply_inbox_unique_post";
alter table "public"."stance_history" add constraint "stance_history_new_score_chk" CHECK (((new_score IS NULL) OR ((new_score >= '-2'::integer) AND (new_score <= 2)))) not valid;
alter table "public"."stance_history" validate constraint "stance_history_new_score_chk";
alter table "public"."stance_history" add constraint "stance_history_old_score_chk" CHECK (((old_score IS NULL) OR ((old_score >= '-2'::integer) AND (old_score <= 2)))) not valid;
alter table "public"."stance_history" validate constraint "stance_history_old_score_chk";
alter table "public"."stance_history" add constraint "stance_history_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."stance_history" validate constraint "stance_history_question_id_fkey";
alter table "public"."stance_history" add constraint "stance_history_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."stance_history" validate constraint "stance_history_user_id_fkey";
alter table "public"."stance_texts" add constraint "stance_texts_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."stance_texts" validate constraint "stance_texts_question_id_fkey";
alter table "public"."stance_texts" add constraint "stance_texts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."stance_texts" validate constraint "stance_texts_user_id_fkey";
alter table "public"."topic_cluster_items" add constraint "topic_cluster_items_cluster_id_fkey" FOREIGN KEY (cluster_id) REFERENCES public.topic_clusters(id) ON DELETE CASCADE not valid;
alter table "public"."topic_cluster_items" validate constraint "topic_cluster_items_cluster_id_fkey";
alter table "public"."topic_cluster_items" add constraint "topic_cluster_items_ingestion_id_fkey" FOREIGN KEY (ingestion_id) REFERENCES public.ingestion_queue(id) ON DELETE CASCADE not valid;
alter table "public"."topic_cluster_items" validate constraint "topic_cluster_items_ingestion_id_fkey";
alter table "public"."topic_cluster_items" add constraint "topic_cluster_items_similarity_check" CHECK (((similarity >= (0)::numeric) AND (similarity <= (1)::numeric))) not valid;
alter table "public"."topic_cluster_items" validate constraint "topic_cluster_items_similarity_check";
alter table "public"."topic_clusters" add constraint "topic_clusters_confidence_check" CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))) not valid;
alter table "public"."topic_clusters" validate constraint "topic_clusters_confidence_check";
alter table "public"."topic_clusters" add constraint "topic_clusters_story_id_key" UNIQUE using index "topic_clusters_story_id_key";
alter table "public"."topic_drafts" add constraint "topic_drafts_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES auth.users(id) not valid;
alter table "public"."topic_drafts" validate constraint "topic_drafts_approved_by_fkey";
alter table "public"."topic_drafts" add constraint "topic_drafts_cluster_id_fkey" FOREIGN KEY (cluster_id) REFERENCES public.topic_clusters(id) ON DELETE SET NULL not valid;
alter table "public"."topic_drafts" validate constraint "topic_drafts_cluster_id_fkey";
alter table "public"."topic_drafts" add constraint "topic_drafts_news_item_id_fkey" FOREIGN KEY (news_item_id) REFERENCES public.news_items(id) ON DELETE CASCADE not valid;
alter table "public"."topic_drafts" validate constraint "topic_drafts_news_item_id_fkey";
alter table "public"."topic_drafts" add constraint "topic_drafts_parent_topic_confidence_check" CHECK (((parent_topic_confidence IS NULL) OR ((parent_topic_confidence >= (0)::numeric) AND (parent_topic_confidence <= (1)::numeric)))) not valid;
alter table "public"."topic_drafts" validate constraint "topic_drafts_parent_topic_confidence_check";
alter table "public"."topic_drafts" add constraint "topic_drafts_parent_topic_id_fkey" FOREIGN KEY (parent_topic_id) REFERENCES public.topics(id) ON DELETE SET NULL not valid;
alter table "public"."topic_drafts" validate constraint "topic_drafts_parent_topic_id_fkey";
alter table "public"."topic_drafts" add constraint "topic_drafts_rejected_by_fkey" FOREIGN KEY (rejected_by) REFERENCES auth.users(id) not valid;
alter table "public"."topic_drafts" validate constraint "topic_drafts_rejected_by_fkey";
alter table "public"."topic_drafts" add constraint "topic_drafts_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'rejected'::text]))) not valid;
alter table "public"."topic_drafts" validate constraint "topic_drafts_status_check";
alter table "public"."topic_impact_scores" add constraint "topic_impact_scores_check_has_id" CHECK (((topic_id IS NOT NULL) OR (question_id IS NOT NULL))) not valid;
alter table "public"."topic_impact_scores" validate constraint "topic_impact_scores_check_has_id";
alter table "public"."topic_impact_scores" add constraint "topic_impact_scores_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."topic_impact_scores" validate constraint "topic_impact_scores_question_id_fkey";
alter table "public"."topic_impact_scores" add constraint "topic_impact_scores_question_id_key" UNIQUE using index "topic_impact_scores_question_id_key";
alter table "public"."topic_impact_scores" add constraint "topic_impact_scores_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;
alter table "public"."topic_impact_scores" validate constraint "topic_impact_scores_topic_id_fkey";
alter table "public"."topic_region_trends" add constraint "topic_region_trends_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;
alter table "public"."topic_region_trends" validate constraint "topic_region_trends_topic_id_fkey";
alter table "public"."topic_regions" add constraint "topic_regions_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;
alter table "public"."topic_regions" validate constraint "topic_regions_topic_id_fkey";
alter table "public"."topic_sources" add constraint "topic_sources_country_code_len" CHECK (((country_code IS NULL) OR (length(btrim(country_code)) = 2))) not valid;
alter table "public"."topic_sources" validate constraint "topic_sources_country_code_len";
alter table "public"."topic_sources" add constraint "topic_sources_country_name_not_blank" CHECK (((country_name IS NULL) OR (length(btrim(country_name)) > 0))) not valid;
alter table "public"."topic_sources" validate constraint "topic_sources_country_name_not_blank";
alter table "public"."topic_sources" add constraint "topic_sources_kind_check" CHECK ((kind = ANY (ARRAY['rss'::text, 'api'::text, 'social'::text]))) not valid;
alter table "public"."topic_sources" validate constraint "topic_sources_kind_check";
alter table "public"."topic_sources" add constraint "topic_sources_polling_interval_check" CHECK ((polling_interval = ANY (ARRAY['hourly'::text, '6h'::text, 'daily'::text, 'weekly'::text]))) not valid;
alter table "public"."topic_sources" validate constraint "topic_sources_polling_interval_check";
alter table "public"."topics" add constraint "chk_topics_sources_nonempty" CHECK (((jsonb_typeof(sources) = 'array'::text) AND (jsonb_array_length(sources) > 0))) not valid;
alter table "public"."topics" validate constraint "chk_topics_sources_nonempty";
alter table "public"."topics" add constraint "chk_topics_title_len" CHECK (((char_length(title) >= 8) AND (char_length(title) <= 500))) not valid;
alter table "public"."topics" validate constraint "chk_topics_title_len";
alter table "public"."topics" add constraint "topics_parent_topic_fk" FOREIGN KEY (parent_topic_id) REFERENCES public.topics(id) ON DELETE RESTRICT not valid;
alter table "public"."topics" validate constraint "topics_parent_topic_fk";
alter table "public"."topics" add constraint "topics_parent_topic_id_fkey" FOREIGN KEY (parent_topic_id) REFERENCES public.topics(id) ON DELETE SET NULL not valid;
alter table "public"."topics" validate constraint "topics_parent_topic_id_fkey";
alter table "public"."topics" add constraint "topics_slug_unique" UNIQUE using index "topics_slug_unique";
alter table "public"."topics" add constraint "topics_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'archived'::text]))) not valid;
alter table "public"."topics" validate constraint "topics_status_check";
alter table "public"."topics" add constraint "topics_tier_check" CHECK ((tier = ANY (ARRAY['city'::text, 'county'::text, 'state'::text, 'country'::text, 'global'::text]))) not valid;
alter table "public"."topics" validate constraint "topics_tier_check";
alter table "public"."toxicity_scores" add constraint "toxicity_scores_comment_id_fkey" FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE CASCADE not valid;
alter table "public"."toxicity_scores" validate constraint "toxicity_scores_comment_id_fkey";
alter table "public"."user_cognitive_states" add constraint "user_cognitive_states_prior_state_id_fkey" FOREIGN KEY (prior_state_id) REFERENCES public.user_cognitive_states(id) not valid;
alter table "public"."user_cognitive_states" validate constraint "user_cognitive_states_prior_state_id_fkey";
alter table "public"."user_cognitive_states" add constraint "user_cognitive_states_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_cognitive_states" validate constraint "user_cognitive_states_user_id_fkey";
alter table "public"."user_cognitive_states" add constraint "valid_consistency" CHECK (((stance_consistency_score >= (0)::numeric) AND (stance_consistency_score <= (1)::numeric))) not valid;
alter table "public"."user_cognitive_states" validate constraint "valid_consistency";
alter table "public"."user_cognitive_states" add constraint "valid_evaluation_period" CHECK ((evaluation_period_end >= evaluation_period_start)) not valid;
alter table "public"."user_cognitive_states" validate constraint "valid_evaluation_period";
alter table "public"."user_cognitive_states" add constraint "valid_mean_stance" CHECK (((overall_mean_stance >= ('-2'::integer)::numeric) AND (overall_mean_stance <= (2)::numeric))) not valid;
alter table "public"."user_cognitive_states" validate constraint "valid_mean_stance";
alter table "public"."user_cognitive_states" add constraint "valid_median_stance" CHECK (((overall_median_stance >= ('-2'::integer)::numeric) AND (overall_median_stance <= (2)::numeric))) not valid;
alter table "public"."user_cognitive_states" validate constraint "valid_median_stance";
alter table "public"."user_follows" add constraint "user_follows_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_follows" validate constraint "user_follows_user_id_fkey";
alter table "public"."user_follows" add constraint "user_follows_user_id_follow_type_follow_id_key" UNIQUE using index "user_follows_user_id_follow_type_follow_id_key";
alter table "public"."user_location_settings" add constraint "user_location_settings_location_id_fkey" FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE not valid;
alter table "public"."user_location_settings" validate constraint "user_location_settings_location_id_fkey";
alter table "public"."user_location_settings" add constraint "user_location_settings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_location_settings" validate constraint "user_location_settings_user_id_fkey";
alter table "public"."user_notifications" add constraint "user_notifications_digest_id_fkey" FOREIGN KEY (digest_id) REFERENCES public.weekly_digests(id) ON DELETE SET NULL not valid;
alter table "public"."user_notifications" validate constraint "user_notifications_digest_id_fkey";
alter table "public"."user_notifications" add constraint "user_notifications_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE SET NULL not valid;
alter table "public"."user_notifications" validate constraint "user_notifications_question_id_fkey";
alter table "public"."user_notifications" add constraint "user_notifications_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE SET NULL not valid;
alter table "public"."user_notifications" validate constraint "user_notifications_topic_id_fkey";
alter table "public"."user_notifications" add constraint "user_notifications_type_chk" CHECK ((notification_type = ANY (ARRAY['stance_change'::text, 'weekly_digest'::text, 'topic_follow'::text, 'reminder'::text, 'new_local_topic'::text, 'election_update'::text]))) not valid;
alter table "public"."user_notifications" validate constraint "user_notifications_type_chk";
alter table "public"."user_notifications" add constraint "user_notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_notifications" validate constraint "user_notifications_user_id_fkey";
alter table "public"."user_privacy" add constraint "user_privacy_comment_visibility_check" CHECK ((comment_visibility = ANY (ARRAY['display_mode'::text, 'always_anonymous'::text]))) not valid;
alter table "public"."user_privacy" validate constraint "user_privacy_comment_visibility_check";
alter table "public"."user_privacy" add constraint "user_privacy_display_mode_check" CHECK ((display_mode = ANY (ARRAY['anonymous'::text, 'username'::text]))) not valid;
alter table "public"."user_privacy" validate constraint "user_privacy_display_mode_check";
alter table "public"."user_privacy" add constraint "user_privacy_profile_visibility_check" CHECK ((profile_visibility = ANY (ARRAY['private'::text, 'public'::text]))) not valid;
alter table "public"."user_privacy" validate constraint "user_privacy_profile_visibility_check";
alter table "public"."user_privacy" add constraint "user_privacy_stance_visibility_check" CHECK ((stance_visibility = ANY (ARRAY['aggregate_only'::text, 'public'::text]))) not valid;
alter table "public"."user_privacy" validate constraint "user_privacy_stance_visibility_check";
alter table "public"."user_privacy" add constraint "user_privacy_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_privacy" validate constraint "user_privacy_user_id_fkey";
alter table "public"."user_region_follows" add constraint "region_scope_check" CHECK ((region_scope = ANY (ARRAY['city'::text, 'county'::text, 'state'::text, 'country'::text]))) not valid;
alter table "public"."user_region_follows" validate constraint "region_scope_check";
alter table "public"."user_region_follows" add constraint "user_region_follows_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_region_follows" validate constraint "user_region_follows_user_id_fkey";
alter table "public"."user_region_follows" add constraint "user_region_follows_user_id_region_scope_region_key_key" UNIQUE using index "user_region_follows_user_id_region_scope_region_key_key";
alter table "public"."user_region_preferences" add constraint "user_region_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_region_preferences" validate constraint "user_region_preferences_user_id_fkey";
alter table "public"."user_restrictions" add constraint "user_restrictions_moderator_id_fkey" FOREIGN KEY (moderator_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."user_restrictions" validate constraint "user_restrictions_moderator_id_fkey";
alter table "public"."user_restrictions" add constraint "user_restrictions_restriction_type_check" CHECK ((restriction_type = ANY (ARRAY['restrict'::text, 'ban'::text]))) not valid;
alter table "public"."user_restrictions" validate constraint "user_restrictions_restriction_type_check";
alter table "public"."user_restrictions" add constraint "user_restrictions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_restrictions" validate constraint "user_restrictions_user_id_fkey";
alter table "public"."user_topic_follows" add constraint "user_topic_follows_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;
alter table "public"."user_topic_follows" validate constraint "user_topic_follows_topic_id_fkey";
alter table "public"."user_topic_follows" add constraint "user_topic_follows_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_topic_follows" validate constraint "user_topic_follows_user_id_fkey";
alter table "public"."user_topic_follows" add constraint "user_topic_follows_user_id_topic_id_key" UNIQUE using index "user_topic_follows_user_id_topic_id_key";
alter table "public"."user_topic_interactions" add constraint "user_topic_interactions_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;
alter table "public"."user_topic_interactions" validate constraint "user_topic_interactions_topic_id_fkey";
alter table "public"."user_topic_interactions" add constraint "user_topic_interactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;
alter table "public"."user_topic_interactions" validate constraint "user_topic_interactions_user_id_fkey";
alter table "public"."user_topic_interactions" add constraint "user_topic_interactions_user_id_topic_id_key" UNIQUE using index "user_topic_interactions_user_id_topic_id_key";
alter table "public"."username_history" add constraint "username_history_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."username_history" validate constraint "username_history_user_id_fkey";
alter table "public"."users" add constraint "users_email_key" UNIQUE using index "users_email_key";
alter table "public"."weekly_digests" add constraint "weekly_digests_unique_user_week" UNIQUE using index "weekly_digests_unique_user_week";
alter table "public"."weekly_digests" add constraint "weekly_digests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;
alter table "public"."weekly_digests" validate constraint "weekly_digests_user_id_fkey";
alter table "public"."whatsapp_active_sessions" add constraint "whatsapp_active_sessions_last_question_id_fkey" FOREIGN KEY (last_question_id) REFERENCES public.questions(id) ON DELETE SET NULL not valid;
alter table "public"."whatsapp_active_sessions" validate constraint "whatsapp_active_sessions_last_question_id_fkey";
alter table "public"."whatsapp_broadcasts" add constraint "whatsapp_broadcasts_contact_list_id_fkey" FOREIGN KEY (contact_list_id) REFERENCES public.whatsapp_contact_lists(id) ON DELETE SET NULL not valid;
alter table "public"."whatsapp_broadcasts" validate constraint "whatsapp_broadcasts_contact_list_id_fkey";
alter table "public"."whatsapp_broadcasts" add constraint "whatsapp_broadcasts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."whatsapp_broadcasts" validate constraint "whatsapp_broadcasts_created_by_fkey";
alter table "public"."whatsapp_broadcasts" add constraint "whatsapp_broadcasts_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE RESTRICT not valid;
alter table "public"."whatsapp_broadcasts" validate constraint "whatsapp_broadcasts_question_id_fkey";
alter table "public"."whatsapp_broadcasts" add constraint "whatsapp_broadcasts_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'completed'::text, 'partially_failed'::text, 'cancelled'::text]))) not valid;
alter table "public"."whatsapp_broadcasts" validate constraint "whatsapp_broadcasts_status_check";
alter table "public"."whatsapp_config" add constraint "whatsapp_config_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'disconnected'::text, 'suspended'::text]))) not valid;
alter table "public"."whatsapp_config" validate constraint "whatsapp_config_status_check";
alter table "public"."whatsapp_contact_list_numbers" add constraint "whatsapp_contact_list_numbers_contact_list_id_fkey" FOREIGN KEY (contact_list_id) REFERENCES public.whatsapp_contact_lists(id) ON DELETE CASCADE not valid;
alter table "public"."whatsapp_contact_list_numbers" validate constraint "whatsapp_contact_list_numbers_contact_list_id_fkey";
alter table "public"."whatsapp_contact_lists" add constraint "whatsapp_contact_lists_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;
alter table "public"."whatsapp_contact_lists" validate constraint "whatsapp_contact_lists_created_by_fkey";
alter table "public"."whatsapp_delivery_log" add constraint "whatsapp_delivery_log_broadcast_id_fkey" FOREIGN KEY (broadcast_id) REFERENCES public.whatsapp_broadcasts(id) ON DELETE CASCADE not valid;
alter table "public"."whatsapp_delivery_log" validate constraint "whatsapp_delivery_log_broadcast_id_fkey";
alter table "public"."whatsapp_delivery_log" add constraint "whatsapp_delivery_log_status_check" CHECK ((status = ANY (ARRAY['sent'::text, 'delivered'::text, 'failed'::text, 'opted_out'::text]))) not valid;
alter table "public"."whatsapp_delivery_log" validate constraint "whatsapp_delivery_log_status_check";
alter table "public"."whatsapp_forward_chains" add constraint "whatsapp_forward_chains_parent_forward_chain_id_fkey" FOREIGN KEY (parent_forward_chain_id) REFERENCES public.whatsapp_forward_chains(id) ON DELETE SET NULL not valid;
alter table "public"."whatsapp_forward_chains" validate constraint "whatsapp_forward_chains_parent_forward_chain_id_fkey";
alter table "public"."whatsapp_forward_chains" add constraint "whatsapp_forward_chains_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."whatsapp_forward_chains" validate constraint "whatsapp_forward_chains_question_id_fkey";
alter table "public"."whatsapp_phone_verifications" add constraint "whatsapp_phone_verifications_verification_token_key" UNIQUE using index "whatsapp_phone_verifications_verification_token_key";
alter table "public"."whatsapp_question_subscriptions" add constraint "whatsapp_question_subscriptio_whatsapp_phone_hash_question__key" UNIQUE using index "whatsapp_question_subscriptio_whatsapp_phone_hash_question__key";
alter table "public"."whatsapp_question_subscriptions" add constraint "whatsapp_question_subscriptions_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;
alter table "public"."whatsapp_question_subscriptions" validate constraint "whatsapp_question_subscriptions_question_id_fkey";
set check_function_bodies = off;
CREATE OR REPLACE FUNCTION admin.cron_aggregate_election_stances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
AS $function$
DECLARE
  lock_key        bigint := hashtext('admin.cron_aggregate_election_stances');
  got_lock        boolean;
  v_cron_secret   text;
  v_service_role  text;
  r               extensions.http_response;
  v_status        int;
  v_body          text;
BEGIN
  got_lock := pg_try_advisory_lock(lock_key);
  IF NOT got_lock THEN
    INSERT INTO admin.cron_runs(job, ok, message, finished_at)
    VALUES ('aggregate_election_stances', true, 'skipped: lock busy', now());
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_cron_secret
  FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

  SELECT decrypted_secret INTO v_service_role
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  SELECT extensions.http((
    'POST',
    'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/aggregate-election-stances',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || v_service_role),
      extensions.http_header('apikey',         v_service_role),
      extensions.http_header('x-cron-secret',  v_cron_secret),
      extensions.http_header('content-type',   'application/json')
    ]::extensions.http_header[],
    '{}'::text,
    'application/json'
  )) INTO r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);

  INSERT INTO admin.cron_runs(job, finished_at, ok, http_status, message)
  VALUES ('aggregate_election_stances', now(), (v_status = 200), v_status, v_body);

  PERFORM pg_advisory_unlock(lock_key);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(lock_key);
  INSERT INTO admin.cron_runs(job, finished_at, ok, message)
  VALUES ('aggregate_election_stances', now(), false, SQLERRM);
END;
$function$;
CREATE OR REPLACE FUNCTION admin.cron_cluster()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'private'
AS $function$
declare
  lock_key  bigint := hashtext('admin.cron_cluster');
  got_lock  boolean;
  secret    text := private.get_secret('CRON_SECRET');
  r         extensions.http_response;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message) values ('cluster', true, 'skipped: lock busy');
    return;
  end if;

  begin
    select extensions.http((
      'POST',
      'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/cluster',
      ARRAY[
        extensions.http_header('x-cron-secret', secret),
        extensions.http_header('content-type','application/json')
      ],
      '{}'
    )) into r;

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values ('cluster', now(), (r.status = 200), r.status, left(coalesce(r.content::text,''), 2000));

    if r.status <> 200 then
      raise warning 'cluster non-200: % %', r.status, left(coalesce(r.content::text,''),200);
    end if;

  exception when others then
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('cluster', now(), false, sqlerrm);
    perform pg_advisory_unlock(lock_key);
    raise;
  end;

  perform pg_advisory_unlock(lock_key);
end;
$function$;
CREATE OR REPLACE FUNCTION admin.cron_detect_election_anomalies()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
AS $function$
DECLARE
  lock_key        bigint := hashtext('admin.cron_detect_election_anomalies');
  got_lock        boolean;
  v_cron_secret   text;
  v_service_role  text;
  r               extensions.http_response;
  v_status        int;
  v_body          text;
BEGIN
  got_lock := pg_try_advisory_lock(lock_key);
  IF NOT got_lock THEN
    INSERT INTO admin.cron_runs(job, ok, message, finished_at)
    VALUES ('detect_election_anomalies', true, 'skipped: lock busy', now());
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_cron_secret
  FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

  SELECT decrypted_secret INTO v_service_role
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  SELECT extensions.http((
    'POST',
    'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/detect-election-anomalies',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || v_service_role),
      extensions.http_header('apikey',         v_service_role),
      extensions.http_header('x-cron-secret',  v_cron_secret),
      extensions.http_header('content-type',   'application/json')
    ]::extensions.http_header[],
    '{}'::text,
    'application/json'
  )) INTO r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);

  INSERT INTO admin.cron_runs(job, finished_at, ok, http_status, message)
  VALUES ('detect_election_anomalies', now(), (v_status = 200), v_status, v_body);

  PERFORM pg_advisory_unlock(lock_key);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(lock_key);
  INSERT INTO admin.cron_runs(job, finished_at, ok, message)
  VALUES ('detect_election_anomalies', now(), false, SQLERRM);
END;
$function$;
CREATE OR REPLACE FUNCTION admin.cron_enforce_silence()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
AS $function$
DECLARE
  lock_key        bigint := hashtext('admin.cron_enforce_silence');
  got_lock        boolean;
  v_cron_secret   text;
  v_service_role  text;
  r               extensions.http_response;
  v_status        int;
  v_body          text;
BEGIN
  got_lock := pg_try_advisory_lock(lock_key);
  IF NOT got_lock THEN
    INSERT INTO admin.cron_runs(job, ok, message, finished_at)
    VALUES ('enforce_silence', true, 'skipped: lock busy', now());
    RETURN;
  END IF;

  -- Read secrets from Vault
  SELECT decrypted_secret INTO v_cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  SELECT decrypted_secret INTO v_service_role
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  -- Call Edge Function
  SELECT extensions.http((
    'POST',
    'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/enforce-election-silence',
    ARRAY[
      extensions.http_header('authorization',  'Bearer ' || v_service_role),
      extensions.http_header('apikey',          v_service_role),
      extensions.http_header('x-cron-secret',   v_cron_secret),
      extensions.http_header('content-type',    'application/json')
    ]::extensions.http_header[],
    '{}'::text,
    'application/json'
  )) INTO r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);

  INSERT INTO admin.cron_runs(job, finished_at, ok, http_status, message)
  VALUES ('enforce_silence', now(), (v_status = 200), v_status, v_body);

  PERFORM pg_advisory_unlock(lock_key);

EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(lock_key);
  INSERT INTO admin.cron_runs(job, finished_at, ok, message)
  VALUES ('enforce_silence', now(), false, SQLERRM);
END;
$function$;
CREATE OR REPLACE FUNCTION admin.cron_generate()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'private'
AS $function$
declare
  lock_key  bigint := hashtext('admin.cron_generate');
  got_lock  boolean;
  secret    text := private.get_secret('CRON_SECRET');
  r         extensions.http_response;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message) values ('generate', true, 'skipped: lock busy');
    return;
  end if;

  begin
    select extensions.http((
      'POST',
      'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/generate',
      ARRAY[
        extensions.http_header('x-cron-secret', secret),
        extensions.http_header('content-type','application/json')
      ],
      '{}'
    )) into r;

    insert into admin.cron_runs(job, finished_at, ok, http_status, message)
    values ('generate', now(), (r.status = 200), r.status, left(coalesce(r.content::text,''), 2000));

    if r.status <> 200 then
      raise warning 'generate non-200: % %', r.status, left(coalesce(r.content::text,''),200);
    end if;

  exception when others then
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('generate', now(), false, sqlerrm);
    perform pg_advisory_unlock(lock_key);
    raise;
  end;

  perform pg_advisory_unlock(lock_key);
end;
$function$;
CREATE OR REPLACE FUNCTION admin.cron_ingest()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
AS $function$
declare
  lock_key        bigint := hashtext('admin.cron_ingest');
  got_lock        boolean;

  v_cron_secret   text;
  v_service_role  text;

  r               extensions.http_response;
  v_status        int;
  v_body          text;
begin
  got_lock := pg_try_advisory_lock(lock_key);
  if not got_lock then
    insert into admin.cron_runs(job, ok, message, finished_at)
    values ('ingest', true, 'skipped: lock busy', now());
    return;
  end if;

  -- Read secrets from Vault (names match what you saw: cron_secret, service_role_key)
  select decrypted_secret into v_cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  select decrypted_secret into v_service_role
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_cron_secret is null or v_cron_secret = '' then
    raise exception 'Missing vault secret: cron_secret';
  end if;

  if v_service_role is null or v_service_role = '' then
    raise exception 'Missing vault secret: service_role_key';
  end if;

  -- Make the HTTP call
  select extensions.http((
    'POST',
    'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/ingest',
    array[
      extensions.http_header('authorization', 'Bearer ' || v_service_role),
      extensions.http_header('apikey', v_service_role),
      extensions.http_header('x-cron-secret', v_cron_secret),
      extensions.http_header('content-type','application/json')
    ]::extensions.http_header[],
    '{}'::text,
    'application/json'
  )) into r;

  -- Extract fields explicitly (avoid “record -> int” accidents)
  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);

  insert into admin.cron_runs(job, finished_at, ok, http_status, message)
  values ('ingest', now(), (v_status = 200), v_status, v_body);

  if v_status <> 200 then
    raise warning 'ingest non-200: % %', v_status, left(v_body, 200);
  end if;

  perform pg_advisory_unlock(lock_key);

exception when others then
  -- Always unlock + record error
  begin
    insert into admin.cron_runs(job, finished_at, ok, message)
    values ('ingest', now(), false, sqlerrm);
  exception when others then
    -- ignore logging failures
  end;

  perform pg_advisory_unlock(lock_key);
  raise;
end;
$function$;
CREATE OR REPLACE FUNCTION admin.cron_notify_election_updates()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'admin', 'vault', 'pg_temp'
AS $function$
DECLARE
  lock_key        bigint := hashtext('admin.cron_notify_election_updates');
  got_lock        boolean;
  v_cron_secret   text;
  v_service_role  text;
  r               extensions.http_response;
  v_status        int;
  v_body          text;
BEGIN
  got_lock := pg_try_advisory_lock(lock_key);
  IF NOT got_lock THEN
    INSERT INTO admin.cron_runs(job, ok, message, finished_at)
    VALUES ('notify_election_updates', true, 'skipped: lock busy', now());
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_cron_secret
  FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;

  SELECT decrypted_secret INTO v_service_role
  FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;

  SELECT extensions.http((
    'POST',
    'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/notify-election-updates',
    ARRAY[
      extensions.http_header('authorization', 'Bearer ' || v_service_role),
      extensions.http_header('apikey',         v_service_role),
      extensions.http_header('x-cron-secret',  v_cron_secret),
      extensions.http_header('content-type',   'application/json')
    ]::extensions.http_header[],
    '{}'::text,
    'application/json'
  )) INTO r;

  v_status := (r).status;
  v_body   := left(coalesce((r).content::text, ''), 2000);

  INSERT INTO admin.cron_runs(job, finished_at, ok, http_status, message)
  VALUES ('notify_election_updates', now(), (v_status = 200), v_status, v_body);

  PERFORM pg_advisory_unlock(lock_key);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(lock_key);
  INSERT INTO admin.cron_runs(job, finished_at, ok, message)
  VALUES ('notify_election_updates', now(), false, SQLERRM);
END;
$function$;
create or replace view "admin"."v_fn_p95_24h" as  SELECT func,
    count(*) AS runs_24h,
    percentile_disc((0.95)::double precision) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
    round(avg(duration_ms), 1) AS avg_ms
   FROM admin.fn_perf
  WHERE (at > (now() - '24:00:00'::interval))
  GROUP BY func
  ORDER BY func;
create or replace view "admin"."v_publish_p95_24h" as  SELECT count(*) AS runs_24h,
    percentile_disc((0.95)::double precision) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
    round(avg(duration_ms), 1) AS avg_ms
   FROM admin.fn_perf
  WHERE ((func = 'admin_publish_draft'::text) AND (at > (now() - '24:00:00'::interval)));
CREATE OR REPLACE FUNCTION private.get_secret(p_key text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
AS $function$
  select
    coalesce(
      (select s.val   from private.secrets    s where s.key = p_key),
      (select k.value from private.kv_secrets k where k.key = p_key)
    );
$function$;
CREATE OR REPLACE FUNCTION public._cluster_entity_overlap(e1 jsonb, e2 jsonb)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
AS $function$
  WITH
  people AS (
    SELECT COALESCE((
      WITH a AS (SELECT DISTINCT lower(x) v FROM jsonb_array_elements_text(COALESCE(e1->'people','[]'::jsonb)) x),
           b AS (SELECT DISTINCT lower(x) v FROM jsonb_array_elements_text(COALESCE(e2->'people','[]'::jsonb)) x),
           inter AS (SELECT COUNT(*)::float i FROM a JOIN b USING (v)),
           uni   AS (SELECT COUNT(*)::float u FROM (SELECT v FROM a UNION SELECT v FROM b) t)
      SELECT CASE WHEN (SELECT u FROM uni)=0 THEN 0 ELSE (SELECT i FROM inter)/(SELECT u FROM uni) END
    ),0) s
  ),
  orgs AS (
    SELECT COALESCE((
      WITH a AS (SELECT DISTINCT lower(x) v FROM jsonb_array_elements_text(COALESCE(e1->'organizations','[]'::jsonb)) x),
           b AS (SELECT DISTINCT lower(x) v FROM jsonb_array_elements_text(COALESCE(e2->'organizations','[]'::jsonb)) x),
           inter AS (SELECT COUNT(*)::float i FROM a JOIN b USING (v)),
           uni   AS (SELECT COUNT(*)::float u FROM (SELECT v FROM a UNION SELECT v FROM b) t)
      SELECT CASE WHEN (SELECT u FROM uni)=0 THEN 0 ELSE (SELECT i FROM inter)/(SELECT u FROM uni) END
    ),0) s
  ),
  locs AS (
    SELECT COALESCE((
      WITH a AS (SELECT DISTINCT lower(x) v FROM jsonb_array_elements_text(COALESCE(e1->'locations','[]'::jsonb)) x),
           b AS (SELECT DISTINCT lower(x) v FROM jsonb_array_elements_text(COALESCE(e2->'locations','[]'::jsonb)) x),
           inter AS (SELECT COUNT(*)::float i FROM a JOIN b USING (v)),
           uni   AS (SELECT COUNT(*)::float u FROM (SELECT v FROM a UNION SELECT v FROM b) t)
      SELECT CASE WHEN (SELECT u FROM uni)=0 THEN 0 ELSE (SELECT i FROM inter)/(SELECT u FROM uni) END
    ),0) s
  ),
  evs AS (
    SELECT COALESCE((
      WITH a AS (SELECT DISTINCT lower(x) v FROM jsonb_array_elements_text(COALESCE(e1->'events','[]'::jsonb)) x),
           b AS (SELECT DISTINCT lower(x) v FROM jsonb_array_elements_text(COALESCE(e2->'events','[]'::jsonb)) x),
           inter AS (SELECT COUNT(*)::float i FROM a JOIN b USING (v)),
           uni   AS (SELECT COUNT(*)::float u FROM (SELECT v FROM a UNION SELECT v FROM b) t)
      SELECT CASE WHEN (SELECT u FROM uni)=0 THEN 0 ELSE (SELECT i FROM inter)/(SELECT u FROM uni) END
    ),0) s
  )
  SELECT
    (SELECT s FROM people) * 0.35 +
    (SELECT s FROM orgs)   * 0.25 +
    (SELECT s FROM locs)   * 0.20 +
    (SELECT s FROM evs)    * 0.20
$function$;
CREATE OR REPLACE FUNCTION public._ensure_admin_or_service()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- service_role bypasses admin check
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;

  -- otherwise must be admin
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized (admin or service_role required)'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;
create or replace view "public"."active_questions" as  SELECT DISTINCT ON (q.topic_id) q.id,
    q.question_draft_id,
    q.topic_draft_id,
    q.news_item_id,
    q.question,
    q.summary,
    q.tags,
    q.location_label,
    q.status,
    q.created_at,
    q.created_by,
    q.published_at,
    q.state,
    q.state_changed_at,
    q.archived_at,
    q.archive_reason,
    q.is_resolved,
    q.resolved_at,
    q.resolution_summary,
    q.is_trending,
    q.trending_since,
    q.trending_score,
    q.is_featured,
    q.featured_at,
    q.featured_by,
    q.featured_reason,
    q.dedup_key,
    q.dedup_bucket,
    q.context_summary,
    q.supporting_links,
    q.last_context_refresh_at,
    q.context_version,
    q.topic_id,
    q.search_vector,
    q.phase,
    q.engagement_score,
    t.title AS topic_title,
    t.slug AS topic_slug,
    t.tags AS topic_tags
   FROM (public.questions q
     JOIN public.topics t ON ((t.id = q.topic_id)))
  WHERE (q.state = 'active'::public.question_state)
  ORDER BY q.topic_id, q.published_at DESC;
CREATE OR REPLACE FUNCTION public.add_context_to_existing_question(p_question_id uuid, p_new_context text, p_supporting_link text DEFAULT NULL::text, p_should_reactivate boolean DEFAULT true)
 RETURNS TABLE(success boolean, new_context_version integer, new_state text, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current_context TEXT;
  v_current_links TEXT[];
  v_current_version INT;
  v_current_status TEXT;
  v_current_phase TEXT;
  v_new_context TEXT;
  v_new_links TEXT[];
  v_new_version INT;
  v_new_status TEXT;
  v_response_count INTEGER;
  v_age_days NUMERIC;
BEGIN
  -- Get current question data
  SELECT 
    context_summary,
    supporting_links,
    context_version,
    status::TEXT,
    phase::TEXT,
    COALESCE((SELECT COUNT(*) FROM public.question_stances WHERE question_id = p_question_id), 0),
    EXTRACT(EPOCH FROM (NOW() - published_at)) / 86400
  INTO 
    v_current_context,
    v_current_links,
    v_current_version,
    v_current_status,
    v_current_phase,
    v_response_count,
    v_age_days
  FROM public.questions
  WHERE id = p_question_id;
  
  IF NOT FOUND THEN
    RETURN QUERY 
    SELECT false, 0, ''::TEXT, 'Question not found'::TEXT;
    RETURN;
  END IF;
  
  -- Build new context (append, don't replace)
  IF v_current_context IS NULL OR v_current_context = '' THEN
    v_new_context := p_new_context;
  ELSE
    v_new_context := v_current_context || E'\n\n---\n\n' || 
                     '**Update ' || (v_current_version + 1) || ':** ' || p_new_context;
  END IF;
  
  -- Add supporting link if provided
  IF p_supporting_link IS NOT NULL THEN
    v_new_links := array_append(COALESCE(v_current_links, ARRAY[]::TEXT[]), p_supporting_link);
  ELSE
    v_new_links := v_current_links;
  END IF;
  
  -- Increment version
  v_new_version := v_current_version + 1;
  
  -- Determine new status (lifecycle integration)
  IF p_should_reactivate AND v_current_status IN ('dormant', 'cooling') THEN
    v_new_status := 'active';
  ELSE
    v_new_status := v_current_status;
  END IF;
  
  -- Update the question (NEVER touch question text!)
  UPDATE public.questions
  SET 
    context_summary         = v_new_context,
    supporting_links        = v_new_links,
    context_version         = v_new_version,
    last_context_refresh_at = NOW(),
    status                  = v_new_status::question_state
  WHERE id = p_question_id;

  -- Log to question_context_updates
  INSERT INTO public.question_context_updates (
    question_id,
    updated_by,
    old_phase,
    new_phase,
    new_context,
    supporting_links,
    updated_at
  ) VALUES (
    p_question_id,
    auth.uid(),
    COALESCE(v_current_phase, 'initial'),
    'update',
    p_new_context,
    CASE WHEN p_supporting_link IS NOT NULL 
         THEN ARRAY[p_supporting_link] 
         ELSE NULL 
    END,
    NOW()
  );

  -- Log to question_state_history (audit trail)
  INSERT INTO public.question_state_history (
    question_id,
    old_state,
    new_state,
    reason,
    response_count,
    response_rate,
    age_days,
    created_at,
    created_by
  ) VALUES (
    p_question_id,
    v_current_status::question_state,
    v_new_status::question_state,
    'context_update:version_' || v_new_version,
    v_response_count,
    0,
    COALESCE(v_age_days, 0),
    NOW(),
    auth.uid()
  );
  
  RETURN QUERY 
  SELECT 
    true,
    v_new_version,
    v_new_status,
    format('Context added successfully. Version: %s, Status: %s', v_new_version, v_new_status)::TEXT;
    
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY 
  SELECT false, 0, ''::TEXT, ('Error: ' || SQLERRM)::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.admin_claim_ingest_jobs(p_limit integer)
 RETURNS SETOF public.ingestion_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  claimed_ids uuid[];
  v_stale_after interval := interval '15 minutes';
begin
  -- 0) Requeue stale running jobs (so they get retried)
  update public.ingestion_queue q
     set status = 'error'
   where q.status = 'running'
     and q.started_at is not null
     and q.started_at < now() - v_stale_after;

  -- 1) Claim jobs, including prior errors
  with upd as (
    update public.ingestion_queue q
       set status     = 'running',
           started_at = now()
     where q.id in (
       select id
       from public.ingestion_queue
       where status in ('pending','new','error')
       order by created_at asc
       limit greatest(p_limit, 1)
       for update skip locked
     )
     returning q.id
  )
  select coalesce(array_agg(id), '{}') into claimed_ids
  from upd;

  return query
    select *
    from public.ingestion_queue
    where id = any(claimed_ids);
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_create_question_draft(p_topic_draft_id uuid, p_question text, p_summary text, p_tags text[], p_location_label text, p_ai_version text, p_ai_input jsonb, p_ai_output jsonb, p_scope text DEFAULT NULL::text, p_guardrail_flags text[] DEFAULT '{}'::text[], p_qa_passed boolean DEFAULT NULL::boolean, p_audience_location_label text DEFAULT NULL::text, p_audience_reason text DEFAULT NULL::text, p_parent_topic_id uuid DEFAULT NULL::uuid, p_parent_topic_confidence numeric DEFAULT NULL::numeric, p_parent_topic_reason text DEFAULT NULL::text)
 RETURNS public.question_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_drafts;
begin
  insert into public.question_drafts(
    topic_draft_id,
    question,
    summary,
    tags,
    location_label,
    status,
    ai_version,
    ai_input,
    ai_output,
    scope,
    guardrail_flags,
    qa_passed,
    audience_location_label,
    audience_reason,
    created_by
  )
  values (
    p_topic_draft_id,
    p_question,
    p_summary,
    coalesce(p_tags, '{}'),
    p_location_label,
    'draft',
    p_ai_version,
    p_ai_input,
    p_ai_output,
    p_scope,
    coalesce(p_guardrail_flags, '{}'),
    p_qa_passed,
    p_audience_location_label,
    p_audience_reason,
    auth.uid()
  )
  returning * into v_row;

  -- Write parent classification back to topic_drafts if provided
  IF p_parent_topic_id IS NOT NULL THEN
    UPDATE public.topic_drafts
    SET
      parent_topic_id         = p_parent_topic_id,
      parent_topic_confidence = p_parent_topic_confidence,
      parent_topic_reason     = p_parent_topic_reason,
      updated_at              = now()
    WHERE id = p_topic_draft_id;
  END IF;

  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_create_topic_draft(p_news_item_id uuid, p_title text, p_summary text, p_tags text[], p_location_label text, p_ai_version text, p_ai_input jsonb, p_ai_output jsonb)
 RETURNS public.topic_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_draft public.topic_drafts;
begin
  insert into public.topic_drafts (
    news_item_id,
    title,
    summary,
    tags,
    location_label,
    status,
    ai_version,
    ai_input,
    ai_output
  )
  values (
    p_news_item_id,
    p_title,
    p_summary,
    coalesce(p_tags, '{}'),
    p_location_label,
    'draft',
    p_ai_version,
    p_ai_input,
    p_ai_output
  )
  returning * into v_draft;

  return v_draft;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_finish_ingest_job(p_id uuid, p_status text, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_source_id uuid;
begin
  -- Update the job row
  update public.ingestion_queue q
  set
    status = p_status,
    finished_at = case
      when p_status in ('done','error') then now()
      else q.finished_at
    end,
    error_msg = case
      when p_status = 'error' then left(coalesce(p_error,''), 1000)
      else null
    end
  where q.id = p_id
  returning q.source_id into v_source_id;

  -- If job id not found, no-op
  if v_source_id is null then
    return;
  end if;

  -- Sync source telemetry
  update public.topic_sources s
  set
    last_status = p_status,
    last_error  = case when p_status = 'error' then left(coalesce(p_error,''), 1000) else null end,
    last_polled_at = now(),
    success_count = coalesce(s.success_count, 0) + case when p_status = 'done' then 1 else 0 end,
    failure_count = coalesce(s.failure_count, 0) + case when p_status = 'error' then 1 else 0 end
  where s.id = v_source_id;

end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_get_question_draft_detail(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb;
begin
  if not public.is_admin_me() then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'draft', to_jsonb(qd),
    'topic', to_jsonb(td),
    'news',  to_jsonb(ni)
  )
  into v_row
  from public.question_drafts qd
  join public.topic_drafts td
    on td.id = qd.topic_draft_id
  left join public.news_items ni
    on ni.id = td.news_item_id
  where qd.id = p_draft_id;

  if v_row is null then
    raise exception 'question_draft % not found', p_draft_id;
  end if;

  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_ingest_source(p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'admin', 'auth', 'net'
AS $function$
declare
  resp        jsonb;
  url         text := 'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/ingest';
  body        text := json_build_object('source_id', p_source_id)::text;
  cron_secret text := coalesce(current_setting('app.cron_secret', true), 'demo123');
begin
  -- Only admins may trigger ingestion
  if not coalesce(public.is_admin_me(), false) then
    raise exception 'not authorized';
  end if;

  -- Try net.http_post(url, headers, body)
  if to_regprocedure('net.http_post(text,jsonb,text)') is not null then
    select net.http_post(
             url,
             jsonb_build_object(
               'x-cron-secret', cron_secret,
               'content-type',  'application/json'
             ),
             body
           )
      into resp;

  -- Try net.http_post(url, body, headers)
  elsif to_regprocedure('net.http_post(text,text,jsonb)') is not null then
    select net.http_post(
             url,
             body,
             jsonb_build_object(
               'x-cron-secret', cron_secret,
               'content-type',  'application/json'
             )
           )
      into resp;

  -- Fallback: net.http_request(url, method, headers, body)
  elsif to_regprocedure('net.http_request(text,text,jsonb,text)') is not null then
    select net.http_request(
             url,
             'POST',
             jsonb_build_object(
               'x-cron-secret', cron_secret,
               'content-type',  'application/json'
             ),
             body
           )
      into resp;

  else
    raise exception 'pg_net HTTP client functions not available';
  end if;

  return resp;  -- includes keys like status, body, headers depending on pg_net version
end
$function$;
create or replace view "public"."admin_question_drafts_v" as  SELECT qd.id,
    qd.topic_draft_id,
    qd.topic_id,
    qd.question,
    qd.summary,
    qd.tags,
    qd.location_label,
    qd.status,
    qd.ai_version,
    qd.created_at,
    qd.updated_at,
    qd.approved_at,
    qd.rejected_at,
    td.title AS topic_title,
    td.summary AS topic_summary,
    td.tags AS topic_tags,
    td.location_label AS topic_location_label,
    td.status AS topic_status,
    td.news_item_id AS topic_news_item_id,
    ni.title AS news_title,
    ni.url AS news_url,
    ni.published_at AS news_published_at
   FROM ((public.question_drafts qd
     JOIN public.topic_drafts td ON ((td.id = qd.topic_draft_id)))
     LEFT JOIN public.news_items ni ON ((ni.id = td.news_item_id)));
CREATE OR REPLACE FUNCTION public.admin_list_question_drafts(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS SETOF public.admin_question_drafts_v
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select *
  from public.admin_question_drafts_v v
  where
    public.is_admin_me()
    and (p_status is null or v.status = p_status)
  order by v.created_at desc
  limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
$function$;
CREATE OR REPLACE FUNCTION public.admin_mark_question_updated(p_question_id uuid, p_new_phase text, p_new_context text, p_supporting_links text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_phase text;
  v_old_status text;
  v_users_affected integer;
  v_result jsonb;
  v_admin_id uuid;
  v_response_count integer;
  v_age_days numeric;
BEGIN
  -- SECURITY: Check admin permission using is_admin_me()
  IF NOT is_admin_me() THEN
    RAISE EXCEPTION 'Only admins can update question phases';
  END IF;
  
  -- SECURITY: Get current user from auth.uid()
  v_admin_id := auth.uid();
  
  -- Verify valid phase
  IF p_new_phase NOT IN ('initial', 'update', 'resolution', 'follow_up') THEN
    RAISE EXCEPTION 'Invalid phase: %', p_new_phase;
  END IF;
  
  -- Get old phase, status, response count, age
  SELECT 
    phase,
    status::TEXT,
    COALESCE((SELECT COUNT(*) FROM public.question_stances WHERE question_id = p_question_id), 0),
    EXTRACT(EPOCH FROM (NOW() - published_at)) / 86400
  INTO v_old_phase, v_old_status, v_response_count, v_age_days
  FROM public.questions 
  WHERE id = p_question_id;
  
  IF v_old_phase IS NULL THEN
    RAISE EXCEPTION 'Question % does not exist', p_question_id;
  END IF;
  
  -- Update question
  UPDATE public.questions
  SET 
    phase = p_new_phase,
    context_summary = p_new_context,
    supporting_links = p_supporting_links,
    last_context_refresh_at = NOW()
  WHERE id = p_question_id;
  
  -- Log to question_context_updates
  INSERT INTO public.question_context_updates (
    question_id,
    updated_by,
    old_phase,
    new_phase,
    new_context,
    supporting_links,
    updated_at
  ) VALUES (
    p_question_id,
    v_admin_id,
    v_old_phase,
    p_new_phase,
    p_new_context,
    p_supporting_links,
    NOW()
  );

  -- Log to question_state_history (audit trail)
  INSERT INTO public.question_state_history (
    question_id,
    old_state,
    new_state,
    reason,
    response_count,
    response_rate,
    age_days,
    created_at,
    created_by
  ) VALUES (
    p_question_id,
    v_old_status::question_state,
    v_old_status::question_state,  -- status unchanged by phase update; log current status
    'admin_phase_update:' || v_old_phase || '->' || p_new_phase,
    v_response_count,
    0,
    COALESCE(v_age_days, 0),
    NOW(),
    v_admin_id
  );
  
  -- Count how many users will be notified
  SELECT COUNT(DISTINCT uti.user_id)
  INTO v_users_affected
  FROM public.user_topic_interactions uti
  JOIN public.questions q ON q.topic_id = uti.topic_id
  WHERE q.id = p_question_id
    AND uti.last_question_phase_seen IS DISTINCT FROM p_new_phase;
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'question_id', p_question_id,
    'old_phase', v_old_phase,
    'new_phase', p_new_phase,
    'users_affected', v_users_affected,
    'updated_by', v_admin_id,
    'message', format(
      'Question updated from %s to %s. %s users will see it reopened.',
      v_old_phase, p_new_phase, v_users_affected
    )
  );
  
  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.admin_merge_topic(p_source_topic_id uuid, p_target_topic_id uuid)
 RETURNS public.topics
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source_exists boolean;
  v_target_canonical_id uuid;
  v_source_canonical_id uuid;
  v_result public.topics;
begin
  -- Admin gate
  if not public.is_admin_me() then
    raise exception 'not authorized';
  end if;

  if p_source_topic_id is null or p_target_topic_id is null then
    raise exception 'source and target topic ids are required';
  end if;

  if p_source_topic_id = p_target_topic_id then
    raise exception 'cannot merge a topic into itself';
  end if;

  -- Ensure both topics exist
  select exists (select 1 from public.topics t where t.id = p_source_topic_id)
  into v_source_exists;

  if not v_source_exists then
    raise exception 'source topic % not found', p_source_topic_id;
  end if;

  select public.get_canonical_topic_id(p_target_topic_id)
  into v_target_canonical_id;

  if v_target_canonical_id is null then
    raise exception 'target topic % not found', p_target_topic_id;
  end if;

  select public.get_canonical_topic_id(p_source_topic_id)
  into v_source_canonical_id;

  if v_source_canonical_id is null then
    raise exception 'source topic % not found', p_source_topic_id;
  end if;

  -- Prevent cycles: cannot merge canonical into itself/descendant
  if v_source_canonical_id = v_target_canonical_id then
    raise exception 'cannot merge a topic into itself or its canonical parent';
  end if;

  -- 1) Re-parent the source topic and any existing children to the canonical target
  update public.topics t
  set parent_topic_id = v_target_canonical_id
  where t.id = p_source_topic_id
     or t.parent_topic_id = p_source_topic_id;

  -- 2) Ensure canonical topic has all region coverage from the source
  insert into public.topic_regions (topic_id, region_id)
  select distinct v_target_canonical_id, tr.region_id
  from public.topic_regions tr
  where tr.topic_id = p_source_topic_id
  on conflict do nothing;

  -- (Optional: you could also merge tags/sources, but we keep topics immutable for now)

  -- Return the canonical topic row (the "surviving" one)
  select *
  into v_result
  from public.topics t
  where t.id = v_target_canonical_id;

  return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_merge_topics(p_source_topic_id uuid, p_target_topic_id uuid)
 RETURNS public.topics
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin   boolean;
  v_source     public.topics%rowtype;
  v_target     public.topics%rowtype;
  v_canonical  public.topics%rowtype;
  v_hops       int := 0;
begin
  -- 1) Admin gate
  select public.is_admin_me() into v_is_admin;
  if not coalesce(v_is_admin, false) then
    raise exception 'not authorized'
      using errcode = '42501';
  end if;

  if p_source_topic_id is null or p_target_topic_id is null then
    raise exception 'source and target topic ids are required'
      using errcode = '22023';
  end if;

  if p_source_topic_id = p_target_topic_id then
    raise exception 'cannot merge a topic into itself'
      using errcode = '22023';
  end if;

  -- 2) Lock source + target
  select *
  into v_source
  from public.topics
  where id = p_source_topic_id
  for update;

  if not found then
    raise exception 'source topic not found'
      using errcode = 'P0002';
  end if;

  select *
  into v_target
  from public.topics
  where id = p_target_topic_id
  for update;

  if not found then
    raise exception 'target topic not found'
      using errcode = 'P0002';
  end if;

  -- 3) Resolve canonical target (follow parent chain if needed)
  v_canonical := v_target;
  while v_canonical.parent_topic_id is not null loop
    v_hops := v_hops + 1;
    exit when v_hops > 8; -- safety guard to avoid cycles
    select *
    into v_canonical
    from public.topics
    where id = v_canonical.parent_topic_id
    for update;
    exit when not found;
  end loop;

  -- 4) Mark source as merged into canonical target
  update public.topics
  set parent_topic_id = v_canonical.id
  where id = v_source.id;

  -- Optional: re-parent any children of the source to canonical as well
  update public.topics
  set parent_topic_id = v_canonical.id
  where parent_topic_id = v_source.id;

  -- Reload and return updated source row
  select *
  into v_source
  from public.topics
  where id = v_source.id;

  return v_source;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_publish_draft(p_draft_id uuid, p_region_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d                 public.ai_question_drafts%rowtype;
  v_topic_id        uuid;
  v_primary_region  uuid;
  v_tier            text;
  v_location_label  text;
begin
  -- Auth check (keep same style as your other admin RPCs)
  if not public.is_admin_me() then
    raise exception 'not authorized';
  end if;

  -- Load AI draft
  select *
  into d
  from public.ai_question_drafts
  where id = p_draft_id
    and state = 'draft';

  if not found then
    raise exception 'ai_question_draft not found or not in DRAFT state';
  end if;

  -- Determine primary region -> tier + label
  if p_region_ids is not null and array_length(p_region_ids, 1) > 0 then
    v_primary_region := p_region_ids[1];

    select lower(l.type::text)::text, l.name
    into v_tier, v_location_label
    from public.locations l
    where l.id = v_primary_region;

    -- Fallback if region id invalid
    if v_tier is null then
      v_tier := 'global';
      v_location_label := 'Global';
    end if;
  else
    v_tier := 'global';
    v_location_label := 'Global';
  end if;

  -- Insert canonical topic
  insert into public.topics (
    title,
    summary,
    tags,
    sources,
    lang,
    published_at,
    cluster_id,
    draft_id,
    tier,
    location_label
  )
  values (
    d.title,
    d.summary,
    d.tags,
    d.sources,
    d.lang,
    now(),
    d.cluster_id,
    d.id,
    v_tier,
    v_location_label
  )
  returning id into v_topic_id;

  -- Attach additional regions
  if p_region_ids is not null and array_length(p_region_ids, 1) > 0 then
    insert into public.topic_regions (topic_id, region_id)
    select v_topic_id, rid
    from unnest(p_region_ids) as rid;
  end if;

  -- Mark AI draft as published
  update public.ai_question_drafts
  set state = 'published'
  where id = p_draft_id;

  return v_topic_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_publish_draft_timed(p_draft_id uuid, p_region_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  t0 timestamptz := clock_timestamp();
begin
  perform public.admin_publish_draft(p_draft_id, p_region_ids);
  insert into admin.rpc_perf(name, duration_ms, ok)
  values ('admin_publish_draft', (extract(epoch from (clock_timestamp()-t0))*1000)::int, true);
exception when others then
  insert into admin.rpc_perf(name, duration_ms, ok, note)
  values ('admin_publish_draft', (extract(epoch from (clock_timestamp()-t0))*1000)::int, false, sqlerrm);
  raise;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_publish_question_draft(p_draft_id uuid)
 RETURNS public.questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_admin  boolean;
  v_draft     public.question_drafts%rowtype;
  v_topic     public.topic_drafts%rowtype;
  v_question  public.questions%rowtype;
  v_topic_id  uuid;

  -- Phase 4B: audience variables
  v_origin_label    text;
  v_audience_label  text;
  v_audience_reason text;

  -- Epic AG: audience fit copy count (for logging)
  v_fit_rows_copied integer;
begin
  -- 1) Admin gate
  select public.is_admin_me() into v_is_admin;
  if not coalesce(v_is_admin, false) then
    raise exception 'not authorized'
      using errcode = '42501';
  end if;

  -- 2) Load the question draft
  select *
  into v_draft
  from public.question_drafts
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'draft not found'
      using errcode = 'P0002';
  end if;

  if v_draft.status is distinct from 'approved' then
    raise exception 'draft must be approved before publishing'
      using errcode = '22023';
  end if;

  -- 3) Load linked topic_draft for news_item + location (if present)
  begin
    select *
    into v_topic
    from public.topic_drafts
    where id = v_draft.topic_draft_id;
  exception
    when no_data_found then
      null;
  end;

  -- 3.5) Ensure canonical topic exists + write back topic_id on draft
  v_topic_id := public.ensure_topic_for_topic_draft(v_draft.topic_draft_id);

  update public.question_drafts
  set topic_id = v_topic_id
  where id = v_draft.id;

  -- 3.6) Resolve audience fields
  v_origin_label := COALESCE(
    v_draft.origin_location_label,
    v_draft.location_label,
    v_topic.location_label
  );

  IF v_draft.audience_location_label IS NOT NULL THEN
    v_audience_label  := v_draft.audience_location_label;
    v_audience_reason := v_draft.audience_reason;
  ELSE
    SELECT audience_label, reason
    INTO   v_audience_label, v_audience_reason
    FROM   public.infer_audience_location(
             v_draft.question,
             v_draft.summary,
             v_draft.tags,
             v_origin_label
           )
    LIMIT 1;
  END IF;

  -- 4) Insert live question — now includes slider_low_label and slider_high_label
  insert into public.questions (
    question_draft_id,
    topic_draft_id,
    topic_id,
    news_item_id,
    question,
    summary,
    tags,
    location_label,
    status,
    created_by,
    published_at,
    cover_image_url,
    cover_news_item_id,
    -- Phase 4B additions
    origin_location_label,
    audience_location_label,
    audience_reason,
    -- Dynamic slider labels
    slider_low_label,
    slider_high_label
  )
  values (
    v_draft.id,
    v_draft.topic_draft_id,
    v_topic_id,
    coalesce(v_topic.news_item_id, null),
    v_draft.question,
    v_draft.summary,
    coalesce(v_draft.tags, '{}'),
    coalesce(v_draft.location_label, v_topic.location_label),
    'active',
    auth.uid(),
    now(),
    v_draft.cover_image_url,
    v_draft.cover_news_item_id,
    -- Phase 4B additions
    v_origin_label,
    v_audience_label,
    v_audience_reason,
    -- Dynamic slider labels — null-safe: UI falls back to generic labels
    v_draft.slider_low_label,
    v_draft.slider_high_label
  )
  returning * into v_question;

  -- 5) Assign cover image if missing
  if v_question.cover_image_url is null then
    perform public.assign_question_cover(v_question.id, false);
    select * into v_question
    from public.questions
    where id = v_question.id;
  end if;

  -- ── 6) Epic AG: Copy audience fit rows draft → published question ──────────
  -- Copies all rows from question_draft_audience_fit for this draft into
  -- question_audience_fit for the new live question_id.
  -- ON CONFLICT DO UPDATE preserves admin_override rows (reviewed_by_admin=true)
  -- and updates ai_pipeline rows in case of republish.
  -- Draft rows are intentionally preserved for audit — not deleted.
  INSERT INTO public.question_audience_fit (
    question_id,
    audience_segment_id,
    relevance_tier,
    reason,
    source,
    reviewed_by_admin,
    created_at,
    updated_at
  )
  SELECT
    v_question.id,          -- new live question id
    qdaf.audience_segment_id,
    qdaf.relevance_tier,
    qdaf.reason,
    qdaf.source,
    qdaf.reviewed_by_admin,
    now(),
    now()
  FROM public.question_draft_audience_fit qdaf
  WHERE qdaf.question_draft_id = p_draft_id
  ON CONFLICT (question_id, audience_segment_id)
    DO UPDATE SET
      relevance_tier    = EXCLUDED.relevance_tier,
      reason            = EXCLUDED.reason,
      -- Only overwrite source/reviewed_by_admin if the incoming row
      -- is an admin_override — never downgrade an admin_override to ai_pipeline
      source            = CASE
                            WHEN EXCLUDED.source = 'admin_override' THEN 'admin_override'
                            WHEN question_audience_fit.source = 'admin_override' THEN 'admin_override'
                            ELSE EXCLUDED.source
                          END,
      reviewed_by_admin = GREATEST(
                            question_audience_fit.reviewed_by_admin,
                            EXCLUDED.reviewed_by_admin
                          ),
      updated_at        = now();

  GET DIAGNOSTICS v_fit_rows_copied = ROW_COUNT;

  -- If no draft fit rows exist (pre-Epic questions republished, or AI skipped),
  -- insert a fallback general row so the question always has at least one fit entry.
  IF v_fit_rows_copied = 0 THEN
    INSERT INTO public.question_audience_fit (
      question_id,
      audience_segment_id,
      relevance_tier,
      reason,
      source,
      reviewed_by_admin
    )
    SELECT
      v_question.id,
      id,
      'general',
      'No audience fit data on draft — fallback general assigned at publish.',
      'ai_pipeline',
      false
    FROM public.audience_segments
    WHERE key    = 'general'
      AND status = 'active'
    LIMIT 1
    ON CONFLICT (question_id, audience_segment_id) DO NOTHING;
  END IF;
  -- ── End Epic AG ────────────────────────────────────────────────────────────

  return v_question;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_publish_question_drafts_bulk(p_draft_ids uuid[])
 RETURNS SETOF public.questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id   uuid;
  v_row  public.questions;
begin
  if not public.is_admin_me() then
    raise exception 'not authorized';
  end if;

  if p_draft_ids is null or array_length(p_draft_ids, 1) is null then
    return;
  end if;

  foreach v_id in array p_draft_ids loop
    begin
      -- Will raise if draft is not approved / not found; you can decide whether to catch those.
      v_row := public.admin_publish_question_draft(v_id);
      return next v_row;
    exception
      when others then
        -- Optional: skip bad ones instead of aborting whole batch.
        -- comment this block out if you prefer "all-or-nothing" semantics.
        continue;
    end;
  end loop;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_pull_back_live_question(p_draft_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_deleted int := 0;
begin
  -- Try: questions.draft_id
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='questions' and column_name='draft_id'
  ) then
    delete from public.questions where draft_id = p_draft_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  -- Try: questions.question_draft_id
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='questions' and column_name='question_draft_id'
  ) then
    delete from public.questions where question_draft_id = p_draft_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  -- Try: live_questions.draft_id
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='live_questions' and column_name='draft_id'
  ) then
    delete from public.live_questions where draft_id = p_draft_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  -- Try: live_questions.question_draft_id
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='live_questions' and column_name='question_draft_id'
  ) then
    delete from public.live_questions where question_draft_id = p_draft_id;
    get diagnostics v_deleted = row_count;
    return v_deleted;
  end if;

  raise exception
    'No supported live table/column found. Expected questions/live_questions with draft_id or question_draft_id.';
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_set_question_draft_status(p_draft_id uuid, p_status text)
 RETURNS public.question_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_drafts;
begin
  if not public.is_admin_me() then
    raise exception 'not authorized';
  end if;

  if p_status not in ('draft','approved','rejected') then
    raise exception 'invalid status %', p_status;
  end if;

  update public.question_drafts
     set status = p_status,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         rejected_at = case when p_status = 'rejected' then now() else rejected_at end,
         updated_at  = now()
   where id = p_draft_id
   returning * into v_row;

  if not found then
    raise exception 'question_draft % not found', p_draft_id;
  end if;

  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_set_topic_draft_status(p_topic_draft_id uuid, p_status text)
 RETURNS public.topic_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.topic_drafts;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not coalesce(public.is_admin_me(), false) then
    raise exception 'Not authorized';
  end if;

  if p_status not in ('draft','approved','rejected') then
    raise exception 'Invalid status: %', p_status;
  end if;

  update public.topic_drafts
  set
    status      = p_status,
    updated_at  = now(),
    approved_at = case when p_status='approved' then now() else approved_at end,
    rejected_at = case when p_status='rejected' then now() else rejected_at end,
    approved_by = case when p_status='approved' then v_uid else approved_by end,
    rejected_by = case when p_status='rejected' then v_uid else rejected_by end
  where id = p_topic_draft_id
  returning * into v_row;

  if not found then
    raise exception 'Topic draft not found: %', p_topic_draft_id;
  end if;

  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_update_question_draft(p_draft_id uuid, p_summary text, p_tags text[], p_location_label text)
 RETURNS public.question_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.question_drafts;
begin
  if not public.is_admin_me() then
    raise exception 'not authorized';
  end if;

  update public.question_drafts
     set summary        = coalesce(p_summary, summary),
         tags           = coalesce(p_tags, tags),
         location_label = coalesce(p_location_label, location_label),
         updated_at     = now()
   where id = p_draft_id
   returning * into v_row;

  if not found then
    raise exception 'question_draft % not found', p_draft_id;
  end if;

  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_update_topic_draft_status(p_id uuid, p_status text)
 RETURNS TABLE(id uuid, status text, approved_at timestamp with time zone, rejected_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- only admins
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception 'Not authorized';
  end if;

  -- fail fast if locked
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '15s', true);

  update public.topic_drafts
  set
    status = p_status,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    rejected_at = case when p_status = 'rejected' then now() else rejected_at end
  where id = p_id;

  if not found then
    raise exception 'No row updated (missing row or blocked by RLS)';
  end if;

  return query
  select td.id, td.status, td.approved_at, td.rejected_at
  from public.topic_drafts td
  where td.id = p_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.apply_feed_hygiene(p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_suppressed   integer := 0;
  v_archived     integer := 0;
  v_boosted      integer := 0;
  v_skipped      integer := 0;

  v_low_engagement_threshold  integer := 5;    -- responses_total to be considered "engaged"
  v_suppress_age_hours        integer := 24;   -- suppress after 24h if low engagement (was 72)
  v_archive_age_days          integer := 7;    -- archive after 7d if not trending
  v_min_composite_score       numeric := 7.0;  -- suppress if composite score below this (was 5.0)

  v_now timestamptz := now();
BEGIN

  -- ── Suppress: old + low engagement + low composite score ─────────────────
  -- Questions older than suppress_age_hours, not trending, with low engagement
  -- or a composite_score below the threshold get suppressed.

  IF NOT p_dry_run THEN
    WITH to_suppress AS (
      SELECT q.id AS question_id
      FROM questions q
      LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
      LEFT JOIN question_engagement_metrics qe ON qe.question_id = q.id
      LEFT JOIN topic_impact_scores tis ON tis.question_id = q.id
      WHERE
        q.status = 'active'
        AND (vr.visibility IS NULL OR vr.visibility = 'visible')
        AND q.is_trending = false
        AND q.published_at < (v_now - make_interval(hours => v_suppress_age_hours))
        AND (
          (qe.responses_total IS NULL OR qe.responses_total < v_low_engagement_threshold)
          OR
          (tis.composite_score IS NOT NULL AND tis.composite_score < v_min_composite_score)
        )
    )
    INSERT INTO question_visibility_rules (question_id, visibility, reason, last_evaluated_at)
    SELECT
      ts.question_id,
      'suppressed',
      'Feed hygiene: low engagement or score below ' || v_min_composite_score::text || ' after ' || v_suppress_age_hours::text || ' hours (auto)',
      v_now
    FROM to_suppress ts
    ON CONFLICT (question_id) DO UPDATE
      SET visibility = 'suppressed',
          reason = EXCLUDED.reason,
          last_evaluated_at = v_now;

    GET DIAGNOSTICS v_suppressed = ROW_COUNT;
  ELSE
    -- Dry run: just count
    SELECT count(*) INTO v_suppressed
    FROM questions q
    LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
    LEFT JOIN question_engagement_metrics qe ON qe.question_id = q.id
    LEFT JOIN topic_impact_scores tis ON tis.question_id = q.id
    WHERE
      q.status = 'active'
      AND (vr.visibility IS NULL OR vr.visibility = 'visible')
      AND q.is_trending = false
      AND q.published_at < (v_now - make_interval(hours => v_suppress_age_hours))
      AND (
        (qe.responses_total IS NULL OR qe.responses_total < v_low_engagement_threshold)
        OR
        (tis.composite_score IS NOT NULL AND tis.composite_score < v_min_composite_score)
      );
  END IF;

  -- ── Archive: old + not trending + not engaged ─────────────────────────────
  -- Questions older than archive_age_days that are still visible/suppressed
  -- and have shown no trending activity get moved to archived.

  IF NOT p_dry_run THEN
    WITH to_archive AS (
      SELECT q.id AS question_id
      FROM questions q
      LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
      LEFT JOIN question_engagement_metrics qe ON qe.question_id = q.id
      WHERE
        q.status = 'active'
        AND (vr.visibility IS NULL OR vr.visibility IN ('visible', 'suppressed'))
        AND q.is_trending = false
        AND q.published_at < (v_now - make_interval(days => v_archive_age_days))
        AND (qe.responses_last_24h IS NULL OR qe.responses_last_24h < 2)
    )
    INSERT INTO question_visibility_rules (question_id, visibility, reason, last_evaluated_at)
    SELECT
      ta.question_id,
      'archived',
      format('Feed hygiene: no activity after %s days (auto)', v_archive_age_days),
      v_now
    FROM to_archive ta
    ON CONFLICT (question_id) DO UPDATE
      SET visibility = 'archived',
          reason = EXCLUDED.reason,
          last_evaluated_at = v_now;

    GET DIAGNOSTICS v_archived = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_archived
    FROM questions q
    LEFT JOIN question_visibility_rules vr ON vr.question_id = q.id
    LEFT JOIN question_engagement_metrics qe ON qe.question_id = q.id
    WHERE
      q.status = 'active'
      AND (vr.visibility IS NULL OR vr.visibility IN ('visible', 'suppressed'))
      AND q.is_trending = false
      AND q.published_at < (v_now - make_interval(days => v_archive_age_days))
      AND (qe.responses_last_24h IS NULL OR qe.responses_last_24h < 2);
  END IF;

  -- ── Boost: trending questions that were suppressed ────────────────────────
  -- If a question is trending, override any suppression and restore to visible.
  -- Trending = either is_trending = true or trending_score > 20.

  IF NOT p_dry_run THEN
    WITH to_boost AS (
      SELECT q.id AS question_id
      FROM questions q
      JOIN question_visibility_rules vr ON vr.question_id = q.id
      WHERE
        q.status = 'active'
        AND vr.visibility = 'suppressed'
        AND (q.is_trending = true OR q.trending_score > 20)
    )
    UPDATE question_visibility_rules vr
    SET
      visibility = 'visible',
      reason = 'Feed hygiene: restored — question is now trending',
      last_evaluated_at = v_now
    FROM to_boost tb
    WHERE vr.question_id = tb.question_id;

    GET DIAGNOSTICS v_boosted = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_boosted
    FROM questions q
    JOIN question_visibility_rules vr ON vr.question_id = q.id
    WHERE
      q.status = 'active'
      AND vr.visibility = 'suppressed'
      AND (q.is_trending = true OR q.trending_score > 20);
  END IF;

  RETURN jsonb_build_object(
    'ran_at',      v_now,
    'dry_run',     p_dry_run,
    'suppressed',  v_suppressed,
    'archived',    v_archived,
    'boosted',     v_boosted,
    'skipped',     v_skipped,
    'rules', jsonb_build_object(
      'suppress_after_hours',     v_suppress_age_hours,
      'archive_after_days',       v_archive_age_days,
      'min_composite_score',      v_min_composite_score,
      'low_engagement_threshold', v_low_engagement_threshold
    )
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.assert_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Not authorized (admin only)' using errcode = '42501';
  end if;
end$function$;
CREATE OR REPLACE FUNCTION public.assign_draft_covers_batch(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id       uuid;
  v_assigned int := 0;
  v_skipped  int := 0;
  v_result   jsonb;
BEGIN
  FOR v_id IN
    SELECT id FROM public.question_drafts
    WHERE  cover_image_url IS NULL OR btrim(cover_image_url) = ''
    ORDER  BY created_at DESC
    LIMIT  p_limit
  LOOP
    v_result := public.assign_question_draft_cover(v_id);
    IF (v_result->>'assigned')::boolean THEN
      v_assigned := v_assigned + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_assigned, 'skipped', v_skipped);
END;
$function$;
CREATE OR REPLACE FUNCTION public.assign_question_cover(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_news_item_id uuid;
  v_topic_id     uuid;
  v_cluster_id   uuid;
  v_image_url    text;
  v_cover_ni_id  uuid;
BEGIN
  -- Guard
  SELECT news_item_id, topic_id
  INTO   v_news_item_id, v_topic_id
  FROM   public.questions
  WHERE  id = p_question_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('assigned', false, 'source', 'not_found', 'image_url', null);
  END IF;

  -- Rule 1: already set (non-blank)
  IF EXISTS (
    SELECT 1 FROM public.questions
    WHERE  id = p_question_id
      AND  cover_image_url IS NOT NULL
      AND  btrim(cover_image_url) <> ''
  ) THEN
    RETURN jsonb_build_object('assigned', false, 'source', 'already_set', 'image_url', null);
  END IF;

  -- Rule 2: direct news_item on the question
  IF v_news_item_id IS NOT NULL THEN
    SELECT ni.image_url
    INTO   v_image_url
    FROM   public.news_items ni
    WHERE  ni.id = v_news_item_id
      AND  ni.image_url IS NOT NULL
      AND  btrim(ni.image_url) <> '';

    IF FOUND AND v_image_url IS NOT NULL THEN
      UPDATE public.questions
      SET    cover_image_url    = v_image_url,
             cover_news_item_id = v_news_item_id,
             updated_at         = now()
      WHERE  id = p_question_id;

      RETURN jsonb_build_object(
        'assigned',     true,
        'source',       'question_news_item',
        'image_url',    v_image_url,
        'news_item_id', v_news_item_id
      );
    END IF;
  END IF;

  -- Rule 3: topic → cluster → topic_drafts → news_items (newest published_at)
  IF v_topic_id IS NOT NULL THEN
    SELECT t.cluster_id
    INTO   v_cluster_id
    FROM   public.topics t
    WHERE  t.id = v_topic_id;

    IF v_cluster_id IS NOT NULL THEN
      SELECT ni.image_url, ni.id
      INTO   v_image_url, v_cover_ni_id
      FROM   public.topic_drafts td
      JOIN   public.news_items ni ON ni.id = td.news_item_id
      WHERE  td.cluster_id     = v_cluster_id
        AND  ni.image_url     IS NOT NULL
        AND  btrim(ni.image_url) <> ''
      ORDER  BY ni.published_at DESC NULLS LAST,
                ni.created_at  DESC
      LIMIT  1;

      IF FOUND AND v_image_url IS NOT NULL THEN
        UPDATE public.questions
        SET    cover_image_url    = v_image_url,
               cover_news_item_id = v_cover_ni_id,
               updated_at         = now()
        WHERE  id = p_question_id;

        RETURN jsonb_build_object(
          'assigned',     true,
          'source',       'cluster_fallback',
          'image_url',    v_image_url,
          'news_item_id', v_cover_ni_id
        );
      END IF;
    END IF;
  END IF;

  -- Rule 4: nothing found
  RETURN jsonb_build_object('assigned', false, 'source', 'no_image_available', 'image_url', null);
END;
$function$;
CREATE OR REPLACE FUNCTION public.assign_question_cover(p_question_id uuid, p_force boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_topic_id uuid;
  v_cluster_id uuid;
  v_best_url text;
begin
  -- Find the topic + cluster for this question
  select q.topic_id, t.cluster_id
    into v_topic_id, v_cluster_id
  from public.questions q
  join public.topics t on t.id = q.topic_id
  where q.id = p_question_id;

  if v_topic_id is null or v_cluster_id is null then
    return null;
  end if;

  -- If not forcing, and already has a cover, do nothing
  if not p_force then
    perform 1
    from public.questions q
    where q.id = p_question_id
      and coalesce(q.cover_image_url, '') <> '';
    if found then
      select cover_image_url into v_best_url
      from public.questions
      where id = p_question_id;
      return v_best_url;
    end if;
  end if;

  -- Pick "best" image within the cluster:
  -- 1) most frequent image_url across cluster items
  -- 2) then most recent ingestion_queue.created_at
  -- 3) deterministic URL tie-break
  with candidates as (
    select
      (iq.normalized->>'image_url') as image_url,
      count(*)                      as freq,
      max(iq.created_at)            as last_seen_at
    from public.topic_cluster_items tci
    join public.ingestion_queue iq on iq.id = tci.ingestion_id
    where tci.cluster_id = v_cluster_id
      and coalesce(iq.normalized->>'image_url', '') <> ''
      and (iq.normalized->>'image_url') ~* '^https?://'
    group by (iq.normalized->>'image_url')
  )
  select c.image_url
    into v_best_url
  from candidates c
  order by
    c.freq desc,
    c.last_seen_at desc,
    c.image_url asc
  limit 1;

  if coalesce(v_best_url, '') = '' then
    return null;
  end if;

  update public.questions
  set cover_image_url = v_best_url
  where id = p_question_id
    and (p_force or coalesce(cover_image_url, '') = '');

  return v_best_url;
end;
$function$;
CREATE OR REPLACE FUNCTION public.assign_question_covers_batch(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id       uuid;
  v_assigned int := 0;
  v_skipped  int := 0;
  v_result   jsonb;
BEGIN
  FOR v_id IN
    SELECT id FROM public.questions
    WHERE  (cover_image_url IS NULL OR btrim(cover_image_url) = '')
      AND  status = 'active'
    ORDER  BY published_at DESC
    LIMIT  p_limit
  LOOP
    v_result := public.assign_question_cover(v_id);
    IF (v_result->>'assigned')::boolean THEN
      v_assigned := v_assigned + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_assigned, 'skipped', v_skipped);
END;
$function$;
CREATE OR REPLACE FUNCTION public.assign_question_draft_cover(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_topic_draft_id  uuid;
  v_cluster_id      uuid;
  v_framing_item_id uuid;
  v_image_url       text;
  v_news_item_id    uuid;
BEGIN
  -- Guard: draft must exist
  SELECT topic_draft_id
  INTO   v_topic_draft_id
  FROM   public.question_drafts
  WHERE  id = p_draft_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('assigned', false, 'source', 'not_found', 'image_url', null);
  END IF;

  -- Rule 1: already set (non-blank) → do nothing
  IF EXISTS (
    SELECT 1 FROM public.question_drafts
    WHERE  id = p_draft_id
      AND  cover_image_url IS NOT NULL
      AND  btrim(cover_image_url) <> ''
  ) THEN
    RETURN jsonb_build_object('assigned', false, 'source', 'already_set', 'image_url', null);
  END IF;

  -- Rule 2: framing news item's image
  SELECT td.news_item_id, td.cluster_id
  INTO   v_framing_item_id, v_cluster_id
  FROM   public.topic_drafts td
  WHERE  td.id = v_topic_draft_id;

  IF v_framing_item_id IS NOT NULL THEN
    SELECT ni.image_url
    INTO   v_image_url
    FROM   public.news_items ni
    WHERE  ni.id = v_framing_item_id
      AND  ni.image_url IS NOT NULL
      AND  btrim(ni.image_url) <> '';

    IF FOUND AND v_image_url IS NOT NULL THEN
      UPDATE public.question_drafts
      SET    cover_image_url    = v_image_url,
             cover_news_item_id = v_framing_item_id,
             updated_at         = now()
      WHERE  id = p_draft_id;

      RETURN jsonb_build_object(
        'assigned',     true,
        'source',       'framing_item',
        'image_url',    v_image_url,
        'news_item_id', v_framing_item_id
      );
    END IF;
  END IF;

  -- Rule 3: cluster fallback — same cluster, pick newest by published_at
  IF v_cluster_id IS NOT NULL THEN
    SELECT ni.image_url, ni.id
    INTO   v_image_url, v_news_item_id
    FROM   public.topic_drafts td
    JOIN   public.news_items ni ON ni.id = td.news_item_id
    WHERE  td.cluster_id     = v_cluster_id
      AND  td.news_item_id  != COALESCE(v_framing_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND  ni.image_url     IS NOT NULL
      AND  btrim(ni.image_url) <> ''
    ORDER  BY ni.published_at DESC NULLS LAST,
              ni.created_at  DESC
    LIMIT  1;

    IF FOUND AND v_image_url IS NOT NULL THEN
      UPDATE public.question_drafts
      SET    cover_image_url    = v_image_url,
             cover_news_item_id = v_news_item_id,
             updated_at         = now()
      WHERE  id = p_draft_id;

      RETURN jsonb_build_object(
        'assigned',     true,
        'source',       'cluster_fallback',
        'image_url',    v_image_url,
        'news_item_id', v_news_item_id
      );
    END IF;
  END IF;

  -- Rule 4: nothing found — leave null
  RETURN jsonb_build_object('assigned', false, 'source', 'no_image_available', 'image_url', null);
END;
$function$;
CREATE OR REPLACE FUNCTION public.auto_link_related_questions(p_question_id uuid, p_min_score numeric DEFAULT 0.3)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_related RECORD;
  v_link_count INT := 0;
BEGIN
  -- Find and link related questions
  FOR v_related IN 
    SELECT * FROM find_related_questions_lightweight(p_question_id, p_min_score, 20)
  LOOP
    -- Insert link (skip if exists)
    INSERT INTO question_links (
      from_question_id,
      to_question_id,
      link_type,
      score,
      method,
      created_by
    ) VALUES (
      p_question_id,
      v_related.related_question_id,
      v_related.link_type,
      v_related.score,
      v_related.method,
      'auto_linker'
    )
    ON CONFLICT (from_question_id, to_question_id, link_type) DO NOTHING;
    
    IF FOUND THEN
      v_link_count := v_link_count + 1;
    END IF;
  END LOOP;
  
  RETURN v_link_count;
END;
$function$;
CREATE OR REPLACE FUNCTION public.backfill_question_covers(p_limit integer DEFAULT NULL::integer, p_force boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_updated int := 0;
begin
  /*
    Backfill strategy:
    - Compute best image per cluster_id using frequency + recency
    - Update questions joined via topics.cluster_id
    - Only apply to "published + active" questions by default (matches v_live_questions usage)
    - Use p_limit to cap how many questions are updated in one call (useful for batching)
  */

  with best_per_cluster as (
    select distinct on (tci.cluster_id)
      tci.cluster_id,
      (iq.normalized->>'image_url') as image_url
    from public.topic_cluster_items tci
    join public.ingestion_queue iq on iq.id = tci.ingestion_id
    where coalesce(iq.normalized->>'image_url', '') <> ''
      and (iq.normalized->>'image_url') ~* '^https?://'
    group by tci.cluster_id, (iq.normalized->>'image_url')
    order by
      tci.cluster_id,
      count(*) desc,
      max(iq.created_at) desc,
      (iq.normalized->>'image_url') asc
  ),
  target_questions as (
    select q.id as question_id, b.image_url
    from public.questions q
    join public.topics t on t.id = q.topic_id
    join best_per_cluster b on b.cluster_id = t.cluster_id
    where q.published_at is not null
      and q.status = 'active'
      and (p_force or coalesce(q.cover_image_url, '') = '')
    order by q.published_at desc nulls last, q.created_at desc
    limit coalesce(p_limit, 2147483647)
  ),
  upd as (
    update public.questions q
    set cover_image_url = tq.image_url
    from target_questions tq
    where q.id = tq.question_id
      and (p_force or coalesce(q.cover_image_url, '') = '')
    returning 1
  )
  select count(*) into v_updated from upd;

  return v_updated;
end;
$function$;
CREATE OR REPLACE FUNCTION public.bootstrap_epic_p_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_question_ids UUID[];
  v_scoring_result JSONB;
  v_visibility_count INT;
  v_curated_result JSONB;
  v_top_questions UUID[];
BEGIN
  -- Step 1: Collect active question IDs ordered for round-robin rescoring.
  --   Priority: never-scored first (NULL updated_at), then oldest-scored first,
  --   most-recently-scored last. This ensures each rescore run processes the
  --   full pool fairly rather than hitting the same questions repeatedly.
  SELECT array_agg(q.id ORDER BY tis.updated_at ASC NULLS FIRST)
  INTO v_question_ids
  FROM public.questions q
  LEFT JOIN public.topic_impact_scores tis ON tis.question_id = q.id
  WHERE q.status = 'active';

  IF v_question_ids IS NULL OR array_length(v_question_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active questions found to score'
    );
  END IF;

  v_scoring_result := public.calculate_question_impact_scores_batch(v_question_ids);

  -- Step 2: Apply visibility rules
  SELECT COUNT(*) INTO v_visibility_count
  FROM public.update_visibility_rules();

  -- Step 3: Create today's curated set
  SELECT array_agg(question_id ORDER BY composite_score DESC)
  INTO v_top_questions
  FROM (
    SELECT
      q.id as question_id,
      tis.composite_score
    FROM public.questions q
    JOIN public.topic_impact_scores tis ON tis.question_id = q.id
    JOIN public.question_visibility_rules qvr ON qvr.question_id = q.id
    WHERE q.status = 'active'
      AND qvr.visibility = 'visible'
    ORDER BY tis.composite_score DESC
    LIMIT 7
  ) top_q;

  -- Only publish if we have enough questions
  IF v_top_questions IS NOT NULL AND array_length(v_top_questions, 1) >= 5 THEN
    PERFORM public.publish_curated_set(CURRENT_DATE, v_top_questions);
  END IF;

  -- Return summary
  RETURN jsonb_build_object(
    'success', true,
    'questions_scored', v_scoring_result->'total_processed',
    'visibility_rules_updated', v_visibility_count,
    'curated_questions', COALESCE(array_length(v_top_questions, 1), 0),
    'timestamp', NOW()
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.bootstrap_user_after_login()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(email) into v_email
  from auth.users
  where id = v_uid;

  if v_email is null then
    raise exception 'Email not found for user %', v_uid;
  end if;

  -- 1) If there's already a row with this email but different id, reattach it.
  update public.users
     set id = v_uid,
         last_seen_at = now()
   where email = v_email
     and id <> v_uid;

  -- 2) Insert or update by id (idempotent)
  insert into public.users (id, email, status, created_at, last_seen_at)
  values (v_uid, v_email, 'active'::public.user_status_enum, now(), now())
  on conflict (id) do update
    set email       = excluded.email,
        last_seen_at = now();

  -- 3) Ensure profile exists (also idempotent)
  insert into public.profiles (user_id, random_id, display_handle_mode)
  values (v_uid, public.generate_random_id(), 'random_id'::public.display_handle_mode_enum)
  on conflict (user_id) do nothing;

end;
$function$;
CREATE OR REPLACE FUNCTION public.build_topic_sources_from_news_item(p_news_item_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select jsonb_build_array(
    jsonb_build_object('type','news_item','id', p_news_item_id::text)
  );
$function$;
CREATE OR REPLACE FUNCTION public.bulk_import_candidates(p_election_id uuid, p_import_batch text, p_candidates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_item            jsonb;
  v_party_id        uuid;
  v_constituency_id uuid;
  v_inserted        integer := 0;
  v_skipped         integer := 0;
  v_errors          jsonb   := '[]'::jsonb;
  v_election        record;
BEGIN
  -- Verify election exists
  SELECT tier_code, country INTO v_election
  FROM public.elections WHERE id = p_election_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Election % not found', p_election_id;
  END IF;

  -- Process each candidate row
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_candidates)
  LOOP
    BEGIN
      -- Resolve party_id from abbreviation
      v_party_id := NULL;
      IF v_item->>'party_abbreviation' IS NOT NULL
         AND v_item->>'party_abbreviation' != '' THEN
        SELECT id INTO v_party_id
        FROM public.election_parties
        WHERE abbreviation = UPPER(TRIM(v_item->>'party_abbreviation'))
          AND country = v_election.country;

        IF NOT FOUND THEN
          v_errors := v_errors || jsonb_build_object(
            'row', v_item,
            'error', 'party_abbreviation not found: ' || (v_item->>'party_abbreviation')
          );
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
      END IF;

      -- Resolve constituency_id from constituency_code
      SELECT id INTO v_constituency_id
      FROM public.election_constituencies
      WHERE constituency_code = UPPER(TRIM(v_item->>'constituency_code'))
        AND tier_code = v_election.tier_code;

      IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_object(
          'row', v_item,
          'error', 'constituency_code not found: ' || (v_item->>'constituency_code')
        );
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- Insert candidate (skip if already exists for this election+constituency+party)
      INSERT INTO public.election_candidates (
        election_id, constituency_id, party_id,
        full_name, full_name_local, gender,
        affidavit_url, import_batch_id, import_source,
        status
      )
      VALUES (
        p_election_id,
        v_constituency_id,
        v_party_id,
        TRIM(v_item->>'full_name'),
        NULLIF(TRIM(v_item->>'full_name_local'), ''),
        NULLIF(UPPER(TRIM(v_item->>'gender')), ''),
        NULLIF(TRIM(v_item->>'affidavit_url'), ''),
        p_import_batch,
        'csv_import',
        'DECLARED'
      )
      ON CONFLICT (election_id, constituency_id, party_id) DO NOTHING;

      IF FOUND THEN
        v_inserted := v_inserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'row', v_item,
        'error', SQLERRM
      );
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'errors',   v_errors,
    'batch_id', p_import_batch
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_cognitive_state(p_user_id uuid, p_evaluation_period_days integer DEFAULT 90)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_state_id UUID;
    v_prior_state_id UUID;
    v_profile JSONB;
    v_period_start TIMESTAMP WITH TIME ZONE;
    v_period_end TIMESTAMP WITH TIME ZONE;
    v_mean_stance NUMERIC;
    v_median_stance NUMERIC;
    v_consistency NUMERIC;
    v_total_questions INTEGER;
    v_active_topics INTEGER;
    v_topic_data JSONB;
BEGIN
    v_period_end := NOW();
    v_period_start := v_period_end - (p_evaluation_period_days || ' days')::INTERVAL;
    
    SELECT id INTO v_prior_state_id
    FROM public.user_cognitive_states
    WHERE user_id = p_user_id 
      AND state_status = 'current'
    ORDER BY evaluated_at DESC
    LIMIT 1;
    
    IF v_prior_state_id IS NOT NULL THEN
        UPDATE public.user_cognitive_states
        SET state_status = 'historical'
        WHERE id = v_prior_state_id;
    END IF;
    
    SELECT 
        total_questions,
        active_topics,
        mean_stance,
        median_stance,
        stance_stddev
    INTO
        v_total_questions,
        v_active_topics,
        v_mean_stance,
        v_median_stance,
        v_consistency
    FROM public.user_stance_summary
    WHERE user_id = p_user_id;
    
    IF v_total_questions IS NULL OR v_total_questions = 0 THEN
        RETURN NULL;
    END IF;
    
    v_consistency := GREATEST(0, 1 - (COALESCE(v_consistency, 0) / 2.0))::NUMERIC(3,2);
    
    SELECT 
        jsonb_object_agg(
            t.id::text,
            jsonb_build_object(
                'topic_id', t.id,
                'topic_name', t.title,
                'mean_stance', topic_stats.mean_stance,
                'median_stance', topic_stats.median_stance,
                'question_count', topic_stats.question_count,
                'consistency_score', topic_stats.consistency,
                'last_updated', topic_stats.last_updated,
                'stance_distribution', jsonb_build_object(
                    'strong_disagree', topic_stats.strong_disagree,
                    'disagree', topic_stats.disagree,
                    'neutral', topic_stats.neutral,
                    'agree', topic_stats.agree,
                    'strong_agree', topic_stats.strong_agree
                )
            )
        )
    INTO v_topic_data
    FROM (
        SELECT 
            t.id,
            t.title,
            AVG(qs.score)::NUMERIC(4,2) as mean_stance,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY qs.score)::NUMERIC(4,2) as median_stance,
            COUNT(qs.id) as question_count,
            GREATEST(0, 1 - (COALESCE(STDDEV(qs.score), 0) / 2.0))::NUMERIC(3,2) as consistency,
            MAX(qs.updated_at) as last_updated,
            COUNT(*) FILTER (WHERE qs.score = -2) as strong_disagree,
            COUNT(*) FILTER (WHERE qs.score = -1) as disagree,
            COUNT(*) FILTER (WHERE qs.score = 0) as neutral,
            COUNT(*) FILTER (WHERE qs.score = 1) as agree,
            COUNT(*) FILTER (WHERE qs.score = 2) as strong_agree
        FROM public.question_stances qs
        JOIN public.questions q ON q.id = qs.question_id
        JOIN public.topics t ON t.id = q.topic_id
        WHERE qs.user_id = p_user_id
          AND qs.created_at >= v_period_start
        GROUP BY t.id, t.title
    ) topic_stats
    JOIN public.topics t ON t.id = topic_stats.id;
    
    v_profile := jsonb_build_object(
        'overall_orientation', jsonb_build_object(
            'mean_stance', v_mean_stance,
            'median_stance', v_median_stance,
            'stance_variance', v_consistency,
            'total_questions', v_total_questions,
            'active_topics', v_active_topics
        ),
        'topic_profiles', COALESCE(v_topic_data, '{}'::jsonb),
        'stance_distribution', (
            SELECT jsonb_build_object(
                'strong_disagree', strong_disagree_count,
                'disagree', disagree_count,
                'neutral', neutral_count,
                'agree', agree_count,
                'strong_agree', strong_agree_count
            )
            FROM public.user_stance_summary
            WHERE user_id = p_user_id
        ),
        'engagement_patterns', jsonb_build_object(
            'first_stance_at', (SELECT first_stance_at FROM user_stance_summary WHERE user_id = p_user_id),
            'last_stance_at', (SELECT last_stance_at FROM user_stance_summary WHERE user_id = p_user_id),
            'questions_per_week', (
                CASE 
                    WHEN EXTRACT(EPOCH FROM (NOW() - (SELECT first_stance_at FROM user_stance_summary WHERE user_id = p_user_id))) > 0
                    THEN (v_total_questions::NUMERIC / (EXTRACT(EPOCH FROM (NOW() - (SELECT first_stance_at FROM user_stance_summary WHERE user_id = p_user_id))) / 604800))::NUMERIC(5,2)
                    ELSE 0
                END
            )
        ),
        'computed_at', NOW(),
        'evaluation_period_days', p_evaluation_period_days
    );
    
    INSERT INTO public.user_cognitive_states (
        user_id,
        evaluated_at,
        evaluation_period_start,
        evaluation_period_end,
        cognitive_profile,
        overall_mean_stance,
        overall_median_stance,
        stance_consistency_score,
        total_questions_answered,
        active_topic_count,
        prior_state_id,
        state_status
    ) VALUES (
        p_user_id,
        NOW(),
        v_period_start,
        v_period_end,
        v_profile,
        v_mean_stance,
        v_median_stance,
        v_consistency,
        v_total_questions,
        v_active_topics,
        v_prior_state_id,
        'current'
    )
    RETURNING id INTO v_state_id;
    
    INSERT INTO public.cognitive_state_snapshots (
        user_id,
        snapshot_at,
        question_count,
        mean_stance,
        active_topics,
        last_stance_at
    ) 
    SELECT
        p_user_id,
        NOW(),
        v_total_questions,
        v_mean_stance,
        COALESCE(ARRAY_AGG(DISTINCT t.title), ARRAY[]::text[]),
        (SELECT last_stance_at FROM user_stance_summary WHERE user_id = p_user_id)
    FROM jsonb_each(COALESCE(v_topic_data, '{}'::jsonb)) AS topic_entry
    LEFT JOIN public.topics t ON t.id::text = topic_entry.key;
    
    RETURN v_state_id;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Error calculating cognitive state for user %: %', p_user_id, SQLERRM;
        RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_engagement_rates()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  
  -- Update all engagement metrics in one pass
  INSERT INTO public.question_engagement_metrics (
    question_id,
    responses_last_24h,
    responses_last_7d,
    responses_total,
    response_rate_24h,
    response_rate_7d,
    updated_at
  )
  SELECT 
    q.id,
    
    -- Count responses in last 24 hours
    COUNT(qs.id) FILTER (WHERE qs.created_at > NOW() - INTERVAL '24 hours'),
    
    -- Count responses in last 7 days
    COUNT(qs.id) FILTER (WHERE qs.created_at > NOW() - INTERVAL '7 days'),
    
    -- Total responses
    COUNT(qs.id),
    
    -- Response rate per day (last 24h)
    COUNT(qs.id) FILTER (WHERE qs.created_at > NOW() - INTERVAL '24 hours')::NUMERIC,
    
    -- Response rate per day (last 7d average)
    (COUNT(qs.id) FILTER (WHERE qs.created_at > NOW() - INTERVAL '7 days')::NUMERIC / 7.0),
    
    -- Updated timestamp
    NOW()
    
  FROM public.questions q
  LEFT JOIN public.question_stances qs ON qs.question_id = q.id
  GROUP BY q.id
  
  -- Upsert (insert or update)
  ON CONFLICT (question_id) DO UPDATE
  SET
    responses_last_24h = EXCLUDED.responses_last_24h,
    responses_last_7d = EXCLUDED.responses_last_7d,
    responses_total = EXCLUDED.responses_total,
    response_rate_24h = EXCLUDED.response_rate_24h,
    response_rate_7d = EXCLUDED.response_rate_7d,
    updated_at = EXCLUDED.updated_at;
    
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_entity_overlap(p_entities1 text[], p_entities2 text[])
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_overlap_count INT;
  v_total_count INT;
BEGIN
  IF p_entities1 IS NULL OR p_entities2 IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Count overlapping entities
  SELECT COUNT(*)
  INTO v_overlap_count
  FROM unnest(p_entities1) e1
  WHERE LOWER(e1) = ANY(
    SELECT LOWER(e2) FROM unnest(p_entities2) e2
  );
  
  -- Get total unique entities
  SELECT COUNT(DISTINCT LOWER(e))
  INTO v_total_count
  FROM unnest(p_entities1 || p_entities2) e;
  
  IF v_total_count = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN v_overlap_count::NUMERIC / v_total_count;
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_jaccard_similarity(p_text1 text, p_text2 text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_tokens1 TEXT[];
  v_tokens2 TEXT[];
  v_intersection_count INT;
  v_union_count INT;
BEGIN
  -- Tokenize (split on whitespace, lowercase)
  v_tokens1 := string_to_array(LOWER(p_text1), ' ');
  v_tokens2 := string_to_array(LOWER(p_text2), ' ');
  
  -- Calculate intersection size
  SELECT COUNT(*)
  INTO v_intersection_count
  FROM unnest(v_tokens1) t1
  WHERE t1 = ANY(v_tokens2);
  
  -- Calculate union size
  SELECT COUNT(DISTINCT t)
  INTO v_union_count
  FROM unnest(v_tokens1 || v_tokens2) t;
  
  -- Return Jaccard coefficient
  IF v_union_count = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN v_intersection_count::NUMERIC / v_union_count;
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_question_impact_score(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_response JSONB;
BEGIN
  -- Validate
  IF NOT EXISTS (SELECT 1 FROM public.questions WHERE id = p_question_id) THEN
    RAISE EXCEPTION 'Question % not found', p_question_id;
  END IF;
  
  -- Call Edge Function for AI scoring
  -- Note: This uses Supabase's internal function invocation
  SELECT 
    extensions.http((
      'POST',
      current_setting('app.settings.supabase_url') || '/functions/v1/ai-score-question',
      ARRAY[
        extensions.http_header('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')),
        extensions.http_header('Content-Type', 'application/json')
      ],
      'application/json',
      json_build_object('question_id', p_question_id)::text
    )::json)
  INTO v_response;
  
  -- Check if Edge Function returned error
  IF v_response->>'error' IS NOT NULL THEN
    RAISE EXCEPTION 'AI scoring failed: %', v_response->>'error';
  END IF;
  
  -- Parse response
  v_result := v_response;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    -- If Edge Function fails, log error and return NULL
    RAISE WARNING 'AI scoring failed for question %: %', p_question_id, SQLERRM;
    RETURN jsonb_build_object(
      'error', SQLERRM,
      'question_id', p_question_id
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_question_impact_scores_batch(p_question_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_question_id UUID;
  v_results JSONB := '[]'::jsonb;
  v_score JSONB;
  v_count INT := 0;
  v_errors INT := 0;
BEGIN
  -- Validate
  IF p_question_ids IS NULL OR array_length(p_question_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'question_ids array cannot be empty';
  END IF;
  
  -- Process each question
  FOREACH v_question_id IN ARRAY p_question_ids
  LOOP
    BEGIN
      v_score := public.calculate_question_impact_score(v_question_id);
      v_results := v_results || v_score;
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE NOTICE 'Error scoring question %: %', v_question_id, SQLERRM;
    END;
  END LOOP;
  
  -- Return summary
  RETURN jsonb_build_object(
    'total_processed', v_count,
    'total_errors', v_errors,
    'scores', v_results,
    'timestamp', NOW()
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_question_state(p_question_id uuid)
 RETURNS public.question_state
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_age_days NUMERIC;
  v_response_rate_24h NUMERIC;
  v_response_rate_7d NUMERIC;
  v_is_resolved BOOLEAN;
  v_archived_at TIMESTAMP;
  v_has_recent_update BOOLEAN;
  v_has_metrics_row BOOLEAN;

  -- Configuration (loaded from config table)
  v_new_duration NUMERIC;
  v_active_max_age NUMERIC;
  v_dormant_max_age NUMERIC;
  v_force_archive_age NUMERIC;
  v_active_threshold NUMERIC;
  v_dormant_threshold NUMERIC;
  v_allow_resurrection BOOLEAN;
  v_resurrection_max_age NUMERIC;
  v_auto_archive_on_resolution BOOLEAN;
BEGIN

  -- Get question data
  SELECT
    EXTRACT(EPOCH FROM (NOW() - published_at))/86400,
    COALESCE(is_resolved, false),
    archived_at
  INTO v_age_days, v_is_resolved, v_archived_at
  FROM public.questions
  WHERE id = p_question_id;

  -- If question not found, return archived
  IF v_age_days IS NULL THEN
    RETURN 'archived'::question_state;
  END IF;

  -- Get engagement metrics
  -- v_has_metrics_row distinguishes "no data yet" from "data exists but rates are zero"
  SELECT
    true,
    COALESCE(response_rate_24h, 0),
    COALESCE(response_rate_7d, 0),
    COALESCE(last_major_update > NOW() - INTERVAL '48 hours', false)
  INTO v_has_metrics_row, v_response_rate_24h, v_response_rate_7d, v_has_recent_update
  FROM public.question_engagement_metrics
  WHERE question_id = p_question_id;

  -- If no metrics row found, default flags
  IF v_has_metrics_row IS NULL THEN
    v_has_metrics_row    := false;
    v_response_rate_24h  := 0;
    v_response_rate_7d   := 0;
    v_has_recent_update  := false;
  END IF;

  -- Load configuration
  SELECT
    new_duration,
    active_max_age,
    dormant_max_age,
    force_archive_age,
    active_threshold,
    dormant_threshold,
    allow_resurrection,
    resurrection_max_age,
    auto_archive_on_resolution
  INTO
    v_new_duration,
    v_active_max_age,
    v_dormant_max_age,
    v_force_archive_age,
    v_active_threshold,
    v_dormant_threshold,
    v_allow_resurrection,
    v_resurrection_max_age,
    v_auto_archive_on_resolution
  FROM public.question_lifecycle_config
  WHERE topic_category IS NULL AND region_tier IS NULL
  LIMIT 1;

  -- -------------------------------------------------------------------------
  -- STATE CALCULATION RULES (in priority order)
  -- -------------------------------------------------------------------------

  -- RULE 1: Resolved questions → ARCHIVED (immediately)
  IF v_is_resolved AND v_auto_archive_on_resolution THEN
    RETURN 'archived'::question_state;
  END IF;

  -- RULE 2: Force archive if too old (90+ days)
  IF v_age_days >= v_force_archive_age THEN
    RETURN 'archived'::question_state;
  END IF;

  -- RULE 3: Check for resurrection (archived question coming back to life)
  IF v_archived_at IS NOT NULL AND v_allow_resurrection THEN
    IF v_archived_at > NOW() - (v_resurrection_max_age || ' days')::INTERVAL
       AND v_has_recent_update
       AND v_response_rate_24h >= v_active_threshold THEN
      RETURN 'active'::question_state;
    END IF;
  END IF;

  -- RULE 4: NEW state (first new_duration days)
  IF v_age_days < v_new_duration THEN
    RETURN 'new'::question_state;
  END IF;

  -- RULE 4b: No engagement data yet — question is newly past the 'new' window
  -- but has never been evaluated. Treat as active so it surfaces in the feed.
  IF NOT v_has_metrics_row AND v_age_days < v_active_max_age THEN
    RETURN 'active'::question_state;
  END IF;

  -- RULE 5: ACTIVE state (high engagement OR recent update)
  IF v_response_rate_24h >= v_active_threshold THEN
    RETURN 'active'::question_state;
  END IF;

  IF v_has_recent_update AND v_age_days < v_dormant_max_age THEN
    RETURN 'active'::question_state;
  END IF;

  -- RULE 6: DORMANT state (30-90 days with low engagement)
  IF v_age_days >= v_active_max_age AND v_age_days < v_dormant_max_age THEN
    RETURN 'dormant'::question_state;
  END IF;

  -- RULE 7: Young question → ACTIVE regardless of engagement level.
  -- Questions under active_max_age (30d) always deserve feed exposure.
  -- Zero responses means no data yet, not genuinely low engagement.
  IF v_age_days < v_active_max_age THEN
    RETURN 'active'::question_state;
  END IF;

  -- RULE 8: ARCHIVED (catch-all for old or inactive questions)
  IF v_age_days >= v_dormant_max_age THEN
    RETURN 'archived'::question_state;
  END IF;

  -- Default: DORMANT (transitional state)
  RETURN 'dormant'::question_state;

END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_question_trending_score(p_question_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_responses_total BIGINT;
  v_responses_24h BIGINT;
  v_responses_7d BIGINT;
  v_responses_prev_24h BIGINT;
  v_unique_users_24h BIGINT;
  v_unique_users_7d BIGINT;
  v_question_age_hours NUMERIC;
  
  v_velocity_score NUMERIC := 0;
  v_recency_score NUMERIC := 0;
  v_volume_score NUMERIC := 0;
  v_diversity_score NUMERIC := 0;
  v_trending_score NUMERIC := 0;
BEGIN
  -- Get question age in hours
  SELECT EXTRACT(EPOCH FROM (NOW() - published_at)) / 3600
  INTO v_question_age_hours
  FROM questions
  WHERE id = p_question_id;
  
  -- Don't score questions older than 30 days
  IF v_question_age_hours > 720 THEN
    RETURN 0;
  END IF;
  
  -- Count total responses
  SELECT COUNT(*)
  INTO v_responses_total
  FROM question_stances
  WHERE question_id = p_question_id;
  
  -- Count responses in last 24 hours
  SELECT COUNT(*)
  INTO v_responses_24h
  FROM question_stances
  WHERE question_id = p_question_id
    AND created_at >= NOW() - INTERVAL '24 hours';
  
  -- Count responses in last 7 days
  SELECT COUNT(*)
  INTO v_responses_7d
  FROM question_stances
  WHERE question_id = p_question_id
    AND created_at >= NOW() - INTERVAL '7 days';
  
  -- Count responses in previous 24 hours (for velocity)
  SELECT COUNT(*)
  INTO v_responses_prev_24h
  FROM question_stances
  WHERE question_id = p_question_id
    AND created_at >= NOW() - INTERVAL '48 hours'
    AND created_at < NOW() - INTERVAL '24 hours';
  
  -- Count unique users in last 24 hours
  SELECT COUNT(DISTINCT user_id)
  INTO v_unique_users_24h
  FROM question_stances
  WHERE question_id = p_question_id
    AND created_at >= NOW() - INTERVAL '24 hours';
  
  -- Count unique users in last 7 days
  SELECT COUNT(DISTINCT user_id)
  INTO v_unique_users_7d
  FROM question_stances
  WHERE question_id = p_question_id
    AND created_at >= NOW() - INTERVAL '7 days';
  
  -- =============================================================================
  -- VELOCITY SCORE (0-100): Growth rate in last 24h vs previous 24h
  -- =============================================================================
  IF v_responses_prev_24h > 0 THEN
    -- Calculate percentage increase
    v_velocity_score := LEAST(100, (v_responses_24h::NUMERIC / v_responses_prev_24h - 1) * 100);
  ELSIF v_responses_24h >= 5 THEN
    -- New hot question (no previous data but good activity)
    v_velocity_score := 80;
  ELSIF v_responses_24h > 0 THEN
    v_velocity_score := v_responses_24h * 10;
  END IF;
  
  -- Ensure non-negative
  v_velocity_score := GREATEST(0, v_velocity_score);
  
  -- =============================================================================
  -- RECENCY SCORE (0-100): Time-decayed activity in last 7 days
  -- =============================================================================
  -- More recent responses weighted higher
  v_recency_score := LEAST(100, v_responses_24h * 20 + v_responses_7d * 2);
  
  -- =============================================================================
  -- VOLUME SCORE (0-100): Total engagement (capped)
  -- =============================================================================
  -- Logarithmic scale to prevent old popular questions from dominating
  v_volume_score := LEAST(100, 10 * LN(GREATEST(1, v_responses_total)));
  
  -- =============================================================================
  -- DIVERSITY SCORE (0-100): Unique user participation
  -- =============================================================================
  -- Higher score if more diverse participation
  IF v_responses_24h > 0 THEN
    v_diversity_score := LEAST(100, (v_unique_users_24h::NUMERIC / GREATEST(1, v_responses_24h)) * 100);
  END IF;
  
  -- =============================================================================
  -- FINAL TRENDING SCORE: Weighted combination
  -- =============================================================================
  v_trending_score := 
    (v_velocity_score * 0.40) +    -- 40% - Growth rate
    (v_recency_score * 0.35) +     -- 35% - Recent activity
    (v_volume_score * 0.15) +      -- 15% - Total engagement
    (v_diversity_score * 0.10);    -- 10% - User diversity
  
  -- Store metrics for debugging/analysis
  INSERT INTO question_trending_metrics (
    question_id,
    responses_total,
    responses_24h,
    responses_7d,
    responses_prev_24h,
    unique_users_24h,
    unique_users_7d,
    velocity_score,
    recency_score,
    volume_score,
    diversity_score,
    trending_score,
    last_calculated_at
  ) VALUES (
    p_question_id,
    v_responses_total,
    v_responses_24h,
    v_responses_7d,
    v_responses_prev_24h,
    v_unique_users_24h,
    v_unique_users_7d,
    v_velocity_score,
    v_recency_score,
    v_volume_score,
    v_diversity_score,
    v_trending_score,
    NOW()
  )
  ON CONFLICT (question_id) 
  DO UPDATE SET
    responses_total = EXCLUDED.responses_total,
    responses_24h = EXCLUDED.responses_24h,
    responses_7d = EXCLUDED.responses_7d,
    responses_prev_24h = EXCLUDED.responses_prev_24h,
    unique_users_24h = EXCLUDED.unique_users_24h,
    unique_users_7d = EXCLUDED.unique_users_7d,
    velocity_score = EXCLUDED.velocity_score,
    recency_score = EXCLUDED.recency_score,
    volume_score = EXCLUDED.volume_score,
    diversity_score = EXCLUDED.diversity_score,
    trending_score = EXCLUDED.trending_score,
    last_calculated_at = NOW();
  
  RETURN v_trending_score;
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_topic_trending_score(p_topic_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_score numeric;
BEGIN
  SELECT 
    -- Questions in last 24h (heavily weighted for breaking news)
    COALESCE(
      (COUNT(*) FILTER (WHERE q.published_at > NOW() - INTERVAL '24 hours') * 50.0),
      0.0
    ) +
    
    -- Responses in last 24h (active engagement indicator)
    COALESCE(
      (COUNT(qs.*) FILTER (WHERE qs.created_at > NOW() - INTERVAL '24 hours') * 2.0),
      0.0
    ) +
    
    -- Questions in last 7 days (recent relevance)
    COALESCE(
      (COUNT(*) FILTER (WHERE q.published_at > NOW() - INTERVAL '7 days') * 10.0),
      0.0
    ) +
    
    -- Total engagement (historical popularity, low weight)
    COALESCE(
      (COUNT(qs.*) * 0.1),
      0.0
    )
  INTO v_score
  FROM questions q
  LEFT JOIN question_stances qs ON qs.question_id = q.id
  WHERE q.topic_id = p_topic_id
    AND q.status = 'active';
    
  RETURN COALESCE(v_score, 0);
END;
$function$;
CREATE OR REPLACE FUNCTION public.can_show_acknowledgement(p_user_id uuid, p_cooldown_days integer DEFAULT 7)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 
    FROM public.contribution_acknowledgements
    WHERE user_id = p_user_id
      AND shown_at > now() - (p_cooldown_days || ' days')::interval
      AND dismissed_at IS NULL
  );
$function$;
CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.deletion_requests
  SET status       = 'cancelled',
      cancelled_at = now()
  WHERE user_id = v_uid
    AND status  = 'pending';

  RETURN FOUND;
END;
$function$;
CREATE OR REPLACE FUNCTION public.cfg_username_changes_per_30d()
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$ select 2::int $function$;
CREATE OR REPLACE FUNCTION public.check_duplicate_question_deterministic(p_question text, p_topic_id uuid DEFAULT NULL::uuid, p_window_days integer DEFAULT 14)
 RETURNS TABLE(is_duplicate boolean, existing_question_id uuid, existing_question text, dedup_key text, dedup_bucket text, match_type text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_dedup_key TEXT;
  v_dedup_bucket TEXT;
  v_existing_id UUID;
  v_existing_text TEXT;
  v_window_start TIMESTAMPTZ;
BEGIN
  -- Generate dedup key and bucket
  v_dedup_key := generate_dedup_key(p_question, p_topic_id);
  v_dedup_bucket := generate_dedup_bucket(NOW(), p_window_days);
  
  -- Calculate time window start
  v_window_start := NOW() - (p_window_days || ' days')::INTERVAL;
  
  -- Check for exact match in time window
  SELECT q.id, q.question
  INTO v_existing_id, v_existing_text
  FROM questions q
  WHERE q.dedup_key = v_dedup_key
    AND q.dedup_bucket = v_dedup_bucket
    AND q.published_at >= v_window_start
    AND q.state IN ('new', 'active', 'dormant')  -- Not archived
  LIMIT 1;
  
  IF FOUND THEN
    RETURN QUERY 
    SELECT true, v_existing_id, v_existing_text, v_dedup_key, v_dedup_bucket, 'exact_match_in_window'::TEXT;
    RETURN;
  END IF;
  
  -- No duplicate found
  RETURN QUERY 
  SELECT false, NULL::UUID, NULL::TEXT, v_dedup_key, v_dedup_bucket, 'unique'::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.check_election_email_verified(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_email_confirmed_at  timestamptz;
  v_is_verified         boolean;
BEGIN
  -- Check Supabase auth.users for email_confirmed_at
  SELECT email_confirmed_at
  INTO v_email_confirmed_at
  FROM auth.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'USER_NOT_FOUND');
  END IF;

  v_is_verified := v_email_confirmed_at IS NOT NULL;

  IF NOT v_is_verified THEN
    RETURN jsonb_build_object(
      'verified',  false,
      'reason',    'EMAIL_NOT_VERIFIED',
      'message',   'Email verification is required to participate in election stance capture. Please verify your email address in Settings.'
    );
  END IF;

  RETURN jsonb_build_object('verified', true);
END;
$function$;
CREATE OR REPLACE FUNCTION public.check_election_silence(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_election_id           uuid;
  v_state                 text;
  v_silence_start         timestamptz;
  v_polling_start         timestamptz;
  v_polling_end           timestamptz;
  v_tier_code             text;
  v_user_id               uuid;
  v_email_confirmed_at    timestamptz;
BEGIN
  -- Get calling user
  v_user_id := auth.uid();

  -- ── Email verification gate (EL-IN-012, EL-QA-032) ──────────────────────
  -- Only enforce for authenticated users attempting election questions
  IF v_user_id IS NOT NULL THEN
    SELECT email_confirmed_at
    INTO v_email_confirmed_at
    FROM auth.users
    WHERE id = v_user_id;

    IF v_email_confirmed_at IS NULL THEN
      RETURN jsonb_build_object(
        'allowed',   false,
        'reason',    'EMAIL_NOT_VERIFIED',
        'http_code', 403,
        'message',   'Email verification is required to participate in election stance capture. Please verify your email in Settings → Account.'
      );
    END IF;
  END IF;

  -- ── Fast path: is this an election question? ─────────────────────────────
  SELECT election_id
  INTO v_election_id
  FROM public.questions
  WHERE id = p_question_id
    AND is_election_question = true;

  IF NOT FOUND OR v_election_id IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'NOT_ELECTION_QUESTION');
  END IF;

  -- ── Get election state ────────────────────────────────────────────────────
  SELECT state, silence_start_at, polling_start_at, polling_end_at, tier_code
  INTO v_state, v_silence_start, v_polling_start, v_polling_end, v_tier_code
  FROM public.elections
  WHERE id = v_election_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'ELECTION_NOT_FOUND');
  END IF;

  -- SILENCE state → HTTP 451
  IF v_state = 'SILENCE' THEN
    RETURN jsonb_build_object(
      'allowed',          false,
      'reason',           'SILENCE',
      'http_code',        451,
      'election_state',   v_state,
      'silence_start_at', v_silence_start,
      'polling_start_at', v_polling_start,
      'tier_code',        v_tier_code,
      'message',          'Stance submission is suspended during the electoral silence period (RPA 1951 §126/§126B). Submissions will reopen after polling closes.'
    );
  END IF;

  -- POLLING state → HTTP 451
  IF v_state = 'POLLING' THEN
    RETURN jsonb_build_object(
      'allowed',          false,
      'reason',           'POLLING_ACTIVE',
      'http_code',        451,
      'election_state',   v_state,
      'polling_start_at', v_polling_start,
      'polling_end_at',   v_polling_end,
      'tier_code',        v_tier_code,
      'message',          'Stance submission is suspended while polling is active.'
    );
  END IF;

  -- UPCOMING → 423 Locked
  IF v_state = 'UPCOMING' THEN
    RETURN jsonb_build_object(
      'allowed',        false,
      'reason',         'NOT_YET_ACTIVE',
      'http_code',      423,
      'election_state', v_state,
      'message',        'This election has not yet opened for stance submission.'
    );
  END IF;

  -- All other states: allow
  RETURN jsonb_build_object(
    'allowed',        true,
    'election_state', v_state,
    'reason',         'ACTIVE'
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.check_for_acknowledgement()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_can_show boolean;
  v_trigger_type text;
  v_message text;
  v_context jsonb;
  v_topic_title text;
  v_region_label text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Check if user is eligible (hasn't seen one recently)
  v_can_show := public.can_show_acknowledgement(v_uid, 7);
  
  if NOT v_can_show then
    return jsonb_build_object(
      'should_show', false,
      'reason', 'cooldown_active'
    );
  end if;

  -- Get user's region
  select 
    case
      when city_label is not null then city_label
      when county_label is not null then county_label
      when state_label is not null then state_label
      when country_label is not null then country_label
      else 'your area'
    end
  into v_region_label
  from public.user_region_dimensions
  where user_id = v_uid;

  -- Check trigger 1: Early responder (among first 15 to answer a question)
  -- Look at user's most recent stance
  with recent_stance as (
    select 
      qs.id as stance_id,
      qs.question_id,
      qs.created_at,
      q.topic_id,
      t.title as topic_title
    from public.question_stances qs
    join public.questions q on q.id = qs.question_id
    left join public.topics t on t.id = q.topic_id
    where qs.user_id = v_uid
    order by qs.created_at desc
    limit 1
  ),
  response_rank as (
    select 
      rs.stance_id,
      rs.topic_title,
      row_number() over (order by qs.created_at) as rank,
      count(*) over () as total_responses
    from recent_stance rs
    join public.question_stances qs on qs.question_id = rs.question_id
    where qs.created_at <= rs.created_at + interval '5 minutes' -- within 5 min of user's response
  )
  select topic_title into v_topic_title
  from response_rank
  where stance_id = (select stance_id from recent_stance)
    and rank <= 15
    and total_responses >= 15;

  if v_topic_title is not null then
    v_trigger_type := 'early_responder';
    v_message := format('Your response contributed to how %s is now trending in %s.', 
                        v_topic_title, v_region_label);
    v_context := jsonb_build_object(
      'topic_title', v_topic_title,
      'region', v_region_label
    );
    
    return jsonb_build_object(
      'should_show', true,
      'trigger_type', v_trigger_type,
      'message', v_message,
      'secondary_text', 'Thanks for taking part.',
      'context', v_context
    );
  end if;

  -- Check trigger 2: User's stance aligned with emerging trend
  -- Find topics where user answered early and topic later became active
  with user_early_topics as (
    select 
      q.topic_id,
      t.title as topic_title,
      min(qs.created_at) as user_answered_at
    from public.question_stances qs
    join public.questions q on q.id = qs.question_id
    left join public.topics t on t.id = q.topic_id
    where qs.user_id = v_uid
      and q.topic_id is not null
      and qs.created_at > now() - interval '30 days'
    group by q.topic_id, t.title
  ),
  topic_activity as (
    select 
      uet.topic_id,
      uet.topic_title,
      count(*) as recent_responses
    from user_early_topics uet
    join public.questions q on q.topic_id = uet.topic_id
    join public.question_stances qs on qs.question_id = q.id
    where qs.created_at > uet.user_answered_at + interval '7 days'
      and qs.created_at > now() - interval '14 days'
    group by uet.topic_id, uet.topic_title
    having count(*) >= 20 -- topic got at least 20 more responses
  )
  select topic_title into v_topic_title
  from topic_activity
  order by recent_responses desc
  limit 1;

  if v_topic_title is not null then
    v_trigger_type := 'trending_contribution';
    v_message := format('Your input helped shape how %s is discussed in %s.', 
                        v_topic_title, v_region_label);
    v_context := jsonb_build_object(
      'topic_title', v_topic_title,
      'region', v_region_label
    );
    
    return jsonb_build_object(
      'should_show', true,
      'trigger_type', v_trigger_type,
      'message', v_message,
      'secondary_text', 'Thanks for taking part.',
      'context', v_context
    );
  end if;

  -- Check trigger 3: User contributed to regional signal (answered 5+ questions on a topic)
  with user_topic_contributions as (
    select 
      q.topic_id,
      t.title as topic_title,
      count(*) as answers_count
    from public.question_stances qs
    join public.questions q on q.id = qs.question_id
    left join public.topics t on t.id = q.topic_id
    where qs.user_id = v_uid
      and q.topic_id is not null
      and qs.created_at > now() - interval '30 days'
    group by q.topic_id, t.title
    having count(*) >= 5
  )
  select topic_title into v_topic_title
  from user_topic_contributions
  order by answers_count desc
  limit 1;

  if v_topic_title is not null then
    v_trigger_type := 'region_signal';
    v_message := format('Your responses on %s contributed to %s''s overall signal.', 
                        v_topic_title, v_region_label);
    v_context := jsonb_build_object(
      'topic_title', v_topic_title,
      'region', v_region_label
    );
    
    return jsonb_build_object(
      'should_show', true,
      'trigger_type', v_trigger_type,
      'message', v_message,
      'secondary_text', 'Thanks for taking part.',
      'context', v_context
    );
  end if;

  -- No triggers met
  return jsonb_build_object(
    'should_show', false,
    'reason', 'no_trigger_met'
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.clear_my_dob()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.profiles
     SET dob_encrypted = NULL,
         dob_checked   = false,
         updated_at    = now()
   WHERE user_id = v_uid;
END;
$function$;
CREATE OR REPLACE FUNCTION public.column_exists(p_schema text, p_table text, p_column text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = p_schema
      and table_name   = p_table
      and column_name  = p_column
  );
$function$;
CREATE OR REPLACE FUNCTION public.compute_composite_score(p_topic_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_rec public.topic_impact_scores;
  v_composite numeric;
BEGIN
  PERFORM public._ensure_admin_or_service();

  SELECT *
  INTO v_rec
  FROM public.topic_impact_scores
  WHERE topic_id = p_topic_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No topic_impact_scores row found for topic_id=%', p_topic_id
      USING ERRCODE = 'NO_DATA_FOUND';
  END IF;

  -- Simple initial weighting; adjust as needed.
  v_composite :=
      0.40 * COALESCE(v_rec.impact_score,                0)
    + 0.20 * COALESCE(v_rec.stance_potential_score,      0)
    + 0.10 * COALESCE(v_rec.cluster_density_score,       0)
    + 0.15 * COALESCE(v_rec.region_relevance_score,      0)
    + 0.15 * COALESCE(v_rec.engagement_prediction_score, 0);

  UPDATE public.topic_impact_scores
  SET composite_score = v_composite,
      updated_at      = now()
  WHERE topic_id = p_topic_id;

  RETURN v_composite;
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_cron_job(p_jobname text, p_schedule text, p_command text)
 RETURNS TABLE(result_jobid bigint, result_success boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_new_jobid BIGINT;
BEGIN
  -- Validate inputs
  IF p_jobname IS NULL OR p_schedule IS NULL OR p_command IS NULL THEN
    RETURN QUERY SELECT NULL::BIGINT, false, 'Missing required parameters'::TEXT;
    RETURN;
  END IF;
  
  -- Create the job
  SELECT cron.schedule(p_jobname, p_schedule, p_command) INTO v_new_jobid;
  
  RETURN QUERY SELECT v_new_jobid, true, 'Job created successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::BIGINT, false, SQLERRM::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_cron_job_secure(p_jobname text, p_schedule text, p_command text)
 RETURNS TABLE(result_jobid bigint, result_success boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_new_jobid BIGINT;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Validate inputs
  IF p_jobname IS NULL OR p_schedule IS NULL OR p_command IS NULL THEN
    RETURN QUERY SELECT NULL::BIGINT, false, 'Missing required parameters'::TEXT;
    RETURN;
  END IF;
  
  -- Create the job
  SELECT cron.schedule(p_jobname, p_schedule, p_command) INTO v_new_jobid;
  
  RETURN QUERY SELECT v_new_jobid, true, 'Job created successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::BIGINT, false, SQLERRM::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_question_comment(p_question_id uuid, p_body text, p_parent_comment_id uuid DEFAULT NULL::uuid)
 RETURNS public.comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_user_id    uuid := auth.uid();
  v_comment    public.comments;
  v_random_id  text;
  v_username   text;
  v_mode       public.display_handle_mode_enum;
  v_display    text;
  v_depth      integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'Comment body is required';
  END IF;

  -- M-G04: depth check — only when replying to an existing comment
  IF p_parent_comment_id IS NOT NULL THEN
    WITH RECURSIVE ancestors AS (
      -- Base: the immediate parent
      SELECT id, parent_id, 1 AS depth
      FROM public.comments
      WHERE id = p_parent_comment_id

      UNION ALL

      -- Recurse: walk up one level at a time
      SELECT c.id, c.parent_id, a.depth + 1
      FROM public.comments c
      JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT COALESCE(MAX(depth), 0)
    INTO v_depth
    FROM ancestors;

    -- maxDepth = 3: the parent must be at depth ≤ 3 (1-indexed from the CTE).
    -- A parent at depth 3 means the new reply would be at depth 4 — reject.
    IF v_depth >= 3 THEN
      RAISE EXCEPTION 'Maximum reply depth reached';
    END IF;
  END IF;

  -- Look up profile to build a display label
  SELECT random_id, username, display_handle_mode
  INTO v_random_id, v_username, v_mode
  FROM public.profiles
  WHERE user_id = v_user_id;

  -- If no profile row (edge case), fall back to a generic label
  IF NOT FOUND THEN
    v_display := 'Someone';
  ELSE
    -- Decide what to show based on handle mode
    IF v_mode = 'username' AND v_username IS NOT NULL THEN
      v_display := v_username;
    ELSE
      v_display := v_random_id;
    END IF;
  END IF;

  INSERT INTO public.comments (
    topic_id,
    question_id,
    parent_id,
    user_id,
    user_display,
    body
  )
  VALUES (
    NULL,                -- topic_id (we're using question threads here)
    p_question_id,
    p_parent_comment_id,
    v_user_id,
    v_display,
    p_body
  )
  RETURNING * INTO v_comment;

  RETURN v_comment;
END;
$function$;
CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.comments
  SET
    is_deleted = true,
    body       = '',
    edited_at  = NULL
  WHERE
    id         = p_comment_id
    AND user_id    = v_uid
    AND is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comment not found or you do not have permission to delete it';
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.delete_cron_job(p_jobid bigint)
 RETURNS TABLE(result_success boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Check if job exists
  IF NOT EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobid = p_jobid) THEN
    RETURN QUERY SELECT false, 'Job not found'::TEXT;
    RETURN;
  END IF;
  
  -- Unschedule the job
  PERFORM cron.unschedule(p_jobid);
  
  RETURN QUERY SELECT true, 'Job deleted successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.delete_cron_job_secure(p_jobid bigint)
 RETURNS TABLE(result_success boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Check if job exists
  IF NOT EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobid = p_jobid) THEN
    RETURN QUERY SELECT false, 'Job not found'::TEXT;
    RETURN;
  END IF;
  
  -- Unschedule the job
  PERFORM cron.unschedule(p_jobid);
  
  RETURN QUERY SELECT true, 'Job deleted successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.disconnect_social_provider(p_provider public.social_provider)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_identity_count int;
  v_has_password   boolean;
BEGIN
  -- Count how many auth.identities this user has
  SELECT count(*) INTO v_identity_count
  FROM auth.identities
  WHERE user_id = auth.uid();

  -- Check if user has a password set (email provider identity)
  SELECT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE user_id = auth.uid()
    AND provider = 'email'
  ) INTO v_has_password;

  -- Block disconnect if this is their only auth method
  IF v_identity_count <= 1 AND NOT v_has_password THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot disconnect your only login method. Add a password or connect another provider first.'
    );
  END IF;

  DELETE FROM public.social_auth_tokens
  WHERE user_id = auth.uid()
  AND provider = p_provider;

  RETURN jsonb_build_object('success', true);
END;
$function$;
CREATE OR REPLACE FUNCTION public.dismiss_acknowledgement(p_ack_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  UPDATE public.contribution_acknowledgements
  SET dismissed_at = now()
  WHERE id = p_ack_id
    AND user_id = v_uid
    AND dismissed_at IS NULL;
end;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_username_change_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  allowed      int := 2;  -- max username changes per 30 days
  cutoff       timestamptz := now() - interval '30 days';
  change_count int;
BEGIN
  -- Only check when username is actually changing
  IF NEW.username IS NOT DISTINCT FROM OLD.username THEN
    RETURN NEW;
  END IF;

  -- Count recent changes in username_history for this user
  SELECT COUNT(*) INTO change_count
  FROM public.username_history
  WHERE user_id = NEW.user_id
    AND changed_at >= cutoff;

  IF change_count >= allowed THEN
    RAISE EXCEPTION 'username change limit reached — max % changes per 30 days', allowed;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.ensure_question_visibility(p_question_id uuid, p_visibility public.question_visibility_enum DEFAULT 'visible'::public.question_visibility_enum)
 RETURNS public.question_visibility_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_row public.question_visibility_rules;
BEGIN
  INSERT INTO public.question_visibility_rules AS qvr (
    question_id,
    visibility,
    reason,
    last_evaluated_at
  )
  VALUES (
    p_question_id,
    p_visibility,
    'ensure_question_visibility default',
    now()
  )
  ON CONFLICT (question_id) DO UPDATE
    SET visibility        = EXCLUDED.visibility,
        last_evaluated_at = EXCLUDED.last_evaluated_at
  RETURNING qvr.*
  INTO v_row;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.ensure_topic_for_topic_draft(p_topic_draft_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_topic_id       uuid;
  v_td             public.topic_drafts%rowtype;
  v_title          text;
  v_summary        text;
  v_tags           text[];
  v_location_label text;
  v_sources        jsonb;
  v_tier           text;
BEGIN
  IF p_topic_draft_id IS NULL THEN
    RAISE EXCEPTION 'topic_draft_id is required';
  END IF;

  -- If we already created a topic from this draft, reuse it.
  SELECT t.id
    INTO v_topic_id
  FROM public.topics t
  WHERE t.draft_id = p_topic_draft_id
  LIMIT 1;

  IF v_topic_id IS NOT NULL THEN
    RETURN v_topic_id;
  END IF;

  -- Load draft
  SELECT * INTO v_td
  FROM public.topic_drafts
  WHERE id = p_topic_draft_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'topic_draft not found: %', p_topic_draft_id;
  END IF;

  v_title          := v_td.title;
  v_summary        := v_td.summary;
  v_tags           := COALESCE(v_td.tags, '{}'::text[]);
  v_location_label := COALESCE(v_td.location_label, 'Global');
  v_tier           := 'global';
  v_sources        := public.build_topic_sources_from_news_item(v_td.news_item_id);

  -- Insert canonical topic — now includes parent_topic_id from LLM classification
  INSERT INTO public.topics (
    title,
    summary,
    tags,
    sources,
    lang,
    published_at,
    cluster_id,
    draft_id,
    tier,
    location_label,
    parent_topic_id   -- ← NEW: copy LLM classification through from draft
  )
  VALUES (
    v_title,
    v_summary,
    v_tags,
    v_sources,
    'en',
    NOW(),
    NULL,
    p_topic_draft_id,    -- IMPORTANT: topics.draft_id points to topic_drafts.id
    v_tier,
    v_location_label,
    v_td.parent_topic_id  -- NULL when LLM confidence < 0.75; admin assigns manually
  )
  RETURNING id INTO v_topic_id;

  RETURN v_topic_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.execute_pending_deletions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_rec         RECORD;
  v_deleted_ct  INTEGER := 0;
  v_error_ct    INTEGER := 0;
BEGIN
  FOR v_rec IN
    SELECT id, user_id
    FROM public.deletion_requests
    WHERE status      = 'pending'
      AND execute_after <= now()
      AND cancelled_at  IS NULL
  LOOP
    BEGIN
      -- ── Wipe all user-linked public data ────────────────
      DELETE FROM public.question_stances      WHERE user_id = v_rec.user_id;
      DELETE FROM public.stance_history        WHERE user_id = v_rec.user_id;
      DELETE FROM public.question_comments     WHERE user_id = v_rec.user_id;
      DELETE FROM public.comment_reactions     WHERE user_id = v_rec.user_id;
      DELETE FROM public.comment_reports       WHERE user_id = v_rec.user_id;
      DELETE FROM public.user_topic_follows    WHERE user_id = v_rec.user_id;
      DELETE FROM public.user_location_settings WHERE user_id = v_rec.user_id;
      DELETE FROM public.notification_preferences WHERE user_id = v_rec.user_id;
      DELETE FROM public.notification_topic_prefs  WHERE user_id = v_rec.user_id;
      DELETE FROM public.user_notifications    WHERE user_id = v_rec.user_id;
      DELETE FROM public.user_privacy          WHERE user_id = v_rec.user_id;
      DELETE FROM public.user_cognitive_states WHERE user_id = v_rec.user_id;
      DELETE FROM public.cognitive_state_snapshots WHERE user_id = v_rec.user_id;
      DELETE FROM public.contribution_acknowledgements WHERE user_id = v_rec.user_id;
      DELETE FROM public.social_auth_tokens    WHERE user_id = v_rec.user_id;
      DELETE FROM public.share_events          WHERE shared_by_user_id = v_rec.user_id;
      DELETE FROM public.consent_logs          WHERE user_id = v_rec.user_id;
      DELETE FROM public.profiles              WHERE user_id = v_rec.user_id;

      -- ── Mark deletion as executed ────────────────────────
      UPDATE public.deletion_requests
      SET status       = 'executed',
          executed_at  = now()
      WHERE id = v_rec.id;

      -- ── Delete the Supabase Auth user ────────────────────
      -- Note: requires service_role; call via Edge Function or
      -- admin API if pg cannot reach auth schema directly.
      -- Uncomment if auth schema is accessible:
      -- DELETE FROM auth.users WHERE id = v_rec.user_id;

      v_deleted_ct := v_deleted_ct + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue processing remaining users
      RAISE WARNING 'execute_pending_deletions: failed for user % — %',
        v_rec.user_id, SQLERRM;
      v_error_ct := v_error_ct + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'executed', v_deleted_ct,
    'errors',   v_error_ct,
    'run_at',   now()
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.extract_image_from_payload(p_payload jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
  SELECT COALESCE(
    NULLIF(TRIM(p_payload->>'image'), ''),
    NULLIF(TRIM(p_payload->>'image_url'), ''),
    NULLIF(TRIM(p_payload->>'thumbnail'), ''),
    NULLIF(TRIM(p_payload->>'thumbnail_url'), ''),
    NULLIF(TRIM(p_payload->>'lead_image_url'), ''),
    NULLIF(TRIM(p_payload->>'og:image'), ''),
    NULLIF(TRIM(p_payload->>'twitter:image'), ''),
    NULLIF(TRIM(p_payload->'meta'->>'og:image'), ''),
    NULLIF(TRIM(p_payload->'meta'->>'twitter:image'), ''),
    NULLIF(TRIM(p_payload->'og'->>'image'), ''),
    NULLIF(TRIM(p_payload->'scraped'->>'lead_image_url'), ''),
    NULLIF(TRIM(p_payload->'scraped'->>'og_image'), ''),
    NULLIF(TRIM(p_payload->'media'->>'url'), ''),
    NULLIF(TRIM(p_payload->>'enclosure_url'), '')
  )
$function$;
CREATE OR REPLACE FUNCTION public.extract_named_entities(p_text text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_entities TEXT[];
  v_countries TEXT[];
  v_politicians TEXT[];
  v_orgs TEXT[];
BEGIN
  v_entities := ARRAY[]::TEXT[];
  
  -- Extract country names (simple list)
  v_countries := ARRAY(
    SELECT DISTINCT match[1]
    FROM regexp_matches(
      p_text, 
      '\b(United States|USA|US|China|Russia|India|Japan|UK|France|Germany|Canada|Mexico|Brazil)\b',
      'gi'
    ) AS match
  );
  
  -- Extract organization patterns
  v_orgs := ARRAY(
    SELECT DISTINCT match[1]
    FROM regexp_matches(
      p_text,
      '\b(Congress|Senate|House|White House|Supreme Court|NATO|UN|EU|WHO|FBI|CIA)\b',
      'gi'
    ) AS match
  );
  
  -- Combine all entities
  v_entities := v_countries || v_orgs;
  
  RETURN v_entities;
END;
$function$;
create or replace view "public"."feed_topics_v" as  SELECT id,
    title,
    summary,
    tags,
    sources,
    lang,
    published_at
   FROM public.topics t
  WHERE (published_at <= now());
CREATE OR REPLACE FUNCTION public.find_related_questions_lightweight(p_question_id uuid, p_min_score numeric DEFAULT 0.3, p_limit integer DEFAULT 10)
 RETURNS TABLE(related_question_id uuid, related_question text, link_type text, score numeric, method text, tags text[], state text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_source_question TEXT;
  v_source_tags TEXT[];
  v_source_entities TEXT[];
  v_source_published TIMESTAMPTZ;
BEGIN
  -- Get source question data
  SELECT q.question, q.tags, q.published_at
  INTO v_source_question, v_source_tags, v_source_published
  FROM questions q
  WHERE q.id = p_question_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Extract entities from source
  v_source_entities := extract_named_entities(v_source_question);
  
  RETURN QUERY
  WITH candidate_questions AS (
    SELECT 
      q.id,
      q.question,
      q.tags,
      q.state,
      q.published_at,
      
      -- Calculate Jaccard similarity
      calculate_jaccard_similarity(v_source_question, q.question) as jaccard_score,
      
      -- Calculate tag overlap (if both have tags)
      CASE 
        WHEN v_source_tags IS NOT NULL AND q.tags IS NOT NULL THEN
          (
            SELECT COUNT(*)::NUMERIC FROM unnest(v_source_tags) t1 
            WHERE t1 = ANY(q.tags)
          ) / 
          GREATEST(array_length(v_source_tags, 1), array_length(q.tags, 1))
        ELSE 0
      END as tag_overlap,
      
      -- Calculate entity overlap
      calculate_entity_overlap(
        v_source_entities,
        extract_named_entities(q.question)
      ) as entity_overlap,
      
      -- Time proximity (questions published around same time)
      CASE 
        WHEN ABS(EXTRACT(EPOCH FROM (q.published_at - v_source_published))) < 86400 THEN 0.3  -- Same day
        WHEN ABS(EXTRACT(EPOCH FROM (q.published_at - v_source_published))) < 7 * 86400 THEN 0.2  -- Same week
        WHEN ABS(EXTRACT(EPOCH FROM (q.published_at - v_source_published))) < 30 * 86400 THEN 0.1  -- Same month
        ELSE 0
      END as time_proximity
      
    FROM questions q
    WHERE q.id != p_question_id
      AND q.state IN ('new', 'active', 'dormant')
  ),
  scored_questions AS (
    SELECT 
      cq.*,
      -- Weighted combination
      (cq.jaccard_score * 0.4) +
      (cq.tag_overlap * 0.3) +
      (cq.entity_overlap * 0.2) +
      (cq.time_proximity * 0.1) as combined_score,
      
      -- Determine link type
      CASE 
        WHEN cq.entity_overlap > 0.5 AND cq.time_proximity > 0.2 THEN 'same_event_different_angle'
        WHEN cq.time_proximity > 0.2 AND cq.published_at > v_source_published THEN 'follow_up'
        WHEN cq.jaccard_score > 0.6 THEN 'related'
        ELSE 'related'
      END as suggested_link_type,
      
      -- Determine method used
      CASE 
        WHEN cq.entity_overlap > 0 THEN 'entities_jaccard'
        ELSE 'jaccard'
      END as detection_method
      
    FROM candidate_questions cq
    WHERE 
      -- At least some similarity from any method
      cq.jaccard_score > 0.2 OR
      cq.tag_overlap > 0.2 OR
      cq.entity_overlap > 0.2
  )
  SELECT 
    sq.id,
    sq.question,
    sq.suggested_link_type,
    sq.combined_score,
    sq.detection_method,
    sq.tags,
    sq.state
  FROM scored_questions sq
  WHERE sq.combined_score >= p_min_score
  ORDER BY sq.combined_score DESC
  LIMIT p_limit;
END;
$function$;
CREATE OR REPLACE FUNCTION public.flag_anomalous_stances(p_stance_ids uuid[], p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count       integer;
  v_question_id uuid;
BEGIN
  UPDATE public.question_stances
  SET
    is_flagged   = true,
    flagged_at   = now(),
    flag_reason  = p_reason
  WHERE id = ANY(p_stance_ids)
    AND is_flagged = false;  -- Idempotent

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Re-aggregate affected questions
  FOR v_question_id IN
    SELECT DISTINCT question_id
    FROM public.question_stances
    WHERE id = ANY(p_stance_ids)
  LOOP
    PERFORM public.refresh_election_stance_aggregates(v_question_id);
  END LOOP;

  RETURN v_count;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_election_candidates_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_election_compliance_rules_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();

  -- Auto-stamp approved_at when approved_by is set
  IF NEW.approved_by IS NOT NULL AND OLD.approved_by IS NULL THEN
    NEW.approved_at := now();
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_election_parties_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.fn_election_party_elections_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.fn_election_party_regions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.fn_elections_insert_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.state NOT IN ('UPCOMING') AND NEW.legal_review_completed = false THEN
    RAISE EXCEPTION
      'EL-F-006: Cannot create election in state % without legal_review_completed=true.',
      NEW.state;
  END IF;

  -- Auto-stamp snap flag from subtype
  IF NEW.election_subtype = 'SNAP' THEN
    NEW.is_snap := true;
  END IF;

  -- Cache tier_code and country from election_tiers if not supplied
  -- (belt-and-suspenders — admin wizard will supply these directly)
  IF NEW.tier_code IS NULL OR NEW.country IS NULL THEN
    SELECT et.tier_code, et.country
    INTO NEW.tier_code, NEW.country
    FROM public.election_tiers et
    WHERE et.id = NEW.tier_id;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_elections_legal_review_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Only fires on state transitions
  IF OLD.state = NEW.state THEN
    RETURN NEW;
  END IF;

  -- States that require legal review to have been completed
  IF NEW.state IN (
    'CAMPAIGN_ACTIVE',
    'MCC_ACTIVE',
    'SILENCE',
    'POLLING',
    'COUNTING'
  ) THEN
    IF NEW.legal_review_completed = false THEN
      RAISE EXCEPTION
        'EL-F-006: Election cannot transition to % without legal_review_completed=true. '
        'Election id=%, name=%',
        NEW.state, NEW.id, NEW.name;
    END IF;
  END IF;

  -- Auto-stamp state change time
  NEW.state_changed_at := now();

  -- Auto-stamp legal review completion time if just set
  IF NEW.legal_review_completed = true AND OLD.legal_review_completed = false THEN
    NEW.legal_review_completed_at := now();
  END IF;

  -- Auto-stamp updated_at
  NEW.updated_at := now();

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_elections_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_ensure_audience_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Normalize any label that was explicitly set before insert
  IF NEW.audience_location_label IS NOT NULL THEN
    NEW.audience_location_label := public.normalize_audience_location_label(NEW.audience_location_label);
  END IF;

  -- If still null after normalization (or was null to begin with), infer it
  IF NEW.published_at IS NOT NULL AND NEW.audience_location_label IS NULL AND NEW.status = 'active' THEN
    SELECT audience_label, reason
    INTO NEW.audience_location_label, NEW.audience_reason
    FROM public.infer_audience_location(
      NEW.question, NEW.summary, NEW.tags, NEW.location_label
    ) LIMIT 1;
    NEW.origin_location_label := COALESCE(NEW.origin_location_label, NEW.location_label);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_ensure_audience_on_publish()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Normalize any label already set on the row
  IF NEW.audience_location_label IS NOT NULL THEN
    NEW.audience_location_label := public.normalize_audience_location_label(NEW.audience_location_label);
  END IF;

  -- Only infer if published_at is being set for the first time and label is still null
  IF NEW.published_at IS NOT NULL
     AND OLD.published_at IS NULL
     AND NEW.audience_location_label IS NULL
     AND NEW.status = 'active'
  THEN
    SELECT audience_label, reason
    INTO NEW.audience_location_label, NEW.audience_reason
    FROM public.infer_audience_location(
      NEW.question, NEW.summary, NEW.tags, NEW.location_label
    )
    LIMIT 1;
    NEW.origin_location_label := COALESCE(
      NEW.origin_location_label, NEW.location_label
    );
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_eqd_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IN ('APPROVED','REJECTED') AND OLD.status = 'DRAFT' THEN
    NEW.reviewed_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_esd_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  -- Auto-compute total pipeline seconds on AI completion
  IF NEW.ai_processing_status = 'DONE'
     AND OLD.ai_processing_status != 'DONE'
     AND NEW.ingestion_started_at IS NOT NULL THEN
    NEW.total_pipeline_seconds := EXTRACT(
      EPOCH FROM (now() - NEW.ingestion_started_at)
    )::integer;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_party_alliance_members_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $function$;
CREATE OR REPLACE FUNCTION public.fn_trigger_election_aggregate_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Only fire for election questions (cheap check on cached column)
  PERFORM public.refresh_election_stance_aggregates(NEW.question_id);
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.follow_topic(p_user_id uuid, p_topic_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.user_follows (user_id, follow_type, follow_id)
  VALUES (p_user_id, 'topic', p_topic_id)
  ON CONFLICT (user_id, follow_type, follow_id) DO NOTHING;
END;
$function$;
CREATE OR REPLACE FUNCTION public.generate_dedup_bucket(p_timestamp timestamp with time zone DEFAULT now(), p_window_days integer DEFAULT 14)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  -- Format: "YYYY-MM week N" or "YYYY-MM-DD" depending on window
  
  IF p_window_days >= 7 THEN
    -- Weekly buckets for 7+ day windows
    RETURN to_char(p_timestamp, 'YYYY-MM "week" IW');
  ELSE
    -- Daily buckets for shorter windows
    RETURN to_char(p_timestamp, 'YYYY-MM-DD');
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.generate_dedup_key(p_question text, p_topic_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_normalized TEXT;
  v_key_input TEXT;
BEGIN
  v_normalized := normalize_question_text(p_question);
  
  IF p_topic_id IS NOT NULL THEN
    v_key_input := p_topic_id::TEXT || '||' || v_normalized;
  ELSE
    v_key_input := v_normalized;
  END IF;
  
  -- FIX: Use extensions.digest() instead of just digest()
  RETURN encode(extensions.digest(v_key_input, 'sha256'), 'hex');
END;
$function$;
CREATE OR REPLACE FUNCTION public.generate_random_id()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  raw text;
begin
  raw := replace(replace(encode(extensions.gen_random_bytes(10), 'base64'), '/', ''), '+', '');
  return lower(substr(raw, 1, 10));
end $function$;
CREATE OR REPLACE FUNCTION public.generate_realistic_impact_scores()
 RETURNS TABLE(impact_score numeric, stance_potential_score numeric, cluster_density_score numeric, region_relevance_score numeric, engagement_prediction_score numeric, composite_score numeric, explanation text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  base_impact NUMERIC;
  base_stance NUMERIC;
  base_cluster NUMERIC;
  base_region NUMERIC;
  base_engagement NUMERIC;
BEGIN
  -- Generate random but realistic scores (1-10 scale)
  base_impact := 4.0 + (random() * 6.0); -- Range: 4.0 to 10.0
  base_stance := 3.0 + (random() * 7.0); -- Range: 3.0 to 10.0
  base_cluster := 2.0 + (random() * 8.0); -- Range: 2.0 to 10.0
  base_region := 3.0 + (random() * 7.0); -- Range: 3.0 to 10.0
  base_engagement := 3.0 + (random() * 7.0); -- Range: 3.0 to 10.0
  
  -- Round to 1 decimal place
  impact_score := ROUND(base_impact::numeric, 1);
  stance_potential_score := ROUND(base_stance::numeric, 1);
  cluster_density_score := ROUND(base_cluster::numeric, 1);
  region_relevance_score := ROUND(base_region::numeric, 1);
  engagement_prediction_score := ROUND(base_engagement::numeric, 1);
  
  -- Calculate composite score (weighted average)
  -- Weights: impact=30%, stance=25%, cluster=15%, region=15%, engagement=15%
  composite_score := ROUND(
    (impact_score * 0.30 + 
     stance_potential_score * 0.25 + 
     cluster_density_score * 0.15 + 
     region_relevance_score * 0.15 + 
     engagement_prediction_score * 0.15)::numeric, 
    1
  );
  
  -- Generate explanation based on composite score
  IF composite_score >= 8.0 THEN
    explanation := 'High-impact topic with strong debate potential and broad regional relevance. Excellent candidate for featured content.';
  ELSIF composite_score >= 7.0 THEN
    explanation := 'Solid topic with good stance potential. Should be included in curated feed.';
  ELSIF composite_score >= 6.0 THEN
    explanation := 'Moderate impact topic. May be relevant to specific regional audiences.';
  ELSIF composite_score >= 5.0 THEN
    explanation := 'Lower impact topic. Consider for supplemental content only.';
  ELSE
    explanation := 'Low impact topic with limited debate potential. Recommend suppression.';
  END IF;
  
  RETURN NEXT;
END;
$function$;
create or replace view "public"."geo_cities_v" as  SELECT l.id,
    l.name,
        CASE
            WHEN (p.type = 'state'::public.location_tier_enum) THEN p.iso_code
            WHEN (p.type = 'county'::public.location_tier_enum) THEN gp.iso_code
            ELSE NULL::text
        END AS state_code,
        CASE
            WHEN (p.type = 'county'::public.location_tier_enum) THEN p.iso_code
            ELSE NULL::text
        END AS county_code
   FROM ((public.locations l
     JOIN public.locations p ON ((p.id = l.parent_id)))
     LEFT JOIN public.locations gp ON ((gp.id = p.parent_id)))
  WHERE (l.type = 'city'::public.location_tier_enum)
  ORDER BY l.name;
create or replace view "public"."geo_counties_v" as  SELECT l.iso_code AS code,
    l.name,
    p.iso_code AS state_code
   FROM (public.locations l
     JOIN public.locations p ON ((p.id = l.parent_id)))
  WHERE ((l.type = 'county'::public.location_tier_enum) AND (l.iso_code IS NOT NULL))
  ORDER BY l.name;
create or replace view "public"."geo_countries_v" as  SELECT iso_code AS code,
    name
   FROM public.locations
  WHERE ((type = 'country'::public.location_tier_enum) AND (iso_code IS NOT NULL))
  ORDER BY name;
create or replace view "public"."geo_states_v" as  SELECT l.iso_code AS code,
    l.name,
    p.iso_code AS country_code
   FROM (public.locations l
     JOIN public.locations p ON ((p.id = l.parent_id)))
  WHERE ((l.type = 'state'::public.location_tier_enum) AND (l.iso_code IS NOT NULL))
  ORDER BY l.name;
CREATE OR REPLACE FUNCTION public.get_active_compliance_rules(p_election_id uuid)
 RETURNS TABLE(id uuid, rule_type text, silence_hours integer, override_start_at timestamp with time zone, exit_poll_gate_minutes integer, disclaimer_text text, legal_citation text, notes text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    r.id,
    r.rule_type,
    r.silence_hours,
    r.override_start_at,
    r.exit_poll_gate_minutes,
    r.disclaimer_text,
    r.legal_citation,
    r.notes
  FROM public.election_compliance_rules r
  WHERE r.election_id = p_election_id
    AND r.is_active = true
  ORDER BY r.rule_type, r.created_at;
$function$;
CREATE OR REPLACE FUNCTION public.get_all_cron_jobs()
 RETURNS TABLE(jobid bigint, schedule text, command text, nodename text, nodeport integer, database text, username text, active boolean, jobname text)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT 
    jobid,
    schedule,
    command,
    nodename,
    nodeport,
    database,
    username,
    active,
    jobname
  FROM cron.job
  ORDER BY jobid;
$function$;
CREATE OR REPLACE FUNCTION public.get_all_cron_jobs_secure()
 RETURNS TABLE(jobid bigint, schedule text, command text, nodename text, nodeport integer, database text, username text, active boolean, jobname text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Return jobs
  RETURN QUERY
  SELECT 
    cj.jobid,
    cj.schedule,
    cj.command,
    cj.nodename,
    cj.nodeport,
    cj.database,
    cj.username,
    cj.active,
    cj.jobname
  FROM cron.job cj
  ORDER BY cj.jobid;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_alliance_members(p_alliance_id uuid, p_state_code text DEFAULT NULL::text)
 RETURNS TABLE(member_party_id uuid, name text, abbreviation text, name_local text, brand_colour text, logo_path text, symbol_path text, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    p.id,
    p.name,
    p.abbreviation,
    p.name_local,
    p.brand_colour,
    p.logo_path,
    p.symbol_path,
    am.role
  FROM public.party_alliance_members am
  JOIN public.election_parties p ON p.id = am.member_party_id
  WHERE am.alliance_party_id = p_alliance_id
    AND am.valid_to IS NULL
    AND (p_state_code IS NULL OR am.state_code IS NULL OR am.state_code = p_state_code)
  ORDER BY am.role, p.name;
$function$;
CREATE OR REPLACE FUNCTION public.get_anomaly_summary(p_election_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, election_id uuid, question_id uuid, anomaly_type text, severity text, user_id uuid, evidence jsonb, affected_count integer, reviewed boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    e.id,
    e.election_id,
    e.question_id,
    e.anomaly_type,
    e.severity,
    e.user_id,
    e.evidence,
    COALESCE(array_length(e.affected_stance_ids, 1), 0) AS affected_count,
    e.reviewed,
    e.created_at
  FROM public.election_anomaly_events e
  WHERE (p_election_id IS NULL OR e.election_id = p_election_id)
    AND e.reviewed = false
  ORDER BY
    CASE e.severity
      WHEN 'CRITICAL' THEN 1
      WHEN 'HIGH'     THEN 2
      WHEN 'MEDIUM'   THEN 3
      ELSE 4
    END,
    e.created_at DESC
  LIMIT 100;
$function$;
CREATE OR REPLACE FUNCTION public.get_because_you_engaged(p_region text DEFAULT 'Global'::text, p_limit integer DEFAULT 6)
 RETURNS TABLE(question_id uuid, question_text text, topic_id uuid, topic_title text, reason text, rank_score numeric, generated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_current_user uuid;
BEGIN
    -- Get authenticated user
    v_current_user := auth.uid();
    IF v_current_user IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    
    RETURN QUERY
    WITH user_active_topics AS (
        -- Topics user has answered questions in (last 30 days)
        SELECT 
            q.topic_id,
            t.title as topic_title,
            COUNT(*) as user_activity_count
        FROM public.question_stances qs
        JOIN public.questions q ON q.id = qs.question_id
        JOIN public.topics t ON t.id = q.topic_id
        WHERE qs.user_id = v_current_user
            AND qs.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY q.topic_id, t.title
        ORDER BY COUNT(*) DESC
        LIMIT 10  -- Top 10 topics by user activity
    ),
    question_engagement_scores AS (
        -- Calculate engagement score for each active question
        SELECT 
            q.id as question_id,
            t.id as topic_id,
            -- Score based on recent activity
            COALESCE(
                (SELECT COUNT(*)::numeric 
                 FROM public.question_stances qs_count 
                 WHERE qs_count.question_id = q.id 
                 AND qs_count.created_at >= NOW() - INTERVAL '7 days'
                ), 
                0
            ) as recent_stances_7d,
            -- FIXED: Recency boost with null handling
            EXTRACT(EPOCH FROM (NOW() - COALESCE(q.published_at, q.created_at, NOW()))) / 86400.0 as days_old
        FROM public.questions q
        JOIN public.topics t ON t.id = q.topic_id
        WHERE q.status = 'active'
    ),
    unanswered_in_active_topics AS (
        -- Questions in those topics user hasn't answered yet
        -- FIXED: Added topic join and proper region filter
        SELECT 
            q.id as question_id,
            q.question as question_text,
            q.topic_id,
            uat.topic_title,
            'Based on your activity in ' || uat.topic_title as reason,
            -- Use calculated engagement score
            qes.recent_stances_7d - (qes.days_old * 0.1) as rank_score
        FROM public.questions q
        JOIN public.topics t ON t.id = q.topic_id
        JOIN user_active_topics uat ON uat.topic_id = q.topic_id
        JOIN question_engagement_scores qes ON qes.question_id = q.id
        WHERE NOT EXISTS (
            SELECT 1 
            FROM public.question_stances qs2 
            WHERE qs2.question_id = q.id 
                AND qs2.user_id = v_current_user
        )
        AND q.status = 'active'
        -- FIXED: Proper region filter with topic fallback
        AND CASE 
            WHEN p_region = 'United States' THEN 
                COALESCE(q.location_label, t.location_label) IN ('United States', 'Global')
                OR COALESCE(q.location_label, t.location_label) IS NULL
            WHEN p_region = 'Global' THEN 
                TRUE
            ELSE 
                COALESCE(q.location_label, t.location_label) = p_region
        END
    )
    SELECT 
        uiat.question_id,
        uiat.question_text,
        uiat.topic_id,
        uiat.topic_title,
        uiat.reason,
        uiat.rank_score,
        NOW() as generated_at
    FROM unanswered_in_active_topics uiat
    ORDER BY uiat.rank_score DESC
    LIMIT p_limit;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_canonical_topic_id(p_topic_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    case
      when t.parent_topic_id is null then t.id
      else t.parent_topic_id
    end as canonical_topic_id
  from public.topics t
  where t.id = p_topic_id;
$function$;
CREATE OR REPLACE FUNCTION public.get_comment_reactions(p_comment_ids uuid[])
 RETURNS TABLE(comment_id uuid, up_count bigint, down_count bigint, my_reaction text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    r.comment_id,
    COUNT(*) FILTER (WHERE r.reaction = 'up')   AS up_count,
    COUNT(*) FILTER (WHERE r.reaction = 'down')  AS down_count,
    MAX(r.reaction) FILTER (WHERE r.user_id = auth.uid()) AS my_reaction
  FROM public.comment_reactions r
  WHERE r.comment_id = ANY(p_comment_ids)
  GROUP BY r.comment_id;
$function$;
CREATE OR REPLACE FUNCTION public.get_community_pulse(p_region_scope text DEFAULT 'global'::text, p_region_key text DEFAULT 'global'::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(question_id uuid, question_text text, topic_title text, total_responses integer, pct_support numeric, pct_neutral numeric, pct_oppose numeric, avg_score numeric, updated_at timestamp with time zone, macro_total_responses bigint, macro_avg_support numeric, macro_avg_neutral numeric, macro_avg_oppose numeric, macro_avg_score numeric, macro_last_updated timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with regional_stats as (
    select
      r.question_id,
      r.total_responses,
      r.pct_agree    as pct_support,
      r.pct_neutral,
      r.pct_disagree as pct_oppose,
      r.avg_score,
      r.updated_at
    from public.question_stance_stats_region r
    where r.region_scope = p_region_scope
      and r.region_key   = p_region_key
      and r.total_responses > 0
    order by r.total_responses desc
    limit greatest(p_limit, 1)
  ),
  macro as (
    select
      sum(s.total_responses)::bigint                                          as macro_total,
      round(sum(coalesce(s.pct_support,0) * s.total_responses)
            / nullif(sum(s.total_responses),0), 2)                           as macro_support,
      round(sum(coalesce(s.pct_neutral,0) * s.total_responses)
            / nullif(sum(s.total_responses),0), 2)                           as macro_neutral,
      round(sum(coalesce(s.pct_oppose,0)  * s.total_responses)
            / nullif(sum(s.total_responses),0), 2)                           as macro_oppose,
      round(sum(coalesce(s.avg_score,0)   * s.total_responses)
            / nullif(sum(s.total_responses),0), 4)                           as macro_score,
      max(s.updated_at)                                                      as macro_updated
    from regional_stats s
  )
  select
    s.question_id,
    q.question                   as question_text,
    t.title                      as topic_title,
    s.total_responses,
    s.pct_support,
    s.pct_neutral,
    s.pct_oppose,
    s.avg_score,
    s.updated_at,
    m.macro_total                as macro_total_responses,
    m.macro_support              as macro_avg_support,
    m.macro_neutral              as macro_avg_neutral,
    m.macro_oppose               as macro_avg_oppose,
    m.macro_score                as macro_avg_score,
    m.macro_updated              as macro_last_updated
  from regional_stats s
  cross join macro m
  join public.questions q on q.id = s.question_id
  join public.topics    t on t.id = q.topic_id
  order by s.total_responses desc;
$function$;
CREATE OR REPLACE FUNCTION public.get_constituency_pulse(p_constituency_id uuid, p_election_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(issue_tag text, question_count bigint, total_responses bigint, avg_pct_support numeric, avg_pct_oppose numeric, avg_score numeric, avg_pct_switched numeric, constituency_name text, state_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    q.election_issue_tag                   AS issue_tag,
    COUNT(DISTINCT a.question_id)          AS question_count,
    SUM(a.total_responses)                 AS total_responses,
    ROUND(AVG(a.pct_support), 2)           AS avg_pct_support,
    ROUND(AVG(a.pct_oppose), 2)            AS avg_pct_oppose,
    ROUND(AVG(a.avg_score), 4)             AS avg_score,
    ROUND(AVG(a.pct_switched), 2)          AS avg_pct_switched,
    con.name                               AS constituency_name,
    a.state_code
  FROM public.election_stance_aggregates a
  JOIN public.questions q ON q.id = a.question_id
  JOIN public.election_constituencies con ON con.id = a.constituency_id
  WHERE a.constituency_id = p_constituency_id
    AND a.is_gated = false
    AND a.meets_minimum_threshold = true
    AND (p_election_id IS NULL OR a.election_id = p_election_id)
  GROUP BY q.election_issue_tag, con.name, a.state_code
  ORDER BY total_responses DESC;
$function$;
CREATE OR REPLACE FUNCTION public.get_cron_audit_logs(p_limit integer DEFAULT 50)
 RETURNS TABLE(id bigint, user_email text, action text, jobname text, details jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Check if user is admin
  IF NOT is_cron_admin() THEN
    RAISE EXCEPTION 'Permission denied: Admin access required';
  END IF;
  
  RETURN QUERY
  SELECT 
    al.id,
    au.email as user_email,
    al.action,
    al.record_id as jobname,
    al.details,
    al.created_at
  FROM admin.audit_log al
  LEFT JOIN auth.users au ON au.id = al.user_id
  WHERE al.action LIKE '%cron%'
  ORDER BY al.created_at DESC
  LIMIT p_limit;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_cron_job_history(p_jobid bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS TABLE(jobid bigint, runid bigint, job_pid integer, database text, username text, command text, status text, return_message text, start_time timestamp with time zone, end_time timestamp with time zone, duration interval)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT 
    jobid,
    runid,
    job_pid,
    database,
    username,
    command,
    status,
    return_message,
    start_time,
    end_time,
    end_time - start_time as duration
  FROM cron.job_run_details
  WHERE p_jobid IS NULL OR jobid = p_jobid
  ORDER BY start_time DESC
  LIMIT p_limit;
$function$;
CREATE OR REPLACE FUNCTION public.get_cron_job_history_secure(p_jobid bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50)
 RETURNS TABLE(jobid bigint, runid bigint, job_pid integer, database text, username text, command text, status text, return_message text, start_time timestamp with time zone, end_time timestamp with time zone, duration interval)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  RETURN QUERY
  SELECT 
    jrd.jobid,
    jrd.runid,
    jrd.job_pid,
    jrd.database,
    jrd.username,
    jrd.command,
    jrd.status,
    jrd.return_message,
    jrd.start_time,
    jrd.end_time,
    jrd.end_time - jrd.start_time as duration
  FROM cron.job_run_details jrd
  WHERE p_jobid IS NULL OR jrd.jobid = p_jobid
  ORDER BY jrd.start_time DESC
  LIMIT p_limit;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_cron_job_stats(p_jobid bigint)
 RETURNS TABLE(jobid bigint, total_runs bigint, successful_runs bigint, failed_runs bigint, avg_duration_seconds numeric, last_run_time timestamp with time zone, last_run_status text, next_run_estimate timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT 
    jrd.jobid,
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE status = 'succeeded') as successful_runs,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_runs,
    AVG(EXTRACT(EPOCH FROM (end_time - start_time)))::NUMERIC as avg_duration_seconds,
    MAX(start_time) as last_run_time,
    (SELECT status FROM cron.job_run_details WHERE jobid = p_jobid ORDER BY start_time DESC LIMIT 1) as last_run_status,
    NULL::TIMESTAMPTZ as next_run_estimate  -- Would need additional logic to calculate
  FROM cron.job_run_details jrd
  WHERE jrd.jobid = p_jobid
  GROUP BY jrd.jobid;
$function$;
CREATE OR REPLACE FUNCTION public.get_cron_job_stats_secure(p_jobid bigint)
 RETURNS TABLE(jobid bigint, total_runs bigint, successful_runs bigint, failed_runs bigint, avg_duration_seconds numeric, last_run_time timestamp with time zone, last_run_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  RETURN QUERY
  SELECT 
    jrd.jobid,
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE jrd.status = 'succeeded') as successful_runs,
    COUNT(*) FILTER (WHERE jrd.status = 'failed') as failed_runs,
    AVG(EXTRACT(EPOCH FROM (jrd.end_time - jrd.start_time)))::NUMERIC as avg_duration_seconds,
    MAX(jrd.start_time) as last_run_time,
    (SELECT status FROM cron.job_run_details WHERE jobid = p_jobid ORDER BY start_time DESC LIMIT 1) as last_run_status
  FROM cron.job_run_details jrd
  WHERE jrd.jobid = p_jobid
  GROUP BY jrd.jobid;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_curated_feed(p_user_id uuid, p_limit integer DEFAULT 7)
 RETURNS TABLE(date date, question_id uuid, row_index integer, question_text text, question_summary text, question_tags text[], question_location text, question_status text, question_published_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
BEGIN
  -- For now we ignore p_user_id and simply reuse Today’s Questions.
  -- Later we can factor in region preferences, blocklists, etc.
  RETURN QUERY
  SELECT *
  FROM public.get_today_questions(p_limit);
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_current_cognitive_state(p_user_id uuid)
 RETURNS public.user_cognitive_states
 LANGUAGE sql
 STABLE
AS $function$
    SELECT *
    FROM public.user_cognitive_states
    WHERE user_id = p_user_id
      AND state_status = 'current'
    ORDER BY evaluated_at DESC
    LIMIT 1;
$function$;
CREATE OR REPLACE FUNCTION public.get_daily_curated_questions(p_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(question_id uuid, question_text text, question_summary text, tags text[], composite_score numeric, source text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_has_curated BOOLEAN;
BEGIN
  -- Check if curated set exists for this date
  SELECT EXISTS(
    SELECT 1 FROM public.daily_curated_questions WHERE date = p_date
  ) INTO v_has_curated;
  
  IF v_has_curated THEN
    -- Return curated set
    RETURN QUERY
    SELECT 
      q.id as question_id,
      q.question as question_text,
      q.summary as question_summary,
      q.tags,
      tis.composite_score,
      'curated'::TEXT as source
    FROM public.daily_curated_questions dcq
    CROSS JOIN UNNEST(dcq.question_ids) as qid
    JOIN public.questions q ON q.id = qid
    LEFT JOIN public.topic_impact_scores tis ON tis.question_id = q.id
    WHERE dcq.date = p_date
    ORDER BY array_position(dcq.question_ids, q.id);
  ELSE
    -- Fallback: return top 7-10 questions by composite score
    RETURN QUERY
    SELECT 
      q.id as question_id,
      q.question as question_text,
      q.summary as question_summary,
      q.tags,
      tis.composite_score,
      'fallback'::TEXT as source
    FROM public.questions q
    JOIN public.topic_impact_scores tis ON tis.question_id = q.id
    JOIN public.question_visibility_rules qvr ON qvr.question_id = q.id
    WHERE q.status = 'active'
      AND qvr.visibility = 'visible'
      AND tis.composite_score >= 6.0
    ORDER BY tis.composite_score DESC
    LIMIT 10;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_demographic_breakdown(p_question_id uuid, p_dimension text DEFAULT 'gender'::text)
 RETURNS TABLE(dimension text, dimension_value text, total_responses integer, pct_support numeric, pct_neutral numeric, pct_oppose numeric, avg_score numeric, snapshot_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    d.dimension,
    d.dimension_value,
    d.total_responses,
    d.pct_support,
    d.pct_neutral,
    d.pct_oppose,
    d.avg_score,
    d.snapshot_date
  from public.demographic_breakdowns d
  where d.question_id = p_question_id
    and d.dimension   = p_dimension
    and d.snapshot_date = (
      select max(snapshot_date)
      from public.demographic_breakdowns
      where question_id = p_question_id
        and dimension   = p_dimension
    )
  order by d.total_responses desc;
$function$;
CREATE OR REPLACE FUNCTION public.get_document_pipeline_status(p_election_id uuid)
 RETURNS TABLE(id uuid, document_type text, party_name text, party_abbreviation text, candidate_name text, constituency_name text, detected_language text, ingestion_status text, translation_status text, ai_processing_status text, ai_question_drafts_count integer, total_pipeline_seconds integer, scope_region text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    d.id,
    d.document_type,
    p.name              AS party_name,
    p.abbreviation      AS party_abbreviation,
    c.full_name         AS candidate_name,
    con.name            AS constituency_name,
    d.detected_language,
    d.ingestion_status,
    d.translation_status,
    d.ai_processing_status,
    d.ai_question_drafts_count,
    d.total_pipeline_seconds,
    d.scope_region,
    d.created_at
  FROM public.election_source_documents d
  LEFT JOIN public.election_parties p     ON p.id = d.party_id
  LEFT JOIN public.election_candidates c  ON c.id = d.candidate_id
  LEFT JOIN public.election_constituencies con ON con.id = c.constituency_id
  WHERE d.election_id = p_election_id
    AND d.is_active = true
  ORDER BY d.created_at DESC;
$function$;
CREATE OR REPLACE FUNCTION public.get_election_community_pulse(p_election_id uuid, p_constituency_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(question_id uuid, question_text text, issue_tag text, party_abbreviation text, party_colour text, candidate_name text, constituency_name text, scope text, total_responses integer, pct_support numeric, pct_neutral numeric, pct_oppose numeric, avg_score numeric, pct_switched numeric, total_revealed integer, is_gated boolean, gate_lifted_at timestamp with time zone, meets_minimum_threshold boolean, pulse_label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    a.question_id,
    q.question                          AS question_text,
    q.election_issue_tag                AS issue_tag,
    q.election_party_abbreviation       AS party_abbreviation,
    q.election_party_colour             AS party_colour,
    q.election_candidate_name           AS candidate_name,
    q.election_constituency_name        AS constituency_name,
    a.scope,
    a.total_responses,
    a.pct_support,
    a.pct_neutral,
    a.pct_oppose,
    a.avg_score,
    a.pct_switched,
    a.total_revealed,
    a.is_gated,
    a.gate_lifted_at,
    a.meets_minimum_threshold,
    'Constituency sentiment'::text      AS pulse_label   -- EL-QA-023
  FROM public.election_stance_aggregates a
  JOIN public.questions q ON q.id = a.question_id
  WHERE a.election_id = p_election_id
    AND a.is_gated = false              -- exit poll gate enforced here
    AND a.meets_minimum_threshold = true
    AND (
      p_constituency_id IS NULL
      OR a.constituency_id = p_constituency_id
      OR a.constituency_id IS NULL      -- party-level questions (all constituencies)
    )
  ORDER BY a.total_responses DESC
  LIMIT p_limit;
$function$;
CREATE OR REPLACE FUNCTION public.get_election_feed_for_user(p_user_id uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE(question_id uuid, question text, election_id uuid, election_party_id uuid, election_candidate_id uuid, election_party_colour text, election_party_abbreviation text, election_candidate_name text, election_constituency_name text, election_disclosure_text text, election_issue_tag text, election_question_type text, election_framing_style text, slider_low_label text, slider_high_label text, local_candidate_id uuid, local_candidate_name text, local_candidate_name_local text, local_candidate_photo_path text, local_candidate_status text, published_at timestamp with time zone, user_has_answered boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_constituency_id uuid;
BEGIN
  -- Get user's primary constituency once
  SELECT primary_constituency_id
  INTO v_constituency_id
  FROM public.profiles
  WHERE user_id = p_user_id;

  RETURN QUERY
  SELECT
    q.id                                AS question_id,
    q.question,
    q.election_id,
    q.election_party_id,
    q.election_candidate_id,
    q.election_party_colour,
    q.election_party_abbreviation,
    q.election_candidate_name,
    q.election_constituency_name,
    q.election_disclosure_text,
    q.election_issue_tag,
    q.election_question_type,
    q.election_framing_style,
    q.slider_low_label,
    q.slider_high_label,

    -- Option C: for party-level questions, find the local candidate
    -- from the same party in the user's constituency
    CASE
      WHEN q.election_candidate_id IS NOT NULL
        -- Already a candidate question — no cross-link needed
        THEN NULL::uuid
      WHEN v_constituency_id IS NULL
        -- User has no constituency set
        THEN NULL::uuid
      ELSE (
        SELECT ec.id
        FROM public.election_candidates ec
        WHERE ec.election_id   = q.election_id
          AND ec.party_id      = q.election_party_id
          AND ec.constituency_id = v_constituency_id
          AND ec.status        NOT IN ('WITHDRAWN', 'DISQUALIFIED')
        LIMIT 1
      )
    END                                 AS local_candidate_id,

    CASE
      WHEN q.election_candidate_id IS NOT NULL THEN NULL::text
      WHEN v_constituency_id IS NULL THEN NULL::text
      ELSE (
        SELECT ec.full_name
        FROM public.election_candidates ec
        WHERE ec.election_id   = q.election_id
          AND ec.party_id      = q.election_party_id
          AND ec.constituency_id = v_constituency_id
          AND ec.status        NOT IN ('WITHDRAWN', 'DISQUALIFIED')
        LIMIT 1
      )
    END                                 AS local_candidate_name,

    CASE
      WHEN q.election_candidate_id IS NOT NULL THEN NULL::text
      WHEN v_constituency_id IS NULL THEN NULL::text
      ELSE (
        SELECT ec.full_name_local
        FROM public.election_candidates ec
        WHERE ec.election_id   = q.election_id
          AND ec.party_id      = q.election_party_id
          AND ec.constituency_id = v_constituency_id
          AND ec.status        NOT IN ('WITHDRAWN', 'DISQUALIFIED')
        LIMIT 1
      )
    END                                 AS local_candidate_name_local,

    CASE
      WHEN q.election_candidate_id IS NOT NULL THEN NULL::text
      WHEN v_constituency_id IS NULL THEN NULL::text
      ELSE (
        SELECT ec.photo_path
        FROM public.election_candidates ec
        WHERE ec.election_id   = q.election_id
          AND ec.party_id      = q.election_party_id
          AND ec.constituency_id = v_constituency_id
          AND ec.status        NOT IN ('WITHDRAWN', 'DISQUALIFIED')
        LIMIT 1
      )
    END                                 AS local_candidate_photo_path,

    CASE
      WHEN q.election_candidate_id IS NOT NULL THEN NULL::text
      WHEN v_constituency_id IS NULL THEN NULL::text
      ELSE (
        SELECT ec.status
        FROM public.election_candidates ec
        WHERE ec.election_id   = q.election_id
          AND ec.party_id      = q.election_party_id
          AND ec.constituency_id = v_constituency_id
          AND ec.status        NOT IN ('WITHDRAWN', 'DISQUALIFIED')
        LIMIT 1
      )
    END                                 AS local_candidate_status,

    q.published_at,

    EXISTS (
      SELECT 1 FROM public.question_stances qs
      WHERE qs.question_id = q.id
        AND qs.user_id = p_user_id
    )                                   AS user_has_answered

  FROM public.questions q
  JOIN public.elections e ON e.id = q.election_id
  WHERE q.is_election_question = true
    AND q.status = 'active'
    AND e.state IN ('CAMPAIGN_ACTIVE', 'MCC_ACTIVE')
    AND (
      -- Constituency-scoped question: matches user's AC exactly
      q.election_constituency_id = v_constituency_id
      -- Party-level question: shown to all users in this election
      OR q.election_constituency_id IS NULL
    )
  ORDER BY
    -- Candidate-specific questions for user's exact constituency first
    CASE WHEN q.election_constituency_id = v_constituency_id THEN 0 ELSE 1 END,
    q.published_at DESC
  LIMIT p_limit;

END;
$function$;
CREATE OR REPLACE FUNCTION public.get_election_silence_status(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'election_id',        e.id,
    'election_name',      e.name,
    'state',              e.state,
    'silence_start_at',   e.silence_start_at,
    'polling_start_at',   e.polling_start_at,
    'polling_end_at',     e.polling_end_at,
    'last_phase_close_at',e.last_phase_close_at,
    'mcc_start_at',       e.mcc_start_at,
    'is_silent_now',      (e.state IN ('SILENCE', 'POLLING')),
    'seconds_to_silence', CASE
      WHEN e.silence_start_at IS NOT NULL AND e.silence_start_at > now()
        THEN EXTRACT(EPOCH FROM (e.silence_start_at - now()))::integer
      ELSE NULL
    END,
    'seconds_to_polling_end', CASE
      WHEN e.polling_end_at IS NOT NULL AND e.polling_end_at > now()
        THEN EXTRACT(EPOCH FROM (e.polling_end_at - now()))::integer
      ELSE NULL
    END,
    'tier_code',          e.tier_code,
    'disclosure_text',    e.disclosure_text
  )
  FROM public.elections e
  WHERE e.id = p_election_id;
$function$;
CREATE OR REPLACE FUNCTION public.get_embed_community_stats(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_registered   jsonb;
  v_embedded_cnt bigint;
  v_embedded_avg numeric;
BEGIN
  -- Registered user stats from existing stats view
  SELECT jsonb_build_object(
    'total_responses', COALESCE(total_responses, 0),
    'pct_agree',       COALESCE(pct_agree, 0),
    'pct_disagree',    COALESCE(pct_disagree, 0),
    'pct_neutral',     COALESCE(pct_neutral, 100),
    'avg_score',       COALESCE(avg_score, 0)
  )
  INTO v_registered
  FROM public.question_stance_stats_region
  WHERE question_id = p_question_id
    AND region_scope = 'global'
  LIMIT 1;

  -- Anonymous embedded stance counts
  SELECT
    count(*),
    AVG(stance_value)
  INTO v_embedded_cnt, v_embedded_avg
  FROM public.embedded_stances
  WHERE question_id = p_question_id
    AND attributed_user_id IS NULL;

  RETURN jsonb_build_object(
    'registered', COALESCE(v_registered, '{}'::jsonb),
    'embedded_count', COALESCE(v_embedded_cnt, 0),
    'total_count', COALESCE((v_registered->>'total_responses')::int, 0) + COALESCE(v_embedded_cnt, 0)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_engagement_stats(p_question_id uuid)
 RETURNS TABLE(responses_today integer, responses_this_week integer, responses_total integer, response_rate_daily numeric, is_trending boolean, trending_since timestamp without time zone)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  
  RETURN QUERY
  SELECT 
    qem.responses_last_24h,
    qem.responses_last_7d,
    qem.responses_total,
    qem.response_rate_24h,
    COALESCE(q.is_trending, false),
    q.trending_since
  FROM public.question_engagement_metrics qem
  JOIN public.questions q ON q.id = qem.question_id
  WHERE qem.question_id = p_question_id;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_followed_topics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'topic_id', t.id,
        'title', t.title,
        'summary', t.summary,
        'followed_at', utf.followed_at,
        'question_count', (
          SELECT count(*)::int
          FROM public.questions q
          LEFT JOIN public.question_drafts qd ON qd.id = q.question_draft_id
          WHERE (qd.topic_id = t.id OR q.topic_draft_id = t.id)
            AND q.status IN ('active', 'live')
        )
      )
      ORDER BY utf.followed_at DESC
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM public.user_topic_follows utf
  JOIN public.topics t ON t.id = utf.topic_id
  WHERE utf.user_id = v_uid;

  RETURN jsonb_build_object(
    'followed_topics', v_result,
    'count', jsonb_array_length(v_result)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_for_you_feed(p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  WITH user_region AS (
    SELECT city_label, county_label, state_label, country_label
    FROM public.user_region_dimensions
    WHERE user_id = v_uid
  ),
  followed_topics AS (
    SELECT topic_id
    FROM public.user_topic_follows
    WHERE user_id = v_uid
  ),
  scored AS (
    SELECT DISTINCT
      q.id,
      q.question,
      q.summary,
      q.published_at,
      q.cover_image_url,
      q.tags,
      COALESCE(t.title, t2.title)  AS topic_title,
      COALESCE(qd.topic_id, t2.id) AS topic_id,
      (
        CASE WHEN EXISTS (
          SELECT 1 FROM followed_topics ft
          WHERE ft.topic_id = COALESCE(qd.topic_id, q.topic_draft_id)
        ) THEN 2.0 ELSE 1.0 END
        *
        CASE
          WHEN q.location_label = (SELECT city_label    FROM user_region WHERE city_label    IS NOT NULL LIMIT 1) THEN 1.5
          WHEN q.location_label = (SELECT state_label   FROM user_region WHERE state_label   IS NOT NULL LIMIT 1) THEN 1.2
          WHEN q.location_label = (SELECT country_label FROM user_region WHERE country_label IS NOT NULL LIMIT 1) THEN 1.1
          ELSE 1.0
        END
        /
        NULLIF(GREATEST(EXTRACT(EPOCH FROM (now() - q.published_at)) / 86400.0, 1.0), 0)
      ) AS rank_score
    FROM public.questions q
    LEFT JOIN public.question_drafts qd ON qd.id = q.question_draft_id
    LEFT JOIN public.topics t  ON t.id  = qd.topic_id
    LEFT JOIN public.topics t2 ON t2.id = q.topic_draft_id
    WHERE q.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.question_stances qs
        WHERE qs.question_id = q.id AND qs.user_id = v_uid
      )
      AND (
        EXISTS (
          SELECT 1 FROM followed_topics ft
          WHERE ft.topic_id = COALESCE(qd.topic_id, q.topic_draft_id)
        )
        OR q.location_label IN (
          SELECT city_label    FROM user_region WHERE city_label    IS NOT NULL
          UNION
          SELECT state_label   FROM user_region WHERE state_label   IS NOT NULL
          UNION
          SELECT country_label FROM user_region WHERE country_label IS NOT NULL
        )
      )
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',              id,
        'question',        question,
        'summary',         summary,
        'topic_title',     topic_title,
        'topic_id',        topic_id,
        'published_at',    published_at,
        'cover_image_url', cover_image_url,
        'tags',            tags
      )
      ORDER BY rank_score DESC, published_at DESC
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM (
    SELECT * FROM scored
    ORDER BY rank_score DESC, published_at DESC
    LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'questions', v_result,
    'count',     jsonb_array_length(v_result)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_high_impact_candidates(p_limit integer DEFAULT 50)
 RETURNS TABLE(topic_id uuid, topic_title text, topic_summary text, topic_tier text, topic_location_label text, topic_tags text[], impact_score numeric, stance_potential_score numeric, cluster_density_score numeric, region_relevance_score numeric, engagement_prediction_score numeric, composite_score numeric, impact_explanation text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
  SELECT
    v.topic_id,
    v.topic_title,
    v.topic_summary,
    v.topic_tier,
    v.topic_location_label,
    v.topic_tags,
    v.impact_score,
    v.stance_potential_score,
    v.cluster_density_score,
    v.region_relevance_score,
    v.engagement_prediction_score,
    v.composite_score,
    v.explanation AS impact_explanation
  FROM public.v_topic_impact_admin v
  WHERE v.composite_score IS NOT NULL
  ORDER BY v.composite_score DESC, v.scores_updated_at DESC
  LIMIT GREATEST(p_limit, 1);
$function$;
CREATE OR REPLACE FUNCTION public.get_high_impact_questions(p_min_score numeric DEFAULT 7.0, p_limit integer DEFAULT 20)
 RETURNS TABLE(question_id uuid, question_text text, composite_score numeric, impact_score numeric, stance_potential_score numeric, visibility text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT 
    q.id as question_id,
    q.question as question_text,
    tis.composite_score,
    tis.impact_score,
    tis.stance_potential_score,
    COALESCE(qvr.visibility, 'visible') as visibility
  FROM public.questions q
  JOIN public.topic_impact_scores tis ON tis.question_id = q.id
  LEFT JOIN public.question_visibility_rules qvr ON qvr.question_id = q.id
  WHERE q.status = 'active'
    AND tis.composite_score >= p_min_score
    AND COALESCE(qvr.visibility, 'visible') = 'visible'
  ORDER BY tis.composite_score DESC
  LIMIT p_limit;
$function$;
CREATE OR REPLACE FUNCTION public.get_issue_tags_for_tier(p_tier_code public.election_tier_code_enum)
 RETURNS TABLE(tag text, tag_local text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT tag, tag_local
  FROM public.election_issue_tag_allowlists
  WHERE tier_code = p_tier_code AND is_active = true
  ORDER BY sort_order, tag;
$function$;
CREATE OR REPLACE FUNCTION public.get_linked_providers()
 RETURNS TABLE(provider public.social_provider, provider_user_id text, connected_at timestamp with time zone, scopes text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    provider,
    -- Mask the external user ID for display (show first 6 chars + ***)
    left(provider_user_id, 6) || '***' AS provider_user_id,
    created_at                          AS connected_at,
    scopes
  FROM public.social_auth_tokens
  WHERE user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.get_macro_trends(p_region_scope text DEFAULT 'global'::text, p_region_key text DEFAULT 'global'::text, p_days integer DEFAULT 30, p_question_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(snapshot_date date, total_responses integer, avg_score numeric, pct_support numeric, pct_neutral numeric, pct_oppose numeric, confidence_low numeric, confidence_high numeric, is_low_sample boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with series as (
    -- Single question mode
    select
      h.snapshot_date,
      sum(h.total_responses)::integer              as total_responses,
      round(avg(h.avg_score)::numeric, 4)          as avg_score,
      round(avg(h.pct_support)::numeric, 2)        as pct_support,
      round(avg(h.pct_neutral)::numeric, 2)        as pct_neutral,
      round(avg(h.pct_oppose)::numeric, 2)         as pct_oppose,
      round(stddev_pop(h.avg_score)::numeric, 4)   as score_stddev
    from public.question_stance_stats_history h
    where h.region_scope = p_region_scope
      and h.region_key   = p_region_key
      and h.snapshot_date >= (current_date - p_days)
      and (p_question_id is null or h.question_id = p_question_id)
    group by h.snapshot_date
  )
  select
    s.snapshot_date,
    s.total_responses,
    s.avg_score,
    s.pct_support,
    s.pct_neutral,
    s.pct_oppose,
    -- confidence band: ±1 stddev, capped at [-2, +2]
    greatest(-2, round(s.avg_score - coalesce(s.score_stddev, 0.2), 4)) as confidence_low,
    least(   2,  round(s.avg_score + coalesce(s.score_stddev, 0.2), 4)) as confidence_high,
    (s.total_responses < 10)                                              as is_low_sample
  from series s
  order by s.snapshot_date asc;
$function$;
CREATE OR REPLACE FUNCTION public.get_media_surge_homepage(p_region text DEFAULT 'Global'::text, p_window_hours integer DEFAULT 24, p_baseline_days integer DEFAULT 7, p_limit integer DEFAULT 5)
 RETURNS TABLE(cluster_id uuid, cluster_title text, articles_24h integer, outlets_24h integer, baseline_avg_daily_articles numeric, surge_ratio numeric, sample_title text, sample_url text, sample_published_at timestamp with time zone, generated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH eligible_sources AS (
    -- Filter sources by region (with country_code fallback)
    SELECT ts.id as source_id
    FROM public.topic_sources ts
    WHERE ts.is_enabled = true
        AND CASE 
            WHEN p_region = 'United States' THEN 
                ts.country_name = 'United States' OR ts.country_code = 'US'
            WHEN p_region = 'Global' THEN 
                TRUE  -- All sources
            ELSE 
                -- For other countries, allow name OR code match
                ts.country_name = p_region OR ts.country_code = p_region
        END
),
articles_in_window AS (
    -- Articles published in the surge window from eligible sources
    SELECT 
        iq.id as ingestion_id,
        iq.source_id,
        iq.title,
        iq.url,
        iq.published_at,
        iq.created_at
    FROM public.ingestion_queue iq
    JOIN eligible_sources es ON es.source_id = iq.source_id
    WHERE (
        iq.published_at >= NOW() - (p_window_hours || ' hours')::interval
        OR (iq.published_at IS NULL AND iq.created_at >= NOW() - (p_window_hours || ' hours')::interval)
    )
    AND iq.status = 'done'  -- Only successfully processed articles
),
articles_in_baseline AS (
    -- FIXED: Baseline period excludes the window [now - baseline_days, now - window_hours)
    SELECT 
        iq.id as ingestion_id,
        iq.source_id
    FROM public.ingestion_queue iq
    JOIN eligible_sources es ON es.source_id = iq.source_id
    WHERE (
        -- Baseline starts at (now - baseline_days)
        (iq.published_at >= NOW() - (p_baseline_days || ' days')::interval
         AND iq.published_at < NOW() - (p_window_hours || ' hours')::interval)
        OR 
        -- For articles without published_at, use created_at
        (iq.published_at IS NULL 
         AND iq.created_at >= NOW() - (p_baseline_days || ' days')::interval
         AND iq.created_at < NOW() - (p_window_hours || ' hours')::interval)
    )
    AND iq.status = 'done'
),
cluster_article_counts AS (
    -- Count articles per cluster in window and baseline
    -- FIXED: Count aiw/aib directly, not tci_*
    SELECT 
        tc.id as cluster_id,
        tc.title as cluster_title,
        
        -- Count unique articles in surge window (FIXED)
        COUNT(DISTINCT aiw.ingestion_id) as window_article_count,
        
        -- Count unique outlets in surge window (key duplicate coverage signal)
        COUNT(DISTINCT aiw.source_id) as window_outlet_count,
        
        -- Count unique articles in baseline period (FIXED)
        COUNT(DISTINCT aib.ingestion_id) as baseline_article_count,
        
        -- Sample article for display (FILTER ensures non-NULL values only)
        (ARRAY_AGG(aiw.title ORDER BY aiw.published_at DESC NULLS LAST) 
            FILTER (WHERE aiw.ingestion_id IS NOT NULL))[1] as sample_title,
        (ARRAY_AGG(aiw.url ORDER BY aiw.published_at DESC NULLS LAST) 
            FILTER (WHERE aiw.ingestion_id IS NOT NULL))[1] as sample_url,
        (ARRAY_AGG(aiw.published_at ORDER BY aiw.published_at DESC NULLS LAST) 
            FILTER (WHERE aiw.ingestion_id IS NOT NULL))[1] as sample_published_at
        
    FROM public.topic_clusters tc
    JOIN public.topic_cluster_items tci ON tci.cluster_id = tc.id
    LEFT JOIN articles_in_window aiw ON aiw.ingestion_id = tci.ingestion_id
    LEFT JOIN articles_in_baseline aib ON aib.ingestion_id = tci.ingestion_id
    
    GROUP BY tc.id, tc.title
    HAVING COUNT(DISTINCT aiw.ingestion_id) > 0  -- Only clusters with articles in window
),
with_surge_ratio AS (
    SELECT 
        cluster_id,
        cluster_title,
        window_article_count,
        window_outlet_count,
        
        -- Calculate baseline average per day (excluding window)
        ROUND(
            baseline_article_count::numeric / GREATEST(1, p_baseline_days - (p_window_hours::numeric / 24)),
            2
        ) as baseline_avg_daily_articles,
        
        -- Calculate surge ratio (window count vs daily baseline)
        ROUND(
            window_article_count::numeric / 
            GREATEST(1, (baseline_article_count::numeric / GREATEST(1, p_baseline_days - (p_window_hours::numeric / 24)))),
            2
        ) as surge_ratio,
        
        sample_title,
        sample_url,
        sample_published_at
        
    FROM cluster_article_counts
    -- ADDED: Require at least 2 outlets (duplicate coverage signal)
    WHERE window_outlet_count >= 2
)
SELECT 
    wsr.cluster_id,
    wsr.cluster_title,
    wsr.window_article_count::int as articles_24h,
    wsr.window_outlet_count::int as outlets_24h,
    wsr.baseline_avg_daily_articles,
    wsr.surge_ratio,
    wsr.sample_title,
    wsr.sample_url,
    wsr.sample_published_at,
    NOW() as generated_at
FROM with_surge_ratio wsr
ORDER BY 
    wsr.surge_ratio DESC,           -- Prefer relative surge
    wsr.window_outlet_count DESC,   -- Then duplicate coverage
    wsr.window_article_count DESC   -- Then volume
LIMIT p_limit;
$function$;
create or replace view "public"."mod_identifier_overview" as  SELECT user_id,
    random_id,
    username,
    display_handle_mode,
    created_at,
    ( SELECT count(*) AS count
           FROM public.username_history uh
          WHERE (uh.user_id = p.user_id)) AS username_changes,
    ( SELECT max(uh.created_at) AS max
           FROM public.username_history uh
          WHERE (uh.user_id = p.user_id)) AS username_last_changed_at,
    ( SELECT count(*) AS count
           FROM public.location_audits la
          WHERE (la.user_id = p.user_id)) AS location_changes,
    ( SELECT max(la.created_at) AS max
           FROM public.location_audits la
          WHERE (la.user_id = p.user_id)) AS location_last_changed_at
   FROM public.profiles p;
CREATE OR REPLACE FUNCTION public.get_mod_identifier_overview()
 RETURNS SETOF public.mod_identifier_overview
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.mod_identifier_overview
  where public.is_moderator();
$function$;
CREATE OR REPLACE FUNCTION public.get_my_consent_logs()
 RETURNS TABLE(id uuid, consent_key text, granted boolean, version text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT id, consent_key, granted, version, created_at
  FROM public.consent_logs
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 50;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_deletion_request()
 RETURNS public.deletion_requests
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.deletion_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_row
  FROM public.deletion_requests
  WHERE user_id = v_uid AND status = 'pending'
  LIMIT 1;

  RETURN v_row;  -- returns NULL row if not found; frontend handles null
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_latest_weekly_digest()
 RETURNS TABLE(id uuid, week_start date, week_end date, summary jsonb, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    wd.id,
    wd.week_start,
    wd.week_end,
    wd.summary,
    wd.created_at
  from public.weekly_digests wd
  where wd.user_id = auth.uid()
  order by wd.week_start desc, wd.created_at desc
  limit 1;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_muted_topic_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    ARRAY_AGG(topic_id),
    '{}'::uuid[]
  )
  FROM public.notification_topic_prefs
  WHERE user_id = auth.uid()
    AND muted = true;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_notification_preferences()
 RETURNS public.notification_preferences
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select *
  from public.notification_preferences
  where user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.get_my_notifications(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_unread_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, notification_type text, title text, body text, href text, topic_id uuid, question_id uuid, digest_id uuid, metadata jsonb, is_read boolean, read_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    un.id,
    un.notification_type,
    un.title,
    un.body,
    un.href,
    un.topic_id,
    un.question_id,
    un.digest_id,
    un.metadata,
    un.is_read,
    un.read_at,
    un.created_at
  from public.user_notifications un
  where un.user_id = auth.uid()
    and (
      not p_unread_only
      or un.is_read = false
    )
  order by un.created_at desc
  limit  greatest(p_limit,  0)
  offset greatest(p_offset, 0);
$function$;
CREATE OR REPLACE FUNCTION public.get_my_personal_analytics(p_region_scope text DEFAULT 'global'::text, p_region_key text DEFAULT 'Global'::text, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
WITH base AS (
  -- Core dataset: user stances joined with community aggregates.
  -- Resolves to CANONICAL topic: if a micro-topic has a parent_topic_id,
  -- we group under the parent so that related micro-topics aggregate together.
  -- Example: "Netanyahu's Leadership" + "Escalation in Gaza" both assigned to
  -- "Middle East Conflict" will count as 2 answers under "Middle East Conflict".
  SELECT
    qs.question_id,
    qs.created_at                                    AS answered_at,
    qs.score::double precision                       AS user_score,
    -- Use parent topic id when available, else the micro-topic id
    COALESCE(t.parent_topic_id, q.topic_id)          AS topic_id,
    -- Use parent topic title when available, else micro-topic title
    COALESCE(tp.title, t.title, 'General')           AS topic_title,
    qssr.avg_score::double precision                 AS community_avg_score,
    qssr.total_responses,
    GREATEST(0.0, LEAST(1.0,
      1.0 - (ABS(qs.score::double precision
                 - COALESCE(qssr.avg_score::double precision, 0.0)) / 4.0)
    ))                                               AS closeness_score
  FROM public.question_stances qs
  JOIN public.questions q
    ON q.id = qs.question_id
  LEFT JOIN public.topics t
    ON t.id = q.topic_id
  -- tp = the parent topic row (NULL when t has no parent)
  LEFT JOIN public.topics tp
    ON tp.id = t.parent_topic_id
  LEFT JOIN public.question_stance_stats_region qssr
    ON  qssr.question_id  = qs.question_id
    AND qssr.region_scope = p_region_scope
    AND qssr.region_key   = p_region_key
  WHERE qs.user_id = auth.uid()
    AND qs.created_at >= NOW() - MAKE_INTERVAL(days => p_days)
),

-- ── Overview counts ──────────────────────────────────────────────────────────
overview AS (
  SELECT
    COUNT(*)::int                      AS total_answered,
    COUNT(DISTINCT topic_id)::int      AS topics_answered,
    MIN(answered_at)                   AS first_answered_at,
    MAX(answered_at)                   AS last_answered_at
  FROM base
),

-- ── Weekly alignment trend ───────────────────────────────────────────────────
-- Buckets answers into weeks, computes avg closeness per bucket.
-- Uses generate_series to fill gaps for display consistency.
trend_buckets AS (
  SELECT
    DATE_TRUNC('week', answered_at)    AS bucket_start,
    AVG(closeness_score)::double precision AS alignment_score,
    COUNT(*)::int                      AS answered_count
  FROM base
  WHERE community_avg_score IS NOT NULL  -- only rows with community data
  GROUP BY 1
),
trend_series AS (
  SELECT
    gs.bucket_start,
    tb.alignment_score,
    COALESCE(tb.answered_count, 0)::int AS answered_count
  FROM GENERATE_SERIES(
    DATE_TRUNC('week', NOW() - MAKE_INTERVAL(days => LEAST(p_days, 56))),
    DATE_TRUNC('week', NOW()),
    INTERVAL '1 week'
  ) AS gs(bucket_start)
  LEFT JOIN trend_buckets tb ON tb.bucket_start = gs.bucket_start
  ORDER BY gs.bucket_start
),
trend_valid AS (
  -- Only buckets where we actually have answers
  SELECT * FROM trend_series WHERE answered_count > 0
),
trend_summary AS (
  SELECT
    (SELECT alignment_score FROM trend_valid ORDER BY bucket_start DESC LIMIT 1)
      AS current_alignment_score,
    (SELECT alignment_score FROM trend_valid ORDER BY bucket_start DESC OFFSET 1 LIMIT 1)
      AS previous_alignment_score,
    (SELECT COUNT(*) FROM trend_valid)
      AS valid_bucket_count
),

-- ── Most divergent topic ──────────────────────────────────────────────────────
-- Topic where abs(user_avg - community_avg) is largest.
-- Requires >= 2 answered questions per topic.
topic_divergence AS (
  SELECT
    topic_id,
    MAX(topic_title)                              AS topic_title,
    COUNT(*)::int                                 AS answered_count,
    AVG(user_score)::double precision             AS user_avg_score,
    AVG(community_avg_score)::double precision    AS community_avg_score,
    ABS(AVG(user_score) - AVG(COALESCE(community_avg_score, 0)))::double precision
                                                  AS divergence_score
  FROM base
  WHERE topic_id IS NOT NULL
  GROUP BY topic_id
  HAVING COUNT(*) >= 2
),
top_divergent AS (
  SELECT
    topic_id,
    topic_title,
    user_avg_score,
    community_avg_score,
    divergence_score,
    answered_count,
    CASE
      WHEN user_avg_score > COALESCE(community_avg_score, 0) + 0.35 THEN 'more_supportive'
      WHEN user_avg_score < COALESCE(community_avg_score, 0) - 0.35 THEN 'more_opposed'
      ELSE 'mixed'
    END AS direction
  FROM topic_divergence
  ORDER BY divergence_score DESC NULLS LAST, answered_count DESC, topic_title ASC
  LIMIT 1
),

-- ── Opinion fingerprint metrics ───────────────────────────────────────────────
fingerprint AS (
  SELECT
    AVG(user_score)::double precision              AS avg_score,
    AVG(ABS(user_score))::double precision         AS absolute_avg_score,
    -- consistency: 1 = very consistent, 0 = highly variable
    GREATEST(0.0, LEAST(1.0,
      1.0 - (COALESCE(STDDEV_POP(user_score), 0)::double precision / 2.0)
    ))                                             AS consistency_score,
    -- divergence_rate: fraction of answers where user meaningfully differs
    AVG(CASE
      WHEN ABS(user_score - COALESCE(community_avg_score, 0)) >= 1.25 THEN 1.0
      ELSE 0.0
    END)::double precision                         AS divergence_rate
  FROM base
),
-- Per-topic answer counts for concentration + strongest topic
topic_counts AS (
  SELECT
    topic_id,
    MAX(topic_title)             AS topic_title,
    COUNT(*)::int                AS answered_count,
    AVG(user_score)::double precision AS avg_user_score
  FROM base
  WHERE topic_id IS NOT NULL
  GROUP BY topic_id
),
concentration AS (
  SELECT
    CASE
      WHEN (SELECT total_answered FROM overview) > 0
      THEN (
        SELECT MAX(answered_count)::double precision
               / (SELECT total_answered FROM overview)::double precision
        FROM topic_counts
      )
      ELSE NULL
    END AS concentration_score
),
strongest_topic AS (
  SELECT
    topic_id                  AS strongest_topic_id,
    topic_title               AS strongest_topic_title,
    avg_user_score            AS strongest_topic_avg_score
  FROM topic_counts
  WHERE answered_count >= 2
  ORDER BY ABS(avg_user_score) DESC NULLS LAST, answered_count DESC, topic_title ASC
  LIMIT 1
)

-- ── Final JSON assembly ───────────────────────────────────────────────────────
SELECT JSONB_BUILD_OBJECT(
  'total_answered',    COALESCE((SELECT total_answered  FROM overview), 0),
  'topics_answered',   COALESCE((SELECT topics_answered FROM overview), 0),
  'first_answered_at', (SELECT first_answered_at FROM overview),
  'last_answered_at',  (SELECT last_answered_at  FROM overview),

  'alignment_trend', JSONB_BUILD_OBJECT(
    'window_days', p_days,
    'points', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'bucket_start',   bucket_start,
          'alignment_score', alignment_score,
          'answered_count',  answered_count
        ) ORDER BY bucket_start
      )
      FROM trend_series
    ), '[]'::jsonb),
    'current_alignment_score',  (SELECT current_alignment_score  FROM trend_summary),
    'previous_alignment_score', (SELECT previous_alignment_score FROM trend_summary),
    'delta', CASE
      WHEN (SELECT current_alignment_score  FROM trend_summary) IS NOT NULL
       AND (SELECT previous_alignment_score FROM trend_summary) IS NOT NULL
      THEN (SELECT current_alignment_score  FROM trend_summary)
         - (SELECT previous_alignment_score FROM trend_summary)
      ELSE NULL
    END,
    'direction', CASE
      WHEN (SELECT valid_bucket_count FROM trend_summary) < 2 THEN 'insufficient'
      WHEN (
        (SELECT current_alignment_score  FROM trend_summary) -
        (SELECT previous_alignment_score FROM trend_summary)
      ) >=  0.06 THEN 'up'
      WHEN (
        (SELECT current_alignment_score  FROM trend_summary) -
        (SELECT previous_alignment_score FROM trend_summary)
      ) <= -0.06 THEN 'down'
      ELSE 'flat'
    END
  ),

  'most_divergent_topic', (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM top_divergent)
      THEN (
        SELECT JSONB_BUILD_OBJECT(
          'topic_id',            topic_id,
          'topic_title',         topic_title,
          'user_avg_score',      user_avg_score,
          'community_avg_score', community_avg_score,
          'divergence_score',    divergence_score,
          'answered_count',      answered_count,
          'direction',           direction
        ) FROM top_divergent
      )
      ELSE NULL
    END
  ),

  'opinion_fingerprint', JSONB_BUILD_OBJECT(
    'avg_score',                (SELECT avg_score            FROM fingerprint),
    'absolute_avg_score',       (SELECT absolute_avg_score   FROM fingerprint),
    'consistency_score',        (SELECT consistency_score    FROM fingerprint),
    'divergence_rate',          (SELECT divergence_rate      FROM fingerprint),
    'concentration_score',      (SELECT concentration_score  FROM concentration),
    'strongest_topic_id',       (SELECT strongest_topic_id   FROM strongest_topic),
    'strongest_topic_title',    (SELECT strongest_topic_title   FROM strongest_topic),
    'strongest_topic_avg_score',(SELECT strongest_topic_avg_score FROM strongest_topic),
    'summary_tags', '[]'::jsonb  -- populated by frontend helper
  )
);
$function$;
CREATE OR REPLACE FUNCTION public.get_my_privacy_settings()
 RETURNS public.user_privacy
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_privacy;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_row FROM public.user_privacy WHERE user_id = v_uid;

  IF NOT FOUND THEN
    INSERT INTO public.user_privacy (user_id)
    VALUES (v_uid)
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_share_stats()
 RETURNS TABLE(question_id uuid, question_text text, total_shares bigint, total_clicks bigint, last_shared_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    se.question_id,
    q.question AS question_text,
    count(se.id)          AS total_shares,
    sum(se.click_count)   AS total_clicks,
    max(se.created_at)    AS last_shared_at
  FROM public.share_events se
  JOIN public.questions q ON q.id = se.question_id
  WHERE se.shared_by_user_id = auth.uid()
  GROUP BY se.question_id, q.question
  ORDER BY last_shared_at DESC;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_stance_export()
 RETURNS TABLE(question_id uuid, question_text text, current_score smallint, first_answered timestamp with time zone, last_updated timestamp with time zone, change_count bigint, rationale text, links text[], score_history jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    qs.question_id,
    q.question                                              as question_text,
    qs.score                                                as current_score,
    qs.created_at                                           as first_answered,
    qs.updated_at                                           as last_updated,
    count(sh.id)                                            as change_count,
    st.rationale,
    coalesce(st.links, '{}')                                as links,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'old_score', sh.old_score,
          'new_score', sh.new_score,
          'changed_at', sh.changed_at
        )
        order by sh.changed_at asc
      ) filter (where sh.id is not null),
      '[]'::jsonb
    )                                                       as score_history
  from public.question_stances qs
  join public.questions q
    on q.id = qs.question_id
  left join public.stance_history sh
    on sh.user_id = qs.user_id
   and sh.question_id = qs.question_id
  left join public.stance_texts st
    on st.user_id = qs.user_id
   and st.question_id = qs.question_id
  where qs.user_id = auth.uid()
  group by
    qs.question_id,
    q.question,
    qs.score,
    qs.created_at,
    qs.updated_at,
    st.rationale,
    st.links
  order by qs.updated_at desc;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_stance_history(p_question_id uuid)
 RETURNS TABLE(id uuid, old_score smallint, new_score smallint, changed_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    sh.id,
    sh.old_score,
    sh.new_score,
    sh.changed_at
  from public.stance_history sh
  where sh.user_id     = auth.uid()
    and sh.question_id = p_question_id
  order by sh.changed_at asc;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_stance_snapshot(p_limit_topics integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid            uuid := auth.uid();
  v_city           text;
  v_county         text;
  v_state          text;
  v_country        text;
  v_scope          text;
  v_label          text;
  v_mean_abs       numeric;
  v_total          int;
  v_alignment_text text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- User region labels
  select city_label, county_label, state_label, country_label
    into v_city, v_county, v_state, v_country
  from public.user_region_dimensions
  where user_id = v_uid;

  -- Choose best available region tier
  v_scope := case
    when v_city    is not null then 'city'
    when v_county  is not null then 'county'
    when v_state   is not null then 'state'
    when v_country is not null then 'country'
    else 'global'
  end;

  v_label := case v_scope
    when 'city'    then v_city
    when 'county'  then v_county
    when 'state'   then v_state
    when 'country' then v_country
    else 'Global'
  end;

  -- Get total count
  select count(*)::int into v_total
  from public.question_stances
  where user_id = v_uid;

  -- Calculate mean absolute difference (if regional stats exist)
  select avg(abs(qs.score - coalesce(r.avg_score, g.avg_score, 0)))::numeric
    into v_mean_abs
  from public.question_stances qs
  left join public.question_stance_stats_region r
    on r.question_id = qs.question_id
   and r.region_scope = v_scope
   and r.region_key   = v_label
  left join public.question_stance_stats_region g
    on g.question_id  = qs.question_id
   and g.region_scope = 'global'
   and g.region_key   = 'Global'
  where qs.user_id = v_uid;

  -- Build alignment label text
  if v_total = 0 then
    v_alignment_text := 'As you answer more questions, patterns will begin to appear here.';
  elsif v_mean_abs is null then
    if v_scope = 'global' then
      v_alignment_text := 'We don''t have enough community data yet to place this in context.';
    else
      v_alignment_text := format('We don''t have enough community data yet to place this in context for %s.', v_label);
    end if;
  elsif v_mean_abs <= 0.50 then
    if v_scope = 'global' then
      v_alignment_text := 'Your views generally align with others globally.';
    else
      v_alignment_text := format('Your views generally align with others in %s.', v_label);
    end if;
  elsif v_mean_abs <= 1.00 then
    if v_scope = 'global' then
      v_alignment_text := 'Your views sometimes differ from the broader global pattern.';
    else
      v_alignment_text := format('On average, your views differ a bit from others in %s.', v_label);
    end if;
  else
    if v_scope = 'global' then
      v_alignment_text := 'Your views often diverge from the broader global pattern.';
    else
      v_alignment_text := format('On average, your views often diverge from others in %s.', v_label);
    end if;
  end if;

  return jsonb_build_object(
    'total_answered', v_total,
    'topics', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'topic_id',    topic_id,
            'topic_title', topic_title,
            'tags',        tags,
            'n',           n,
            'avg_score',   avg_score
          )
          order by n desc
        )
        from (
          select
            coalesce(t.id,    t2.id)::text                  as topic_id,
            coalesce(t.title, t2.title, 'General')          as topic_title,
            coalesce(t.tags,  t2.tags,  '{}'::text[])       as tags,
            count(*)::int                                    as n,
            avg(qs.score::numeric)                          as avg_score
          from public.question_stances qs
          join public.questions q        on q.id   = qs.question_id
          left join public.question_drafts qd on qd.id = q.question_draft_id
          left join public.topics t      on t.id   = q.topic_id
          left join public.topics t2     on t2.id  = qd.topic_id
          where qs.user_id = v_uid
          group by
            coalesce(t.id,    t2.id)::text,
            coalesce(t.title, t2.title, 'General'),
            coalesce(t.tags,  t2.tags,  '{}'::text[])
          order by count(*) desc, abs(avg(qs.score::numeric)) desc
          limit greatest(coalesce(p_limit_topics, 3), 1)
        ) topics_subquery
      ),
      '[]'::jsonb
    ),
    'region', jsonb_build_object(
      'scope',           v_scope,
      'label',           v_label,
      'mean_abs_diff',   v_mean_abs,
      'alignment_label', v_alignment_text
    )
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_parent_topics_for_classification()
 RETURNS TABLE(id uuid, title text, tags text[], location_label text, child_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    t.id,
    t.title,
    t.tags,
    t.location_label,
    COUNT(c.id)::integer AS child_count
  FROM public.topics t
  LEFT JOIN public.topics c ON c.parent_topic_id = t.id
  WHERE t.parent_topic_id IS NULL         -- root topics only
    AND t.title IS NOT NULL
    AND char_length(t.title) >= 8
    AND t.status = 'approved'             -- ← NEW: exclude pending/archived
  GROUP BY t.id, t.title, t.tags, t.location_label
  -- No HAVING filter needed — status='approved' in WHERE is the real guard.
  -- Any approved root topic with a valid title is eligible as a parent.
  ORDER BY COUNT(c.id) DESC, t.title ASC
  LIMIT 50;
$function$;
CREATE OR REPLACE FUNCTION public.get_participation_stats(p_region text DEFAULT 'Global'::text, p_window_hours integer DEFAULT 24)
 RETURNS TABLE(region text, stances_window integer, stances_7d integer, stances_60m integer, unique_users_window integer, generated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH regional_stances AS (
    -- Get all stances for region-eligible questions
    SELECT 
        qs.id,
        qs.created_at,
        qs.user_id
    FROM public.question_stances qs
    JOIN public.questions q ON q.id = qs.question_id
    JOIN public.topics t ON t.id = q.topic_id
    WHERE 
        CASE 
            WHEN p_region = 'United States' THEN 
                -- US tab: include US, Global, and NULL (treat NULL as US-eligible)
                COALESCE(q.location_label, t.location_label) IN ('United States', 'Global')
                OR COALESCE(q.location_label, t.location_label) IS NULL
            WHEN p_region = 'Global' THEN 
                TRUE  -- Global tab: include everything
            ELSE 
                -- Specific country: exact match only (no NULL for other countries)
                COALESCE(q.location_label, t.location_label) = p_region
        END
)
SELECT 
    p_region as region,
    COUNT(*) FILTER (WHERE created_at >= NOW() - (p_window_hours || ' hours')::interval)::int as stances_window,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int as stances_7d,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 minutes')::int as stances_60m,
    COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - (p_window_hours || ' hours')::interval)::int as unique_users_window,
    NOW() as generated_at
FROM regional_stances;
$function$;
CREATE OR REPLACE FUNCTION public.get_parties_for_election(p_election_id uuid)
 RETURNS TABLE(party_id uuid, name text, abbreviation text, name_local text, party_type text, brand_colour text, logo_path text, symbol_path text, participation_type text, contesting_as_alliance_id uuid, seats_contested integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    p.id,
    p.name,
    p.abbreviation,
    p.name_local,
    p.party_type,
    p.brand_colour,
    p.logo_path,
    p.symbol_path,
    pe.participation_type,
    pe.contesting_as_alliance_id,
    pe.seats_contested
  FROM public.election_party_elections pe
  JOIN public.election_parties p ON p.id = pe.party_id
  WHERE pe.election_id = p_election_id
    AND p.is_active = true
  ORDER BY p.party_type, p.name;
$function$;
CREATE OR REPLACE FUNCTION public.get_pending_merge_count(p_device_fingerprint text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT count(*)::integer
  FROM public.embedded_stances
  WHERE device_fingerprint = p_device_fingerprint
    AND attributed_user_id IS NULL;
$function$;
CREATE OR REPLACE FUNCTION public.get_personalized_feed(p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(question_id uuid, topic_id uuid, question text, summary text, tags text[], state text, published_at timestamp with time zone, is_trending boolean, trending_score numeric, user_has_answered boolean, topic_title text, topic_tags text[], relevance_score numeric, response_count bigint, phase text, is_new_phase boolean, cover_image_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_city    text;
  v_state   text;
  v_country text;
BEGIN
  -- ✅ Correct location source (preserved verbatim)
  SELECT
    city_label,
    state_label,
    country_label
  INTO
    v_city,
    v_state,
    v_country
  FROM public.user_region_dimensions
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_country IS NULL THEN
    v_country := 'United States';
  END IF;

  RETURN QUERY
  SELECT
    q.id AS question_id,
    q.topic_id,
    q.question,
    q.summary,
    q.tags,
    q.state::text AS state,
    q.published_at,
    COALESCE(q.is_trending, false) AS is_trending,
    COALESCE(q.trending_score, 0) AS trending_score,

    EXISTS(
      SELECT 1
      FROM public.question_stances qs
      WHERE qs.question_id = q.id
        AND qs.user_id = p_user_id
    ) AS user_has_answered,

    t.title AS topic_title,
    t.tags AS topic_tags,

    -- ✅ Relevance scoring with wrong-country suppression (preserved verbatim)
    (
      10.0
      + CASE WHEN EXISTS(
          SELECT 1 FROM public.user_follows uf
          WHERE uf.user_id = p_user_id
            AND uf.follow_type = 'topic'
            AND uf.follow_id = q.topic_id
        ) THEN 20.0 ELSE 0.0 END

      + CASE WHEN v_city IS NOT NULL
          AND q.location_label ILIKE '%' || v_city || '%'
        THEN 15.0 ELSE 0.0 END

      + CASE WHEN v_state IS NOT NULL
          AND q.location_label ILIKE '%' || v_state || '%'
        THEN 10.0 ELSE 0.0 END

      + CASE WHEN v_country IS NOT NULL
          AND q.location_label ILIKE '%' || v_country || '%'
        THEN 5.0 ELSE 0.0 END

      + CASE WHEN q.state = 'new' THEN 12.0 ELSE 0.0 END
      + CASE WHEN COALESCE(q.is_trending, false) THEN 10.0 ELSE 0.0 END
      + COALESCE(
          (SELECT qem.response_rate_24h * 2.0
           FROM public.question_engagement_metrics qem
           WHERE qem.question_id = q.id),
          0.0
        )

      -- ✅ HARD FILTER SCORE: wrong-country questions pushed to -1e9 (preserved verbatim)
      + CASE
          WHEN q.location_label IS NULL OR q.location_label = '' THEN 0.0
          WHEN v_country IS NOT NULL AND q.location_label ILIKE '%' || v_country || '%' THEN 0.0
          ELSE -1000000000.0
        END
    ) AS relevance_score,

    COALESCE(
      (SELECT COUNT(*) FROM public.question_stances qs2 WHERE qs2.question_id = q.id),
      0
    )::bigint AS response_count,

    q.phase,

    -- ✅ Phase-aware feed flag (preserved verbatim)
    CASE
      WHEN EXISTS(
        SELECT 1
        FROM public.user_topic_interactions uti
        WHERE uti.user_id = p_user_id
          AND uti.topic_id = q.topic_id
          AND uti.last_question_phase_seen IS DISTINCT FROM q.phase
      ) THEN true
      ELSE false
    END AS is_new_phase,

    q.cover_image_url          -- ← only addition to RETURN QUERY SELECT

  FROM public.questions q
  JOIN public.topics t ON t.id = q.topic_id
  WHERE
    q.status = 'active'
    AND q.state IN ('new', 'active')

    AND NOT EXISTS(
      SELECT 1
      FROM public.question_stances qs_check
      WHERE qs_check.question_id = q.id
        AND qs_check.user_id = p_user_id
    )

    -- ✅ Location filter (preserved verbatim)
    AND (
      q.location_label IS NULL
      OR q.location_label = ''
      OR (v_country IS NOT NULL AND q.location_label ILIKE '%' || v_country || '%')
    )

  ORDER BY relevance_score DESC, q.published_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_personalized_trending_topics(p_user_id uuid, p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_result jsonb;
begin
  WITH user_topic_follows AS (
    SELECT follow_id as topic_id
    FROM public.user_follows
    WHERE user_id = p_user_id
      AND follow_type = 'topic'
  ),
  user_region AS (
    SELECT
      city_label,
      county_label,
      state_label,
      country_label
    FROM public.user_region_dimensions
    WHERE user_region_dimensions.user_id = p_user_id
    LIMIT 1
  ),
  scored_topics AS (
    SELECT
      t.id,
      t.title,
      t.summary,
      t.tags,
      t.published_at as updated_at,
      t.tier,
      t.location_label,
      COALESCE(t.trending_score, 0) as trending_score,
      COALESCE(t.activity_7d, 0) as activity_7d,
      -- Calculate follow boost
      CASE 
        WHEN EXISTS (SELECT 1 FROM user_topic_follows uf WHERE uf.topic_id = t.id)
        THEN COALESCE(t.trending_score, 0) * 2.0
        ELSE COALESCE(t.trending_score, 0)
      END as follow_boosted_score,
      -- Calculate region boost
      CASE
        WHEN t.location_label = (SELECT city_label FROM user_region WHERE city_label IS NOT NULL) THEN 1.5
        WHEN t.location_label = (SELECT state_label FROM user_region WHERE state_label IS NOT NULL) THEN 1.2
        WHEN t.location_label = (SELECT country_label FROM user_region WHERE country_label IS NOT NULL) THEN 1.1
        ELSE 1.0
      END as region_boost
    FROM public.topics t
    WHERE COALESCE(t.trending_score, 0) > 0
      OR COALESCE(t.activity_7d, 0) > 0
      OR EXISTS (SELECT 1 FROM user_topic_follows uf WHERE uf.topic_id = t.id)
  ),
  personalized_topics AS (
    SELECT
      id,
      title,
      summary,
      tags,
      updated_at,
      tier,
      location_label,
      trending_score,
      activity_7d,
      -- Now we can multiply them because they're already calculated
      (follow_boosted_score * region_boost) as final_score
    FROM scored_topics
    ORDER BY final_score DESC, activity_7d DESC
    LIMIT p_limit
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'title', title,
        'summary', summary,
        'tags', tags,
        'updated_at', updated_at,
        'tier', tier,
        'location_label', location_label,
        'trending_score', trending_score,
        'activity_7d', activity_7d
      )
    ),
    '[]'::jsonb
  ) INTO v_result
  FROM personalized_topics;

  RETURN v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_question_context_timeline(p_question_id uuid)
 RETURNS TABLE(version integer, context_added text, added_at timestamp with time zone, state_change text, link text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_context TEXT;
  v_links TEXT[];
  v_versions TEXT[];
  v_version TEXT;
  v_idx INT;
BEGIN
  -- Get context summary
  SELECT context_summary, supporting_links
  INTO v_context, v_links
  FROM questions
  WHERE id = p_question_id;
  
  IF v_context IS NULL THEN
    RETURN;
  END IF;
  
  -- Split context by version markers
  v_versions := string_to_array(v_context, E'\n\n---\n\n');
  
  -- Return each version
  v_idx := 1;
  FOREACH v_version IN ARRAY v_versions
  LOOP
    RETURN QUERY SELECT 
      v_idx,
      v_version,
      CASE 
        WHEN v_idx = 1 THEN (SELECT published_at FROM questions WHERE id = p_question_id)
        ELSE (SELECT last_context_refresh_at FROM questions WHERE id = p_question_id)
      END,
      ''::TEXT,  -- State changes tracked separately
      CASE 
        WHEN v_idx <= array_length(v_links, 1) THEN v_links[v_idx]
        ELSE NULL
      END;
    v_idx := v_idx + 1;
  END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_question_distribution(p_question_id uuid, p_region text DEFAULT 'Global'::text, p_window_hours integer DEFAULT 168)
 RETURNS TABLE(question_id uuid, region text, responses integer, oppose_pct numeric, neutral_pct numeric, support_pct numeric, avg_score numeric, generated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p_question_id,
    p_region,
    qssr.total_responses,
    qssr.pct_disagree,
    qssr.pct_neutral,
    qssr.pct_agree,
    qssr.avg_score,
    qssr.updated_at
  FROM public.question_stance_stats_region qssr
  WHERE qssr.question_id = p_question_id
    AND qssr.region_scope = 'global'
    AND qssr.region_key = 'global';
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_question_draft_balance(p_election_id uuid)
 RETURNS TABLE(entity_type text, entity_id uuid, entity_name text, entity_abbrev text, draft_count bigint, approved_count bigint, rejected_count bigint, contradiction_count bigint, avg_confidence numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  -- Party balance
  SELECT
    'party'::text,
    p.id,
    p.name,
    p.abbreviation,
    COUNT(*) FILTER (WHERE d.status = 'DRAFT'),
    COUNT(*) FILTER (WHERE d.status = 'APPROVED'),
    COUNT(*) FILTER (WHERE d.status = 'REJECTED'),
    COUNT(*) FILTER (WHERE d.potential_contradiction = true AND d.status = 'DRAFT'),
    ROUND(AVG(d.confidence_score) FILTER (WHERE d.status = 'DRAFT'), 2)
  FROM public.election_question_drafts d
  JOIN public.election_parties p ON p.id = d.party_id
  WHERE d.election_id = p_election_id
    AND d.party_id IS NOT NULL
    AND d.candidate_id IS NULL
  GROUP BY p.id, p.name, p.abbreviation

  UNION ALL

  -- Candidate balance
  SELECT
    'candidate'::text,
    c.id,
    c.full_name,
    COALESCE(p.abbreviation, 'IND'),
    COUNT(*) FILTER (WHERE d.status = 'DRAFT'),
    COUNT(*) FILTER (WHERE d.status = 'APPROVED'),
    COUNT(*) FILTER (WHERE d.status = 'REJECTED'),
    COUNT(*) FILTER (WHERE d.potential_contradiction = true AND d.status = 'DRAFT'),
    ROUND(AVG(d.confidence_score) FILTER (WHERE d.status = 'DRAFT'), 2)
  FROM public.election_question_drafts d
  JOIN public.election_candidates c ON c.id = d.candidate_id
  LEFT JOIN public.election_parties p ON p.id = c.party_id
  WHERE d.election_id = p_election_id
    AND d.candidate_id IS NOT NULL
  GROUP BY c.id, c.full_name, p.abbreviation

  ORDER BY 1, 5 DESC;
  -- 1 = entity_type, 5 = draft_count (column positions required in UNION ALL)
$function$;
CREATE OR REPLACE FUNCTION public.get_question_share_stats(p_question_id uuid)
 RETURNS TABLE(platform public.share_platform, share_count bigint, click_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    se.platform,
    count(se.id)         AS share_count,
    sum(se.click_count)  AS click_count
  FROM public.share_events se
  WHERE se.question_id = p_question_id
  GROUP BY se.platform
  ORDER BY share_count DESC;
$function$;
CREATE OR REPLACE FUNCTION public.get_question_stats_for_user(p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_user_id   uuid := auth.uid();
  me          public.user_region_dimensions%rowtype;
  v_my_stance integer;
  v_regions   jsonb := '{}'::jsonb;
begin
  -- Anonymous caller: just return global stats if present
  if v_user_id is null then
    return jsonb_build_object(
      'my_stance', null,
      'location', null,
      'regions',
        jsonb_build_object(
          'global',
          (
            select to_jsonb(q)
            from public.question_stance_stats_region q
            where q.question_id = p_question_id
              and q.region_scope = 'global'
              and q.region_key   = 'global'
          )
        )
    );
  end if;

  -- Caller location
  select *
  into me
  from public.user_region_dimensions urd
  where urd.user_id = v_user_id;

  -- My stance (if any)
  select qs.score
  into v_my_stance
  from public.question_stances qs
  where qs.question_id = p_question_id
    and qs.user_id     = v_user_id;

  -- Always include global
  v_regions :=
    v_regions || jsonb_build_object(
      'global',
      (
        select to_jsonb(q)
        from public.question_stance_stats_region q
        where q.question_id = p_question_id
          and q.region_scope = 'global'
          and q.region_key   = 'global'
      )
    );

  -- CITY (by label)
  if me.city_label is not null then
    v_regions :=
      v_regions || jsonb_build_object(
        'city',
        (
          select to_jsonb(q)
          from public.question_stance_stats_region q
          where q.question_id   = p_question_id
            and q.region_scope  = 'city'
            and q.region_label  = me.city_label
        )
      );
  end if;

  -- COUNTY
  if me.county_label is not null then
    v_regions :=
      v_regions || jsonb_build_object(
        'county',
        (
          select to_jsonb(q)
          from public.question_stance_stats_region q
          where q.question_id   = p_question_id
            and q.region_scope  = 'county'
            and q.region_label  = me.county_label
        )
      );
  end if;

  -- STATE
  if me.state_label is not null then
    v_regions :=
      v_regions || jsonb_build_object(
        'state',
        (
          select to_jsonb(q)
          from public.question_stance_stats_region q
          where q.question_id   = p_question_id
            and q.region_scope  = 'state'
            and q.region_label  = me.state_label
        )
      );
  end if;

  -- COUNTRY
  if me.country_label is not null then
    v_regions :=
      v_regions || jsonb_build_object(
        'country',
        (
          select to_jsonb(q)
          from public.question_stance_stats_region q
          where q.question_id   = p_question_id
            and q.region_scope  = 'country'
            and q.region_label  = me.country_label
        )
      );
  end if;

  return jsonb_build_object(
    'my_stance', v_my_stance,
    'location', jsonb_build_object(
      'city',    me.city_label,
      'county',  me.county_label,
      'state',   me.state_label,
      'country', me.country_label
    ),
    'regions', v_regions
  );
end;
$function$;
create or replace view "public"."v_live_questions" as  SELECT q.id,
    q.question,
    q.summary,
    q.tags,
    q.location_label,
    q.published_at,
    q.status,
    q.cover_image_url,
    q.phase,
    t.title AS topic_title,
    q.origin_location_label,
    q.audience_location_label,
    q.slider_low_label,
    q.slider_high_label
   FROM ((public.questions q
     JOIN public.topics t ON ((t.id = q.topic_id)))
     LEFT JOIN public.question_visibility_rules vr ON ((vr.question_id = q.id)))
  WHERE ((q.status = 'active'::text) AND (q.published_at IS NOT NULL) AND ((vr.visibility IS NULL) OR (vr.visibility = 'visible'::public.question_visibility_enum)));
CREATE OR REPLACE FUNCTION public.get_questions_for_topic(p_topic_id uuid, p_limit integer DEFAULT 50)
 RETURNS SETOF public.v_live_questions
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'auth'
AS $function$
  with canonical as (
    select public.get_canonical_topic_id(p_topic_id) as canonical_id
  ),
  related_topics as (
    select t.*
    from public.topics t
    join canonical c
      on c.canonical_id is not null
     and (t.id = c.canonical_id or t.parent_topic_id = c.canonical_id)
  ),
  draft_ids as (
    select distinct t.draft_id
    from related_topics t
    where t.draft_id is not null
  )
  select v.*
  from public.v_live_questions v
  join public.questions q
    on q.id = v.id
  where exists (
    select 1
    from draft_ids d
    where d.draft_id = q.topic_draft_id
  )
  order by v.published_at desc
  limit coalesce(p_limit, 50);
$function$;
CREATE OR REPLACE FUNCTION public.get_regional_comparison(p_question_id uuid)
 RETURNS TABLE(region_scope text, region_key text, region_label text, total_responses integer, pct_support numeric, pct_neutral numeric, pct_oppose numeric, avg_score numeric, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.region_scope,
    r.region_key,
    r.region_label,
    r.total_responses,
    r.pct_agree    as pct_support,
    r.pct_neutral,
    r.pct_disagree as pct_oppose,
    r.avg_score,
    r.updated_at
  from public.question_stance_stats_region r
  where r.question_id = p_question_id
    and r.total_responses > 0
  order by
    case r.region_scope
      when 'city'    then 1
      when 'county'  then 2
      when 'state'   then 3
      when 'country' then 4
      when 'global'  then 5
      else 6
    end;
$function$;
CREATE OR REPLACE FUNCTION public.get_related_questions_for_display(p_question_id uuid, p_limit integer DEFAULT 5)
 RETURNS TABLE(question_id uuid, question text, summary text, tags text[], link_type text, score numeric, response_count bigint, method text)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    q.id,
    q.question,
    COALESCE(q.context_summary, q.summary) as summary,
    q.tags,
    ql.link_type,
    ql.score,
    (SELECT COUNT(*) FROM question_stances WHERE question_id = q.id) as responses,
    ql.method
  FROM question_links ql
  JOIN questions q ON q.id = ql.to_question_id
  WHERE ql.from_question_id = p_question_id
    AND q.state IN ('new', 'active')
  ORDER BY ql.score DESC, responses DESC
  LIMIT p_limit;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_reopened_questions(p_user_id uuid DEFAULT NULL::uuid, p_location_tier text DEFAULT 'global'::text, p_limit integer DEFAULT 10)
 RETURNS TABLE(question_id uuid, question text, summary text, tags text[], current_state text, previous_state text, state_changed_at timestamp without time zone, days_since_reopened integer, is_recently_reopened boolean, reopening_reason text, responses_since_reopened integer, unique_responders_since_reopened integer, user_has_answered boolean, user_stance_value integer, user_answered_date timestamp with time zone, topic_id uuid, topic_title text, topic_tags text[], is_trending boolean, trending_score numeric, location_label text, tier text, reopened_summary text)
 LANGUAGE sql
 STABLE
AS $function$
WITH state_changes AS (
  -- Step 1: Identify questions that recently changed state
  SELECT
    q.id as question_id,
    q.question,
    q.summary,
    q.tags,
    q.state::TEXT as current_state,
    q.phase as previous_state,
    q.state_changed_at,
    EXTRACT(DAY FROM NOW() - q.state_changed_at::TIMESTAMP WITH TIME ZONE)::INT as days_since_changed,
    
    -- Determine if this is a reopening
    CASE
      -- Reopened = moved back to active/new from cooling/dormant/resolved
      WHEN q.state::TEXT = 'active' AND q.phase IN ('cooling', 'dormant', 'resolution') THEN true
      WHEN q.state::TEXT = 'new' AND q.phase IN ('cooling', 'dormant', 'resolution') THEN true
      ELSE false
    END as is_reopened,
    
    -- Reason for reopening
    CASE
      WHEN q.state::TEXT = 'active' AND q.phase = 'resolution' THEN 'Reopened after resolution'
      WHEN q.state::TEXT = 'active' AND q.phase = 'cooling' THEN 'Regained community interest'
      WHEN q.state::TEXT = 'active' AND q.phase = 'dormant' THEN 'Reactivated from dormant'
      WHEN q.state::TEXT = 'new' AND q.phase = 'cooling' THEN 'New angle discovered'
      ELSE 'State changed'
    END as reopening_reason,
    
    -- New responses since state change
    (SELECT COUNT(*)::INT
     FROM question_stances qs
     WHERE qs.question_id = q.id
       AND qs.created_at > q.state_changed_at::TIMESTAMP WITH TIME ZONE) as responses_since_change,
    
    -- Unique responders since change
    (SELECT COUNT(DISTINCT user_id)::INT
     FROM question_stances qs
     WHERE qs.question_id = q.id
       AND qs.created_at > q.state_changed_at::TIMESTAMP WITH TIME ZONE) as unique_responders_since_change,
    
    q.topic_id,
    q.location_label,
    q.tier,
    q.is_trending,
    q.trending_score
  FROM public.questions q
  WHERE q.state::TEXT NOT IN ('archived', 'historical')
    AND q.published_at IS NOT NULL
),

filtered_reopened AS (
  -- Step 2: Filter for actual reopenings that are recent
  SELECT
    sc.*,
    ROW_NUMBER() OVER (ORDER BY sc.state_changed_at DESC) as rank
  FROM state_changes sc
  WHERE sc.is_reopened = true
    AND sc.days_since_changed <= 30  -- Changed in last 30 days
),

with_topic_data AS (
  -- Step 3: Add topic information
  SELECT
    fr.*,
    t.title as topic_title,
    t.tags as topic_tags
  FROM filtered_reopened fr
  LEFT JOIN public.topics t ON t.id = fr.topic_id
),

with_user_context AS (
  -- Step 4: Add user context if provided
  SELECT
    wtd.*,
    (qs.id IS NOT NULL) as user_has_answered,
    qs.score::INT as user_stance_value,
    qs.created_at as user_answered_date
  FROM with_topic_data wtd
  LEFT JOIN question_stances qs
    ON qs.question_id = wtd.question_id
    AND qs.user_id = p_user_id
)

-- Final: Return with location filtering and summary
SELECT
  wuc.question_id,
  wuc.question,
  wuc.summary,
  wuc.tags,
  
  wuc.current_state,
  wuc.previous_state,
  wuc.state_changed_at,
  
  wuc.days_since_changed as days_since_reopened,
  true as is_recently_reopened,
  wuc.reopening_reason,
  
  wuc.responses_since_change as responses_since_reopened,
  wuc.unique_responders_since_change as unique_responders_since_reopened,
  
  wuc.user_has_answered,
  wuc.user_stance_value,
  wuc.user_answered_date,
  
  wuc.topic_id,
  wuc.topic_title,
  wuc.topic_tags,
  
  wuc.is_trending,
  wuc.trending_score,
  
  wuc.location_label,
  wuc.tier,
  
  -- Summary text
  wuc.question || ' was ' || wuc.reopening_reason || ' (' || 
  wuc.days_since_changed || ' days ago). ' ||
  COALESCE(wuc.responses_since_change::TEXT, '0') || ' new responses.' as reopened_summary
  
FROM with_user_context wuc
WHERE 
  -- Region filtering
  CASE
    WHEN p_location_tier = 'city' THEN wuc.tier = 'city'
    WHEN p_location_tier = 'state' THEN wuc.tier = 'state'
    WHEN p_location_tier = 'country' THEN wuc.tier = 'country'
    ELSE wuc.tier IS NOT NULL OR wuc.tier IS NULL  -- Include all for global
  END
ORDER BY wuc.state_changed_at DESC
LIMIT p_limit;

$function$;
CREATE OR REPLACE FUNCTION public.get_reopened_questions_for_user(p_region text DEFAULT 'Global'::text, p_limit integer DEFAULT 3, p_min_shift numeric DEFAULT 1.0, p_min_age_days integer DEFAULT 30)
 RETURNS TABLE(question_id uuid, question_text text, last_answered_at timestamp with time zone, public_shift_proxy numeric, reason text, generated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_current_user uuid;
BEGIN
    -- Get authenticated user
    v_current_user := auth.uid();
    IF v_current_user IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    
    RETURN QUERY
    WITH user_old_answers AS (
        -- Find questions user answered more than p_min_age_days ago
        SELECT 
            qs.question_id,
            qs.score as user_score,
            qs.created_at as last_answered_at,
            q.question as question_text
        FROM public.question_stances qs
        JOIN public.questions q ON q.id = qs.question_id
        JOIN public.topics t ON t.id = q.topic_id
        WHERE qs.user_id = v_current_user
            AND qs.created_at < NOW() - (p_min_age_days || ' days')::interval
            AND CASE 
                WHEN p_region = 'United States' THEN 
                    COALESCE(q.location_label, t.location_label) IN ('United States', 'Global')
                    OR COALESCE(q.location_label, t.location_label) IS NULL
                WHEN p_region = 'Global' THEN 
                    TRUE
                ELSE 
                    COALESCE(q.location_label, t.location_label) = p_region
            END
    ),
    with_current_stats AS (
        -- Compare user's old score with current community average
        SELECT 
            uoa.question_id,
            uoa.question_text,
            uoa.last_answered_at,
            uoa.user_score,
            qsr.avg_score as current_avg_score,
            
            -- Approximation: divergence between user score and current avg
            -- On -2 to +2 scale, divergence of 1.0 = significant shift
            ABS(uoa.user_score - COALESCE(qsr.avg_score, 0)) as score_divergence
            
        FROM user_old_answers uoa
        LEFT JOIN public.question_stance_stats_region qsr 
            ON qsr.question_id = uoa.question_id
            AND CASE 
                WHEN p_region = 'Global' THEN 
                    qsr.region_scope = 'global' AND qsr.region_key = 'Global'
                ELSE 
                    qsr.region_scope = 'country' AND qsr.region_key = p_region
            END
        WHERE qsr.avg_score IS NOT NULL  -- Only include questions with current stats
    )
    SELECT 
        wcs.question_id,
        wcs.question_text,
        wcs.last_answered_at,
        wcs.score_divergence as public_shift_proxy,
        CASE 
            WHEN wcs.score_divergence >= 1.5 THEN 'Public opinion has shifted significantly'
            WHEN wcs.score_divergence >= 1.0 THEN 'Public opinion has shifted moderately'
            WHEN wcs.score_divergence >= 0.5 THEN 'Public opinion has shifted slightly'
            ELSE 'Slight change detected'
        END as reason,
        NOW() as generated_at
    FROM with_current_stats wcs
    WHERE wcs.score_divergence >= p_min_shift
    ORDER BY wcs.score_divergence DESC, wcs.last_answered_at ASC
    LIMIT p_limit;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_since_last_visit_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_last_visit timestamptz;

  v_location_id uuid;
  v_location_type text;
  v_region_label text;

  v_highlights jsonb;
begin
  -- Last visit (v1 definition)
  select u.last_sign_in_at
    into v_last_visit
  from auth.users u
  where u.id = v_user_id;

  if v_last_visit is null then
    v_last_visit := now() - interval '7 days';
  end if;

  -- Determine user's most specific location_id (city → county → state → country → global)
  select l.id, l.type::text
    into v_location_id, v_location_type
  from public.user_location_settings uls
  join public.locations l on l.id = uls.location_id
  where uls.user_id = v_user_id
  order by
    case l.type
      when 'city'    then 1
      when 'county'  then 2
      when 'state'   then 3
      when 'country' then 4
      else 5
    end
  limit 1;

  -- Fallback to global if user has no location
  if v_location_id is null then
    select l.id, l.type::text
      into v_location_id, v_location_type
    from public.locations l
    where l.type = 'global'::public.location_tier_enum
    limit 1;
  end if;

  -- Region label from user_region_dimensions view (or fallback to location name)
  select
    case v_location_type
      when 'city'    then urd.city_label
      when 'county'  then urd.county_label
      when 'state'   then urd.state_label
      when 'country' then urd.country_label
      else urd.global_label
    end
  into v_region_label
  from public.user_region_dimensions urd
  where urd.user_id = v_user_id;

  if v_region_label is null then
    -- fallback to location name
    select l.name into v_region_label
    from public.locations l
    where l.id = v_location_id;

    if v_region_label is null then
      v_region_label := 'Global';
    end if;
  end if;

  -- Build highlights from trending engine
  select jsonb_agg(
    jsonb_build_object(
      'topic_id', t.topic_id,
      'title', t.title,
      'trending_score', t.trending_score,
      'activity_7d', t.activity_7d,
      'message', format('%s is trending in %s.', t.title, v_region_label)
    )
  )
  into v_highlights
  from (
    select
      tr.id as topic_id,
      tr.title,
      tr.trending_score,
      tr.activity_7d,
      tr.updated_at
    from public.topic_region_trends_v tr
    where tr.location_id = v_location_id
      and tr.updated_at >= v_last_visit
    order by tr.trending_score desc, tr.activity_7d desc, tr.updated_at desc
    limit 3
  ) t;

  if v_highlights is null then
    v_highlights := jsonb_build_array(
      jsonb_build_object(
        'message',
        format('No major shifts in %s since your last visit.', v_region_label)
      )
    );
  end if;

  return jsonb_build_object(
    'last_visit_at', v_last_visit,
    'region', jsonb_build_object(
      'type', v_location_type,
      'label', v_region_label,
      'location_id', v_location_id
    ),
    'highlights', v_highlights
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_since_last_visited()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_last_seen timestamp with time zone;
  v_days_away int;
  v_city text;
  v_county text;
  v_state text;
  v_country text;
  v_scope text;
  v_label text;
  v_changes jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Get user's last_seen_at
  select last_seen_at into v_last_seen
  from public.profiles
  where user_id = v_uid;

  -- If never seen before, set to 7 days ago as default
  if v_last_seen is null then
    v_last_seen := now() - interval '7 days';
  end if;

  -- Calculate days away
  v_days_away := EXTRACT(day FROM (now() - v_last_seen))::int;

  -- Get user's region
  select city_label, county_label, state_label, country_label
    into v_city, v_county, v_state, v_country
  from public.user_region_dimensions
  where user_id = v_uid;

  v_scope := case
    when v_city is not null then 'city'
    when v_county is not null then 'county'
    when v_state is not null then 'state'
    when v_country is not null then 'country'
    else 'global'
  end;

  v_label := case v_scope
    when 'city' then v_city
    when 'county' then v_county
    when 'state' then v_state
    when 'country' then v_country
    else 'Global'
  end;

  -- Find topics with significant changes
  -- Strategy: Compare avg stance before last_seen vs after last_seen
  with user_topics as (
    -- Topics the user has answered
    select distinct q.topic_id
    from public.question_stances qs
    join public.questions q on q.id = qs.question_id
    where qs.user_id = v_uid
      and q.topic_id is not null
  ),
  topic_changes as (
    select
      t.id as topic_id,
      t.title as topic_title,
      -- Stance average BEFORE user left
      (
        select avg(qs.score)
        from public.question_stances qs
        join public.questions q on q.id = qs.question_id
        where q.topic_id = t.id
          and qs.created_at < v_last_seen
          and qs.created_at > v_last_seen - interval '30 days'
      ) as avg_before,
      -- Stance average AFTER user left
      (
        select avg(qs.score)
        from public.question_stances qs
        join public.questions q on q.id = qs.question_id
        where q.topic_id = t.id
          and qs.created_at >= v_last_seen
      ) as avg_after,
      -- Response count since user left
      (
        select count(*)
        from public.question_stances qs
        join public.questions q on q.id = qs.question_id
        where q.topic_id = t.id
          and qs.created_at >= v_last_seen
      ) as new_responses
    from public.topics t
    where exists (
      select 1 from user_topics ut where ut.topic_id = t.id
    )
  ),
  significant_changes as (
    select
      topic_id,
      topic_title,
      avg_before,
      avg_after,
      (avg_after - avg_before) as delta,
      new_responses,
      case
        when (avg_after - avg_before) > 0.3 then 'shifted_positive'
        when (avg_after - avg_before) < -0.3 then 'shifted_negative'
        when new_responses > 10 then 'gaining_attention'
        else 'stable'
      end as change_type
    from topic_changes
    where avg_before is not null 
      and avg_after is not null
      and (
        abs(avg_after - avg_before) > 0.3  -- Significant shift
        or new_responses > 10              -- High activity
      )
    order by abs(avg_after - avg_before) desc, new_responses desc
    limit 3
  )
  select jsonb_agg(
    jsonb_build_object(
      'topic_id', topic_id,
      'topic_title', topic_title,
      'change_type', change_type,
      'delta', round(delta::numeric, 2),
      'new_responses', new_responses
    )
  ) into v_changes
  from significant_changes;

  -- Build response
  return jsonb_build_object(
    'last_seen_at', v_last_seen,
    'days_away', v_days_away,
    'region', jsonb_build_object(
      'scope', v_scope,
      'label', v_label
    ),
    'changes', coalesce(v_changes, '[]'::jsonb),
    'has_changes', coalesce(jsonb_array_length(v_changes), 0) > 0
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_societal_pulse_homepage(p_region_label text DEFAULT 'Global'::text, p_topic_pick_n integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE
  v_rapid_shift_delta_per_hour numeric;
  v_momentum_active_24h numeric;
  v_quiet_7d_threshold_daily numeric;
  v_reawakening_min_total_24h numeric;
  v_reawakening_spike_multiplier numeric;
  v_polarization_threshold numeric;
  v_min_sample_size numeric;
  v_breadth_low numeric;
  v_breadth_high numeric;

  v_rapid_shift_count int;
  v_polarized_count   int;
  v_reawakening_count int;
  v_active_count      int;
  v_breadth           numeric;

  v_state      text;
  v_t1         text;
  v_t2         text;
  v_t3         text;
  v_sentence_1 text;
  v_sentence_2 text;
  v_updated_at timestamptz;

  -- ← new: holds chip JSON so it survives outside the CTE block
  v_chips_json jsonb;
BEGIN

  -- ── Load config (with fallback defaults) ──
  BEGIN
    SELECT
      COALESCE(MAX(value) FILTER (WHERE key = 'rapid_shift_delta_per_hour'), 0.4),
      COALESCE(MAX(value) FILTER (WHERE key = 'momentum_active_24h'), 0.5),
      COALESCE(MAX(value) FILTER (WHERE key = 'quiet_7d_threshold_daily'), 5),
      COALESCE(MAX(value) FILTER (WHERE key = 'reawakening_min_total_24h'), 10),
      COALESCE(MAX(value) FILTER (WHERE key = 'reawakening_spike_multiplier'), 2),
      COALESCE(MAX(value) FILTER (WHERE key = 'polarization_threshold'), 0.60),
      COALESCE(MAX(value) FILTER (WHERE key = 'min_sample_size'), 10),
      COALESCE(MAX(value) FILTER (WHERE key = 'breadth_low_threshold'), 0.12),
      COALESCE(MAX(value) FILTER (WHERE key = 'breadth_high_threshold'), 0.25)
    INTO
      v_rapid_shift_delta_per_hour, v_momentum_active_24h, v_quiet_7d_threshold_daily,
      v_reawakening_min_total_24h,  v_reawakening_spike_multiplier, v_polarization_threshold,
      v_min_sample_size, v_breadth_low, v_breadth_high
    FROM public.societal_pulse_config;
  EXCEPTION WHEN OTHERS THEN
    v_rapid_shift_delta_per_hour := 0.4;  v_momentum_active_24h      := 0.5;
    v_quiet_7d_threshold_daily   := 5;    v_reawakening_min_total_24h := 10;
    v_reawakening_spike_multiplier := 2;  v_polarization_threshold   := 0.60;
    v_min_sample_size := 10; v_breadth_low := 0.12; v_breadth_high := 0.25;
  END;

  -- ── Main data query — captures metrics, topic titles AND chip JSON
  --    in a single statement so all CTEs remain in scope ──
  WITH mv_freshness AS (
    SELECT EXISTS (
      SELECT 1 FROM public.topic_pulse_metrics_mv
      WHERE region_label = p_region_label
        AND materialized_at >= NOW() - INTERVAL '24 hours'
      LIMIT 1
    ) AS is_fresh
  ),

  base_data AS (
    SELECT
      topic_id, topic_title, region_label, total_7d, total_24h,
      momentum_24h, momentum_7d, delta_24h_per_hour, polarization_score, movement_score,
      (delta_24h_per_hour >= v_rapid_shift_delta_per_hour
        OR (momentum_24h >= v_momentum_active_24h
            AND delta_24h_per_hour >= (v_rapid_shift_delta_per_hour * 0.5))
      ) AS is_rapid_shift,
      (total_24h >= v_reawakening_min_total_24h
        AND (total_7d::numeric / 7.0) < v_quiet_7d_threshold_daily
        AND total_24h > ((total_7d::numeric / 7.0) * v_reawakening_spike_multiplier)
      ) AS is_reawakening,
      (polarization_score >= v_polarization_threshold) AS is_polarized,
      (momentum_24h >= v_momentum_active_24h) AS is_active,
      updated_at
    FROM public.topic_pulse_metrics_mv mv
    CROSS JOIN mv_freshness mf
    WHERE mf.is_fresh
      AND mv.region_label = p_region_label
      AND mv.total_7d >= v_min_sample_size

    UNION ALL

    SELECT
      tr.topic_id, t.title AS topic_title, l.name AS region_label,
      tr.total AS total_7d, tr.total_24h, tr.momentum_24h, tr.momentum_7d,
      tr.delta_24h_per_hour, tr.polarization_score, tr.movement_score,
      (tr.delta_24h_per_hour >= v_rapid_shift_delta_per_hour
        OR (tr.momentum_24h >= v_momentum_active_24h
            AND tr.delta_24h_per_hour >= (v_rapid_shift_delta_per_hour * 0.5))
      ) AS is_rapid_shift,
      (tr.total_24h >= v_reawakening_min_total_24h
        AND (tr.total::numeric / 7.0) < v_quiet_7d_threshold_daily
        AND tr.total_24h > ((tr.total::numeric / 7.0) * v_reawakening_spike_multiplier)
      ) AS is_reawakening,
      (tr.polarization_score >= v_polarization_threshold) AS is_polarized,
      (tr.momentum_24h >= v_momentum_active_24h) AS is_active,
      tr.updated_at
    FROM public.topic_region_trends tr
    JOIN public.topics t    ON t.id = tr.topic_id
    JOIN public.locations l ON l.id = tr.location_id
    CROSS JOIN mv_freshness mf
    WHERE NOT mf.is_fresh
      AND l.name = p_region_label
      AND t.title IS NOT NULL
      AND t.parent_topic_id IS NULL
      AND tr.total >= v_min_sample_size
  ),

  topn AS (
    SELECT * FROM base_data
    ORDER BY movement_score DESC NULLS LAST
    LIMIT p_topic_pick_n
  ),

  metrics AS (
    SELECT
      COUNT(*) FILTER (WHERE is_rapid_shift) AS rapid_shift_count,
      COUNT(*) FILTER (WHERE is_reawakening) AS reawakening_count,
      COUNT(*) FILTER (WHERE is_polarized)   AS polarized_count,
      COUNT(*) FILTER (WHERE is_active)      AS active_count,
      COUNT(*)                               AS total_count,
      MAX(updated_at)                        AS latest_update
    FROM topn
  ),

  chip_picks AS (
    WITH p0   AS (SELECT * FROM topn ORDER BY movement_score DESC LIMIT 1),
         p1   AS (SELECT * FROM topn WHERE is_rapid_shift   AND topic_id NOT IN (SELECT topic_id FROM p0) ORDER BY delta_24h_per_hour DESC NULLS LAST, movement_score DESC LIMIT 1),
         p2   AS (SELECT * FROM topn WHERE is_reawakening   AND topic_id NOT IN (SELECT topic_id FROM p0 UNION ALL SELECT topic_id FROM p1) ORDER BY delta_24h_per_hour DESC NULLS LAST, movement_score DESC LIMIT 1),
         p3   AS (SELECT * FROM topn WHERE is_polarized     AND topic_id NOT IN (SELECT topic_id FROM p0 UNION ALL SELECT topic_id FROM p1 UNION ALL SELECT topic_id FROM p2) ORDER BY total_24h DESC, movement_score DESC LIMIT 1),
         fill AS (SELECT * FROM topn WHERE topic_id NOT IN  (SELECT topic_id FROM p0 UNION ALL SELECT topic_id FROM p1 UNION ALL SELECT topic_id FROM p2 UNION ALL SELECT topic_id FROM p3) ORDER BY movement_score DESC LIMIT 3),
         all_picks AS (SELECT * FROM p0 UNION ALL SELECT * FROM p1 UNION ALL SELECT * FROM p2 UNION ALL SELECT * FROM p3 UNION ALL SELECT * FROM fill)
    SELECT * FROM all_picks ORDER BY movement_score DESC LIMIT 3
  ),

  topic_titles AS (
    SELECT
      MAX(topic_title) FILTER (WHERE rn = 1) AS t1,
      MAX(topic_title) FILTER (WHERE rn = 2) AS t2,
      MAX(topic_title) FILTER (WHERE rn = 3) AS t3
    FROM (
      SELECT topic_title, ROW_NUMBER() OVER (ORDER BY movement_score DESC) AS rn
      FROM chip_picks
    ) x
  ),

  -- ← Build chip JSON inside the same CTE chain so chip_picks is still in scope
  chips_built AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'topic_id', cp.topic_id,
          'title',    cp.topic_title,
          'icon',     CASE
                        WHEN cp.is_reawakening THEN 'reawakening'
                        WHEN cp.is_polarized   THEN 'polarized'
                        WHEN cp.is_rapid_shift THEN 'up'
                        ELSE 'steady'
                      END,
          'href', '/topics/' || cp.topic_id::text
        ) ORDER BY cp.movement_score DESC
      ),
      '[]'::jsonb
    ) AS chips
    FROM chip_picks cp
  )

  -- Single SELECT captures everything into variables
  SELECT
    m.rapid_shift_count,
    m.reawakening_count,
    m.polarized_count,
    m.active_count,
    CASE WHEN m.total_count > 0
         THEN (m.active_count::numeric / m.total_count::numeric)
         ELSE 0 END,
    m.latest_update,
    tt.t1, tt.t2, tt.t3,
    cb.chips
  INTO
    v_rapid_shift_count, v_reawakening_count, v_polarized_count, v_active_count,
    v_breadth, v_updated_at,
    v_t1, v_t2, v_t3,
    v_chips_json                  -- ← captured here
  FROM metrics m
  CROSS JOIN topic_titles tt
  CROSS JOIN chips_built cb;

  -- ── Determine state ──
  IF    COALESCE(v_active_count, 0) <= 2
     OR (COALESCE(v_breadth, 0) < v_breadth_low AND COALESCE(v_rapid_shift_count, 0) = 0)
  THEN  v_state := 'STABLE';
  ELSIF COALESCE(v_reawakening_count, 0) >= 2 AND COALESCE(v_rapid_shift_count, 0) <= 2
  THEN  v_state := 'REAWAKENING';
  ELSIF COALESCE(v_polarized_count, 0) >= 2
     OR (COALESCE(v_polarized_count, 0) = 1 AND COALESCE(v_rapid_shift_count, 0) >= 2)
  THEN  v_state := 'POLARIZING';
  ELSIF COALESCE(v_breadth, 0) >= v_breadth_high AND COALESCE(v_rapid_shift_count, 0) >= 3
  THEN  v_state := 'ACCELERATING';
  ELSE  v_state := 'FOCUSED';
  END IF;

  v_t1 := COALESCE(v_t1, 'key topics');
  v_t2 := COALESCE(v_t2, 'public discussion');

  -- ── Build narrative sentences ──
  CASE v_state
    WHEN 'STABLE' THEN
      v_sentence_1 := format('Most major topics are showing limited directional change right now, including %s and %s.', v_t1, v_t2);
      v_sentence_2 := 'Stance signals look relatively steady, with few rapid shifts over the last 24 hours.';
    WHEN 'REAWAKENING' THEN
      v_sentence_1 := format('Conversation is reactivating around %s and %s, with renewed stance activity after a quieter period.', v_t1, v_t2);
      v_sentence_2 := CASE WHEN v_t3 IS NOT NULL
        THEN format('Early signals suggest engagement is returning, and positions are still forming — especially on %s.', v_t3)
        ELSE 'Early signals suggest engagement is returning, and positions are still forming.' END;
    WHEN 'POLARIZING' THEN
      v_sentence_1 := format('Stance signals are diverging most sharply on %s and %s, with regional alignment beginning to split.', v_t1, v_t2);
      v_sentence_2 := CASE WHEN v_t3 IS NOT NULL
        THEN format('Engagement remains strong, and polarization cues are becoming more visible — particularly around %s.', v_t3)
        ELSE 'Engagement remains strong, and polarization cues are becoming more visible.' END;
    WHEN 'ACCELERATING' THEN
      v_sentence_1 := format('Multiple topics are shifting at once — led by %s and %s — with noticeable stance movement over the past 48 hours.', v_t1, v_t2);
      v_sentence_2 := CASE WHEN v_t3 IS NOT NULL
        THEN format('Momentum is broad rather than isolated, and %s is also seeing rapid re-evaluation.', v_t3)
        ELSE 'Momentum is broad rather than isolated, with rapid re-evaluation across several topics.' END;
    ELSE
      v_sentence_1 := format('Movement is concentrated around %s and %s, where stance intensity is changing faster than most other topics.', v_t1, v_t2);
      v_sentence_2 := CASE WHEN v_t3 IS NOT NULL
        THEN format('Outside of those, signals look steadier — though %s is beginning to pick up.', v_t3)
        ELSE 'Outside of those, signals look steadier.' END;
  END CASE;

  -- ── Return final JSON — uses v_chips_json variable, not chip_picks CTE ──
  RETURN jsonb_build_object(
    'region_label',  p_region_label,
    'updated_at',    to_char(timezone('UTC', COALESCE(v_updated_at, NOW())), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'state',         v_state,
    'narrative',     jsonb_build_object(
                       'title',      'Societal Pulse',
                       'sentence_1', v_sentence_1,
                       'sentence_2', v_sentence_2
                     ),
    'micro_metrics', jsonb_build_array(
                       jsonb_build_object('label', 'topics shifting rapidly', 'value', COALESCE(v_rapid_shift_count, 0)),
                       jsonb_build_object('label', 'polarized',               'value', COALESCE(v_polarized_count,   0)),
                       jsonb_build_object('label', 'reawakening',             'value', COALESCE(v_reawakening_count, 0))
                     ),
    'chips',         COALESCE(v_chips_json, '[]'::jsonb)
  );

END;
$function$;
CREATE OR REPLACE FUNCTION public.get_society_pulse(p_region text DEFAULT 'Global'::text, p_shift_threshold numeric DEFAULT 0.08)
 RETURNS TABLE(region text, rapid_shifts_count integer, polarized_count integer, reawakening_count integer, volatility_level text, top_shift_question_id uuid, top_shift_question_text text, generated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH momentum_metrics AS (
    -- Get momentum data from existing view (columns verified: unique_users_24h, unique_users_7d, velocity_6h)
    SELECT 
        m.question_id,
        m.unique_users_24h,
        m.unique_users_7d,
        m.velocity_6h,
        
        -- Calculate shift rate (24h activity vs 7d baseline)
        CASE 
            WHEN m.unique_users_7d > 0 THEN
                ABS((m.unique_users_24h::numeric / (m.unique_users_7d / 7.0)) - 1.0)
            ELSE 0
        END as shift_rate
        
    FROM public.question_stance_momentum_region_v m
    WHERE 
        CASE 
            WHEN p_region = 'Global' THEN 
                m.region_scope = 'global'
            ELSE 
                m.region_scope = 'country' AND m.region_key = p_region
        END
        AND m.unique_users_24h > 0
),
distribution_metrics AS (
    -- Get current stance distributions for polarization detection
    SELECT 
        qsr.question_id,
        qsr.pct_agree,
        qsr.pct_disagree,
        qsr.total_responses,
        
        -- FIXED: Polarization score - closer to 0 = more polarized (50/50 split)
        ABS(COALESCE(qsr.pct_agree, 0) - COALESCE(qsr.pct_disagree, 0)) as polarization_gap
        
    FROM public.question_stance_stats_region qsr
    WHERE 
        CASE 
            WHEN p_region = 'Global' THEN 
                qsr.region_scope = 'global'
            ELSE 
                qsr.region_scope = 'country' AND qsr.region_key = p_region
        END
        AND qsr.total_responses >= 10  -- Minimum responses for meaningful polarization
),
aggregated_stats AS (
    SELECT 
        -- Rapid shifts: questions with high momentum change
        COUNT(*) FILTER (WHERE mm.shift_rate >= p_shift_threshold) as rapid_shifts_count,
        
        -- Polarized: questions with small gap (near 50/50 split)
        -- FIXED: polarization_gap <= 10 means within 10% of 50/50
        COUNT(*) FILTER (WHERE dm.polarization_gap <= 10) as polarized_count,
        
        -- Reawakening: questions with recent activity after being dormant
        COUNT(*) FILTER (
            WHERE mm.velocity_6h > 0 
            AND mm.unique_users_7d <= 5
        ) as reawakening_count,
        
        -- Top shifting question
        (SELECT mm2.question_id 
         FROM momentum_metrics mm2 
         ORDER BY mm2.shift_rate DESC 
         LIMIT 1
        ) as top_shift_question_id
        
    FROM momentum_metrics mm
    FULL OUTER JOIN distribution_metrics dm ON dm.question_id = mm.question_id
)
SELECT 
    p_region as region,
    COALESCE(s.rapid_shifts_count, 0)::int,
    COALESCE(s.polarized_count, 0)::int,
    COALESCE(s.reawakening_count, 0)::int,
    
    -- Volatility level based on rapid shifts
    CASE 
        WHEN COALESCE(s.rapid_shifts_count, 0) >= 5 THEN 'High'
        WHEN COALESCE(s.rapid_shifts_count, 0) >= 2 THEN 'Medium'
        ELSE 'Low'
    END as volatility_level,
    
    s.top_shift_question_id,
    q.question as top_shift_question_text,
    NOW() as generated_at
    
FROM aggregated_stats s
LEFT JOIN public.questions q ON q.id = s.top_shift_question_id;
$function$;
CREATE OR REPLACE FUNCTION public.get_society_pulse_early_stage(p_region text DEFAULT 'Global'::text, p_top_n integer DEFAULT 2, p_min_candidates integer DEFAULT 3, p_w24h double precision DEFAULT 0.7, p_w7d double precision DEFAULT 0.3)
 RETURNS TABLE(mode text, headline text, description text, chips jsonb, featured_topics jsonb, topic_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_topic_count int := 0;
  v_headline text;
  v_desc text;

  t1_title text;
  t2_title text;
  v_avg_dir double precision := 0;

  v_featured_topics jsonb := '[]'::jsonb;
  v_chips jsonb := '[]'::jsonb;
begin
  if p_region is null or length(btrim(p_region)) = 0 then
    raise exception 'p_region cannot be null or empty';
  end if;

  if p_top_n < 1 or p_top_n > 10 then
    raise exception 'p_top_n must be between 1 and 10';
  end if;

  with candidates as (
    select
      t.id as topic_id,
      t.title,
      t.location_label as topic_location_label,

      l.name as region_label,
      l.type as region_type,

      abs(coalesce(tr.momentum_24h, 0)) as m24_abs,
      abs(coalesce(tr.momentum_7d, 0))  as m7_abs,

      (p_w24h * abs(coalesce(tr.momentum_24h, 0)))
      + (p_w7d  * abs(coalesce(tr.momentum_7d, 0))) as momentum_score,

      sign(
        (p_w24h * coalesce(tr.momentum_24h, 0))
        + (p_w7d  * coalesce(tr.momentum_7d, 0))
      ) as dir_sign,

      -- deterministic tie-breaker
      ('x' || substr(md5(t.id::text), 1, 8))::bit(32)::int as tie
    from public.topic_region_trends tr
    join public.topics t on t.id = tr.topic_id
    join public.locations l on l.id = tr.location_id
    where
      (
        (p_region = 'Global' and l.type = 'global' and l.name = 'Global')
        or
        (p_region <> 'Global' and l.name = p_region)
      )
      and (
        -- keep your “topic scope” filter consistent with earlier work:
        p_region = 'Global'
        or coalesce(t.location_label, 'Global') in (p_region, 'Global')
      )
  ),
  ranked as (
    select *
    from candidates
    where momentum_score > 0
    order by momentum_score desc, tie desc
  ),
  picked as (
    select *
    from ranked
    limit greatest(1, least(p_top_n, 2))
  ),
  stats as (
    select
      (select count(*) from ranked) as cnt,
      (select avg(dir_sign::double precision) from picked) as avg_dir,
      (select title from picked offset 0 limit 1) as t1,
      (select title from picked offset 1 limit 1) as t2,
      (select coalesce(
        jsonb_agg(
          jsonb_build_object('topic_id', topic_id, 'title', title)
          order by momentum_score desc, tie desc
        ),
        '[]'::jsonb
      ) from picked) as topics_json
  )
  select
    coalesce(cnt, 0),
    coalesce(avg_dir, 0),
    t1, t2,
    coalesce(topics_json, '[]'::jsonb)
  into
    v_topic_count, v_avg_dir, t1_title, t2_title, v_featured_topics
  from stats;

  -- headline
  if v_topic_count < p_min_candidates then
    v_headline := 'Signals are forming';
  elsif v_avg_dir > 0.2 then
    v_headline := 'Momentum is building';
  elsif v_avg_dir < -0.2 then
    v_headline := 'Momentum is cooling';
  else
    v_headline := 'Signals are updating';
  end if;

  -- description
  if t1_title is null then
    v_desc := 'Early signals are still forming. As more people participate, we’ll surface clearer movement and disagreement.';
  elsif t2_title is null then
    v_desc := format(
      'Early signals are forming around %s. As more people participate, we’ll surface clearer movement and disagreement.',
      t1_title
    );
  else
    v_desc := format(
      'Early signals show movement in %s and %s. Expect this to sharpen as more people weigh in.',
      t1_title, t2_title
    );
  end if;

  v_chips := jsonb_build_array(
    jsonb_build_object('label', format('%s topics surfacing', v_topic_count), 'value', v_topic_count),
    jsonb_build_object('label', case when v_topic_count < p_min_candidates then 'signals forming' else 'signals updating' end, 'value', null),
    jsonb_build_object('label', 'early movement', 'value', null)
  );

  return query
  select
    'early_stage'::text as mode,
    v_headline as headline,
    v_desc as description,
    v_chips as chips,
    v_featured_topics as featured_topics,
    v_topic_count as topic_count;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_tailored_feed(p_limit integer DEFAULT 20)
 RETURNS SETOF public.v_live_questions
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  with me as (
    select auth.uid() as user_id
  ),
  my_region as (
    select urd.*
    from me
    left join public.user_region_dimensions urd
      on urd.user_id = me.user_id
  ),
  my_segment as (
    select p.audience_segment_id
    from me
    left join public.profiles p on p.user_id = me.user_id
  ),
  segment_match as (
    select
      qaf.question_id,
      min(case qaf.relevance_tier
            when 'direct'   then 0
            when 'adjacent' then 1
            else                 2
          end) as best_tier_rank
    from public.question_audience_fit qaf
    join my_segment ms on ms.audience_segment_id = qaf.audience_segment_id
    where ms.audience_segment_id is not null
    group by qaf.question_id
  ),
  base as (
    select
      v.*,
      case
        when exists (
          select 1
          from public.question_stances qs
          join me on qs.user_id = me.user_id
          where qs.question_id = v.id
        ) then 1
        else 0
      end as answered_flag,
      qss.total_responses,
      qss.avg_score,
      coalesce(sm.best_tier_rank, 2) as segment_bucket,
      case
        when (select user_id from me) is null then 2
        when v.location_label is null then 3
        when mr.city_label   is not null and v.location_label = mr.city_label   then 0
        when mr.county_label is not null and v.location_label = mr.county_label then 0
        when mr.state_label  is not null and v.location_label = mr.state_label  then 0
        when mr.country_label is not null and v.location_label = mr.country_label then 0
        when v.location_label = 'Global' then 2
        else 3
      end as location_bucket,
      case
        when qss.total_responses is null then 2
        when qss.total_responses < 5 then 1
        else 0
      end as engagement_bucket,
      case
        when qss.avg_score is null then 1
        when abs(qss.avg_score) < 0.5 then 0
        else 1
      end as controversy_bucket
    from public.v_live_questions v
    left join my_region mr on true
    left join public.question_stance_stats qss on qss.question_id = v.id
    left join segment_match sm on sm.question_id = v.id
    where v.status = 'active'
  )
  select
    id, question, summary, tags, location_label, published_at, status,
    cover_image_url, phase, topic_title,
    origin_location_label, audience_location_label,
    slider_low_label, slider_high_label
  from base
  order by
    answered_flag               asc,
    segment_bucket              asc,
    location_bucket             asc,
    engagement_bucket           asc,
    controversy_bucket          asc,
    coalesce(total_responses,0) desc,
    published_at                desc
  limit p_limit;
$function$;
CREATE OR REPLACE FUNCTION public.get_tailored_feed(p_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS SETOF public.v_live_questions
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  with me as (
    select coalesce(p_user_id, auth.uid()) as user_id
  ),
  my_region as (
    select
      urd.user_id, urd.city_label, urd.county_label,
      urd.state_label, urd.country_label, urd.global_label
    from public.user_region_dimensions urd
    join me on urd.user_id = me.user_id
  ),
  my_segment as (
    select p.audience_segment_id
    from me
    left join public.profiles p on p.user_id = me.user_id
  ),
  segment_match as (
    select
      qaf.question_id,
      min(case qaf.relevance_tier
            when 'direct'   then 0
            when 'adjacent' then 1
            else                 2
          end) as best_tier_rank
    from public.question_audience_fit qaf
    join my_segment ms on ms.audience_segment_id = qaf.audience_segment_id
    where ms.audience_segment_id is not null
    group by qaf.question_id
  ),
  base as (
    select
      v.*,
      case
        when exists (
          select 1
          from public.question_stances qs
          join me on qs.user_id = me.user_id
          where qs.question_id = v.id
        ) then 1
        else 0
      end as answered_flag,
      qss.total_responses,
      qss.avg_score,
      coalesce(sm.best_tier_rank, 2) as segment_bucket,
      case
        when (select user_id from me) is null then 2
        when v.location_label is null then 3
        when mr.city_label   is not null and v.location_label = mr.city_label   then 0
        when mr.county_label is not null and v.location_label = mr.county_label then 0
        when mr.state_label  is not null and v.location_label = mr.state_label  then 0
        when mr.country_label is not null and v.location_label = mr.country_label then 0
        when v.location_label = 'Global' then 2
        else 3
      end as location_bucket,
      case
        when qss.total_responses is null then 2
        when qss.total_responses < 5 then 1
        else 0
      end as engagement_bucket,
      case
        when qss.avg_score is null then 1
        when abs(qss.avg_score) < 0.5 then 0
        else 1
      end as controversy_bucket
    from public.v_live_questions v
    left join my_region mr on true
    left join public.question_stance_stats qss on qss.question_id = v.id
    left join segment_match sm on sm.question_id = v.id
    where v.status = 'active'
  )
  select
    id, question, summary, tags, location_label, published_at, status,
    cover_image_url, phase, topic_title,
    origin_location_label, audience_location_label,
    slider_low_label, slider_high_label
  from base
  order by
    answered_flag               asc,
    segment_bucket              asc,
    location_bucket             asc,
    engagement_bucket           asc,
    controversy_bucket          asc,
    coalesce(total_responses,0) desc,
    published_at                desc
  limit p_limit;
$function$;
CREATE OR REPLACE FUNCTION public.get_three_tier_curated_feed(p_user_id uuid DEFAULT NULL::uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(tier text, tier_label text, question_id uuid, question text, summary text, tags text[], location_label text, composite_score numeric, tier_position integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_city TEXT := NULL;
  v_state TEXT := NULL;
  v_country TEXT := NULL;
BEGIN
  -- Get user's location (if provided)
  IF p_user_id IS NOT NULL THEN
    BEGIN
      SELECT 
        city_label, 
        state_label, 
        country_label
      INTO v_city, v_state, v_country
      FROM user_region_dimensions
      WHERE user_id = p_user_id;
    EXCEPTION WHEN OTHERS THEN
      v_city := NULL;
      v_state := NULL;
      v_country := NULL;
    END;
  END IF;
  
  -- Return all tiers
  RETURN QUERY
  WITH 
  -- LOCAL tier
  local_questions AS (
    SELECT 
      'local'::TEXT as q_tier,
      COALESCE(v_city, v_state, 'Local')::TEXT as q_tier_label,
      q.id as q_id,
      q.question as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score
    FROM questions q
    JOIN topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND tis.composite_score >= 5.5
      AND (
        (v_city IS NOT NULL AND q.location_label ILIKE '%' || v_city || '%')
        OR (v_state IS NOT NULL AND q.location_label ILIKE '%' || v_state || '%')
      )
    ORDER BY tis.composite_score DESC
    LIMIT 5
  ),
  -- NATIONAL tier
  national_questions AS (
    SELECT 
      'national'::TEXT as q_tier,
      COALESCE(v_country, 'National')::TEXT as q_tier_label,
      q.id as q_id,
      q.question as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score
    FROM questions q
    JOIN topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND tis.composite_score >= 5.0
      AND v_country IS NOT NULL
      AND q.location_label ILIKE '%' || v_country || '%'
      AND q.id NOT IN (SELECT q_id FROM local_questions)
    ORDER BY tis.composite_score DESC
    LIMIT 6
  ),
  -- GLOBAL tier
  global_questions AS (
    SELECT 
      'global'::TEXT as q_tier,
      'Global'::TEXT as q_tier_label,
      q.id as q_id,
      q.question as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score
    FROM questions q
    JOIN topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND tis.composite_score >= 5.0
      AND q.id NOT IN (
        SELECT q_id FROM local_questions
        UNION
        SELECT q_id FROM national_questions
      )
    ORDER BY tis.composite_score DESC
    LIMIT 15
  ),
  -- Combine and number
  combined AS (
    SELECT 
      q_tier,
      q_tier_label,
      q_id,
      q_text,
      q_summary,
      q_tags,
      q_location,
      q_score,
      ROW_NUMBER() OVER (ORDER BY 
        CASE q_tier 
          WHEN 'local' THEN 1
          WHEN 'national' THEN 2
          WHEN 'global' THEN 3
        END,
        q_score DESC
      )::INT as q_position
    FROM (
      SELECT * FROM local_questions
      UNION ALL
      SELECT * FROM national_questions
      UNION ALL
      SELECT * FROM global_questions
    ) all_tiers
  )
  SELECT 
    combined.q_tier,
    combined.q_tier_label,
    combined.q_id,
    combined.q_text,
    combined.q_summary,
    combined.q_tags,
    combined.q_location,
    combined.q_score,
    combined.q_position
  FROM combined
  ORDER BY combined.q_position;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_three_tier_curated_feed_v2(p_user_id uuid DEFAULT NULL::uuid, p_date date DEFAULT CURRENT_DATE, p_ip_country text DEFAULT NULL::text)
 RETURNS TABLE(tier text, tier_label text, question_id uuid, question text, summary text, tags text[], location_label text, composite_score numeric, tier_position integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_city TEXT := NULL;
  v_state TEXT := NULL;
  v_country TEXT := NULL;
BEGIN
  -- Get user's location (if logged in)
  IF p_user_id IS NOT NULL THEN
    BEGIN
      SELECT 
        city_label, 
        state_label, 
        country_label
      INTO v_city, v_state, v_country
      FROM user_region_dimensions
      WHERE user_id = p_user_id;
    EXCEPTION WHEN OTHERS THEN
      v_city := NULL;
      v_state := NULL;
      v_country := NULL;
    END;
  ELSIF p_ip_country IS NOT NULL THEN
    -- Use IP-detected country for anonymous users
    v_country := p_ip_country;
  END IF;
  
  -- Return all tiers
  RETURN QUERY
  WITH 
  -- LOCAL tier (only for logged-in users with saved location)
  local_questions AS (
    SELECT 
      'local'::TEXT as q_tier,
      COALESCE(v_city, v_state, 'Local')::TEXT as q_tier_label,
      q.id as q_id,
      q.question as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score
    FROM questions q
    JOIN topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND tis.composite_score >= 5.5
      AND p_user_id IS NOT NULL  -- Only for logged-in users
      AND (
        (v_city IS NOT NULL AND q.location_label ILIKE '%' || v_city || '%')
        OR (v_state IS NOT NULL AND q.location_label ILIKE '%' || v_state || '%')
      )
    ORDER BY tis.composite_score DESC
    LIMIT 5
  ),
  -- NATIONAL tier (for logged-in users OR anonymous with IP country)
  national_questions AS (
    SELECT 
      'national'::TEXT as q_tier,
      COALESCE(v_country, 'National')::TEXT as q_tier_label,
      q.id as q_id,
      q.question as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score
    FROM questions q
    JOIN topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND tis.composite_score >= 5.0
      AND v_country IS NOT NULL
      AND q.location_label ILIKE '%' || v_country || '%'
      AND q.id NOT IN (SELECT q_id FROM local_questions)
    ORDER BY tis.composite_score DESC
    LIMIT 6
  ),
  -- GLOBAL tier (ONLY truly global questions - no fallback)
  global_questions AS (
    SELECT 
      'global'::TEXT as q_tier,
      'Global'::TEXT as q_tier_label,
      q.id as q_id,
      q.question as q_text,
      q.summary as q_summary,
      q.tags as q_tags,
      q.location_label as q_location,
      tis.composite_score as q_score
    FROM questions q
    JOIN topic_impact_scores tis ON tis.question_id = q.id
    WHERE q.status = 'active'
      AND tis.composite_score >= 5.0
      AND q.id NOT IN (
        SELECT q_id FROM local_questions
        UNION
        SELECT q_id FROM national_questions
      )
      -- ONLY truly global questions
      AND (
        q.location_label IS NULL 
        OR q.location_label = 'Global'
        OR q.location_label = ''
      )
    ORDER BY tis.composite_score DESC
    LIMIT 15
  ),
  -- Combine and number
  combined AS (
    SELECT 
      q_tier,
      q_tier_label,
      q_id,
      q_text,
      q_summary,
      q_tags,
      q_location,
      q_score,
      ROW_NUMBER() OVER (ORDER BY 
        CASE q_tier 
          WHEN 'local' THEN 1
          WHEN 'national' THEN 2
          WHEN 'global' THEN 3
        END,
        q_score DESC
      )::INT as q_position
    FROM (
      SELECT * FROM local_questions
      UNION ALL
      SELECT * FROM national_questions
      UNION ALL
      SELECT * FROM global_questions
    ) all_tiers
  )
  SELECT 
    combined.q_tier,
    combined.q_tier_label,
    combined.q_id,
    combined.q_text,
    combined.q_summary,
    combined.q_tags,
    combined.q_location,
    combined.q_score,
    combined.q_position
  FROM combined
  ORDER BY combined.q_position;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_three_tier_trending_questions(p_user_id uuid DEFAULT NULL::uuid, p_limit_per_tier integer DEFAULT 5)
 RETURNS TABLE(tier text, tier_label text, question_id uuid, question text, summary text, tags text[], location_label text, trending_score numeric, response_count bigint)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_city TEXT;
  v_county TEXT;
  v_state TEXT;
  v_country TEXT;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT city_label, county_label, state_label, country_label
    INTO v_city, v_county, v_state, v_country
    FROM user_region_dimensions
    WHERE user_id = p_user_id LIMIT 1;
  END IF;

  IF v_city IS NOT NULL OR v_county IS NOT NULL OR v_state IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      'local'::TEXT, COALESCE(v_state, v_county, v_city, 'Local')::TEXT,
      q.id, q.question, q.summary, q.tags, q.location_label,
      COALESCE(q.trending_score, 0),
      (SELECT COUNT(*) FROM question_stances qs WHERE qs.question_id = q.id)
    FROM questions q
    WHERE COALESCE(q.trending_score, 0) > 0
      AND q.state IN ('new', 'active')
      AND (
        (v_city IS NOT NULL AND q.location_label ILIKE '%' || v_city || '%')
        OR (v_county IS NOT NULL AND q.location_label ILIKE '%' || v_county || '%')
        OR (v_state IS NOT NULL AND q.location_label ILIKE '%' || v_state || '%')
      )
    ORDER BY q.trending_score DESC, q.published_at DESC
    LIMIT p_limit_per_tier;
  END IF;

  IF v_country IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      'national'::TEXT, v_country::TEXT,
      q.id, q.question, q.summary, q.tags, q.location_label,
      COALESCE(q.trending_score, 0),
      (SELECT COUNT(*) FROM question_stances qs WHERE qs.question_id = q.id)
    FROM questions q
    WHERE COALESCE(q.trending_score, 0) > 0
      AND q.state IN ('new', 'active')
      AND q.location_label ILIKE '%' || v_country || '%'
    ORDER BY q.trending_score DESC, q.published_at DESC
    LIMIT p_limit_per_tier;
  END IF;

  RETURN QUERY
  SELECT 
    'global'::TEXT, 'Global'::TEXT,
    q.id, q.question, q.summary, q.tags, q.location_label,
    COALESCE(q.trending_score, 0),
    (SELECT COUNT(*) FROM question_stances qs WHERE qs.question_id = q.id)
  FROM questions q
  WHERE COALESCE(q.trending_score, 0) > 0
    AND q.state IN ('new', 'active')
  ORDER BY q.trending_score DESC, q.published_at DESC
  LIMIT p_limit_per_tier;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_three_tier_trending_topics(p_user_id uuid DEFAULT NULL::uuid, p_limit_per_tier integer DEFAULT 5)
 RETURNS TABLE(tier text, tier_label text, topic_id uuid, title text, summary text, tags text[], location_label text, trending_score numeric, activity_7d integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_city TEXT;
  v_county TEXT;
  v_state TEXT;
  v_country TEXT;
BEGIN
  -- Get user's location if logged in
  IF p_user_id IS NOT NULL THEN
    SELECT 
      city_label,
      county_label,
      state_label,
      country_label
    INTO v_city, v_county, v_state, v_country
    FROM user_region_dimensions
    WHERE user_id = p_user_id
    LIMIT 1;
  END IF;

  -- LOCAL TRENDING (City, County, State)
  IF v_city IS NOT NULL OR v_county IS NOT NULL OR v_state IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      'local'::TEXT as tier,
      COALESCE(v_state, v_county, v_city, 'Local')::TEXT as tier_label,
      t.id as topic_id,
      t.title,
      t.summary,
      t.tags,
      t.location_label,
      COALESCE(t.trending_score, 0) as trending_score,
      COALESCE(t.activity_7d, 0) as activity_7d
    FROM topics t
    WHERE 
      COALESCE(t.trending_score, 0) > 0
      AND (
        (v_city IS NOT NULL AND t.location_label ILIKE '%' || v_city || '%')
        OR
        (v_county IS NOT NULL AND t.location_label ILIKE '%' || v_county || '%')
        OR
        (v_state IS NOT NULL AND t.location_label ILIKE '%' || v_state || '%')
      )
      AND (v_country IS NULL OR t.location_label NOT ILIKE v_country)
      AND t.location_label NOT ILIKE '%global%'
    ORDER BY 
      t.trending_score DESC NULLS LAST,
      t.created_at DESC  -- CHANGED: updated_at -> created_at
    LIMIT p_limit_per_tier;
  END IF;

  -- NATIONAL TRENDING (Country)
  IF v_country IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      'national'::TEXT as tier,
      v_country::TEXT as tier_label,
      t.id as topic_id,
      t.title,
      t.summary,
      t.tags,
      t.location_label,
      COALESCE(t.trending_score, 0) as trending_score,
      COALESCE(t.activity_7d, 0) as activity_7d
    FROM topics t
    WHERE 
      COALESCE(t.trending_score, 0) > 0
      AND t.location_label ILIKE '%' || v_country || '%'
      AND (v_state IS NULL OR t.location_label NOT ILIKE '%' || v_state || '%')
      AND t.location_label NOT ILIKE '%global%'
    ORDER BY 
      t.trending_score DESC NULLS LAST,
      t.created_at DESC  -- CHANGED: updated_at -> created_at
    LIMIT p_limit_per_tier;
  END IF;

  -- GLOBAL TRENDING (Worldwide)
  RETURN QUERY
  SELECT 
    'global'::TEXT as tier,
    'Global'::TEXT as tier_label,
    t.id as topic_id,
    t.title,
    t.summary,
    t.tags,
    t.location_label,
    COALESCE(t.trending_score, 0) as trending_score,
    COALESCE(t.activity_7d, 0) as activity_7d
  FROM topics t
  WHERE 
    COALESCE(t.trending_score, 0) > 0
    AND (
      t.location_label IS NULL 
      OR t.location_label ILIKE '%global%'
      OR t.tier = 'global'
      OR (v_country IS NOT NULL AND t.location_label NOT ILIKE '%' || v_country || '%')
    )
  ORDER BY 
    t.trending_score DESC NULLS LAST,
    t.created_at DESC  -- CHANGED: updated_at -> created_at
  LIMIT p_limit_per_tier;
  
END;
$function$;
create or replace view "public"."v_daily_curated_questions_expanded" as  SELECT dc.date,
    q_id.question_id,
    q_id.ordinality AS row_index,
    q.question AS question_text,
    q.summary AS question_summary,
    q.tags AS question_tags,
    q.location_label AS question_location_label,
    q.status AS question_status,
    q.published_at AS question_published_at
   FROM ((public.daily_curated_questions dc
     CROSS JOIN LATERAL unnest(dc.question_ids) WITH ORDINALITY q_id(question_id, ordinality))
     JOIN public.questions q ON ((q.id = q_id.question_id)));
CREATE OR REPLACE FUNCTION public.get_today_questions(p_limit integer)
 RETURNS SETOF public.v_daily_curated_questions_expanded
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select *
  from public.v_daily_curated_questions_expanded v
  where v.date = current_date
  order by v.row_index
  limit coalesce(p_limit, 7);
$function$;
CREATE OR REPLACE FUNCTION public.get_trending_questions(p_limit integer DEFAULT 10, p_state_filter public.question_state[] DEFAULT ARRAY['new'::public.question_state, 'active'::public.question_state])
 RETURNS TABLE(question_id uuid, question text, state public.question_state, trending_score numeric, trending_since timestamp without time zone, response_rate_24h numeric, responses_total integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  
  RETURN QUERY
  SELECT 
    q.id,
    q.question,
    q.state,
    q.trending_score,
    q.trending_since,
    qem.response_rate_24h,
    qem.responses_total
  FROM public.questions q
  JOIN public.question_engagement_metrics qem ON q.id = qem.question_id
  WHERE COALESCE(q.is_trending, false) = true
    AND q.state = ANY(p_state_filter)
  ORDER BY q.trending_score DESC, q.trending_since ASC
  LIMIT p_limit;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_trending_questions_homepage(p_user_id uuid, p_region_scope text, p_region_key text, p_location_id uuid, p_limit integer, p_offset integer)
 RETURNS TABLE(question_id uuid, question_text text, summary text, tags text[], topic_id uuid, topic_title text, tier text, location_label text, user_has_answered boolean, trend_micro_signal text, trend_score numeric, stance_momentum numeric, topic_momentum numeric, cover_image_url text, impact_normalized numeric, origin_location_label text, audience_location_label text, is_new_phase boolean, user_stance_value numeric, slider_low_label text, slider_high_label text)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
with
cfg as (
  select
    max(value) filter (where key = 'stance_weight')                 as stance_weight,
    max(value) filter (where key = 'topic_weight')                  as topic_weight,
    max(value) filter (where key = 'lifecycle_weight')              as lifecycle_weight,
    max(value) filter (where key = 'stance_24h_weight')             as stance_24h_weight,
    max(value) filter (where key = 'stance_7d_weight')              as stance_7d_weight,
    max(value) filter (where key = 'stance_u24h_cap')               as stance_u24h_cap,
    max(value) filter (where key = 'stance_u7d_cap')                as stance_u7d_cap,
    max(value) filter (where key = 'stance_v6h_cap')                as stance_v6h_cap,
    max(value) filter (where key = 'topic_news_v24h_cap')           as topic_news_v24h_cap,
    max(value) filter (where key = 'breaking_topic_threshold')      as breaking_topic_threshold,
    max(value) filter (where key = 'breaking_stance_low_threshold') as breaking_stance_low_threshold,
    max(value) filter (where key = 'gaining_velocity_threshold')    as gaining_velocity_threshold,
    max(value) filter (where key = 'stable_7d_threshold')           as stable_7d_threshold,
    max(value) filter (where key = 'new_days')                      as new_days,
    max(value) filter (where key = 'stale_days')                    as stale_days,
    max(value) filter (where key = 'min_score_floor')               as min_score_floor,
    coalesce(max(value) filter (where key = 'impact_gate_min_score'), 7.0) as impact_gate_min_score,
    coalesce(max(value) filter (where key = 'impact_gate_enabled'),   1.0) as impact_gate_enabled
  from public.app_config_trending
),
base_questions as (
  select
    q.id                                              as question_id,
    q.question                                        as question_text,
    q.summary,
    q.tags,
    q.topic_id,
    t.title                                           as topic_title,
    q.phase,
    coalesce(q.published_at, q.created_at)            as opened_at,
    coalesce(q.location_label, t.location_label)      as effective_location_label,
    q.cover_image_url,
    q.origin_location_label,
    q.audience_location_label,
    q.slider_low_label,
    q.slider_high_label
  from public.questions q
  join public.topics t on t.id = q.topic_id
  where q.status = 'active'
    and q.published_at is not null
    and (
      p_region_scope = 'global'
      or coalesce(q.audience_location_label, q.location_label, t.location_label) is null
      or coalesce(q.audience_location_label, q.location_label, t.location_label) in (p_region_key, 'Global')
    )
),
stance_stats as (
  select
    s.question_id,
    coalesce(s.unique_users_24h, 0)::numeric as unique_users_24h,
    coalesce(s.unique_users_7d,  0)::numeric as unique_users_7d,
    coalesce(s.velocity_6h,      0)::numeric as velocity_6h
  from public.question_stance_momentum_region_v s
  where s.region_scope = p_region_scope
    and s.region_key   = p_region_key
),
topic_stats as (
  select
    tr.topic_id,
    coalesce(tr.total_24h, 0)::numeric as topic_total_24h
  from public.topic_region_trends tr
  where tr.location_id = p_location_id
),
impact_scores as (
  select
    qis.question_id,
    qis.composite_score,
    least(coalesce(qis.composite_score, 0) / 10.0, 1.0)::numeric as impact_normalized
  from public.question_impact_scores qis
),
answered as (
  select
    qs.question_id,
    true              as user_has_answered,
    qs.score::numeric as user_stance_value
  from public.question_stances qs
  where p_user_id is not null
    and qs.user_id = p_user_id
),
followed_topics as (
  select topic_id
  from public.user_topic_follows
  where p_user_id is not null
    and user_id = p_user_id
),
followed_topic_ids as (
  select t.id as topic_id
  from public.topics t
  where t.id in (select topic_id from followed_topics)
  union
  select t.id as topic_id
  from public.topics t
  where t.parent_topic_id in (select topic_id from followed_topics)
),
phase_seen as (
  select
    uti.topic_id,
    uti.last_question_phase_seen
  from public.user_topic_interactions uti
  where p_user_id is not null
    and uti.user_id = p_user_id
),
scored as (
  select
    bq.question_id, bq.question_text, bq.summary, bq.tags, bq.topic_id, bq.topic_title,
    bq.cover_image_url, bq.effective_location_label, bq.opened_at,
    bq.origin_location_label, bq.audience_location_label,
    bq.slider_low_label, bq.slider_high_label,
    (cfg.stance_24h_weight * least(coalesce(ss.unique_users_24h, 0) / nullif(cfg.stance_u24h_cap, 0), 1.0)
   + cfg.stance_7d_weight  * least(coalesce(ss.unique_users_7d,  0) / nullif(cfg.stance_u7d_cap,  0), 1.0))::numeric as stance_momentum,
    least(coalesce(ts.topic_total_24h, 0) / nullif(cfg.topic_news_v24h_cap, 0), 1.0)::numeric as topic_momentum,
    (case when bq.phase in ('new', 'initial') then 1.0 when bq.phase = 'active' then 0.6
          when bq.phase = 'dormant' then 0.2 else 0.4 end
     * case when bq.opened_at >= now() - (cfg.new_days::int || ' days')::interval then 1.0
            when bq.opened_at < now() - (cfg.stale_days::int || ' days')::interval then 0.4
            else 0.8 end
    )::numeric as lifecycle_modifier,
    coalesce(ss.velocity_6h, 0)::numeric        as velocity_6h,
    coalesce(a.user_has_answered, false)         as user_has_answered,
    a.user_stance_value                          as user_stance_value,
    imp.composite_score,
    coalesce(imp.impact_normalized, 0)::numeric  as impact_normalized,
    case
      when a.user_has_answered = true
        and ps.last_question_phase_seen is not null
        and ps.last_question_phase_seen is distinct from bq.phase
      then true
      else false
    end as is_new_phase,
    case
      when exists (select 1 from followed_topic_ids ft where ft.topic_id = bq.topic_id)
      then 1.5
      else 1.0
    end as followed_boost
  from base_questions bq
  left join stance_stats  ss  on ss.question_id  = bq.question_id
  left join topic_stats   ts  on ts.topic_id     = bq.topic_id
  left join impact_scores imp on imp.question_id = bq.question_id
  left join answered      a   on a.question_id   = bq.question_id
  left join phase_seen    ps  on ps.topic_id     = bq.topic_id
  cross join cfg
),
final as (
  select s.*,
    (cfg.stance_weight * s.stance_momentum + cfg.topic_weight * s.topic_momentum
   + cfg.lifecycle_weight * s.lifecycle_modifier + 0.30 * s.impact_normalized
    )::numeric * s.followed_boost as trend_score,
    (case when s.topic_momentum >= cfg.breaking_topic_threshold
               and s.stance_momentum < cfg.breaking_stance_low_threshold then 'breaking'
          when least(s.velocity_6h / nullif(cfg.stance_v6h_cap, 0), 1.0) >= cfg.gaining_velocity_threshold then 'gaining'
          when s.stance_momentum >= cfg.stable_7d_threshold then 'stable'
          else 'gaining' end)::text as trend_micro_signal,
    cfg.impact_gate_min_score, cfg.impact_gate_enabled, cfg.min_score_floor
  from scored s cross join cfg
),
gated as (
  select *, 1 as feed_priority from final
  where trend_score >= min_score_floor
    and (impact_gate_enabled < 1.0 or (impact_gate_enabled >= 1.0 and composite_score >= impact_gate_min_score))
),
fallback as (
  select *, 2 as feed_priority from final
  where (composite_score is null or composite_score < impact_gate_min_score)
    and trend_score >= min_score_floor
),
gated_count as (select count(*)::int as n from gated),
combined as (
  select * from gated
  union all
  select fb.* from fallback fb cross join gated_count gc where gc.n < (p_offset + p_limit)
)
select
  question_id, question_text, summary, tags, topic_id, topic_title,
  null::text as tier, effective_location_label as location_label,
  user_has_answered, trend_micro_signal, trend_score, stance_momentum, topic_momentum,
  cover_image_url, impact_normalized, origin_location_label, audience_location_label,
  is_new_phase, user_stance_value,
  slider_low_label,
  slider_high_label
from combined
order by feed_priority asc, trend_score desc, topic_momentum desc, stance_momentum desc, opened_at desc
limit  greatest(coalesce(p_limit, 10), 1)
offset greatest(coalesce(p_offset, 0), 0);
$function$;
CREATE OR REPLACE FUNCTION public.get_trending_questions_v3(p_user_id uuid DEFAULT NULL::uuid, p_location_tier text DEFAULT 'global'::text, p_limit integer DEFAULT 15)
 RETURNS TABLE(question_id uuid, question text, summary text, tags text[], published_at timestamp with time zone, stance_momentum double precision, topic_momentum double precision, community_engagement_score double precision, lifecycle_modifier double precision, final_trending_score double precision, trend_signal text, trend_direction integer, region_scope text, trend_reason text, user_has_answered boolean, user_stance_value integer, user_answer_date timestamp with time zone, response_count_24h integer, response_count_7d integer, response_velocity double precision, unique_responders_24h integer, first_response_at timestamp with time zone, topic_id uuid, topic_title text, topic_tags text[], question_phase text, days_since_published integer, source_count integer, source_diversity_score double precision)
 LANGUAGE sql
 STABLE
AS $function$
WITH scored_questions AS (
  -- Step 1: Base question data + initial scoring
  SELECT
    q.id as question_id,
    q.question,
    q.summary,
    q.tags,
    q.published_at,
    q.topic_id,
    q.state::TEXT as question_phase,
    q.created_at,
    
    -- Stance Momentum: unique stancers in 24h, normalized to 0-100
    LEAST(100.0, 
      COALESCE(
        (
          (SELECT COUNT(DISTINCT user_id)::FLOAT8 
           FROM question_stances 
           WHERE question_id = q.id 
             AND created_at >= NOW() - INTERVAL '1 day'
          ) / NULLIF(
            (SELECT COUNT(DISTINCT user_id)::FLOAT8 
             FROM question_stances 
             WHERE created_at >= NOW() - INTERVAL '7 days'
            ),
            0
          ) * 100
        ),
        0.0
      )
    ) as stance_momentum,
    
    -- Topic Momentum: inherited from topic trending (0-100)
    COALESCE(
      t.trending_score::FLOAT8,
      0.0
    ) as topic_momentum,
    
    -- Community Engagement Score: comment velocity normalized (0-100)
    LEAST(100.0,
      COALESCE(
        (
          (SELECT COUNT(*)::FLOAT8 
           FROM comments 
           WHERE question_id = q.id 
             AND created_at >= NOW() - INTERVAL '24 hours'
          ) / NULLIF(
            (EXTRACT(EPOCH FROM (NOW() - q.published_at)) / 3600 + 1)::FLOAT8,
            0
          ) * 10
        ),
        0.0
      )
    ) as community_engagement_score,
    
    -- Response metrics
    (SELECT COUNT(*)::INT 
     FROM question_stances 
     WHERE question_id = q.id 
       AND created_at >= NOW() - INTERVAL '24 hours'
    ) as response_count_24h,
    
    (SELECT COUNT(*)::INT 
     FROM question_stances 
     WHERE question_id = q.id 
       AND created_at >= NOW() - INTERVAL '7 days'
    ) as response_count_7d,
    
    (SELECT COUNT(DISTINCT user_id)::INT 
     FROM question_stances 
     WHERE question_id = q.id 
       AND created_at >= NOW() - INTERVAL '24 hours'
    ) as unique_responders_24h,
    
    (SELECT MIN(created_at) 
     FROM question_stances 
     WHERE question_id = q.id
    ) as first_response_at,
    
    -- Topic reference for later joins
    t.id as topic_id_ref,
    t.title as topic_title,
    t.tags as topic_tags
    
  FROM public.questions q
  LEFT JOIN public.topics t ON t.id = q.topic_id
  WHERE q.state::TEXT NOT IN ('archived', 'historical')
),

-- Step 2: Calculate lifecycle modifier based on question age and phase
scored_with_lifecycle AS (
  SELECT
    *,
    EXTRACT(DAY FROM NOW() - created_at)::INT as days_since_published,
    CASE
      WHEN question_phase = 'new' THEN 1.3
      WHEN question_phase = 'active' AND EXTRACT(DAY FROM NOW() - created_at) < 7 THEN 1.15
      WHEN question_phase = 'active' AND EXTRACT(DAY FROM NOW() - created_at) >= 7 THEN 1.0
      WHEN question_phase = 'cooling' THEN 0.7
      WHEN question_phase = 'dormant' THEN 0.3
      ELSE 0.0
    END as lifecycle_modifier
  FROM scored_questions
),

-- Step 3: Determine trend signal based on momentum characteristics
with_signal AS (
  SELECT
    *,
    CASE
      WHEN topic_momentum > 70 AND response_count_24h < 10 THEN 'breaking'
      WHEN stance_momentum > 50 AND response_count_24h >= 10 THEN 'gaining'
      WHEN response_count_7d > 50 AND stance_momentum > 30 THEN 'stable'
      ELSE NULL
    END as trend_signal,
    CASE
      WHEN stance_momentum > 50 THEN 1
      WHEN stance_momentum > 30 THEN 0
      ELSE -1
    END as trend_direction
  FROM scored_with_lifecycle
),

-- Step 4: Calculate final composite score and determine reason
final_scores AS (
  SELECT
    *,
    -- Composite score: 65% stance + 25% topic + 10% engagement × lifecycle modifier
    ((
      (stance_momentum * 0.65) +
      (topic_momentum * 0.25) +
      (community_engagement_score * 0.10)
    ) * lifecycle_modifier) as final_trending_score,
    
    -- Human-readable reason for trending
    CASE
      WHEN trend_signal = 'breaking' THEN 'Breaking news generating early discussion'
      WHEN trend_signal = 'gaining' THEN 'Community engagement accelerating'
      WHEN trend_signal = 'stable' THEN 'Sustained community engagement'
      ELSE 'Recent activity'
    END as trend_reason,
    
    -- Determine region scope
    CASE 
      WHEN p_location_tier = 'city' THEN 'local'
      WHEN p_location_tier = 'state' THEN 'state'
      WHEN p_location_tier = 'country' THEN 'country'
      ELSE 'global'
    END as region_scope,
    
    -- Source count placeholder (0 for now)
    0 as source_count
  FROM with_signal
),

-- Step 5: Add user context (answer state, stance value)
with_user_context AS (
  SELECT
    fs.question_id,
    fs.question,
    fs.summary,
    fs.tags,
    fs.published_at,
    fs.stance_momentum,
    fs.topic_momentum,
    fs.community_engagement_score,
    fs.lifecycle_modifier,
    fs.final_trending_score,
    fs.trend_signal,
    fs.trend_direction,
    fs.region_scope,
    fs.trend_reason,
    
    -- User context: check if user answered and get their score
    (qs.id IS NOT NULL) as user_has_answered,
    qs.score::INT as user_stance_value,
    qs.created_at as user_answer_date,
    
    -- Engagement data
    fs.response_count_24h,
    fs.response_count_7d,
    (fs.response_count_24h::FLOAT8 / NULLIF(24, 0))::FLOAT8 as response_velocity,
    fs.unique_responders_24h,
    fs.first_response_at,
    
    -- Topic data
    fs.topic_id,
    fs.topic_title,
    fs.topic_tags,
    
    -- Question state
    fs.question_phase,
    fs.days_since_published,
    
    -- Source diversity
    fs.source_count,
    CASE
      WHEN fs.source_count = 0 THEN 0.0
      WHEN fs.source_count = 1 THEN 0.3
      WHEN fs.source_count <= 5 THEN 0.6
      ELSE 1.0
    END as source_diversity_score
    
  FROM final_scores fs
  LEFT JOIN question_stances qs 
    ON qs.question_id = fs.question_id 
    AND qs.user_id = p_user_id
  WHERE fs.region_scope = COALESCE(
    CASE 
      WHEN p_location_tier = 'city' THEN 'local'
      WHEN p_location_tier = 'state' THEN 'state'
      WHEN p_location_tier = 'country' THEN 'country'
      ELSE 'global'
    END,
    'global'
  )
)

-- Final: Return sorted results
SELECT * FROM with_user_context
ORDER BY final_trending_score DESC NULLS LAST
LIMIT p_limit;

$function$;
CREATE OR REPLACE FUNCTION public.get_trending_topics_v2(p_location_tier text DEFAULT 'global'::text, p_limit integer DEFAULT 10)
 RETURNS TABLE(topic_id uuid, topic_title text, summary text, tags text[], trending_score numeric, news_velocity double precision, source_count integer, source_diversity double precision, last_article_date timestamp with time zone, total_questions integer, primary_question_id uuid, primary_question_text text, unanswered_questions_count integer, region_scope text, location_label text, trend_reason text, days_trending integer, article_preview text[])
 LANGUAGE sql
 STABLE
AS $function$
WITH topic_activity AS (
  -- Step 1: Calculate topic activity and news velocity
  SELECT
    t.id as topic_id,
    t.title,
    t.summary,
    t.tags,
    t.location_label,
    t.tier,
    
    -- Trending score: direct from topics table
    COALESCE(t.trending_score, 0)::NUMERIC as trending_score,
    
    -- Activity 7d: direct from topics table
    COALESCE(t.activity_7d, 0)::INT as activity_7d,
    
    -- News velocity: based on activity (articles per hour)
    (COALESCE(t.activity_7d, 0)::FLOAT8 / 
     NULLIF((7 * 24), 0))::FLOAT8 as news_velocity,
    
    -- Last publish date from topics
    t.published_at as last_article_date,
    
    t.created_at
  FROM public.topics t
  WHERE t.parent_topic_id IS NULL  -- Exclude merged topics
),

-- Step 2: Count associated questions and answers
questions_agg AS (
  SELECT
    q.topic_id,
    COUNT(*)::INT as total_questions,
    COUNT(*) FILTER (WHERE qs.id IS NULL)::INT as unanswered_questions_count,
    
    -- Primary question: highest engagement (most responses)
    (
      SELECT q2.id 
      FROM public.questions q2
      WHERE q2.topic_id = q.topic_id
      ORDER BY (SELECT COUNT(*) FROM public.question_stances WHERE question_id = q2.id) DESC
      LIMIT 1
    ) as primary_question_id,
    
    (
      SELECT q2.question 
      FROM public.questions q2
      WHERE q2.topic_id = q.topic_id
      ORDER BY (SELECT COUNT(*) FROM public.question_stances WHERE question_id = q2.id) DESC
      LIMIT 1
    ) as primary_question_text
    
  FROM public.questions q
  LEFT JOIN public.question_stances qs ON qs.question_id = q.id
  WHERE q.topic_id IS NOT NULL
  GROUP BY q.topic_id
),

-- Step 3: Add source/article information
with_sources AS (
  SELECT
    ta.*,
    qa.total_questions,
    qa.unanswered_questions_count,
    qa.primary_question_id,
    qa.primary_question_text,
    
    -- Source count: count distinct sources in topics.sources JSONB
    CASE 
      WHEN ta.trending_score IS NOT NULL AND ta.trending_score > 0 THEN
        LEAST(5, GREATEST(1, (ta.activity_7d / 5)::INT))  -- Estimate from activity
      ELSE 0
    END::INT as source_count,
    
    -- Article preview: from topic summary
    ARRAY[COALESCE(ta.summary, 'No summary available')] as article_preview
    
  FROM topic_activity ta
  LEFT JOIN questions_agg qa ON qa.topic_id = ta.topic_id
),

-- Step 4: Calculate diversity and trend reason
final_topics AS (
  SELECT
    ws.topic_id,
    ws.title as topic_title,
    ws.summary,
    ws.tags,
    ws.trending_score,
    ws.news_velocity,
    ws.source_count,
    
    -- Source diversity score (0-1)
    CASE
      WHEN ws.source_count = 0 THEN 0.0::FLOAT8
      WHEN ws.source_count = 1 THEN 0.3::FLOAT8
      WHEN ws.source_count <= 5 THEN 0.6::FLOAT8
      ELSE 1.0::FLOAT8
    END as source_diversity,
    
    ws.last_article_date,
    COALESCE(ws.total_questions, 0) as total_questions,
    ws.primary_question_id,
    ws.primary_question_text,
    COALESCE(ws.unanswered_questions_count, 0) as unanswered_questions_count,
    
    ws.location_label,
    ws.tier,
    
    -- Trend reason based on activity
    CASE
      WHEN ws.news_velocity > 5 THEN 'Breaking news'
      WHEN ws.activity_7d > 50 THEN 'High engagement'
      WHEN ws.activity_7d > 20 THEN 'Sustained coverage'
      ELSE 'Trending'
    END as trend_reason,
    
    EXTRACT(DAY FROM NOW() - ws.last_article_date)::INT as days_trending,
    ws.article_preview,
    ws.created_at
  FROM with_sources ws
)

-- Final: Return sorted results
SELECT
  ft.topic_id,
  ft.topic_title,
  ft.summary,
  ft.tags,
  ft.trending_score,
  ft.news_velocity,
  ft.source_count,
  ft.source_diversity,
  ft.last_article_date,
  ft.total_questions,
  ft.primary_question_id,
  ft.primary_question_text,
  ft.unanswered_questions_count,
  
  -- Map tier to region scope
  CASE
    WHEN p_location_tier = 'city' THEN 'local'
    WHEN p_location_tier = 'state' THEN 'state'
    WHEN p_location_tier = 'country' THEN 'country'
    ELSE 'global'
  END as region_scope,
  
  ft.location_label,
  ft.trend_reason,
  ft.days_trending,
  ft.article_preview
  
FROM final_topics ft
WHERE 
  -- Filter by tier if specified
  CASE
    WHEN p_location_tier = 'city' THEN ft.tier = 'city'
    WHEN p_location_tier = 'state' THEN ft.tier = 'state'
    WHEN p_location_tier = 'country' THEN ft.tier = 'country'
    ELSE ft.tier = 'global'
  END
  
ORDER BY ft.trending_score DESC NULLS LAST
LIMIT p_limit;

$function$;
CREATE OR REPLACE FUNCTION public.get_unread_notification_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int
  from public.user_notifications
  where user_id = auth.uid()
    and is_read = false;
$function$;
CREATE OR REPLACE FUNCTION public.get_user_alignment_snapshot(p_region text DEFAULT 'Global'::text, p_lookback_days integer DEFAULT 30)
 RETURNS TABLE(user_id uuid, region text, alignment_pct numeric, minority_count integer, most_divergent_question_id uuid, most_divergent_question_text text, generated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  WITH v AS (
    SELECT auth.uid() AS uid
  ),
  user_recent_stances AS (
    SELECT
      qs.question_id,
      qs.score        AS user_score,
      q.question      AS question_text
    FROM public.question_stances qs
    JOIN public.questions q ON q.id = qs.question_id
    JOIN public.topics    t ON t.id = q.topic_id
    CROSS JOIN v
    WHERE v.uid IS NOT NULL
      AND qs.user_id = v.uid
      AND qs.created_at >= NOW() - (p_lookback_days || ' days')::interval
      AND CASE
            WHEN p_region = 'United States' THEN
              COALESCE(q.location_label, t.location_label) IN ('United States', 'Global')
              OR COALESCE(q.location_label, t.location_label) IS NULL
            WHEN p_region = 'Global' THEN TRUE
            ELSE
              COALESCE(q.location_label, t.location_label) = p_region
          END
  ),
  with_community_stats AS (
    SELECT
      urs.question_id,
      urs.user_score,
      urs.question_text,
      ABS(urs.user_score - COALESCE(qsr.avg_score, 0)) AS divergence,
      CASE
        WHEN urs.user_score >= 1  AND COALESCE(qsr.pct_agree,    0) > COALESCE(qsr.pct_disagree, 0) THEN true
        WHEN urs.user_score <= -1 AND COALESCE(qsr.pct_disagree, 0) > COALESCE(qsr.pct_agree,    0) THEN true
        WHEN urs.user_score = 0   AND ABS(COALESCE(qsr.pct_agree, 0) - COALESCE(qsr.pct_disagree, 0)) <= 10 THEN true
        ELSE false
      END AS is_majority
    FROM user_recent_stances urs
    LEFT JOIN public.question_stance_stats_region qsr
           ON qsr.question_id = urs.question_id
          AND CASE
                WHEN p_region = 'Global' THEN
                  qsr.region_scope = 'global' AND qsr.region_key = 'Global'
                ELSE
                  qsr.region_scope = 'country' AND qsr.region_key = p_region
              END
  ),
  aggregated AS (
    SELECT
      COUNT(*)                                AS total_answered,
      COUNT(*) FILTER (WHERE is_majority)     AS majority_count,
      COUNT(*) FILTER (WHERE NOT is_majority) AS minority_count,
      (SELECT wcs.question_id   FROM with_community_stats wcs ORDER BY wcs.divergence DESC LIMIT 1) AS top_divergent_id,
      (SELECT wcs.question_text FROM with_community_stats wcs ORDER BY wcs.divergence DESC LIMIT 1) AS top_divergent_text
    FROM with_community_stats
  )
  SELECT
    v.uid                                                                                    AS user_id,
    p_region                                                                                 AS region,
    COALESCE(ROUND(100.0 * COALESCE(a.majority_count, 0) / NULLIF(a.total_answered, 0), 1), 0) AS alignment_pct,
    COALESCE(a.minority_count, 0)::integer                                                   AS minority_count,
    a.top_divergent_id                                                                       AS most_divergent_question_id,
    a.top_divergent_text                                                                     AS most_divergent_question_text,
    NOW()                                                                                    AS generated_at
  FROM aggregated a
  CROSS JOIN v
  WHERE v.uid IS NOT NULL;
$function$;
CREATE OR REPLACE FUNCTION public.get_user_engagement_metrics(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_result jsonb;
  v_topics_followed integer;
  v_questions_answered integer;
  v_last_activity timestamptz;
  v_days_since_activity integer;
BEGIN
  -- ✅ SECURITY: Use provided user_id or auth.uid()
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'topics_followed', 0,
      'questions_answered', 0
    );
  END IF;
  
  -- Count followed topics
  SELECT COUNT(*)
  INTO v_topics_followed
  FROM user_follows
  WHERE user_id = v_user_id
    AND follow_type = 'topic';
  
  -- Count answered questions
  SELECT COUNT(*)
  INTO v_questions_answered
  FROM question_stances
  WHERE user_id = v_user_id;
  
  -- Get last activity
  SELECT MAX(created_at)
  INTO v_last_activity
  FROM question_stances
  WHERE user_id = v_user_id;
  
  IF v_last_activity IS NOT NULL THEN
    v_days_since_activity := EXTRACT(DAY FROM NOW() - v_last_activity)::integer;
  END IF;
  
  -- Build result
  v_result := jsonb_build_object(
    'authenticated', true,
    'topics_followed', v_topics_followed,
    'questions_answered', v_questions_answered,
    'last_activity', v_last_activity,
    'days_since_activity', v_days_since_activity
  );
  
  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_user_since_last_visit(p_user_id uuid, p_limit integer DEFAULT 10)
 RETURNS TABLE(days_since_visit integer, last_visit_at timestamp with time zone, reopened_questions_count integer, reopened_questions jsonb, user_stance_changes_count integer, user_stance_changes jsonb, community_shifts_count integer, community_shifts jsonb, new_questions_count integer, new_topics_count integer, followed_unanswered_count integer, followed_unanswered_topics jsonb)
 LANGUAGE sql
 STABLE
AS $function$
WITH user_last_visit AS (
  -- Get user's last session
  SELECT
    user_id,
    COALESCE(last_seen_at, created_at) as last_visit,
    EXTRACT(DAY FROM NOW() - COALESCE(last_seen_at, created_at))::INT as days_since
  FROM public.sessions
  WHERE user_id = p_user_id
  ORDER BY last_seen_at DESC NULLS LAST
  LIMIT 1
),

reopened_questions_data AS (
  -- Questions that changed state/phase since last visit
  SELECT
    q.id as question_id,
    q.question,
    q.state::TEXT as current_state,
    
    -- Get responses since last visit
    (SELECT COUNT(*)::INT 
     FROM question_stances qs
     WHERE qs.question_id = q.id
       AND qs.created_at > ulv.last_visit) as new_responses_since_visit,
    
    -- Use state_changed_at as last activity time
    q.state_changed_at as last_activity,
    t.title as topic_title,
    
    ROW_NUMBER() OVER (ORDER BY q.state_changed_at DESC) as rank
    
  FROM public.questions q
  LEFT JOIN public.topics t ON t.id = q.topic_id
  CROSS JOIN user_last_visit ulv
  WHERE q.state_changed_at::TIMESTAMP WITH TIME ZONE > ulv.last_visit
    AND q.state::TEXT NOT IN ('archived', 'historical')
    AND q.published_at IS NOT NULL
),

user_stance_changes_data AS (
  -- Questions where user changed their stance (if they answered multiple times)
  -- This requires comparing their previous and current stances
  SELECT
    q.id as question_id,
    q.question,
    
    -- Get latest stance
    (SELECT qs1.score 
     FROM question_stances qs1 
     WHERE qs1.question_id = q.id 
       AND qs1.user_id = p_user_id
     ORDER BY qs1.created_at DESC 
     LIMIT 1)::INT as current_stance,
    
    -- Get previous stance (second to last)
    (SELECT qs2.score 
     FROM question_stances qs2 
     WHERE qs2.question_id = q.id 
       AND qs2.user_id = p_user_id
     ORDER BY qs2.created_at DESC 
     OFFSET 1 LIMIT 1)::INT as previous_stance,
    
    t.title as topic_title,
    
    -- Get the date of the change
    (SELECT qs3.created_at 
     FROM question_stances qs3 
     WHERE qs3.question_id = q.id 
       AND qs3.user_id = p_user_id
     ORDER BY qs3.created_at DESC 
     LIMIT 1) as changed_at,
    
    ROW_NUMBER() OVER (ORDER BY (
      SELECT qs3.created_at 
      FROM question_stances qs3 
      WHERE qs3.question_id = q.id 
        AND qs3.user_id = p_user_id
      ORDER BY qs3.created_at DESC 
      LIMIT 1) DESC) as rank
    
  FROM question_stances qs_user
  INNER JOIN public.questions q ON q.id = qs_user.question_id
  LEFT JOIN public.topics t ON t.id = q.topic_id
  CROSS JOIN user_last_visit ulv
  WHERE qs_user.user_id = p_user_id
    AND qs_user.created_at > ulv.last_visit
    -- Only include if they have multiple stances (changed mind)
    AND (SELECT COUNT(*) 
         FROM question_stances qs_count 
         WHERE qs_count.question_id = q.id 
           AND qs_count.user_id = p_user_id) > 1
),

community_shifts_data AS (
  -- Topics where community consensus shifted
  SELECT
    t.id as topic_id,
    t.title as topic_title,
    t.summary,
    
    -- Get current trending score
    t.trending_score as current_trending_score,
    
    -- Community movement
    (SELECT COUNT(DISTINCT user_id)::INT 
     FROM question_stances qs 
     INNER JOIN questions q ON q.id = qs.question_id
     WHERE q.topic_id = t.id
       AND qs.created_at > ulv.last_visit) as new_responses_count,
    
    -- Average stance of new responses
    (SELECT AVG(qs.score)::NUMERIC 
     FROM question_stances qs 
     INNER JOIN questions q ON q.id = qs.question_id
     WHERE q.topic_id = t.id
       AND qs.created_at > ulv.last_visit) as new_responses_avg_stance,
    
    ROW_NUMBER() OVER (ORDER BY t.trending_score DESC) as rank
    
  FROM public.topics t
  CROSS JOIN user_last_visit ulv
  WHERE (SELECT COUNT(*) 
         FROM question_stances qs 
         INNER JOIN questions q ON q.id = qs.question_id
         WHERE q.topic_id = t.id
           AND qs.created_at > ulv.last_visit) > 0
    AND t.parent_topic_id IS NULL
),

new_content_data AS (
  -- New questions and topics since last visit
  SELECT
    (SELECT COUNT(*)::INT 
     FROM questions q 
     CROSS JOIN user_last_visit ulv
     WHERE q.published_at > ulv.last_visit
       AND q.state::TEXT NOT IN ('archived', 'historical')) as new_questions,
    
    (SELECT COUNT(*)::INT 
     FROM topics t 
     CROSS JOIN user_last_visit ulv
     WHERE t.published_at > ulv.last_visit
       AND t.parent_topic_id IS NULL) as new_topics
),

followed_unanswered_data AS (
  -- Unanswered questions from topics user follows
  SELECT
    t.id as topic_id,
    t.title as topic_title,
    ARRAY_AGG(JSON_BUILD_OBJECT(
      'question_id', q.id,
      'question', q.question,
      'responses_count', (SELECT COUNT(*) FROM question_stances WHERE question_id = q.id),
      'created_at', q.published_at
    ) ORDER BY q.published_at DESC) as unanswered_questions,
    
    COUNT(q.id)::INT as count,
    
    ROW_NUMBER() OVER (ORDER BY MAX(q.published_at) DESC) as rank
    
  FROM public.user_topic_follows utf
  INNER JOIN public.topics t ON t.id = utf.topic_id
  INNER JOIN public.questions q ON q.topic_id = t.id
  LEFT JOIN question_stances qs 
    ON qs.question_id = q.id 
    AND qs.user_id = p_user_id
  WHERE utf.user_id = p_user_id
    AND qs.id IS NULL  -- User hasn't answered
    AND q.state::TEXT NOT IN ('archived', 'historical')
  GROUP BY t.id, t.title
)

-- Final: Combine all data
SELECT
  ulv.days_since,
  ulv.last_visit,
  
  -- Reopened questions
  (SELECT COUNT(*)::INT FROM reopened_questions_data WHERE rank <= p_limit) as reopened_questions_count,
  (SELECT JSONB_AGG(JSON_BUILD_OBJECT(
    'question_id', question_id,
    'question', question,
    'current_state', current_state,
    'new_responses', new_responses_since_visit,
    'last_activity', last_activity,
    'topic_title', topic_title
  )) FROM reopened_questions_data WHERE rank <= p_limit) as reopened_questions,
  
  -- User stance changes
  (SELECT COUNT(*)::INT FROM user_stance_changes_data WHERE rank <= p_limit) as user_stance_changes_count,
  (SELECT JSONB_AGG(JSON_BUILD_OBJECT(
    'question_id', question_id,
    'question', question,
    'previous_stance', previous_stance,
    'current_stance', current_stance,
    'topic_title', topic_title,
    'changed_at', changed_at
  )) FROM user_stance_changes_data WHERE rank <= p_limit) as user_stance_changes,
  
  -- Community shifts
  (SELECT COUNT(*)::INT FROM community_shifts_data WHERE rank <= p_limit) as community_shifts_count,
  (SELECT JSONB_AGG(JSON_BUILD_OBJECT(
    'topic_id', topic_id,
    'topic_title', topic_title,
    'summary', summary,
    'trending_score', current_trending_score,
    'new_responses', new_responses_count,
    'new_avg_stance', new_responses_avg_stance
  )) FROM community_shifts_data WHERE rank <= p_limit) as community_shifts,
  
  -- New content
  (SELECT new_questions FROM new_content_data) as new_questions_count,
  (SELECT new_topics FROM new_content_data) as new_topics_count,
  
  -- Followed unanswered
  (SELECT SUM(count)::INT FROM followed_unanswered_data) as followed_unanswered_count,
  (SELECT JSONB_AGG(JSON_BUILD_OBJECT(
    'topic_id', topic_id,
    'topic_title', topic_title,
    'unanswered_questions', unanswered_questions
  )) FROM followed_unanswered_data WHERE rank <= p_limit) as followed_unanswered_topics
  
FROM user_last_visit ulv;

$function$;
CREATE OR REPLACE FUNCTION public.get_user_stance_snapshot(p_user_id uuid)
 RETURNS TABLE(user_id uuid, snapshot_at timestamp with time zone, mean_stance numeric, median_stance numeric, consistency_score numeric, total_questions_answered integer, active_topic_count integer, last_stance_at timestamp with time zone, stance_label text, consistency_label text, profile_summary text, data_source text)
 LANGUAGE sql
 STABLE
AS $function$
WITH latest_snapshot AS (
  -- Get user's most recent cognitive state snapshot
  SELECT
    user_id,
    snapshot_at,
    mean_stance,
    question_count,
    active_topics,
    last_stance_at,
    'snapshot' as data_source
  FROM public.cognitive_state_snapshots
  WHERE user_id = p_user_id
  ORDER BY snapshot_at DESC
  LIMIT 1
),

calculated_snapshot AS (
  -- Calculate from question_stances if no snapshot exists
  SELECT
    p_user_id as user_id,
    NOW()::TIMESTAMP WITH TIME ZONE as snapshot_at,
    AVG(qs.score)::NUMERIC as mean_stance,
    COUNT(DISTINCT qs.question_id)::INT as question_count,
    ARRAY(
      SELECT DISTINCT q.topic_id::TEXT 
      FROM question_stances qs2
      INNER JOIN questions q ON q.id = qs2.question_id
      WHERE qs2.user_id = p_user_id
    ) as active_topics,
    MAX(qs.created_at)::TIMESTAMP WITH TIME ZONE as last_stance_at,
    'calculated' as data_source
  FROM public.question_stances qs
  WHERE qs.user_id = p_user_id
),

combined_snapshot AS (
  -- Use latest snapshot if available, otherwise use calculation
  SELECT
    COALESCE(ls.user_id, cs.user_id) as user_id,
    COALESCE(ls.snapshot_at, cs.snapshot_at) as snapshot_at,
    COALESCE(ls.mean_stance, cs.mean_stance) as mean_stance,
    COALESCE(ls.question_count, cs.question_count) as question_count,
    COALESCE(ls.active_topics, cs.active_topics) as active_topics,
    COALESCE(ls.last_stance_at, cs.last_stance_at) as last_stance_at,
    COALESCE(ls.data_source, cs.data_source) as data_source
  FROM latest_snapshot ls
  FULL OUTER JOIN calculated_snapshot cs ON 1=1
  WHERE COALESCE(ls.user_id, cs.user_id) IS NOT NULL
),

with_consistency AS (
  -- Calculate consistency score from stances
  SELECT
    cs.*,
    -- Consistency = 1.0 - (StdDev / 2.0), bounded to 0-1
    GREATEST(0, LEAST(1.0, 1.0 - COALESCE(
      (
        SELECT STDDEV_POP(qs.score)::FLOAT8 
        FROM question_stances qs
        WHERE qs.user_id = cs.user_id
      ) / 2.0,
      0
    )))::NUMERIC as consistency_score
  FROM combined_snapshot cs
),

with_interpretations AS (
  -- Add human-readable interpretations
  SELECT
    ws.*,
    
    -- Stance Label: -2 to +2 interpretation
    CASE
      WHEN ws.mean_stance IS NULL THEN 'Not enough data'
      WHEN ws.mean_stance <= -1.5 THEN 'Strongly Progressive'
      WHEN ws.mean_stance <= -0.5 THEN 'Moderately Progressive'
      WHEN ws.mean_stance < 0.5 AND ws.mean_stance > -0.5 THEN 'Centrist/Mixed'
      WHEN ws.mean_stance < 1.5 THEN 'Moderately Conservative'
      ELSE 'Strongly Conservative'
    END as stance_label,
    
    -- Consistency Label: how consistent are their views
    CASE
      WHEN ws.consistency_score IS NULL THEN 'Insufficient data'
      WHEN ws.consistency_score >= 0.85 THEN 'Very consistent'
      WHEN ws.consistency_score >= 0.70 THEN 'Fairly consistent'
      WHEN ws.consistency_score >= 0.50 THEN 'Moderate variation'
      ELSE 'High variation'
    END as consistency_label
  FROM with_consistency ws
)

-- Final: Return with summary text
SELECT
  wi.user_id,
  wi.snapshot_at,
  
  wi.mean_stance,
  (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY qs.score)::NUMERIC
    FROM question_stances qs
    WHERE qs.user_id = wi.user_id
  ) as median_stance,
  wi.consistency_score,
  
  wi.question_count as total_questions_answered,
  COALESCE(ARRAY_LENGTH(wi.active_topics, 1), 0) as active_topic_count,
  wi.last_stance_at,
  
  wi.stance_label,
  wi.consistency_label,
  
  -- Profile Summary
  'You are ' || wi.stance_label || ' on most issues. ' ||
  'Your views are ' || wi.consistency_label || '. ' ||
  'You''ve answered ' || wi.question_count || ' questions across ' ||
  COALESCE(ARRAY_LENGTH(wi.active_topics, 1), 0) || ' topics.'
  as profile_summary,
  
  wi.data_source

FROM with_interpretations wi;

$function$;
CREATE OR REPLACE FUNCTION public.get_you_vs_community_summary(p_limit integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- FIX: Changed stance_value to score (correct column name)
  with user_topic as (
    select
      COALESCE(q.topic_id, qd.topic_id) as topic_id,
      avg(qs.score::numeric) as user_avg,  -- FIXED: was stance_value
      count(*) as answers_count
    from public.question_stances qs
    join public.questions q on q.id = qs.question_id
    left join public.question_drafts qd on qd.id = q.question_draft_id
    where qs.user_id = v_user_id
      and COALESCE(q.topic_id, qd.topic_id) is not null
    group by COALESCE(q.topic_id, qd.topic_id)
  ),

  community_user_topic as (
    select
      COALESCE(q.topic_id, qd.topic_id) as topic_id,
      qs.user_id,
      avg(qs.score::numeric) as user_avg_in_topic  -- FIXED: was stance_value
    from public.question_stances qs
    join public.questions q on q.id = qs.question_id
    left join public.question_drafts qd on qd.id = q.question_draft_id
    where COALESCE(q.topic_id, qd.topic_id) is not null
    group by COALESCE(q.topic_id, qd.topic_id), qs.user_id
  ),

  community_topic as (
    select
      topic_id,
      avg(user_avg_in_topic) as community_avg,
      count(*) as respondents
    from community_user_topic
    group by topic_id
  ),

  user_percentiles as (
    select
      ut.topic_id,
      ut.user_avg,
      ct.community_avg,
      ct.respondents,
      ut.answers_count,
      (
        select coalesce(avg(case when cut.user_avg_in_topic <= ut.user_avg then 1 else 0 end), 0)
        from community_user_topic cut
        where cut.topic_id = ut.topic_id
      ) as pct_rank
    from user_topic ut
    join community_topic ct on ct.topic_id = ut.topic_id
  ),

  top_topics as (
    select *
    from user_percentiles
    order by answers_count desc, respondents desc
    limit p_limit
  ),

  overall as (
    select
      avg(pct_rank) as overall_pct_rank,
      count(*) as topics_compared
    from user_percentiles
  )

  select jsonb_build_object(
    'overall', jsonb_build_object(
      'percentile', (select overall_pct_rank from overall),
      'topics_compared', (select topics_compared from overall)
    ),
    'topics', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'topic_id', tt.topic_id,
            'title', coalesce(t.title, 'Unknown Topic'),
            'your_avg', tt.user_avg,
            'community_avg', tt.community_avg,
            'percentile', tt.pct_rank,
            'respondents', tt.respondents,
            'answers_count', tt.answers_count
          )
          order by tt.answers_count desc, tt.respondents desc
        )
        from top_topics tt
        left join public.topics t on t.id = tt.topic_id
      ),
      '[]'::jsonb
    )
  )
  into v_payload;

  return v_payload;
end;
$function$;
CREATE OR REPLACE FUNCTION public.handle_duplicate_with_context_update(p_draft_id uuid, p_question text, p_summary text, p_tags text[] DEFAULT NULL::text[], p_topic_id uuid DEFAULT NULL::uuid, p_location_label text DEFAULT NULL::text, p_source_link text DEFAULT NULL::text, p_window_days integer DEFAULT 14)
 RETURNS TABLE(action_taken text, question_id uuid, is_new boolean, context_version integer, message text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_dup_check RECORD;
  v_publish_result RECORD;
  v_context_result RECORD;
BEGIN
  -- Check for duplicates
  SELECT * INTO v_dup_check
  FROM check_duplicate_question_deterministic(p_question, p_topic_id, p_window_days);
  
  -- If duplicate found, add context to existing question
  IF v_dup_check.is_duplicate THEN
    -- Add context to existing question
    SELECT * INTO v_context_result
    FROM add_context_to_existing_question(
      v_dup_check.existing_question_id,
      p_summary,
      p_source_link,
      true  -- Reactivate if dormant
    );
    
    -- Log as duplicate (for audit)
    INSERT INTO question_duplicates (
      draft_id,
      existing_question_id,
      dedup_key,
      dedup_bucket,
      reason
    ) VALUES (
      p_draft_id,
      v_dup_check.existing_question_id,
      v_dup_check.dedup_key,
      v_dup_check.dedup_bucket,
      'duplicate_context_added'
    );
    
    -- Merge tags if provided
    IF p_tags IS NOT NULL THEN
      UPDATE questions
      SET tags = (
        SELECT ARRAY(
          SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::TEXT[]) || p_tags)
        )
      )
      WHERE id = v_dup_check.existing_question_id;
    END IF;
    
    RETURN QUERY 
    SELECT 
      'updated_existing'::TEXT,
      v_dup_check.existing_question_id,
      false,
      v_context_result.new_context_version,
      format('Updated existing question. Context version: %s', v_context_result.new_context_version)::TEXT;
    RETURN;
  END IF;
  
  -- No duplicate - publish as new question
  SELECT * INTO v_publish_result
  FROM publish_question_with_dedup(
    p_draft_id,
    p_question,
    p_summary,
    p_tags,
    p_topic_id,
    p_location_label,
    p_window_days
  );
  
  -- Add initial context if new question created
  IF v_publish_result.success AND p_source_link IS NOT NULL THEN
    UPDATE questions
    SET 
      context_summary = p_summary,
      supporting_links = ARRAY[p_source_link]
    WHERE id = v_publish_result.question_id;
  END IF;
  
  RETURN QUERY 
  SELECT 
    'created_new'::TEXT,
    v_publish_result.question_id,
    true,
    1,  -- Initial version
    'New question created'::TEXT;
    
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY 
  SELECT 
    'error'::TEXT,
    NULL::UUID,
    false,
    0,
    ('Error: ' || SQLERRM)::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.increment_broadcast_counter(p_broadcast_id uuid, p_column text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only allow safe column names to prevent SQL injection
  IF p_column NOT IN (
    'total_sent', 'total_delivered', 'total_failed',
    'total_opened', 'total_completed', 'total_stances'
  ) THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE public.whatsapp_broadcasts SET %I = %I + 1 WHERE id = $1',
    p_column, p_column
  ) USING p_broadcast_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.infer_audience_location(p_question_text text, p_summary text DEFAULT NULL::text, p_tags text[] DEFAULT NULL::text[], p_origin_label text DEFAULT NULL::text)
 RETURNS TABLE(audience_label text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_lower text;
BEGIN
  v_lower := lower(
    coalesce(p_question_text,'') || ' ' ||
    coalesce(p_summary,'')       || ' ' ||
    array_to_string(coalesce(p_tags,'{}'), ' ')
  );

  -- Rule B: GLOBAL — multiple sovereign nations or international orgs
  IF v_lower ~* '(iran|israel|nato|united nations|worldwide|international|global|russia|china|ukraine|hamas|hezbollah|war between|conflict between|multinational)'
     AND v_lower ~* E'(\\bu\.?s\.?\\b|united states|america|military|strike|sanction)'
  THEN
    RETURN QUERY SELECT
      'Global'::text,
      'International conflict or multinational issue; global relevance.'::text;
    RETURN;
  END IF;

  -- Rule A: NATIONAL US — federal government, institutions, national policy
  IF v_lower ~* '(white house|congress|senate|supreme court|pentagon|federal government|president trump|president biden|immigration policy|federal law|national security|us military|department of\b|cabinet|executive order|sanctions|foreign policy)'
  THEN
    RETURN QUERY SELECT
      'United States'::text,
      'Federal policy decision; national relevance.'::text;
    RETURN;
  END IF;

  -- Rule C: LOCAL — fallback to origin
  RETURN QUERY SELECT
    coalesce(p_origin_label, 'Global')::text,
    'Local/regional issue; audience matches origin.'::text;
END;
$function$;
CREATE OR REPLACE FUNCTION public.initialize_user_context_from_signup(p_email text DEFAULT NULL::text, p_dob_age_band integer DEFAULT NULL::integer, p_entry_path text DEFAULT NULL::text, p_campaign_audience text DEFAULT NULL::text, p_share_ref text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid            uuid := auth.uid();
  v_existing_seg   uuid;
  v_segment_key    text;
  v_segment_id     uuid;
BEGIN
  -- ── Guard: must be authenticated ──────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = '42501';
  END IF;

  -- ── Idempotency: skip if segment already resolved ─────────
  -- audience_segment_id is set once at signup; user can update
  -- it later via Settings. Never overwrite an existing value here.
  SELECT audience_segment_id
    INTO v_existing_seg
    FROM public.profiles
   WHERE user_id = v_uid;

  IF v_existing_seg IS NOT NULL THEN
    -- Already resolved — return the existing key for logging
    SELECT key INTO v_segment_key
      FROM public.audience_segments
     WHERE id = v_existing_seg;
    RETURN v_segment_key;
  END IF;

  -- ── Signal resolution (priority order) ───────────────────
  -- Priority 1: explicit campaign_audience URL param (?s= or ?audience=)
  IF p_campaign_audience IS NOT NULL AND p_campaign_audience != '' THEN
    SELECT id, key
      INTO v_segment_id, v_segment_key
      FROM public.audience_segments
     WHERE key    = lower(trim(p_campaign_audience))
       AND status = 'active'
     LIMIT 1;
  END IF;

  -- Priority 2: entry path prefix match
  IF v_segment_id IS NULL AND p_entry_path IS NOT NULL AND p_entry_path != '' THEN
    v_segment_key := CASE
      WHEN p_entry_path ILIKE '/students%'   THEN 'college_students'
      WHEN p_entry_path ILIKE '/elections%'  THEN 'voters'
      WHEN p_entry_path ILIKE '/vote%'       THEN 'voters'
      WHEN p_entry_path ILIKE '/healthcare%' THEN 'healthcare_workers'
      WHEN p_entry_path ILIKE '/health%'     THEN 'healthcare_workers'
      WHEN p_entry_path ILIKE '/local%'      THEN 'local_residents'
      WHEN p_entry_path ILIKE '/career%'     THEN 'working_professionals'
      WHEN p_entry_path ILIKE '/money%'      THEN 'working_professionals'
      ELSE NULL
    END;

    IF v_segment_key IS NOT NULL THEN
      SELECT id INTO v_segment_id
        FROM public.audience_segments
       WHERE key    = v_segment_key
         AND status = 'active'
       LIMIT 1;
    END IF;
  END IF;

  -- Priority 3: email domain — .edu suffix → college_students
  IF v_segment_id IS NULL AND p_email IS NOT NULL AND p_email != '' THEN
    IF lower(trim(p_email)) LIKE '%.edu' THEN
      SELECT id, key
        INTO v_segment_id, v_segment_key
        FROM public.audience_segments
       WHERE key    = 'college_students'
         AND status = 'active'
       LIMIT 1;
    END IF;
  END IF;

  -- Priority 4: age band — 18–24 → college_students
  IF v_segment_id IS NULL AND p_dob_age_band IS NOT NULL THEN
    IF p_dob_age_band BETWEEN 17 AND 24 THEN
      -- 17 included: 17-year-olds in their last year of school
      -- are likely heading to college soon
      SELECT id, key
        INTO v_segment_id, v_segment_key
        FROM public.audience_segments
       WHERE key    = 'college_students'
         AND status = 'active'
       LIMIT 1;
    END IF;
  END IF;

  -- Priority 5: default → general
  IF v_segment_id IS NULL THEN
    SELECT id, key
      INTO v_segment_id, v_segment_key
      FROM public.audience_segments
     WHERE key    = 'general'
       AND status = 'active'
     LIMIT 1;
  END IF;

  -- ── Write resolved segment to profile ────────────────────
  IF v_segment_id IS NOT NULL THEN
    UPDATE public.profiles
       SET audience_segment_id = v_segment_id,
           updated_at          = now()
     WHERE user_id = v_uid
       AND audience_segment_id IS NULL;  -- double-guard against race conditions
  END IF;

  RETURN v_segment_key;
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = uid
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_admin_me()
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_cron_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- For now: any authenticated user is admin
  -- TODO: Add proper admin_users check later
  RETURN auth.uid() IS NOT NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_following_topic(p_user_id uuid, p_topic_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM public.user_follows
    WHERE user_id = p_user_id
      AND follow_type = 'topic'
      AND follow_id = p_topic_id
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_moderator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.moderators m
    where m.user_id = auth.uid()
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_user_banned(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_restrictions
    WHERE user_id          = p_user_id
      AND restriction_type = 'ban'
      AND lifted_at        IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_user_restricted(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_restrictions
    WHERE user_id          = p_user_id
      AND restriction_type = 'restrict'
      AND lifted_at        IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  );
$function$;
CREATE OR REPLACE FUNCTION public.lift_election_exit_poll_gates(p_election_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_last_phase_close timestamptz;
  v_gate_minutes     integer := 30;
  v_gate_end         timestamptz;
  v_count            integer;
BEGIN
  SELECT last_phase_close_at INTO v_last_phase_close
  FROM public.elections
  WHERE id = p_election_id;

  IF v_last_phase_close IS NULL THEN RETURN 0; END IF;

  -- Get custom gate minutes from compliance rules
  SELECT COALESCE(MIN(exit_poll_gate_minutes), 30) INTO v_gate_minutes
  FROM public.election_compliance_rules
  WHERE election_id = p_election_id
    AND rule_type = 'EXIT_POLL_GATE'
    AND is_active = true;

  v_gate_end := v_last_phase_close + (v_gate_minutes || ' minutes')::interval;

  IF now() < v_gate_end THEN
    RETURN 0; -- Gate still active
  END IF;

  -- Lift gates
  UPDATE public.election_stance_aggregates
  SET is_gated = false, gate_lifted_at = v_gate_end
  WHERE election_id = p_election_id
    AND is_gated = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Audit log
  INSERT INTO public.election_audit_log (
    election_id, action, target_table,
    new_value, notes
  )
  VALUES (
    p_election_id,
    'EXIT_POLL_GATE_LIFTED',
    'election_stance_aggregates',
    jsonb_build_object(
      'rows_unblocked', v_count,
      'gate_end', v_gate_end,
      'gate_minutes', v_gate_minutes
    ),
    'Exit poll gate lifted — community pulse now publicly visible (RPA §126A)'
  );

  RETURN v_count;
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_comment_reports(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_reason text DEFAULT NULL::text, p_status text DEFAULT 'pending'::text)
 RETURNS TABLE(report_id uuid, comment_id uuid, comment_body text, comment_user_id uuid, reporter_id uuid, reason text, reported_at timestamp with time zone, toxicity_score numeric, flagged boolean, action_taken text, action_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    cr.id                             AS report_id,
    cr.comment_id,
    c.body                            AS comment_body,
    c.user_id                         AS comment_user_id,
    cr.reporter_id,
    cr.reason,
    cr.created_at                     AS reported_at,
    ts.toxicity_score,
    ts.flagged,
    ma.action                         AS action_taken,
    ma.created_at                     AS action_at
  FROM public.comment_reports cr
  JOIN public.comments c ON c.id = cr.comment_id
  LEFT JOIN public.toxicity_scores ts ON ts.comment_id = cr.comment_id
  LEFT JOIN public.moderation_actions ma
    ON ma.report_id = cr.id
  WHERE
    (p_reason IS NULL OR cr.reason = p_reason)
    AND (
      p_status = 'all'
      OR (p_status = 'pending'  AND ma.id IS NULL)
      OR (p_status = 'resolved' AND ma.id IS NOT NULL)
    )
  ORDER BY
    ts.toxicity_score DESC NULLS LAST,
    cr.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$function$;
CREATE OR REPLACE FUNCTION public.list_comment_reports(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_reason text DEFAULT NULL::text, p_status text DEFAULT 'pending'::text, p_min_toxicity numeric DEFAULT NULL::numeric, p_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(report_id uuid, comment_id uuid, comment_body text, comment_user_id uuid, reporter_id uuid, reason text, reported_at timestamp with time zone, toxicity_score numeric, flagged boolean, action_taken text, action_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    cr.id                             AS report_id,
    cr.comment_id,
    c.body                            AS comment_body,
    c.user_id                         AS comment_user_id,
    cr.reporter_id,
    cr.reason,
    cr.created_at                     AS reported_at,
    ts.toxicity_score,
    ts.flagged,
    ma.action                         AS action_taken,
    ma.created_at                     AS action_at
  FROM public.comment_reports cr
  JOIN public.comments        c  ON c.id  = cr.comment_id
  LEFT JOIN public.toxicity_scores     ts ON ts.comment_id = cr.comment_id
  LEFT JOIN public.moderation_actions  ma ON ma.report_id  = cr.id
  WHERE
    (p_reason       IS NULL OR cr.reason        = p_reason)
    AND (p_after    IS NULL OR cr.created_at   >= p_after)
    AND (p_before   IS NULL OR cr.created_at   <= p_before)
    AND (p_min_toxicity IS NULL OR COALESCE(ts.toxicity_score, 0) >= p_min_toxicity)
    AND (
      p_status = 'all'
      OR (p_status = 'pending'  AND ma.id IS NULL)
      OR (p_status = 'resolved' AND ma.id IS NOT NULL)
    )
  ORDER BY
    ts.toxicity_score DESC NULLS LAST,
    cr.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$function$;
CREATE OR REPLACE FUNCTION public.list_comment_reports(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_reason text DEFAULT NULL::text, p_status text DEFAULT 'pending'::text, p_min_toxicity numeric DEFAULT NULL::numeric, p_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_order_by text DEFAULT 'toxicity'::text)
 RETURNS TABLE(report_id uuid, comment_id uuid, comment_body text, comment_user_id uuid, reporter_id uuid, reason text, reported_at timestamp with time zone, toxicity_score numeric, flagged boolean, action_taken text, action_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    cr.id                             AS report_id,
    cr.comment_id,
    c.body                            AS comment_body,
    c.user_id                         AS comment_user_id,
    cr.reporter_id,
    cr.reason,
    cr.created_at                     AS reported_at,
    ts.toxicity_score,
    ts.flagged,
    ma.action                         AS action_taken,
    ma.created_at                     AS action_at
  FROM public.comment_reports cr
  JOIN public.comments        c  ON c.id  = cr.comment_id
  LEFT JOIN public.toxicity_scores     ts ON ts.comment_id = cr.comment_id
  LEFT JOIN public.moderation_actions  ma ON ma.report_id  = cr.id
  WHERE
    (p_reason           IS NULL OR cr.reason        = p_reason)
    AND (p_after        IS NULL OR cr.created_at   >= p_after)
    AND (p_before       IS NULL OR cr.created_at   <= p_before)
    AND (p_min_toxicity IS NULL OR COALESCE(ts.toxicity_score, 0) >= p_min_toxicity)
    AND (
      p_status = 'all'
      OR (p_status = 'pending'  AND ma.id IS NULL)
      OR (p_status = 'resolved' AND ma.id IS NOT NULL)
    )
  ORDER BY
    CASE WHEN p_order_by = 'date' THEN cr.created_at END DESC,
    CASE WHEN p_order_by != 'date' THEN ts.toxicity_score END DESC NULLS LAST,
    cr.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
$function$;
CREATE OR REPLACE FUNCTION public.list_feed_topics(p_region_ids uuid[], p_limit integer DEFAULT 30)
 RETURNS SETOF public.feed_topics_v
 LANGUAGE sql
 STABLE
AS $function$
  with ranked as (
    select t.*, tr.region_id,
           row_number() over (
             partition by t.id
             order by case when tr.region_id = any(p_region_ids) then 0 else 1 end,
                      t.published_at desc
           ) rnk
    from public.topics t
    left join public.topic_regions tr on tr.topic_id = t.id
  )
  select id, title, summary, tags, sources, lang, published_at
  from ranked
  where rnk = 1
  order by published_at desc
  limit p_limit;
$function$;
CREATE OR REPLACE FUNCTION public.list_pipeline_jobs(p_limit integer DEFAULT 50, p_status text DEFAULT NULL::text, p_job_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, job_type text, source_name text, status text, started_at timestamp with time zone, finished_at timestamp with time zone, duration_ms integer, items_processed integer, error_message text, retry_count integer, resolved boolean, resolved_note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    pj.id,
    pj.job_type,
    ts.name  AS source_name,
    pj.status,
    pj.started_at,
    pj.finished_at,
    pj.duration_ms,
    pj.items_processed,
    pj.error_message,
    pj.retry_count,
    pj.resolved,
    pj.resolved_note
  FROM public.pipeline_jobs pj
  LEFT JOIN public.topic_sources ts ON ts.id = pj.source_id
  WHERE
    (p_status   IS NULL OR pj.status   = p_status)
    AND (p_job_type IS NULL OR pj.job_type = p_job_type)
  ORDER BY pj.started_at DESC
  LIMIT p_limit;
$function$;
CREATE OR REPLACE FUNCTION public.list_question_comments(p_question_id uuid)
 RETURNS TABLE(id uuid, question_id uuid, parent_id uuid, user_id uuid, user_display text, body text, created_at timestamp with time zone, edited_at timestamp with time zone, is_deleted boolean, profile_random_id text, profile_username text, profile_display_handle_mode text, profile_avatar_url text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    c.id,
    c.question_id,
    c.parent_id,
    c.user_id,
    c.user_display,
    c.body,
    c.created_at,
    c.edited_at,
    c.is_deleted,
    p.random_id             AS profile_random_id,
    p.username              AS profile_username,
    p.display_handle_mode   AS profile_display_handle_mode,
    p.avatar_url            AS profile_avatar_url
  FROM public.comments c
  LEFT JOIN public.profiles p
    ON p.user_id = c.user_id
  WHERE
    c.question_id = p_question_id
  ORDER BY
    COALESCE(c.parent_id, c.id),  -- group replies under their parent
    c.created_at ASC;
$function$;
CREATE OR REPLACE FUNCTION public.list_replies_for_roots(p_question_id uuid, p_root_ids uuid[])
 RETURNS TABLE(id uuid, question_id uuid, parent_id uuid, user_id uuid, user_display text, body text, created_at timestamp with time zone, edited_at timestamp with time zone, is_deleted boolean, profile_random_id text, profile_username text, profile_display_handle_mode text, profile_avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  WITH RECURSIVE reply_tree AS (
    -- Base: direct children of the root comments
    SELECT c.id, c.parent_id, c.id AS root_id
    FROM public.comments c
    WHERE
      c.question_id = p_question_id
      AND c.parent_id = ANY(p_root_ids)

    UNION ALL

    -- Recurse: children of children, carrying the root_id down
    SELECT c.id, c.parent_id, rt.root_id
    FROM public.comments c
    JOIN reply_tree rt ON c.parent_id = rt.id
    WHERE c.question_id = p_question_id
  )
  SELECT
    c.id,
    c.question_id,
    c.parent_id,
    c.user_id,
    c.user_display,
    c.body,
    c.created_at,
    c.edited_at,
    c.is_deleted,
    p.random_id           AS profile_random_id,
    p.username            AS profile_username,
    p.display_handle_mode AS profile_display_handle_mode,
    p.avatar_url          AS profile_avatar_url
  FROM reply_tree rt
  JOIN public.comments c ON c.id = rt.id
  LEFT JOIN public.profiles p ON p.user_id = c.user_id
  ORDER BY
    rt.root_id,           -- group by root
    c.created_at ASC,
    c.id ASC;
$function$;
CREATE OR REPLACE FUNCTION public.list_root_comments_page(p_question_id uuid, p_limit integer DEFAULT 20, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, question_id uuid, parent_id uuid, user_id uuid, user_display text, body text, created_at timestamp with time zone, edited_at timestamp with time zone, is_deleted boolean, profile_random_id text, profile_username text, profile_display_handle_mode text, profile_avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    c.id,
    c.question_id,
    c.parent_id,
    c.user_id,
    c.user_display,
    c.body,
    c.created_at,
    c.edited_at,
    c.is_deleted,
    p.random_id           AS profile_random_id,
    p.username            AS profile_username,
    p.display_handle_mode AS profile_display_handle_mode,
    p.avatar_url          AS profile_avatar_url
  FROM public.comments c
  LEFT JOIN public.profiles p ON p.user_id = c.user_id
  WHERE
    c.question_id = p_question_id
    AND c.parent_id IS NULL
    -- Cursor condition: skip anything at-or-after the cursor position.
    -- NULL cursor = first page, no filter applied.
    AND (
      p_before_created_at IS NULL
      OR (c.created_at, c.id) < (p_before_created_at, p_before_id)
    )
  ORDER BY
    c.created_at DESC,
    c.id DESC
  LIMIT LEAST(p_limit, 100);  -- hard cap at 100 per page
$function$;
create or replace view "public"."topic_region_trends_v" as  SELECT tr.topic_id AS id,
    t.title,
    t.summary,
    t.tags,
    tr.updated_at,
    t.tier,
    t.location_label,
        CASE
            WHEN (tr.total > 0) THEN round(((((((tr.agree - tr.disagree))::numeric / (tr.total)::numeric) * (50)::numeric) + ((tr.total_24h)::numeric * (5)::numeric)) + ((tr.total)::numeric * 0.5)), 2)
            ELSE (0)::numeric
        END AS trending_score,
    tr.total AS activity_7d,
    tr.location_id
   FROM (public.topic_region_trends tr
     JOIN public.topics t ON ((t.id = tr.topic_id)));
CREATE OR REPLACE FUNCTION public.list_trending_topics(p_region_ids uuid[], p_limit integer DEFAULT 8)
 RETURNS SETOF public.topic_region_trends_v
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.*
  from public.topic_region_trends_v v
  join public.topics t
    on t.id = v.id
  where
    -- Only canonical topics in trending lists
    t.parent_topic_id is null
    and (
      -- If caller passes null/empty, behave like global trending
      p_region_ids is null
      or array_length(p_region_ids, 1) is null
      or v.location_id = any (p_region_ids)
    )
  order by
    v.trending_score desc,
    v.activity_7d   desc,
    v.updated_at    desc
  limit coalesce(p_limit, 8);
$function$;
CREATE OR REPLACE FUNCTION public.list_trending_topics_for_me(p_limit integer DEFAULT 8)
 RETURNS SETOF public.topic_region_trends_v
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id    uuid := auth.uid();
  v_region_ids uuid[];
  v_extra_ids  uuid[];
  v_global_id  uuid;
begin
  -- 1) If no logged-in user, fall back to GLOBAL rows
  if v_user_id is null then
    return query
    select v.*
    from public.topic_region_trends_v v
    join public.locations l on l.id = v.location_id
    where l.type = 'global'::public.location_tier_enum
    order by v.trending_score desc, v.activity_7d desc, v.updated_at desc
    limit coalesce(p_limit, 8);
    return;
  end if;

  -- 2) Start with locations directly attached to this user
  select coalesce(array_agg(distinct uls.location_id), '{}'::uuid[])
  into v_region_ids
  from public.user_location_settings uls
  where uls.user_id = v_user_id;

  -- 3) Add extra regions from user_region_preferences (if any)
  select extra_region_ids
  into v_extra_ids
  from public.user_region_preferences urp
  where urp.user_id = v_user_id;

  if v_extra_ids is not null and array_length(v_extra_ids, 1) > 0 then
    v_region_ids := coalesce(v_region_ids, '{}'::uuid[]) || v_extra_ids;
  end if;

  -- 4) Always append the global location (if it exists)
  select id
  into v_global_id
  from public.locations
  where type = 'global'::public.location_tier_enum
  limit 1;

  if v_global_id is not null then
    v_region_ids := array_append(coalesce(v_region_ids, '{}'::uuid[]), v_global_id);
  end if;

  -- 5) If no regions at all, fall back to GLOBAL rows again
  if v_region_ids is null or array_length(v_region_ids, 1) is null then
    return query
    select v.*
    from public.topic_region_trends_v v
    join public.locations l on l.id = v.location_id
    where l.type = 'global'::public.location_tier_enum
    order by v.trending_score desc, v.activity_7d desc, v.updated_at desc
    limit coalesce(p_limit, 8);
    return;
  end if;

  -- 6) Normal case: delegate to list_trending_topics (which also returns topic_region_trends_v rows)
  return query
  select *
  from public.list_trending_topics(v_region_ids, p_limit);
end;
$function$;
CREATE OR REPLACE FUNCTION public.log_username_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and new.username is distinct from old.username then
    insert into public.username_history(user_id, username)
    values (new.user_id, new.username);
  end if;
  return new;
end
$function$;
CREATE OR REPLACE FUNCTION public.manually_archive_question(p_question_id uuid, p_reason text, p_admin_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_old_state question_state;
BEGIN
  
  -- Get current state
  SELECT state INTO v_old_state FROM public.questions WHERE id = p_question_id;
  
  -- Update to archived
  UPDATE public.questions
  SET 
    state = 'archived',
    status = 'archived', -- Keep old field in sync
    state_changed_at = NOW(),
    archived_at = NOW(),
    archive_reason = p_reason
  WHERE id = p_question_id;
  
  -- Log in history
  INSERT INTO public.question_state_history (
    question_id,
    old_state,
    new_state,
    reason,
    created_by
  ) VALUES (
    p_question_id,
    v_old_state,
    'archived',
    'manual_archive: ' || p_reason,
    p_admin_id
  );
  
  RETURN TRUE;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.mark_acknowledgement_shown(p_trigger_type text, p_context jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_ack_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_ack_id := public.record_acknowledgement(v_uid, p_trigger_type, p_context);
  
  return v_ack_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  update public.user_notifications
  set
    is_read = true,
    read_at  = coalesce(read_at, now())
  where user_id = auth.uid()
    and is_read = false;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.user_notifications
  set
    is_read = true,
    read_at  = coalesce(read_at, now())
  where id      = p_notification_id
    and user_id = auth.uid();

  return found;
end;
$function$;
CREATE OR REPLACE FUNCTION public.mark_question_resolved(p_question_id uuid, p_resolution_summary text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  
  UPDATE public.questions
  SET 
    is_resolved = true,
    resolved_at = NOW(),
    resolution_summary = p_resolution_summary
  WHERE id = p_question_id;
  
  -- Trigger state update (will auto-archive if configured)
  PERFORM public.update_question_state(p_question_id, 'resolved');
  
  RETURN TRUE;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.merge_embedded_stances(p_device_fingerprint text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_merged integer := 0;
BEGIN
  -- Only merge stances not already attributed
  UPDATE public.embedded_stances
  SET
    attributed_user_id = auth.uid(),
    merged_at = now()
  WHERE device_fingerprint = p_device_fingerprint
    AND attributed_user_id IS NULL;

  GET DIAGNOSTICS v_merged = ROW_COUNT;
  RETURN v_merged;
END;
$function$;
CREATE OR REPLACE FUNCTION public.normalize_audience_location_label(p_label text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_label IS NULL THEN NULL
    WHEN btrim(lower(p_label)) IN ('global', 'worldwide', 'international') THEN 'Global'
    WHEN btrim(lower(p_label)) IN ('national', 'domestic', 'country', 'us', 'u.s.', 'usa', 'united states of america') THEN 'United States'
    ELSE initcap(btrim(p_label))
  END
$function$;
CREATE OR REPLACE FUNCTION public.normalize_email()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.email is not null then
    new.email := lower(new.email);
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.normalize_question_text(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_normalized TEXT;
BEGIN
  -- Convert to lowercase
  v_normalized := LOWER(p_text);
  
  -- Remove punctuation
  v_normalized := REGEXP_REPLACE(v_normalized, '[^\w\s]', '', 'g');
  
  -- Collapse multiple spaces to single space
  v_normalized := REGEXP_REPLACE(v_normalized, '\s+', ' ', 'g');
  
  -- Remove common stopwords (optional - keeping it simple)
  v_normalized := REGEXP_REPLACE(v_normalized, '\b(the|a|an|and|or|but|in|on|at|to|for)\b', '', 'g');
  
  -- Clean up spaces again
  v_normalized := REGEXP_REPLACE(v_normalized, '\s+', ' ', 'g');
  v_normalized := TRIM(v_normalized);
  
  RETURN v_normalized;
END;
$function$;
CREATE OR REPLACE FUNCTION public.normalize_username()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.username is not null then
    new.username := lower(new.username);
  end if;
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.populate_news_items_from_ingestion_queue(p_days integer DEFAULT 7, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inserted int := 0;
begin
  /*
    Intent:
    - Copy canonical fields from ingestion_queue → news_items
    - Deduplicate by url (news_items is canonical & stable)
    - Idempotent: running multiple times won’t duplicate
    - ✅ Also carry image_url from ingestion_queue.normalized->>'image_url'
  */

  insert into public.news_items (
    source_id,
    title,
    url,
    summary,
    lang,
    published_at,
    image_url,
    image_meta,
    image_checked_at
  )
  select
    iq.source_id,
    coalesce(nullif(iq.title, ''), '[untitled]') as title,
    iq.url,
    iq.summary,
    iq.lang,
    coalesce(iq.published_at, iq.created_at) as published_at,

    -- ✅ Permanent fix: carry image extracted during ingest
    nullif(iq.normalized->>'image_url', '') as image_url,

    -- Optional forensics (helps debugging / future enrich)
    case
      when nullif(iq.normalized->>'image_url', '') is not null then
        jsonb_build_object(
          'source', 'ingestion_queue.normalized',
          'rss',  iq.raw->'extracted_image'->>'rss',
          'meta', iq.raw->'extracted_image'->>'meta'
        )
      else null
    end as image_meta,

    case
      when nullif(iq.normalized->>'image_url', '') is not null then now()
      else null
    end as image_checked_at

  from public.ingestion_queue iq
  where iq.url is not null
    and iq.created_at >= now() - make_interval(days => p_days)
    and coalesce(iq.status, '') not in ('failed') -- adjust if needed
    and not exists (
      select 1
      from public.news_items ni
      where ni.url = iq.url
    )
  order by iq.created_at desc
  limit p_limit;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'days', p_days,
    'limit', p_limit
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.preview_cluster_v3(p_window_hours integer DEFAULT 72, p_candidate_limit integer DEFAULT 200, p_seed_threshold double precision DEFAULT 0.82, p_expand_threshold double precision DEFAULT 0.82, p_entity_weight double precision DEFAULT 0.30, p_min_items integer DEFAULT 1, p_min_sources integer DEFAULT 1, p_max_clusters integer DEFAULT 30, p_force_assign_min_sim double precision DEFAULT 0.55, p_overflow_bucket boolean DEFAULT false, p_ignore_already_clustered boolean DEFAULT false)
 RETURNS TABLE(cluster_id integer, cluster_size integer, distinct_sources integer, ingestion_id uuid, created_at timestamp with time zone, source_id uuid, title text, url text, similarity double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
  r RECORD;

  c_centroids vector[] := ARRAY[]::vector[];
  c_member_ids uuid[][] := ARRAY[]::uuid[][];
  c_member_sims double precision[][] := ARRAY[]::double precision[][];

  total_clusters integer := 0;

  i integer;
  j integer;
  best_i integer;
  best_sim double precision;
  sim double precision;

  new_centroid vector;
  strict_dist integer;

  since_ts timestamptz := now() - make_interval(hours => p_window_hours);
BEGIN
  FOR r IN
    SELECT iq.id, iq.created_at, iq.source_id, iq.title, iq.url, iq.embedding
    FROM public.ingestion_queue iq
    WHERE iq.embedding IS NOT NULL
      AND iq.embed_status = 'done'
      AND iq.created_at >= since_ts
      AND (
        p_ignore_already_clustered
        OR NOT EXISTS (
          SELECT 1 FROM public.topic_cluster_items tci WHERE tci.ingestion_id = iq.id
        )
      )
    ORDER BY iq.created_at DESC, iq.id
    LIMIT p_candidate_limit
  LOOP
    best_i := NULL;
    best_sim := -1;

    FOR i IN 1..total_clusters LOOP
      sim := 1 - (r.embedding <=> c_centroids[i]);
      IF sim > best_sim THEN
        best_sim := sim;
        best_i := i;
      END IF;
    END LOOP;

    IF best_i IS NOT NULL AND best_sim >= p_seed_threshold THEN
      c_member_ids[best_i] := c_member_ids[best_i] || ARRAY[r.id];
      c_member_sims[best_i] := c_member_sims[best_i] || ARRAY[best_sim];

      SELECT avg(v)::vector INTO new_centroid
      FROM (
        SELECT iq2.embedding AS v
        FROM unnest(c_member_ids[best_i]) mid
        JOIN public.ingestion_queue iq2 ON iq2.id = mid
      ) s;

      c_centroids[best_i] := new_centroid;

    ELSIF total_clusters < p_max_clusters THEN
      total_clusters := total_clusters + 1;

      c_centroids := c_centroids || ARRAY[r.embedding];
      c_member_ids := c_member_ids || ARRAY[ARRAY[r.id]]::uuid[][];
      c_member_sims := c_member_sims || ARRAY[ARRAY[1.0]]::double precision[][];

    ELSE
      IF best_i IS NOT NULL AND best_sim >= p_force_assign_min_sim THEN
        c_member_ids[best_i] := c_member_ids[best_i] || ARRAY[r.id];
        c_member_sims[best_i] := c_member_sims[best_i] || ARRAY[best_sim];

        SELECT avg(v)::vector INTO new_centroid
        FROM (
          SELECT iq2.embedding AS v
          FROM unnest(c_member_ids[best_i]) mid
          JOIN public.ingestion_queue iq2 ON iq2.id = mid
        ) s;

        c_centroids[best_i] := new_centroid;
      END IF;
    END IF;
  END LOOP;

  -- Output
  FOR i IN 1..total_clusters LOOP
    IF COALESCE(array_length(c_member_ids[i], 1), 0) < p_min_items THEN
      CONTINUE;
    END IF;

    -- compute distinct sources dynamically (no arrays!)
    SELECT count(DISTINCT iq2.source_id)
    INTO strict_dist
    FROM unnest(c_member_ids[i]) mid
    JOIN public.ingestion_queue iq2 ON iq2.id = mid
    WHERE iq2.source_id IS NOT NULL;

    IF strict_dist < p_min_sources THEN
      CONTINUE;
    END IF;

    FOR j IN 1..array_length(c_member_ids[i], 1) LOOP
      RETURN QUERY
      SELECT
        i,
        array_length(c_member_ids[i], 1),
        strict_dist,
        iq.id,
        iq.created_at,
        iq.source_id,
        iq.title,
        iq.url,
        c_member_sims[i][j]
      FROM public.ingestion_queue iq
      WHERE iq.id = c_member_ids[i][j];
    END LOOP;
  END LOOP;

END;
$function$;
CREATE OR REPLACE FUNCTION public.profile_set_dob_checked(p_dob_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_dob date;
  v_key text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- no-op if already set
  if exists (
    select 1 from public.profiles
    where user_id = v_uid and dob_encrypted is not null
  ) then
    return;
  end if;

  if p_dob_text is null or btrim(p_dob_text) = '' then
    raise exception 'DOB is required';
  end if;

  v_dob := btrim(p_dob_text)::date;

  if v_dob > (current_date - interval '13 years')::date then
    raise exception 'Must be at least 13 years old';
  end if;

  v_key := private.get_secret('dob_key');
  if v_key is null or v_key = '' then
    raise exception 'DOB encryption key not configured';
  end if;

  update public.profiles
     set dob_encrypted = extensions.pgp_sym_encrypt(v_dob::text, v_key),
         updated_at = now()
   where user_id = v_uid;

  if not found then
    raise exception 'Profile row not found for user %', v_uid;
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION public.profile_set_dob_encrypted(p_user_id uuid, p_dob date, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if auth.uid() <> p_user_id and auth.role() <> 'service_role' then
    raise exception 'not allowed';
  end if;
  update public.profiles
     set dob_encrypted = pgp_sym_encrypt(p_dob::text, p_key),
         updated_at = now()
   where user_id = p_user_id;
end $function$;
CREATE OR REPLACE FUNCTION public.profile_set_gender(p_gender text, p_gender_self text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_gender not in ('male','female','nonbinary','prefer_not_to_say','self_described') then
    raise exception 'Invalid gender value';
  end if;
  update public.profiles
     set gender = p_gender,
         gender_self = case when p_gender = 'self_described' then nullif(p_gender_self,'') else null end,
         updated_at = now()
   where user_id = uid;
end $function$;
CREATE OR REPLACE FUNCTION public.promote_ingested_stance(p_ingested_stance_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.ingested_stances%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.ingested_stances
  WHERE id = p_ingested_stance_id AND status = 'accepted';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Cannot promote an unattributed stance — no user_id to write to
  -- question_stances. Return false without touching status so the row
  -- remains promotable once attribution is resolved. (F-05 fix preserved.)
  IF v_row.attributed_user_id IS NULL THEN
    RAISE NOTICE 'promote_ingested_stance: % has no attributed_user_id — skipping promotion', p_ingested_stance_id;
    RETURN false;
  END IF;

  -- Idempotency guard: already promoted on a previous run — return true
  -- without re-inserting. This path is now rare since the pipeline filters
  -- on promoted_at IS NULL, but guards against direct RPC calls.
  IF v_row.promoted_at IS NOT NULL THEN
    RETURN true;
  END IF;

  -- Conflict guard: do not overwrite an existing native stance
  IF EXISTS (
    SELECT 1 FROM public.question_stances
    WHERE user_id    = v_row.attributed_user_id
      AND question_id = v_row.question_id
  ) THEN
    UPDATE public.ingested_stances
    SET status = 'conflict', reviewed_at = now()
    WHERE id = p_ingested_stance_id;
    RETURN false;
  END IF;

  -- Promote: write to question_stances
  INSERT INTO public.question_stances
    (user_id, question_id, score, source)
  VALUES
    (v_row.attributed_user_id, v_row.question_id,
     v_row.stance_value::smallint, 'ingested')
  ON CONFLICT (user_id, question_id) DO NOTHING;

  -- Stamp promoted_at and update reviewed_at
  UPDATE public.ingested_stances
  SET
    promoted_at  = now(),
    reviewed_at  = now()
  WHERE id = p_ingested_stance_id;

  RETURN true;
END;
$function$;
CREATE OR REPLACE FUNCTION public.publish_curated_set(p_date date, p_question_ids uuid[])
 RETURNS public.daily_curated_questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_row public.daily_curated_questions;
BEGIN
  PERFORM public._ensure_admin_or_service();

  INSERT INTO public.daily_curated_questions AS dc (
    date,
    question_ids,
    created_by,
    created_at
  )
  VALUES (
    p_date,
    COALESCE(p_question_ids, '{}'::uuid[]),
    auth.uid(),
    now()
  )
  ON CONFLICT (date) DO UPDATE
    SET question_ids = EXCLUDED.question_ids,
        created_by   = EXCLUDED.created_by,
        created_at   = now()
  RETURNING dc.* INTO v_row;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.publish_question_with_dedup(p_draft_id uuid, p_question text, p_summary text DEFAULT NULL::text, p_tags text[] DEFAULT NULL::text[], p_topic_id uuid DEFAULT NULL::uuid, p_location_label text DEFAULT NULL::text, p_window_days integer DEFAULT 14)
 RETURNS TABLE(success boolean, question_id uuid, is_new boolean, message text, reason text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_dup_check RECORD;
  v_new_question_id UUID;
  v_dedup_key TEXT;
  v_dedup_bucket TEXT;
BEGIN
  -- Check for duplicates
  SELECT * INTO v_dup_check
  FROM check_duplicate_question_deterministic(p_question, p_topic_id, p_window_days);
  
  -- If duplicate found, reject and log
  IF v_dup_check.is_duplicate THEN
    -- Log the duplicate
    INSERT INTO question_duplicates (
      draft_id,
      existing_question_id,
      dedup_key,
      dedup_bucket,
      reason
    ) VALUES (
      p_draft_id,
      v_dup_check.existing_question_id,
      v_dup_check.dedup_key,
      v_dup_check.dedup_bucket,
      'duplicate_in_time_window'
    );
    
    -- Return rejection
    RETURN QUERY 
    SELECT 
      false,
      v_dup_check.existing_question_id,
      false,
      format('Duplicate of existing question: "%s"', v_dup_check.existing_question),
      'duplicate_rejected'::TEXT;
    RETURN;
  END IF;
  
  -- No duplicate - create new question
  INSERT INTO questions (
    question,
    summary,
    tags,
    location_label,
    dedup_key,
    dedup_bucket,
    source
  ) VALUES (
    p_question,
    p_summary,
    p_tags,
    p_location_label,
    v_dup_check.dedup_key,
    v_dup_check.dedup_bucket,
    'ai_generated'
  )
  RETURNING id INTO v_new_question_id;
  
  RETURN QUERY 
  SELECT 
    true,
    v_new_question_id,
    true,
    'Question published successfully'::TEXT,
    'new_question'::TEXT;
    
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY 
  SELECT 
    false,
    NULL::UUID,
    false,
    'Error: ' || SQLERRM,
    'error'::TEXT;
END;
$function$;
create or replace view "public"."question_impact_scores" as  SELECT question_id,
    impact_score,
    stance_potential_score,
    cluster_density_score,
    region_relevance_score,
    engagement_prediction_score,
    composite_score,
    explanation,
    updated_at
   FROM public.topic_impact_scores;
CREATE OR REPLACE FUNCTION public.record_acknowledgement(p_user_id uuid, p_trigger_type text, p_context jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_ack_id uuid;
begin
  INSERT INTO public.contribution_acknowledgements (
    user_id,
    trigger_type,
    context
  ) VALUES (
    p_user_id,
    p_trigger_type,
    p_context
  )
  RETURNING id INTO v_ack_id;
  
  RETURN v_ack_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.record_major_update(p_question_id uuid, p_update_reason text DEFAULT 'content_updated'::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  
  -- Update metrics
  UPDATE public.question_engagement_metrics
  SET 
    last_major_update = NOW(),
    update_count = update_count + 1
  WHERE question_id = p_question_id;
  
  -- Trigger state recalculation (might resurrect archived question)
  PERFORM public.update_question_state(p_question_id, 'major_update: ' || p_update_reason);
  
  RETURN TRUE;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.record_question_answer(p_user_id uuid, p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_topic_id uuid;
  v_phase text;
BEGIN
  -- Get topic_id and phase from the question
  SELECT topic_id, phase 
  INTO v_topic_id, v_phase
  FROM public.questions
  WHERE id = p_question_id;
  
  -- Upsert user_topic_interactions
  INSERT INTO public.user_topic_interactions (
    user_id,
    topic_id,
    last_interacted_at,
    last_question_phase_seen,
    answered
  )
  VALUES (
    p_user_id,
    v_topic_id,
    NOW(),
    v_phase,
    true  -- Mark as answered
  )
  ON CONFLICT (user_id, topic_id) DO UPDATE
  SET
    last_interacted_at = NOW(),
    last_question_phase_seen = v_phase,
    answered = true,
    updated_at = NOW();
END;
$function$;
CREATE OR REPLACE FUNCTION public.record_question_engagement(p_question_id uuid, p_engagement_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_topic_id uuid;
  v_user_id uuid;
BEGIN
  -- ✅ SECURITY: Use auth.uid(), not spoofable parameter
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    -- Not authenticated, skip silently
    RETURN;
  END IF;
  
  -- Get topic_id for this question
  SELECT topic_id INTO v_topic_id 
  FROM questions 
  WHERE id = p_question_id;
  
  IF v_topic_id IS NULL THEN
    RETURN; -- Question doesn't exist
  END IF;
  
  -- Only track meaningful engagement (not passive viewing)
  IF p_engagement_type IN ('answer', 'comment', 'share') THEN
    -- Create or update implicit topic follow
    INSERT INTO user_follows (
      user_id, 
      follow_type, 
      follow_id, 
      created_at
    )
    VALUES (
      v_user_id, 
      'topic', 
      v_topic_id, 
      NOW()
    )
    ON CONFLICT (user_id, follow_type, follow_id) 
    DO UPDATE SET created_at = NOW();  -- Update timestamp on re-engagement
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.record_question_view(p_user_id uuid, p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_topic_id uuid;
  v_phase text;
BEGIN
  -- Get topic_id and phase from the question
  SELECT topic_id, phase 
  INTO v_topic_id, v_phase
  FROM public.questions
  WHERE id = p_question_id;
  
  -- Upsert user_topic_interactions
  INSERT INTO public.user_topic_interactions (
    user_id,
    topic_id,
    last_interacted_at,
    last_question_phase_seen,
    answered
  )
  VALUES (
    p_user_id,
    v_topic_id,
    NOW(),
    v_phase,
    -- Check if they've answered this specific question
    EXISTS(
      SELECT 1 FROM public.question_stances qs
      WHERE qs.question_id = p_question_id 
        AND qs.user_id = p_user_id
    )
  )
  ON CONFLICT (user_id, topic_id) DO UPDATE
  SET
    last_interacted_at = NOW(),
    last_question_phase_seen = v_phase,
    updated_at = NOW();
END;
$function$;
CREATE OR REPLACE FUNCTION public.record_share(p_question_id uuid, p_platform public.share_platform, p_share_type public.share_type DEFAULT 'question'::public.share_type)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_share_id uuid;
BEGIN
  INSERT INTO public.share_events (question_id, shared_by_user_id, platform, share_type)
  VALUES (p_question_id, auth.uid(), p_platform, p_share_type)
  RETURNING id INTO v_share_id;

  RETURN v_share_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.record_share_click(p_share_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Increment click count
  UPDATE public.share_events
  SET click_count = click_count + 1
  WHERE id = p_share_id;

  -- Record the individual click event
  INSERT INTO public.share_click_events (share_event_id)
  VALUES (p_share_id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_all_trending_scores()
 RETURNS TABLE(topics_updated integer, avg_score numeric, max_score numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_updated integer := 0;
  v_avg_score numeric;
  v_max_score numeric;
BEGIN
  -- ✅ SECURITY: Only admins or service role can run this
  -- For cron jobs, this will run as postgres/service role
  -- For manual runs, check admin
  IF current_user != 'postgres' AND NOT EXISTS(
    SELECT 1 FROM auth.users WHERE id = auth.uid()
  ) THEN
    -- If called from authenticated context (not cron), require admin
    IF NOT is_admin_me() THEN
      RAISE EXCEPTION 'Only admins can manually refresh trending scores';
    END IF;
  END IF;
  
  -- Update all topics
  UPDATE topics
  SET 
    trending_score = calculate_topic_trending_score(id),
    activity_7d = (
      SELECT COUNT(*)::integer
      FROM questions q
      WHERE q.topic_id = topics.id
        AND q.published_at > NOW() - INTERVAL '7 days'
        AND q.status = 'active'
    );
    -- ✅ REMOVED: updated_at = NOW() (column doesn't exist)
    
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  -- Get statistics
  SELECT 
    AVG(trending_score),
    MAX(trending_score)
  INTO v_avg_score, v_max_score
  FROM topics
  WHERE trending_score > 0;
  
  RETURN QUERY
  SELECT 
    v_updated,
    COALESCE(v_avg_score, 0),
    COALESCE(v_max_score, 0);
END;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_election_stance_aggregates(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_election_id           uuid;
  v_constituency_id       uuid;
  v_constituency_code     text;
  v_state_code            text;
  v_parent_constituency_id uuid;
  v_party_id              uuid;
  v_is_election           boolean;

  v_total                 integer;
  v_strong_support        integer;
  v_support               integer;
  v_neutral               integer;
  v_oppose                integer;
  v_strong_oppose         integer;
  v_avg                   numeric;
  v_total_revealed        integer;
  v_switched_count        integer;
  v_pct_switched          numeric;

  v_is_gated              boolean;
  v_gate_lifted_at        timestamptz;
BEGIN
  -- Check if this is an election question
  SELECT
    q.is_election_question,
    q.election_id,
    q.election_constituency_id,
    q.election_party_id
  INTO v_is_election, v_election_id, v_constituency_id, v_party_id
  FROM public.questions q
  WHERE q.id = p_question_id;

  IF NOT FOUND OR NOT v_is_election OR v_election_id IS NULL THEN
    RETURN; -- Not an election question — skip
  END IF;

  -- Get constituency details
  IF v_constituency_id IS NOT NULL THEN
    SELECT constituency_code, state_code, parent_constituency_id
    INTO v_constituency_code, v_state_code, v_parent_constituency_id
    FROM public.election_constituencies
    WHERE id = v_constituency_id;
  END IF;

  -- Get exit poll gate status
  SELECT
    CASE
      WHEN e.state IN ('SILENCE', 'POLLING', 'COUNTING') THEN true
      WHEN e.last_phase_close_at IS NOT NULL
        AND now() < e.last_phase_close_at + interval '30 minutes' THEN true
      ELSE false
    END,
    CASE
      WHEN e.last_phase_close_at IS NOT NULL
        THEN e.last_phase_close_at + interval '30 minutes'
      ELSE NULL
    END
  INTO v_is_gated, v_gate_lifted_at
  FROM public.elections e
  WHERE e.id = v_election_id;

  -- Compute stance counts
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE score =  2)::integer,
    COUNT(*) FILTER (WHERE score =  1)::integer,
    COUNT(*) FILTER (WHERE score =  0)::integer,
    COUNT(*) FILTER (WHERE score = -1)::integer,
    COUNT(*) FILTER (WHERE score = -2)::integer,
    ROUND(AVG(score::numeric), 4)
  INTO
    v_total, v_strong_support, v_support, v_neutral, v_oppose, v_strong_oppose, v_avg
  FROM public.question_stances
  WHERE question_id = p_question_id;

  IF v_total = 0 THEN RETURN; END IF;

  -- Compute Switch Mechanic aggregates
  SELECT
    COUNT(*) FILTER (WHERE original_stance_before_reveal IS NOT NULL)::integer,
    COUNT(*) FILTER (WHERE switched_after_reveal = true)::integer
  INTO v_total_revealed, v_switched_count
  FROM public.question_stances
  WHERE question_id = p_question_id;

  v_pct_switched := CASE
    WHEN v_total_revealed > 0
      THEN ROUND((v_switched_count::numeric / v_total_revealed) * 100, 2)
    ELSE NULL
  END;

  -- Upsert aggregate row
  INSERT INTO public.election_stance_aggregates (
    election_id, question_id,
    constituency_id, constituency_code, state_code,
    parent_constituency_id, party_id,
    scope,
    total_responses,
    count_strong_support, count_support, count_neutral,
    count_oppose, count_strong_oppose,
    pct_support, pct_neutral, pct_oppose, avg_score,
    total_revealed, switched_count, pct_switched,
    is_gated, gate_lifted_at,
    last_refreshed_at
  )
  VALUES (
    v_election_id, p_question_id,
    v_constituency_id, v_constituency_code, v_state_code,
    v_parent_constituency_id, v_party_id,
    'constituency',
    v_total,
    v_strong_support, v_support, v_neutral, v_oppose, v_strong_oppose,
    ROUND(((v_strong_support + v_support)::numeric / v_total) * 100, 2),
    ROUND((v_neutral::numeric / v_total) * 100, 2),
    ROUND(((v_oppose + v_strong_oppose)::numeric / v_total) * 100, 2),
    v_avg,
    v_total_revealed, v_switched_count, v_pct_switched,
    COALESCE(v_is_gated, true), v_gate_lifted_at,
    now()
  )
  ON CONFLICT (question_id, constituency_id, scope) DO UPDATE SET
    total_responses       = EXCLUDED.total_responses,
    count_strong_support  = EXCLUDED.count_strong_support,
    count_support         = EXCLUDED.count_support,
    count_neutral         = EXCLUDED.count_neutral,
    count_oppose          = EXCLUDED.count_oppose,
    count_strong_oppose   = EXCLUDED.count_strong_oppose,
    pct_support           = EXCLUDED.pct_support,
    pct_neutral           = EXCLUDED.pct_neutral,
    pct_oppose            = EXCLUDED.pct_oppose,
    avg_score             = EXCLUDED.avg_score,
    total_revealed        = EXCLUDED.total_revealed,
    switched_count        = EXCLUDED.switched_count,
    pct_switched          = EXCLUDED.pct_switched,
    is_gated              = EXCLUDED.is_gated,
    gate_lifted_at        = EXCLUDED.gate_lifted_at,
    last_refreshed_at     = now();

END;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_question_stance_stats(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_total integer;
  v_agree integer;
  v_disagree integer;
  v_neutral integer;
  v_avg numeric;
begin
  -- total responses for this question
  select count(*)::int
  into v_total
  from public.question_stances
  where question_id = p_question_id;

  -- if no responses, delete any existing stats row and exit
  if v_total = 0 then
    delete from public.question_stance_stats
    where question_id = p_question_id;
    return;
  end if;

  -- bucket counts
  select
    count(*) filter (where score > 0)::int,
    count(*) filter (where score < 0)::int,
    count(*) filter (where score = 0)::int,
    avg(score)::numeric
  into
    v_agree,
    v_disagree,
    v_neutral,
    v_avg
  from public.question_stances
  where question_id = p_question_id;

  -- upsert aggregates
  insert into public.question_stance_stats (
    question_id,
    total_responses,
    pct_agree,
    pct_disagree,
    pct_neutral,
    avg_score,
    updated_at
  )
  values (
    p_question_id,
    v_total,
    (v_agree::numeric   * 100.0) / v_total,
    (v_disagree::numeric * 100.0) / v_total,
    (v_neutral::numeric * 100.0) / v_total,
    v_avg,
    now()
  )
  on conflict (question_id)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;
end;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_question_stance_stats_region(p_question_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  -- global
  v_total     integer;
  v_agree     integer;
  v_disagree  integer;
  v_neutral   integer;
  v_avg       numeric;
begin
  -- 1) GLOBAL aggregate (no join needed)
  select count(*)::int,
         count(*) filter (where qs.score > 0)::int,
         count(*) filter (where qs.score < 0)::int,
         count(*) filter (where qs.score = 0)::int,
         avg(qs.score)::numeric
  into v_total, v_agree, v_disagree, v_neutral, v_avg
  from public.question_stances qs
  where qs.question_id = p_question_id;

  if v_total = 0 then
    -- if no responses globally, clear all region rows too
    delete from public.question_stance_stats_region
    where question_id = p_question_id;
    return;
  else
    insert into public.question_stance_stats_region (
      question_id,
      region_scope,
      region_key,
      region_label,
      total_responses,
      pct_agree,
      pct_disagree,
      pct_neutral,
      avg_score,
      updated_at
    )
    values (
      p_question_id,
      'global',
      'global',
      'Global',
      v_total,
      (v_agree::numeric    * 100.0) / v_total,
      (v_disagree::numeric * 100.0) / v_total,
      (v_neutral::numeric  * 100.0) / v_total,
      v_avg,
      now()
    )
    on conflict (question_id, region_scope, region_key)
    do update set
      total_responses = excluded.total_responses,
      pct_agree       = excluded.pct_agree,
      pct_disagree    = excluded.pct_disagree,
      pct_neutral     = excluded.pct_neutral,
      avg_score       = excluded.avg_score,
      updated_at      = excluded.updated_at;
  end if;

  -- 2) PER-TIER aggregates using user_region_dimensions (labels only)

  -- CITY
  insert into public.question_stance_stats_region (
    question_id,
    region_scope,
    region_key,
    region_label,
    total_responses,
    pct_agree,
    pct_disagree,
    pct_neutral,
    avg_score,
    updated_at
  )
  select
    qs.question_id,
    'city'::text as region_scope,
    urd.city_label as region_key,
    urd.city_label as region_label,
    count(*)::int as total_responses,
    (count(*) filter (where qs.score > 0)::numeric * 100.0) / count(*) as pct_agree,
    (count(*) filter (where qs.score < 0)::numeric * 100.0) / count(*) as pct_disagree,
    (count(*) filter (where qs.score = 0)::numeric * 100.0) / count(*) as pct_neutral,
    avg(qs.score)::numeric as avg_score,
    now() as updated_at
  from public.question_stances qs
  join public.user_region_dimensions urd
    on urd.user_id = qs.user_id
  where qs.question_id = p_question_id
    and urd.city_label is not null
  group by qs.question_id, urd.city_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- COUNTY
  insert into public.question_stance_stats_region (
    question_id,
    region_scope,
    region_key,
    region_label,
    total_responses,
    pct_agree,
    pct_disagree,
    pct_neutral,
    avg_score,
    updated_at
  )
  select
    qs.question_id,
    'county'::text as region_scope,
    urd.county_label as region_key,
    urd.county_label as region_label,
    count(*)::int as total_responses,
    (count(*) filter (where qs.score > 0)::numeric * 100.0) / count(*) as pct_agree,
    (count(*) filter (where qs.score < 0)::numeric * 100.0) / count(*) as pct_disagree,
    (count(*) filter (where qs.score = 0)::numeric * 100.0) / count(*) as pct_neutral,
    avg(qs.score)::numeric as avg_score,
    now() as updated_at
  from public.question_stances qs
  join public.user_region_dimensions urd
    on urd.user_id = qs.user_id
  where qs.question_id = p_question_id
    and urd.county_label is not null
  group by qs.question_id, urd.county_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- STATE
  insert into public.question_stance_stats_region (
    question_id,
    region_scope,
    region_key,
    region_label,
    total_responses,
    pct_agree,
    pct_disagree,
    pct_neutral,
    avg_score,
    updated_at
  )
  select
    qs.question_id,
    'state'::text as region_scope,
    urd.state_label as region_key,
    urd.state_label as region_label,
    count(*)::int as total_responses,
    (count(*) filter (where qs.score > 0)::numeric * 100.0) / count(*) as pct_agree,
    (count(*) filter (where qs.score < 0)::numeric * 100.0) / count(*) as pct_disagree,
    (count(*) filter (where qs.score = 0)::numeric * 100.0) / count(*) as pct_neutral,
    avg(qs.score)::numeric as avg_score,
    now() as updated_at
  from public.question_stances qs
  join public.user_region_dimensions urd
    on urd.user_id = qs.user_id
  where qs.question_id = p_question_id
    and urd.state_label is not null
  group by qs.question_id, urd.state_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;

  -- COUNTRY
  insert into public.question_stance_stats_region (
    question_id,
    region_scope,
    region_key,
    region_label,
    total_responses,
    pct_agree,
    pct_disagree,
    pct_neutral,
    avg_score,
    updated_at
  )
  select
    qs.question_id,
    'country'::text as region_scope,
    urd.country_label as region_key,
    urd.country_label as region_label,
    count(*)::int as total_responses,
    (count(*) filter (where qs.score > 0)::numeric * 100.0) / count(*) as pct_agree,
    (count(*) filter (where qs.score < 0)::numeric * 100.0) / count(*) as pct_disagree,
    (count(*) filter (where qs.score = 0)::numeric * 100.0) / count(*) as pct_neutral,
    avg(qs.score)::numeric as avg_score,
    now() as updated_at
  from public.question_stances qs
  join public.user_region_dimensions urd
    on urd.user_id = qs.user_id
  where qs.question_id = p_question_id
    and urd.country_label is not null
  group by qs.question_id, urd.country_label
  on conflict (question_id, region_scope, region_key)
  do update set
    total_responses = excluded.total_responses,
    pct_agree       = excluded.pct_agree,
    pct_disagree    = excluded.pct_disagree,
    pct_neutral     = excluded.pct_neutral,
    avg_score       = excluded.avg_score,
    updated_at      = excluded.updated_at;
end;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_topic_pulse_metrics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'on'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.topic_pulse_metrics_mv;
  RAISE NOTICE 'Topic pulse metrics refreshed at %', NOW();
EXCEPTION WHEN OTHERS THEN
  REFRESH MATERIALIZED VIEW public.topic_pulse_metrics_mv;
  RAISE NOTICE 'Topic pulse metrics refreshed (non-concurrent) at %', NOW();
END;
$function$;
CREATE OR REPLACE FUNCTION public.refresh_topic_region_trends(p_window_days integer DEFAULT 30)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_global_location_id uuid;
begin
  -- ---------------------------------------------------------------
  -- 1) Ensure "Global" location exists
  -- ---------------------------------------------------------------
  SELECT id INTO v_global_location_id
  FROM public.locations
  WHERE type = 'global'::public.location_tier_enum
    AND name = 'Global'
  LIMIT 1;

  IF v_global_location_id IS NULL THEN
    INSERT INTO public.locations (type, name)
    VALUES ('global'::public.location_tier_enum, 'Global')
    RETURNING id INTO v_global_location_id;
  END IF;

  -- ---------------------------------------------------------------
  -- 2) Rebuild GLOBAL rows
  -- ---------------------------------------------------------------
  DELETE FROM public.topic_region_trends
  WHERE location_id = v_global_location_id;

  INSERT INTO public.topic_region_trends (
    topic_id, location_id,
    agree, neutral, disagree, total,
    agree_24h, neutral_24h, disagree_24h, total_24h,
    updated_at
  )
  SELECT
    q.topic_id,
    v_global_location_id,
    count(*) FILTER (WHERE qs.score > 0)::int,
    count(*) FILTER (WHERE qs.score = 0)::int,
    count(*) FILTER (WHERE qs.score < 0)::int,
    count(*)::int,
    count(*) FILTER (WHERE qs.score > 0 AND qs.created_at >= now() - interval '24 hours')::int,
    count(*) FILTER (WHERE qs.score = 0 AND qs.created_at >= now() - interval '24 hours')::int,
    count(*) FILTER (WHERE qs.score < 0 AND qs.created_at >= now() - interval '24 hours')::int,
    count(*) FILTER (WHERE qs.created_at >= now() - interval '24 hours')::int,
    now()
  FROM public.question_stances qs
  JOIN public.questions q ON q.id = qs.question_id
  WHERE qs.created_at >= now() - (p_window_days || ' days')::interval
    AND q.topic_id IS NOT NULL
  GROUP BY q.topic_id;

  -- ---------------------------------------------------------------
  -- 3) Rebuild per-COUNTRY rows
  --    Derives country from user → user_location_settings → locations
  -- ---------------------------------------------------------------
  DELETE FROM public.topic_region_trends
  WHERE location_id IN (
    SELECT id FROM public.locations WHERE type = 'country'::public.location_tier_enum
  );

  INSERT INTO public.topic_region_trends (
    topic_id, location_id,
    agree, neutral, disagree, total,
    agree_24h, neutral_24h, disagree_24h, total_24h,
    updated_at
  )
  SELECT
    q.topic_id,
    country_loc.id AS location_id,
    count(*) FILTER (WHERE qs.score > 0)::int,
    count(*) FILTER (WHERE qs.score = 0)::int,
    count(*) FILTER (WHERE qs.score < 0)::int,
    count(*)::int,
    count(*) FILTER (WHERE qs.score > 0 AND qs.created_at >= now() - interval '24 hours')::int,
    count(*) FILTER (WHERE qs.score = 0 AND qs.created_at >= now() - interval '24 hours')::int,
    count(*) FILTER (WHERE qs.score < 0 AND qs.created_at >= now() - interval '24 hours')::int,
    count(*) FILTER (WHERE qs.created_at >= now() - interval '24 hours')::int,
    now()
  FROM public.question_stances qs
  JOIN public.questions q ON q.id = qs.question_id
  JOIN public.user_location_settings uls ON uls.user_id = qs.user_id
  JOIN public.locations country_loc
    ON country_loc.id = uls.location_id
   AND country_loc.type = 'country'::public.location_tier_enum
  WHERE qs.created_at >= now() - (p_window_days || ' days')::interval
    AND q.topic_id IS NOT NULL
  GROUP BY q.topic_id, country_loc.id;

end;
$function$;
CREATE OR REPLACE FUNCTION public.report_comment(p_comment_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.comment_reports (comment_id, reporter_id, reason)
  VALUES (p_comment_id, v_uid, p_reason)
  ON CONFLICT (comment_id, reporter_id) DO NOTHING;

  RETURN true;
END;
$function$;
CREATE OR REPLACE FUNCTION public.request_account_deletion()
 RETURNS public.deletion_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamp with time zone := now();
  v_row public.deletion_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Cancel any existing pending request first
  UPDATE public.deletion_requests
  SET status = 'cancelled', cancelled_at = v_now
  WHERE user_id = v_uid AND status = 'pending';
  -- Insert fresh request
  INSERT INTO public.deletion_requests (user_id, requested_at, execute_after, status)
  VALUES (v_uid, v_now, v_now + interval '14 days', 'pending')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.resolve_pipeline_job(p_job_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.pipeline_jobs
  SET
    resolved      = true,
    resolved_note = p_note,
    resolved_at   = now()
  WHERE id = p_job_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.rpc_get_topic_score_v1(p_topic_id uuid, p_top_n integer DEFAULT 5)
 RETURNS TABLE(topic_id uuid, title text, summary text, tags text[], tier text, location_label text, created_at timestamp with time zone, topic_score numeric, contributing_questions integer, score_updated_at timestamp with time zone, top_n integer, top_questions jsonb)
 LANGUAGE sql
 STABLE
AS $function$
WITH
canonical_topic AS (
  SELECT COALESCE(t.parent_topic_id, t.id) AS canonical_topic_id
  FROM public.topics t
  WHERE t.id = p_topic_id
  LIMIT 1
),
canonical_row AS (
  SELECT
    t.id AS canonical_topic_id,
    t.title,
    t.summary,
    COALESCE(t.tags, ARRAY[]::text[]) AS tags,
    t.tier,
    t.location_label,
    t.created_at
  FROM public.topics t
  JOIN canonical_topic ct ON ct.canonical_topic_id = t.id
  LIMIT 1
),
latest_question_scores AS (
  SELECT DISTINCT ON (tis.question_id)
    tis.question_id,
    COALESCE(tis.composite_score, 0)::numeric AS composite_score,
    tis.updated_at
  FROM public.topic_impact_scores tis
  WHERE tis.question_id IS NOT NULL
  ORDER BY tis.question_id, tis.updated_at DESC
),
scored_questions AS (
  SELECT
    ct.canonical_topic_id,
    q.id AS question_id,
    q.question AS question_text,
    q.summary AS question_summary,
    q.tags AS question_tags,
    q.location_label AS question_location_label,
    q.published_at AS question_published_at,
    COALESCE(lqs.composite_score, 0)::numeric AS composite_score,
    lqs.updated_at AS score_updated_at
  FROM public.questions q
  JOIN canonical_topic ct
    ON ct.canonical_topic_id = COALESCE(q.topic_id, ct.canonical_topic_id)
  LEFT JOIN latest_question_scores lqs
    ON lqs.question_id = q.id
  WHERE q.status = 'active'
    AND COALESCE((SELECT canonical_topic_id FROM canonical_topic), '00000000-0000-0000-0000-000000000000'::uuid)
        = (SELECT canonical_topic_id FROM canonical_topic)
    AND (
      -- include questions in this canonical topic, including merged children
      COALESCE(
        (SELECT COALESCE(t2.parent_topic_id, t2.id) FROM public.topics t2 WHERE t2.id = q.topic_id),
        q.topic_id
      ) = (SELECT canonical_topic_id FROM canonical_topic)
    )
),
ranked AS (
  SELECT
    sq.*,
    ROW_NUMBER() OVER (
      ORDER BY sq.composite_score DESC NULLS LAST,
               sq.score_updated_at DESC NULLS LAST,
               sq.question_published_at DESC NULLS LAST,
               sq.question_id DESC
    ) AS score_rank
  FROM scored_questions sq
),
topq AS (
  SELECT *
  FROM ranked
  WHERE score_rank <= GREATEST(1, LEAST(p_top_n, 50))
),
agg AS (
  SELECT
    SUM(topq.composite_score)::numeric AS topic_score,
    COUNT(*)::int AS contributing_questions,
    MAX(topq.score_updated_at) AS score_updated_at,
    jsonb_agg(
      jsonb_build_object(
        'question_id', topq.question_id,
        'question', topq.question_text,
        'summary', topq.question_summary,
        'tags', COALESCE(topq.question_tags, ARRAY[]::text[]),
        'location_label', topq.question_location_label,
        'published_at', topq.question_published_at,
        'composite_score', topq.composite_score,
        'rank', topq.score_rank,
        'score_updated_at', topq.score_updated_at
      )
      ORDER BY topq.score_rank ASC
    ) AS top_questions
  FROM topq
)
SELECT
  (SELECT canonical_topic_id FROM canonical_row) AS topic_id,
  (SELECT title FROM canonical_row) AS title,
  (SELECT summary FROM canonical_row) AS summary,
  (SELECT tags FROM canonical_row) AS tags,
  (SELECT tier FROM canonical_row) AS tier,
  (SELECT location_label FROM canonical_row) AS location_label,
  (SELECT created_at FROM canonical_row) AS created_at,
  COALESCE((SELECT topic_score FROM agg), 0)::numeric AS topic_score,
  COALESCE((SELECT contributing_questions FROM agg), 0)::int AS contributing_questions,
  (SELECT score_updated_at FROM agg) AS score_updated_at,
  GREATEST(1, LEAST(p_top_n, 50)) AS top_n,
  COALESCE((SELECT top_questions FROM agg), '[]'::jsonb) AS top_questions;
$function$;
CREATE OR REPLACE FUNCTION public.run_cluster_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp', 'net'
AS $function$
declare
  v_url  text := 'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/cluster';
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
begin
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  -- enqueue request and return immediately (no 5s timeout)
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || v_svc,
      'x-cron-secret', v_cron,
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.run_create_drafts_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  _cron_secret text;
  _service_role text;
  _base_url text := 'https://yzxzpnomcarnxixhjlba.supabase.co';
  _req_id bigint;
begin
  -- Secrets from Vault
  select decrypted_secret into _cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  select decrypted_secret into _service_role
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if _cron_secret is null then
    raise exception 'Missing vault secret: cron_secret';
  end if;

  if _service_role is null then
    raise exception 'Missing vault secret: service_role_key';
  end if;

  -- ✅ Async call (returns immediately; does NOT wait for Edge Function to finish)
  select net.http_post(
    url := _base_url || '/functions/v1/create-topic-drafts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _service_role,
      'apikey', _service_role,
      'x-cron-secret', _cron_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) into _req_id;

  -- Optional: log request id for later troubleshooting
  -- raise notice 'create-topic-drafts request id: %', _req_id;

end;
$function$;
CREATE OR REPLACE FUNCTION public.run_create_drafts_http_debug()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  _cron_secret text;
  _base_url text := 'https://yzxzpnomcarnxixhjlba.supabase.co';
  _resp http_response;
begin
  -- cron secret from vault
  select decrypted_secret into _cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret';

  if _cron_secret is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Missing vault secret: cron_secret'
    );
  end if;

  -- call edge function, capture response
  select * into _resp
  from http((
    'POST',
    _base_url || '/functions/v1/create-topic-drafts',
    array[
      http_header('x-cron-secret', _cron_secret),
      http_header('Content-Type', 'application/json')
    ],
    'application/json',
    '{}'
  )::http_request);

  return jsonb_build_object(
    'ok', true,
    'status', _resp.status,
    'content', coalesce(_resp.content::text, ''),
    'headers', _resp.headers
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.run_generate_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
declare
  v_url text := 'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/generate';
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_resp extensions.http_response;
begin
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  v_resp := extensions.http((
    'POST',
    v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('x-cron-secret', v_cron)
    ]::extensions.http_header[],
    '{}'::text,
    'application/json'
  ));

  if v_resp.status < 200 or v_resp.status >= 300 then
    raise exception 'generate http failed: status=% body=%',
      v_resp.status, left(coalesce(v_resp.content,''), 500);
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION public.run_ingest_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
declare
  v_url text := 'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/ingest';
  v_cron text := (select decrypted_secret from vault.decrypted_secrets where name='cron_secret' limit 1);
  v_svc  text := (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1);
  v_resp extensions.http_response;
begin
  if v_cron is null then raise exception 'vault secret cron_secret missing'; end if;
  if v_svc  is null then raise exception 'vault secret service_role_key missing'; end if;

  v_resp := extensions.http((
    'POST',
    v_url,
    array[
      extensions.http_header('authorization', 'Bearer ' || v_svc),
      extensions.http_header('x-cron-secret', v_cron)
    ]::extensions.http_header[],
    '{}'::text,
    'application/json'
  ));

  if v_resp.status < 200 or v_resp.status >= 300 then
    raise exception 'ingest http failed: status=% body=%', v_resp.status, left(coalesce(v_resp.content,''), 500);
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION public.run_ingestion_pipeline()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- 1) Pull new news into news_items / drafts
  perform public.run_ingest_http();

  -- 2) Cluster / group things (if your cluster function expects new work)
  perform public.run_cluster_http();

  -- 3) Generate AI question drafts
  perform public.run_generate_http();
end;
$function$;
CREATE OR REPLACE FUNCTION public.run_ingestion_pipeline_job()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select
    net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'project_url'
      ) || '/functions/v1/admin-run-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'service_role_key'
        ),
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'cron_secret'
        )
      ),
      body := '{}'::jsonb
    );
$function$;
CREATE OR REPLACE FUNCTION public.run_reframe_http()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM net.http_post(
    url     := 'https://yzxzpnomcarnxixhjlba.supabase.co/functions/v1/reframe',
    headers := '{"Content-Type":"application/json","x-cron-secret":"demo123"}'::jsonb,
    body    := '{}'::jsonb
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.search_content(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_tsquery tsquery;
  v_results jsonb;
begin
  BEGIN
    v_tsquery := plainto_tsquery('english', p_query);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'questions', '[]'::jsonb,
      'topics', '[]'::jsonb,
      'total_questions', 0,
      'total_topics', 0,
      'query', p_query
    );
  END;

  WITH question_results AS (
    SELECT
      q.id,
      q.question,
      q.summary,
      q.published_at,
      q.status,
      q.phase,
      COALESCE(t.title, t2.title) as topic_title,
      COALESCE(qd.topic_id, t2.id) as topic_id,
      ts_rank(q.search_vector, v_tsquery) as rank,
      ts_headline('english', q.question, v_tsquery,
        'StartSel=<mark>, StopSel=</mark>, MaxWords=50') as question_highlight
    FROM public.questions q
    LEFT JOIN public.question_drafts qd ON qd.id = q.question_draft_id
    LEFT JOIN public.topics t ON t.id = qd.topic_id
    LEFT JOIN public.topics t2 ON t2.id = q.topic_draft_id
    WHERE q.search_vector @@ v_tsquery
      AND q.status IN ('active', 'live')
    ORDER BY rank DESC, q.published_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ),
  question_count AS (
    SELECT count(*)::int as total
    FROM public.questions q
    WHERE q.search_vector @@ v_tsquery
      AND q.status IN ('active', 'live')
  ),
  topic_results AS (
    SELECT
      t.id,
      t.title,
      t.summary,
      t.published_at as updated_at,
      ts_rank(t.search_vector, v_tsquery) as rank,
      (
        SELECT count(*)::int
        FROM public.questions q
        LEFT JOIN public.question_drafts qd ON qd.id = q.question_draft_id
        WHERE (qd.topic_id = t.id OR q.topic_draft_id = t.id)
          AND q.status IN ('active', 'live')
      ) as question_count
    FROM public.topics t
    WHERE t.search_vector @@ v_tsquery
    ORDER BY rank DESC, t.published_at DESC
    LIMIT 10
  ),
  topic_count AS (
    SELECT count(*)::int as total
    FROM public.topics t
    WHERE t.search_vector @@ v_tsquery
  )
  SELECT jsonb_build_object(
    'questions', coalesce(
      (SELECT jsonb_agg(row_to_json(qr)) FROM question_results qr),
      '[]'::jsonb
    ),
    'topics', coalesce(
      (SELECT jsonb_agg(row_to_json(tr)) FROM topic_results tr),
      '[]'::jsonb
    ),
    'total_questions', (SELECT total FROM question_count),
    'total_topics', (SELECT total FROM topic_count),
    'query', p_query
  ) INTO v_results;

  RETURN v_results;
end;
$function$;
CREATE OR REPLACE FUNCTION public.search_questions(p_query text, p_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(question_id uuid, topic_id uuid, question text, summary text, tags text[], state text, published_at timestamp with time zone, topic_title text, relevance_rank real, response_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    q.id AS question_id,
    q.topic_id,
    q.question,
    q.summary,
    q.tags,
    q.state::text,
    q.published_at,
    t.title AS topic_title,
    ts_rank(q.search_vector, websearch_to_tsquery('english', p_query)) AS relevance_rank,
    COALESCE(
      (SELECT COUNT(*) FROM public.question_stances qs WHERE qs.question_id = q.id),
      0
    ) AS response_count
  FROM public.questions q
  JOIN public.topics t ON t.id = q.topic_id
  WHERE 
    q.search_vector @@ websearch_to_tsquery('english', p_query)
    AND q.state IN ('new', 'active', 'dormant')
    AND q.status = 'active'
  ORDER BY relevance_rank DESC, q.published_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_display_handle(p_handle text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  mode text := p_handle;
  has_username boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if mode not in ('random_id','username') then
    raise exception 'Invalid handle mode';
  end if;

  if mode = 'username' then
    select (username is not null) into has_username
      from public.profiles where user_id = uid;
    if not has_username then
      raise exception 'Set a username before switching to username display';
    end if;
  end if;

  -- 👇 force cast from text -> enum to satisfy the column type
  update public.profiles
     set display_handle_mode = mode::public.display_handle_mode_enum,
         updated_at = now()
   where user_id = uid;
end $function$;
CREATE OR REPLACE FUNCTION public.set_display_handle(p_user_id uuid, p_mode public.display_handle_mode_enum)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  u text;
begin
  if auth.uid() <> p_user_id and auth.role() <> 'service_role' then
    raise exception 'not allowed';
  end if;

  if p_mode = 'username' then
    select username into u from public.profiles where user_id = p_user_id;
    if u is null or not public.username_is_valid(u) then
      raise exception 'cannot set display to username without a valid username';
    end if;
  end if;

  update public.profiles set display_handle_mode = p_mode, updated_at = now() where user_id = p_user_id;
end $function$;
CREATE OR REPLACE FUNCTION public.set_my_display_handle(p_mode public.display_handle_mode_enum)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  has_username boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_mode = 'username' then
    select (username is not null) into has_username
      from public.profiles where user_id = uid;
    if not has_username then
      raise exception 'Set a username before switching to username display';
    end if;
  end if;

  -- 👇 explicit cast even though p_mode is already enum (defensive)
  update public.profiles
     set display_handle_mode = p_mode::public.display_handle_mode_enum,
         updated_at = now()
   where user_id = uid;
end $function$;
CREATE OR REPLACE FUNCTION public.set_my_location(p_location_id uuid, p_precision public.precision_enum, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.set_user_location(
    auth.uid(),
    p_location_id,
    p_precision,
    false,
    coalesce(p_source, 'app')
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_question_stance(p_question_id uuid, p_score integer)
 RETURNS public.question_stances
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_stance public.question_stances;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_score is null then
    delete from public.question_stances
    where user_id = auth.uid()
      and question_id = p_question_id
    returning * into v_stance;
    return v_stance;
  end if;

  if p_score < -2 or p_score > 2 then
    raise exception 'Invalid score. Must be between -2 and 2.';
  end if;

  insert into public.question_stances (user_id, question_id, score)
  values (auth.uid(), p_question_id, p_score)
  on conflict (user_id, question_id)
  do update set
    score = excluded.score,
    updated_at = now()
  returning * into v_stance;

  return v_stance;
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_question_visibility(p_question_id uuid, p_visibility public.question_visibility_enum, p_reason text DEFAULT NULL::text)
 RETURNS public.question_visibility_rules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_row public.question_visibility_rules;
BEGIN
  PERFORM public._ensure_admin_or_service();

  v_row := public.ensure_question_visibility(p_question_id, p_visibility);

  IF p_reason IS NOT NULL THEN
    UPDATE public.question_visibility_rules
    SET reason            = p_reason,
        last_evaluated_at = now()
    WHERE question_id = p_question_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_topic_notification_pref(p_topic_id uuid, p_muted boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_muted THEN
    INSERT INTO public.notification_topic_prefs (user_id, topic_id, muted, updated_at)
    VALUES (auth.uid(), p_topic_id, true, now())
    ON CONFLICT (user_id, topic_id) DO UPDATE
      SET muted = true, updated_at = now();
  ELSE
    -- Unmuting: delete the row so the table stays clean
    DELETE FROM public.notification_topic_prefs
    WHERE user_id = auth.uid() AND topic_id = p_topic_id;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.set_user_location(p_user_id uuid, p_location_id uuid, p_precision public.precision_enum, p_override boolean, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prev_location uuid;
  v_prev_precision public.precision_enum;
begin
  if auth.uid() <> p_user_id and auth.role() <> 'service_role' then
    raise exception 'not allowed';
  end if;

  -- current setting (if any)
  select location_id, "precision"
    into v_prev_location, v_prev_precision
  from public.user_location_settings
  where user_id = p_user_id
    and location_id = p_location_id
  limit 1;

  -- If nothing changed and not override, do nothing (prevents duplicate audits)
  if p_override is false
     and v_prev_location is not null
     and v_prev_location = p_location_id
     and v_prev_precision = p_precision then
    return;
  end if;

  -- upsert (matches your existing ON CONFLICT target: (user_id, location_id))
  insert into public.user_location_settings(user_id, location_id, "precision")
  values (p_user_id, p_location_id, p_precision)
  on conflict (user_id, location_id) do update
    set "precision" = excluded."precision";

  insert into public.location_audits(user_id, location_id, override, source)
  values (p_user_id, p_location_id, p_override, coalesce(p_source,'manual'));
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_user_location_by_iso(p_iso_code text, p_precision public.precision_enum)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_location_id uuid;
begin
  select id into v_location_id
  from public.locations
  where iso_code = p_iso_code
    and type = p_precision::text
  limit 1;

  if v_location_id is null then
    raise exception 'Location not found for iso_code=% and precision=%', p_iso_code, p_precision;
  end if;

  perform public.set_user_location(
    auth.uid(),
    v_location_id,
    p_precision,
    false,
    'settings'
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_user_location_by_iso(p_user_id uuid, p_iso_code text, p_precision public.precision_enum, p_override boolean, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_location_id uuid;
  v_prev_location uuid;
  v_prev_precision public.precision_enum;
begin
  -- Security check
  if auth.uid() <> p_user_id and auth.role() <> 'service_role' then
    raise exception 'not allowed';
  end if;

  -- Resolve location by ISO code + precision
  select id
    into v_location_id
  from public.locations
  where iso_code = p_iso_code
    and type = p_precision::text
  limit 1;

  if v_location_id is null then
    raise exception 'Location not found for iso_code=% and precision=%',
      p_iso_code, p_precision;
  end if;

  -- Check existing setting
  select location_id, "precision"
    into v_prev_location, v_prev_precision
  from public.user_location_settings
  where user_id = p_user_id
    and location_id = v_location_id
  limit 1;

  -- No-op if unchanged and not override
  if p_override is false
     and v_prev_location is not null
     and v_prev_location = v_location_id
     and v_prev_precision = p_precision then
    return;
  end if;

  -- Upsert location setting (FIXED: quoted "precision")
  insert into public.user_location_settings (
    user_id,
    location_id,
    "precision"
  )
  values (
    p_user_id,
    v_location_id,
    p_precision
  )
  on conflict (user_id, location_id) do update
    set "precision" = excluded."precision";

  -- Audit
  insert into public.location_audits (
    user_id,
    location_id,
    override,
    source
  )
  values (
    p_user_id,
    v_location_id,
    p_override,
    coalesce(p_source, 'manual')
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_user_location_cascade(p_user_id uuid, p_location_id uuid, p_precision public.precision_enum, p_override boolean DEFAULT false, p_source text DEFAULT 'settings'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();

  v_cur_id uuid := p_location_id;
  v_parent_id uuid;
  v_type text;

  v_chain text := '';
begin
-- Allow service_role (auth.uid() is NULL for service_role calls)
if v_uid is null and auth.role() <> 'service_role' then
  raise exception 'Not authenticated';
end if;

-- Allow user to set their own location; service_role may set for others.
if auth.role() <> 'service_role' and v_uid <> p_user_id then
  raise exception 'Not authorized';
end if;


  if v_cur_id is null then
    raise exception 'Location is required';
  end if;

  -- Validate start location exists
  if not exists (select 1 from public.locations l where l.id = v_cur_id) then
    raise exception 'Invalid location_id %', v_cur_id;
  end if;

  -- Remove existing tier rows so we don't accumulate stale tiers
  delete from public.user_location_settings uls
  using public.locations l
  where uls.user_id = p_user_id
    and uls.location_id = l.id
    and l.type in ('city','county','state','country');

  -- Walk up the parent chain deterministically
  while v_cur_id is not null loop
    select l.type::text, l.parent_id
      into v_type, v_parent_id
    from public.locations l
    where l.id = v_cur_id;

    -- record chain we actually saw (for runtime verification)
    if v_type is null then
      exit;
    end if;

    if v_chain = '' then
      v_chain := v_type;
    else
      v_chain := v_chain || '>' || v_type;
    end if;

    -- Insert only tiers we care about
    if v_type in ('city','county','state','country') then
      insert into public.user_location_settings (user_id, location_id, precision)
      values (p_user_id, v_cur_id, v_type::public.precision_enum)
      on conflict (user_id, location_id)
      do update set precision = excluded.precision;
    end if;

    -- Stop once we hit country
    if v_type = 'country' then
      exit;
    end if;

    v_cur_id := v_parent_id;
  end loop;

  -- Audit: keep your original source but append what the function *actually* walked.
  -- This is safe and will immediately tell us if the runtime context can see parents.
  insert into public.location_audits (user_id, location_id, override, source)
  values (
    p_user_id,
    p_location_id,
    p_override,
    p_source || ' | chain=' || coalesce(v_chain, '')
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_user_location_cascade_by_iso(p_iso_code text, p_precision public.precision_enum, p_source text DEFAULT 'settings'::text, p_override boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_loc_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_iso_code is null or length(trim(p_iso_code)) = 0 then
    raise exception 'iso_code is required';
  end if;

  select l.id
    into v_loc_id
  from public.locations l
  where lower(l.iso_code) = lower(trim(p_iso_code))
  limit 1;

  if v_loc_id is null then
    raise exception 'No location found for iso_code %, precision %', p_iso_code, p_precision;
  end if;

  perform public.set_user_location_cascade(
    v_uid,
    v_loc_id,
    p_precision,
    p_override,
    p_source
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_username(p_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_uid uuid := auth.uid();
  v_existing text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_username is null or length(trim(p_username)) < 3 then
    raise exception 'Invalid username';
  end if;

  p_username := lower(trim(p_username));

  -- If user already has this username → NO-OP
  select username
    into v_existing
  from public.profiles
  where user_id = v_uid;

  if v_existing = p_username then
    return;
  end if;

  -- Check if someone else is using it now
  if exists (
    select 1
    from public.profiles
    where username = p_username
      and user_id <> v_uid
  ) then
    raise exception 'Username already taken';
  end if;

  -- Update profile
  update public.profiles
  set username = p_username,
      display_handle_mode = 'username',
      updated_at = now()
  where user_id = v_uid;

  if not found then
    raise exception 'Profile not found';
  end if;

  -- Log change (best-effort; do not block username update during testing)
  begin
    insert into public.username_history(user_id, username, changed_at)
    values (v_uid, p_username, now());
  exception when others then
    null;
  end;

end;
$function$;
CREATE OR REPLACE FUNCTION public.should_recalculate_cognitive_state(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_last_calc TIMESTAMP;
    v_last_count INTEGER;
    v_current_count INTEGER;
BEGIN
    SELECT 
        evaluated_at,
        total_questions_answered
    INTO v_last_calc, v_last_count
    FROM public.user_cognitive_states
    WHERE user_id = p_user_id
      AND state_status = 'current'
    ORDER BY evaluated_at DESC
    LIMIT 1;
    
    IF v_last_calc IS NULL THEN
        RETURN TRUE;
    END IF;
    
    SELECT total_questions INTO v_current_count
    FROM public.user_stance_summary
    WHERE user_id = p_user_id;
    
    RETURN (
        v_current_count != v_last_count
        OR v_last_calc < NOW() - INTERVAL '7 days'
        OR (v_current_count - v_last_count) >= 5
    );
END;
$function$;
CREATE OR REPLACE FUNCTION public.snap_ai_draft_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  insert into public.ai_question_draft_versions (draft_id, snapshot, edited_by)
  values (new.id, to_jsonb(new), auth.uid());
  return new;
end$function$;
CREATE OR REPLACE FUNCTION public.snapshot_cognitive_states_daily()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user       RECORD;
  v_topics     text[];
  v_inserted   int := 0;
  v_skipped    int := 0;
BEGIN

  -- Iterate active users: >= 3 stances, last stance within 90 days.
  -- Skip users who already have a cognitive_state_snapshots row for today
  -- (calculate_cognitive_state() will have written one via trigger).
  FOR v_user IN
    SELECT
      uss.user_id,
      uss.total_questions,
      uss.mean_stance,
      uss.last_stance_at
    FROM public.user_stance_summary uss
    WHERE uss.total_questions >= 3
      AND uss.last_stance_at >= NOW() - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.cognitive_state_snapshots css
        WHERE css.user_id  = uss.user_id
          AND css.snapshot_at >= CURRENT_DATE::timestamptz
          AND css.snapshot_at <  (CURRENT_DATE + 1)::timestamptz
      )
  LOOP

    -- Collect active topic titles for this user (mirrors the INSERT in
    -- calculate_cognitive_state, but lightweight — no full profile build).
    SELECT COALESCE(ARRAY_AGG(DISTINCT t.title), ARRAY[]::text[])
    INTO   v_topics
    FROM   public.question_stances qs
    JOIN   public.questions         q  ON q.id  = qs.question_id
    JOIN   public.topics            t  ON t.id  = q.topic_id
    WHERE  qs.user_id = v_user.user_id;

    INSERT INTO public.cognitive_state_snapshots (
      user_id,
      snapshot_at,
      question_count,
      mean_stance,
      active_topics,
      last_stance_at
    ) VALUES (
      v_user.user_id,
      NOW(),
      v_user.total_questions,
      v_user.mean_stance,
      v_topics,
      v_user.last_stance_at
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RAISE NOTICE 'snapshot_cognitive_states_daily: inserted=%, skipped_already_have_today=%',
    v_inserted, v_skipped;
END;
$function$;
CREATE OR REPLACE FUNCTION public.snapshot_community_trends()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'private'
AS $function$
declare
  v_today            date    := current_date;
  v_trends_rows      integer := 0;
  v_demo_rows        integer := 0;
  v_age_group_rows   integer := 0;
  v_dob_key          text;
begin
  -- ── community_trends: macro aggregation per region ──────────────────────
  insert into public.community_trends (
    snapshot_date, region_scope, region_key, region_label,
    total_questions, total_responses,
    avg_pct_support, avg_pct_neutral, avg_pct_oppose,
    avg_score, score_stddev
  )
  select
    v_today,
    h.region_scope,
    h.region_key,
    initcap(h.region_key)                                    as region_label,
    count(distinct h.question_id)                            as total_questions,
    sum(h.total_responses)                                   as total_responses,
    case when sum(h.total_responses) > 0
      then round(
        sum(coalesce(h.pct_support, 0) * h.total_responses)
        / nullif(sum(h.total_responses), 0), 2)
      else null end                                          as avg_pct_support,
    case when sum(h.total_responses) > 0
      then round(
        sum(coalesce(h.pct_neutral, 0) * h.total_responses)
        / nullif(sum(h.total_responses), 0), 2)
      else null end                                          as avg_pct_neutral,
    case when sum(h.total_responses) > 0
      then round(
        sum(coalesce(h.pct_oppose, 0) * h.total_responses)
        / nullif(sum(h.total_responses), 0), 2)
      else null end                                          as avg_pct_oppose,
    case when sum(h.total_responses) > 0
      then round(
        sum(coalesce(h.avg_score, 0) * h.total_responses)
        / nullif(sum(h.total_responses), 0), 4)
      else null end                                          as avg_score,
    round(stddev_pop(h.avg_score)::numeric, 4)               as score_stddev
  from public.question_stance_stats_history h
  join public.questions q on q.id = h.question_id
  where h.snapshot_date = v_today
    and q.status = 'active'
  group by h.region_scope, h.region_key
  on conflict (snapshot_date, region_scope, region_key)
  do update set
    total_questions  = excluded.total_questions,
    total_responses  = excluded.total_responses,
    avg_pct_support  = excluded.avg_pct_support,
    avg_pct_neutral  = excluded.avg_pct_neutral,
    avg_pct_oppose   = excluded.avg_pct_oppose,
    avg_score        = excluded.avg_score,
    score_stddev     = excluded.score_stddev,
    created_at       = now();

  get diagnostics v_trends_rows = row_count;

  -- ── demographic_breakdowns: gender slice per question ───────────────────
  insert into public.demographic_breakdowns (
    question_id, snapshot_date, dimension, dimension_value,
    total_responses, pct_support, pct_neutral, pct_oppose, avg_score
  )
  select
    qs.question_id,
    v_today,
    'gender'                                                 as dimension,
    coalesce(p.gender, 'prefer_not_to_say')                  as dimension_value,
    count(*)                                                 as total_responses,
    round(
      count(*) filter (where qs.score > 0)::numeric
      / nullif(count(*), 0) * 100, 2)                        as pct_support,
    round(
      count(*) filter (where qs.score = 0)::numeric
      / nullif(count(*), 0) * 100, 2)                        as pct_neutral,
    round(
      count(*) filter (where qs.score < 0)::numeric
      / nullif(count(*), 0) * 100, 2)                        as pct_oppose,
    round(avg(qs.score)::numeric, 4)                         as avg_score
  from public.question_stances qs
  join public.profiles p on p.user_id = qs.user_id
  join public.questions q on q.id = qs.question_id
  where q.status = 'active'
  group by qs.question_id, coalesce(p.gender, 'prefer_not_to_say')
  having count(*) >= 3
  on conflict (question_id, snapshot_date, dimension, dimension_value)
  do update set
    total_responses = excluded.total_responses,
    pct_support     = excluded.pct_support,
    pct_neutral     = excluded.pct_neutral,
    pct_oppose      = excluded.pct_oppose,
    avg_score       = excluded.avg_score,
    created_at      = now();

  get diagnostics v_demo_rows = row_count;

  -- ── demographic_breakdowns: age_group slice per question ────────────────
  -- Graceful skip when dob_key is not configured in vault.
  v_dob_key := private.get_secret('dob_key');

  if v_dob_key is not null and v_dob_key <> '' then

    insert into public.demographic_breakdowns (
      question_id, snapshot_date, dimension, dimension_value,
      total_responses, pct_support, pct_neutral, pct_oppose, avg_score
    )
    select
      qs.question_id,
      v_today,
      'age_group'                                              as dimension,
      case
        when age_years between 13 and 17 then '13-17'
        when age_years between 18 and 24 then '18-24'
        when age_years between 25 and 34 then '25-34'
        when age_years between 35 and 44 then '35-44'
        when age_years between 45 and 54 then '45-54'
        when age_years between 55 and 64 then '55-64'
        else '65+'
      end                                                      as dimension_value,
      count(*)                                                 as total_responses,
      round(
        count(*) filter (where qs.score > 0)::numeric
        / nullif(count(*), 0) * 100, 2)                        as pct_support,
      round(
        count(*) filter (where qs.score = 0)::numeric
        / nullif(count(*), 0) * 100, 2)                        as pct_neutral,
      round(
        count(*) filter (where qs.score < 0)::numeric
        / nullif(count(*), 0) * 100, 2)                        as pct_oppose,
      round(avg(qs.score)::numeric, 4)                         as avg_score
    from public.question_stances qs
    join public.questions q on q.id = qs.question_id
    join (
      -- Decrypt dob_encrypted and compute age in years as a subquery.
      -- Filters to profiles with a verified, non-null DOB only.
      select
        p.user_id,
        date_part('year', age(
          current_date,
          extensions.pgp_sym_decrypt(p.dob_encrypted, v_dob_key)::date
        ))::integer as age_years
      from public.profiles p
      where p.dob_encrypted is not null
        and p.dob_checked   = true
    ) aged on aged.user_id = qs.user_id
    where q.status = 'active'
    group by
      qs.question_id,
      case
        when age_years between 13 and 17 then '13-17'
        when age_years between 18 and 24 then '18-24'
        when age_years between 25 and 34 then '25-34'
        when age_years between 35 and 44 then '35-44'
        when age_years between 45 and 54 then '45-54'
        when age_years between 55 and 64 then '55-64'
        else '65+'
      end
    having count(*) >= 3
    on conflict (question_id, snapshot_date, dimension, dimension_value)
    do update set
      total_responses = excluded.total_responses,
      pct_support     = excluded.pct_support,
      pct_neutral     = excluded.pct_neutral,
      pct_oppose      = excluded.pct_oppose,
      avg_score       = excluded.avg_score,
      created_at      = now();

    get diagnostics v_age_group_rows = row_count;

  end if;

  return jsonb_build_object(
    'snapshot_date',    v_today,
    'trends_rows',      v_trends_rows,
    'demo_rows',        v_demo_rows,
    'age_group_rows',   v_age_group_rows
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.snapshot_stance_stats_daily()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Insert today's snapshot from current stats
    INSERT INTO public.question_stance_stats_history (
        question_id,
        region_scope,
        region_key,
        snapshot_date,
        total_responses,
        avg_score,
        pct_support,
        pct_neutral,
        pct_oppose
    )
    SELECT 
        question_id,
        region_scope,
        region_key,
        CURRENT_DATE,
        total_responses,
        avg_score,
        pct_agree as pct_support,
        pct_neutral,
        pct_disagree as pct_oppose
    FROM public.question_stance_stats_region
    WHERE region_scope IN ('city', 'county', 'state', 'country', 'global')
    ON CONFLICT (question_id, region_scope, region_key, snapshot_date) 
    DO UPDATE SET
        total_responses = EXCLUDED.total_responses,
        avg_score = EXCLUDED.avg_score,
        pct_support = EXCLUDED.pct_support,
        pct_neutral = EXCLUDED.pct_neutral,
        pct_oppose = EXCLUDED.pct_oppose,
        created_at = NOW();
        
    RAISE NOTICE 'Daily stance snapshot completed for %', CURRENT_DATE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.sync_topic_parent_from_drafts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.topics t
  SET    parent_topic_id = td.parent_topic_id
  FROM   public.topic_drafts td
  WHERE  t.draft_id      = td.id
    AND  td.parent_topic_id IS NOT NULL
    AND  t.parent_topic_id IS DISTINCT FROM td.parent_topic_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$function$;
CREATE OR REPLACE FUNCTION public.take_moderation_action(p_report_id uuid, p_comment_id uuid, p_target_user uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS public.moderation_actions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_mod_id      uuid := auth.uid();
  v_row         public.moderation_actions;
  v_question_id uuid;
BEGIN
  IF v_mod_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = v_mod_id)
 AND NOT public.is_moderator() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT question_id INTO v_question_id
  FROM public.comments WHERE id = p_comment_id;

  IF p_action = 'hide_comment' THEN
    UPDATE public.comments SET is_deleted = true  WHERE id = p_comment_id;
  ELSIF p_action = 'restore_comment' THEN
    UPDATE public.comments SET is_deleted = false WHERE id = p_comment_id;
  END IF;

  IF p_action = 'restrict_user' AND p_target_user IS NOT NULL THEN
    INSERT INTO public.user_restrictions (user_id, restriction_type, reason, moderator_id)
    VALUES (p_target_user, 'restrict', p_reason, v_mod_id);
  ELSIF p_action = 'ban_user' AND p_target_user IS NOT NULL THEN
    INSERT INTO public.user_restrictions (user_id, restriction_type, reason, moderator_id)
    VALUES (p_target_user, 'ban', p_reason, v_mod_id);
  END IF;

  INSERT INTO public.moderation_actions
    (report_id, comment_id, target_user_id, moderator_id, action, reason)
  VALUES
    (p_report_id, p_comment_id, p_target_user, v_mod_id, p_action, p_reason)
  RETURNING * INTO v_row;

  IF p_action = 'hide_comment' AND p_target_user IS NOT NULL THEN
    INSERT INTO public.user_notifications
      (user_id, notification_type, title, body, href, metadata)
    VALUES (
      p_target_user, 'reminder', 'Your comment was removed',
      COALESCE('Reason: ' || p_reason, 'Your comment was found to violate our community guidelines.'),
      CASE WHEN v_question_id IS NOT NULL THEN '/q/' || v_question_id::text ELSE '/settings/account' END,
      jsonb_build_object('eventKind', 'moderation_action', 'action', p_action, 'comment_id', p_comment_id, 'question_id', v_question_id)
    );
  ELSIF p_action = 'restore_comment' AND p_target_user IS NOT NULL THEN
    INSERT INTO public.user_notifications
      (user_id, notification_type, title, body, href, metadata)
    VALUES (
      p_target_user, 'reminder', 'Your comment has been restored',
      'Your comment is now visible again.',
      CASE WHEN v_question_id IS NOT NULL THEN '/q/' || v_question_id::text ELSE '/settings/account' END,
      jsonb_build_object('eventKind', 'moderation_action', 'action', p_action, 'comment_id', p_comment_id, 'question_id', v_question_id)
    );
  ELSIF p_action = 'restrict_user' AND p_target_user IS NOT NULL THEN
    INSERT INTO public.user_notifications
      (user_id, notification_type, title, body, href, metadata)
    VALUES (
      p_target_user, 'reminder', 'Your account has been restricted',
      COALESCE('Reason: ' || p_reason, 'Your account has been restricted for violating our community guidelines.'),
      '/settings/account',
      jsonb_build_object('eventKind', 'moderation_action', 'action', p_action)
    );
  ELSIF p_action = 'ban_user' AND p_target_user IS NOT NULL THEN
    INSERT INTO public.user_notifications
      (user_id, notification_type, title, body, href, metadata)
    VALUES (
      p_target_user, 'reminder', 'Your account has been banned',
      COALESCE('Reason: ' || p_reason, 'Your account has been banned for violating our community guidelines.'),
      '/settings/account',
      jsonb_build_object('eventKind', 'moderation_action', 'action', p_action)
    );
  END IF;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.toggle_cron_job(p_jobid bigint)
 RETURNS TABLE(result_jobid bigint, result_active boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_current_status BOOLEAN;
  v_new_status BOOLEAN;
BEGIN
  -- Get current status
  SELECT cj.active INTO v_current_status
  FROM cron.job cj
  WHERE cj.jobid = p_jobid;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_jobid, NULL::BOOLEAN, 'Job not found'::TEXT;
    RETURN;
  END IF;
  
  -- Calculate new status
  v_new_status := NOT v_current_status;
  
  -- Use cron.alter_job to change the active status
  PERFORM cron.alter_job(
    job_id := p_jobid,
    schedule := NULL,  -- Keep existing
    command := NULL,   -- Keep existing  
    database := NULL,  -- Keep existing
    username := NULL,  -- Keep existing
    active := v_new_status
  );
  
  RETURN QUERY 
  SELECT p_jobid, v_new_status, 
    CASE WHEN v_new_status THEN 'Job resumed'::TEXT ELSE 'Job paused'::TEXT END;
    
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT p_jobid, NULL::BOOLEAN, ('Error: ' || SQLERRM)::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.toggle_cron_job_secure(p_jobid bigint)
 RETURNS TABLE(result_jobid bigint, result_active boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_current_status BOOLEAN;
  v_new_status BOOLEAN;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Get current status
  SELECT cj.active INTO v_current_status
  FROM cron.job cj
  WHERE cj.jobid = p_jobid;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_jobid, NULL::BOOLEAN, 'Job not found'::TEXT;
    RETURN;
  END IF;
  
  -- Toggle status
  v_new_status := NOT v_current_status;
  
  -- Update the job
  UPDATE cron.job cj
  SET active = v_new_status
  WHERE cj.jobid = p_jobid;
  
  RETURN QUERY 
  SELECT p_jobid, v_new_status, 
    CASE WHEN v_new_status THEN 'Job resumed'::TEXT ELSE 'Job paused'::TEXT END;
END;
$function$;
CREATE OR REPLACE FUNCTION public.topic_follow(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_topic_id IS NULL THEN
    RAISE EXCEPTION 'p_topic_id is required';
  END IF;

  -- Ensure topic exists (prevents silent follows to bad IDs)
  IF NOT EXISTS (SELECT 1 FROM public.topics t WHERE t.id = p_topic_id) THEN
    RAISE EXCEPTION 'Topic % does not exist', p_topic_id;
  END IF;

  INSERT INTO public.user_topic_follows (user_id, topic_id)
  VALUES (auth.uid(), p_topic_id)
  ON CONFLICT (user_id, topic_id) DO NOTHING;

  RETURN TRUE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.topic_is_following(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_topic_follows utf
    WHERE utf.user_id = auth.uid()
      AND utf.topic_id = p_topic_id
  );
$function$;
create materialized view "public"."topic_pulse_metrics_mv" as  SELECT tr.topic_id,
    tr.location_id,
    l.name AS region_label,
    t.title AS topic_title,
    t.tier,
    tr.total AS total_7d,
    tr.total_24h,
    tr.agree,
    tr.neutral,
    tr.disagree,
    tr.momentum_24h,
    tr.momentum_7d,
    tr.delta_24h_per_hour,
    tr.polarization_score,
    tr.movement_score,
    tr.updated_at,
    now() AS materialized_at
   FROM ((public.topic_region_trends tr
     JOIN public.topics t ON ((t.id = tr.topic_id)))
     JOIN public.locations l ON ((l.id = tr.location_id)))
  WHERE (t.title IS NOT NULL);
CREATE OR REPLACE FUNCTION public.topic_unfollow(p_topic_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_topic_id IS NULL THEN
    RAISE EXCEPTION 'p_topic_id is required';
  END IF;

  DELETE FROM public.user_topic_follows utf
  WHERE utf.user_id = auth.uid()
    AND utf.topic_id = p_topic_id;

  RETURN FALSE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.touch_device(p_device_fingerprint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_device_fingerprint is null or length(trim(p_device_fingerprint)) = 0 then
    raise exception 'device_fingerprint required';
  end if;

  insert into public.devices (user_id, device_fingerprint, last_seen_at)
  values (v_uid, p_device_fingerprint, now())
  on conflict (user_id, device_fingerprint) do update
    set last_seen_at = now();
end;
$function$;
CREATE OR REPLACE FUNCTION public.touch_profiles_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.touch_session(p_ip inet DEFAULT NULL::inet, p_ua text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.sessions (user_id, last_seen_at, ip, ua)
  values (v_uid, now(), p_ip, p_ua)
  on conflict (user_id) do update
    set last_seen_at = now(),
        ip = coalesce(excluded.ip, public.sessions.ip),
        ua = coalesce(excluded.ua, public.sessions.ua);
end;
$function$;
CREATE OR REPLACE FUNCTION public.trg_log_stance_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- INSERT: first answer (old_score = null, new_score = committed value)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.stance_history (user_id, question_id, old_score, new_score, changed_at)
    VALUES (NEW.user_id, NEW.question_id, NULL, NEW.score, NEW.created_at);

  -- UPDATE: only log when score actually changed (unchanged updates are no-ops)
  ELSIF TG_OP = 'UPDATE' AND NEW.score <> OLD.score THEN
    INSERT INTO public.stance_history (user_id, question_id, old_score, new_score, changed_at)
    VALUES (NEW.user_id, NEW.question_id, OLD.score, NEW.score, NEW.updated_at);

  -- DELETE: stance removed — log final score → null transition
  -- new_score = NULL signals the stance no longer exists.
  -- BR-D04: existing history rows are preserved; this adds one final entry.
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.stance_history (user_id, question_id, old_score, new_score, changed_at)
    VALUES (OLD.user_id, OLD.question_id, OLD.score, NULL, now());
  END IF;

  -- Trigger functions must return NEW for INSERT/UPDATE, OLD for DELETE.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trg_question_stances_refresh_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_question_id uuid;
begin
  v_question_id := coalesce(new.question_id, old.question_id);
  if v_question_id is null then
    return null;
  end if;

  perform public.refresh_question_stance_stats(v_question_id);
  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.trg_question_stances_refresh_stats_region()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_question_id uuid;
begin
  v_question_id := coalesce(new.question_id, old.question_id);
  if v_question_id is null then
    return null;
  end if;

  -- SET LOCAL: lock_timeout applies only within this transaction.
  -- Previously used bare SET which permanently altered the connection's
  -- session GUC, corrupting the PostgREST connection pool state.
  SET LOCAL lock_timeout TO '5s';

  perform public.refresh_question_stance_stats_region(v_question_id);
  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_auto_link_question()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Auto-link in background
  -- Note: For high-volume, consider running this via Edge Function instead
  PERFORM auto_link_related_questions(NEW.id, 0.4);
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_cognitive_state_calculation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF (SELECT COUNT(*) FROM question_stances WHERE user_id = NEW.user_id) >= 3 THEN
        IF public.should_recalculate_cognitive_state(NEW.user_id) THEN
            PERFORM public.calculate_cognitive_state(NEW.user_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_cron_job_now(p_jobid bigint)
 RETURNS TABLE(result_success boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_command TEXT;
BEGIN
  -- Get job command
  SELECT cj.command INTO v_command
  FROM cron.job cj
  WHERE cj.jobid = p_jobid;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Job not found'::TEXT;
    RETURN;
  END IF;
  
  -- Execute the command
  EXECUTE v_command;
  
  RETURN QUERY SELECT true, 'Job executed successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_cron_job_now_secure(p_jobid bigint)
 RETURNS TABLE(result_success boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_command TEXT;
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Get job command
  SELECT cj.command INTO v_command
  FROM cron.job cj
  WHERE cj.jobid = p_jobid;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Job not found'::TEXT;
    RETURN;
  END IF;
  
  -- Execute the command
  EXECUTE v_command;
  
  RETURN QUERY SELECT true, 'Job executed successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_generate_dedup_fields()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Auto-generate dedup_key and dedup_bucket if not provided
  IF NEW.dedup_key IS NULL THEN
    NEW.dedup_key := generate_dedup_key(NEW.question, NULL);
  END IF;
  
  IF NEW.dedup_bucket IS NULL THEN
    NEW.dedup_bucket := generate_dedup_bucket(NOW(), 14);
  END IF;
  
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_update_engagement_on_stance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  
  -- Increment total count
  INSERT INTO public.question_engagement_metrics (question_id, responses_total, updated_at)
  VALUES (NEW.question_id, 1, NOW())
  ON CONFLICT (question_id) DO UPDATE
  SET 
    responses_total = public.question_engagement_metrics.responses_total + 1,
    updated_at = NOW();
  
  -- Note: Detailed rates calculated by periodic job for performance
  
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trigger_update_trending_on_new_response()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_score NUMERIC;
BEGIN
  -- Recalculate trending score for this question
  v_score := calculate_question_trending_score(NEW.question_id);
  
  -- Update questions table
  UPDATE questions
  SET 
    trending_score = v_score,
    is_trending = (v_score >= 30),
    trending_since = CASE 
      WHEN v_score >= 30 AND (is_trending = false OR is_trending IS NULL) 
      THEN NOW()
      ELSE trending_since
    END
  WHERE id = NEW.question_id;
  
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.unfollow_topic(p_user_id uuid, p_topic_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  DELETE FROM public.user_follows
  WHERE user_id = p_user_id
    AND follow_type = 'topic'
    AND follow_id = p_topic_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_all_question_states()
 RETURNS TABLE(question_id uuid, old_state public.question_state, new_state public.question_state, changed boolean)
 LANGUAGE plpgsql
AS $function$
BEGIN
  
  -- First, recalculate engagement metrics
  PERFORM public.calculate_engagement_rates();
  
  -- Then update states for all questions
  RETURN QUERY
  WITH state_updates AS (
    SELECT 
      q.id as qid,
      q.state as old_st,
      public.update_question_state(q.id, 'batch_update') as new_st
    FROM public.questions q
    ORDER BY q.published_at DESC
  )
  SELECT 
    qid,
    old_st,
    new_st,
    (old_st != new_st) as changed
  FROM state_updates;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_all_trending_scores()
 RETURNS TABLE(question_id uuid, trending_score numeric, updated boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_question RECORD;
  v_score NUMERIC;
BEGIN
  -- Loop through all active questions
  FOR v_question IN 
    SELECT id 
    FROM questions 
    WHERE state IN ('new', 'active')
      AND published_at >= NOW() - INTERVAL '30 days'  -- Only recent questions
  LOOP
    -- Calculate score
    v_score := calculate_question_trending_score(v_question.id);
    
    -- Update questions table
    UPDATE questions
    SET 
      trending_score = v_score,
      is_trending = (v_score >= 30),  -- Threshold for "trending" flag
      trending_since = CASE 
        WHEN v_score >= 30 AND (is_trending = false OR is_trending IS NULL) 
        THEN NOW()
        ELSE trending_since
      END
    WHERE id = v_question.id;
    
    -- Return result
    RETURN QUERY
    SELECT v_question.id, v_score, true;
  END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_comment(p_comment_id uuid, p_body text)
 RETURNS public.comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_comment public.comments;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_body IS NULL OR length(trim(p_body)) = 0 THEN
    RAISE EXCEPTION 'Comment body is required';
  END IF;

  UPDATE public.comments
  SET
    body      = p_body,
    edited_at = now()
  WHERE
    id         = p_comment_id
    AND user_id    = v_uid
    AND is_deleted = false
  RETURNING * INTO v_comment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comment not found or you do not have permission to edit it';
  END IF;

  RETURN v_comment;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_cron_schedule(p_jobid bigint, p_new_schedule text)
 RETURNS TABLE(result_success boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Validate that job exists
  IF NOT EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobid = p_jobid) THEN
    RETURN QUERY SELECT false, 'Job not found'::TEXT;
    RETURN;
  END IF;
  
  -- Use cron.alter_job
  PERFORM cron.alter_job(
    job_id := p_jobid,
    schedule := p_new_schedule
  );
  
  RETURN QUERY SELECT true, 'Schedule updated successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, ('Error: ' || SQLERRM)::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_cron_schedule_secure(p_jobid bigint, p_new_schedule text)
 RETURNS TABLE(result_success boolean, result_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Check if user is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Validate that job exists
  IF NOT EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobid = p_jobid) THEN
    RETURN QUERY SELECT false, 'Job not found'::TEXT;
    RETURN;
  END IF;
  
  -- Update schedule using alter_job
  PERFORM cron.alter_job(
    job_id := p_jobid,
    schedule := p_new_schedule
  );
  
  RETURN QUERY SELECT true, 'Schedule updated successfully'::TEXT;
  
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM::TEXT;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_last_seen()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  UPDATE public.profiles
  SET last_seen_at = now()
  WHERE user_id = v_uid;
end;
$function$;
CREATE OR REPLACE FUNCTION public.update_my_privacy_settings(p_display_mode text DEFAULT NULL::text, p_stance_visibility text DEFAULT NULL::text, p_comment_visibility text DEFAULT NULL::text, p_profile_visibility text DEFAULT NULL::text)
 RETURNS public.user_privacy
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_privacy;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Ensure row exists
  INSERT INTO public.user_privacy (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.user_privacy SET
    display_mode       = COALESCE(p_display_mode,       display_mode),
    stance_visibility  = COALESCE(p_stance_visibility,  stance_visibility),
    comment_visibility = COALESCE(p_comment_visibility, comment_visibility),
    profile_visibility = COALESCE(p_profile_visibility, profile_visibility),
    updated_at         = now()
  WHERE user_id = v_uid
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_question_lifecycle()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- Move ACTIVE → COOLING (after 5 days for local, 3 days for national)
  update public.questions
  set 
    state = 'cooling',
    state_changed_at = now()
  where 
    state = 'active'
    and (
      (region_level = 'local' and published_at < now() - interval '5 days')
      or (region_level in ('national', 'global') and published_at < now() - interval '3 days')
    );

  -- Move COOLING → DORMANT (after 7 more days of low engagement)
  update public.questions
  set 
    state = 'dormant',
    state_changed_at = now()
  where 
    state = 'cooling'
    and state_changed_at < now() - interval '7 days'
    and engagement_score < 5.0;

  -- Calculate engagement scores
  update public.questions q
  set engagement_score = subq.score
  from (
    select 
      q2.id,
      coalesce(
        (
          -- Stance count
          (select count(*) from public.question_stances where question_id = q2.id) * 1.0 +
          -- Comment count
          (select count(*) from public.comments where question_id = q2.id) * 0.5 +
          -- View count (last 24h)
          (select count(*) from public.question_view_events 
           where question_id = q2.id and viewed_at > now() - interval '24 hours') * 0.1
        ),
        0.0
      ) as score
    from public.questions q2
  ) subq
  where q.id = subq.id;

  -- Update trending status (high engagement velocity)
  update public.questions
  set is_trending = (
    select count(*) > 10
    from public.question_stances qs
    where qs.question_id = questions.id
      and qs.created_at > now() - interval '6 hours'
  )
  where state in ('active', 'cooling');
end;
$function$;
CREATE OR REPLACE FUNCTION public.update_question_search_vector()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Questions table has: question, summary (no description)
  NEW.search_vector := 
    setweight(to_tsvector('english', coalesce(NEW.question, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B');
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_question_state(p_question_id uuid, p_reason text DEFAULT 'auto_transition'::text)
 RETURNS public.question_state
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_state question_state;
  v_new_state question_state;
  v_response_count INTEGER;
  v_response_rate NUMERIC;
  v_age_days NUMERIC;
BEGIN
  
  -- Get current state
  SELECT state INTO v_old_state 
  FROM public.questions 
  WHERE id = p_question_id;
  
  IF v_old_state IS NULL THEN
    RAISE EXCEPTION 'Question % not found', p_question_id;
  END IF;
  
  -- Calculate new state
  v_new_state := public.calculate_question_state(p_question_id);
  
  -- Only update if state changed
  IF v_new_state != v_old_state THEN
    
    -- Update question
    UPDATE public.questions 
    SET 
      state = v_new_state,
      state_changed_at = NOW(),
      
      -- Set archived_at if transitioning to archived
      archived_at = CASE 
        WHEN v_new_state = 'archived' AND archived_at IS NULL THEN NOW() 
        ELSE archived_at 
      END,
      
      -- Set archive reason if not already set
      archive_reason = CASE 
        WHEN v_new_state = 'archived' AND archive_reason IS NULL THEN p_reason
        ELSE archive_reason 
      END,
      
      -- Keep old status field in sync for backward compatibility
      status = CASE 
        WHEN v_new_state = 'archived' THEN 'archived'
        ELSE 'active'
      END
      
    WHERE id = p_question_id;
    
    -- Get metrics for history record
    SELECT 
      COALESCE(qem.responses_total, 0),
      COALESCE(qem.response_rate_24h, 0),
      EXTRACT(EPOCH FROM (NOW() - q.published_at))/86400
    INTO v_response_count, v_response_rate, v_age_days
    FROM public.questions q
    LEFT JOIN public.question_engagement_metrics qem ON q.id = qem.question_id
    WHERE q.id = p_question_id;
    
    -- Log state transition in history
    INSERT INTO public.question_state_history (
      question_id,
      old_state,
      new_state,
      reason,
      response_count,
      response_rate,
      age_days
    ) VALUES (
      p_question_id,
      v_old_state,
      v_new_state,
      p_reason,
      v_response_count,
      v_response_rate,
      v_age_days
    );
    
  END IF;
  
  RETURN v_new_state;
  
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_topic_search_vector()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Topics table has: title, summary (no description)
  NEW.search_vector := 
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B');
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_trending_flags()
 RETURNS TABLE(question_id uuid, became_trending boolean, stopped_trending boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_trending_threshold NUMERIC;
BEGIN
  
  -- Load trending threshold from config
  SELECT trending_threshold INTO v_trending_threshold
  FROM public.question_lifecycle_config
  WHERE topic_category IS NULL AND region_tier IS NULL
  LIMIT 1;
  
  -- Mark questions as trending if they meet threshold
  RETURN QUERY
  WITH trending_updates AS (
    -- Questions that should be trending (high response rate)
    UPDATE public.questions q
    SET 
      is_trending = true,
      trending_since = CASE 
        WHEN NOT COALESCE(q.is_trending, false) THEN NOW() 
        ELSE q.trending_since 
      END,
      trending_score = qem.response_rate_24h
    FROM public.question_engagement_metrics qem
    WHERE q.id = qem.question_id
      AND qem.response_rate_24h >= v_trending_threshold
      AND q.state IN ('new', 'active', 'dormant')  -- Only active questions can trend
      AND NOT COALESCE(q.is_trending, false)  -- Not already trending
    RETURNING q.id, true as became_trending, false as stopped_trending
  ),
  stop_trending AS (
    -- Questions that should stop trending (spike ended)
    UPDATE public.questions q
    SET 
      is_trending = false,
      trending_score = 0
    FROM public.question_engagement_metrics qem
    WHERE q.id = qem.question_id
      AND qem.response_rate_24h < v_trending_threshold
      AND COALESCE(q.is_trending, false)  -- Currently trending
    RETURNING q.id, false as became_trending, true as stopped_trending
  )
  -- Combine results
  SELECT * FROM trending_updates
  UNION ALL
  SELECT * FROM stop_trending;
  
  -- Update trending peak rates
  UPDATE public.question_engagement_metrics qem
  SET trending_peak_rate = GREATEST(
    COALESCE(trending_peak_rate, 0),
    response_rate_24h
  )
  FROM public.questions q
  WHERE qem.question_id = q.id
    AND COALESCE(q.is_trending, false)
    AND qem.response_rate_24h > COALESCE(qem.trending_peak_rate, 0);
    
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_visibility_rules()
 RETURNS TABLE(updated_question_id uuid, updated_visibility text, updated_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH score_based_rules AS (
    SELECT
      tis.question_id,
      tis.composite_score,
      CASE
        -- No score yet: visible by default (nothing to evaluate)
        WHEN tis.composite_score IS NULL  THEN 'visible'::question_visibility_enum
        -- Score-based suppression — applied immediately, no age or stance gate
        WHEN tis.composite_score < 5.0   THEN 'archived'::question_visibility_enum
        WHEN tis.composite_score < 7.0   THEN 'suppressed'::question_visibility_enum
        ELSE                                  'visible'::question_visibility_enum
      END AS new_visibility,
      CASE
        WHEN tis.composite_score IS NULL
          THEN 'Not yet scored — visible by default'
        WHEN tis.composite_score < 5.0
          THEN 'Very low composite score (' || ROUND(tis.composite_score, 2)::text || ', <5.0) — archived automatically'
        WHEN tis.composite_score < 7.0
          THEN 'Below threshold composite score (' || ROUND(tis.composite_score, 2)::text || ', <7.0) — suppressed automatically'
        ELSE
          'Composite score ' || ROUND(tis.composite_score, 2)::text || ' (≥7.0) — visible'
      END AS new_reason
    FROM public.topic_impact_scores tis
    INNER JOIN public.questions q ON q.id = tis.question_id
    WHERE q.status = 'active'
  )
  INSERT INTO public.question_visibility_rules (question_id, visibility, reason, last_evaluated_at)
  SELECT
    sbr.question_id,
    sbr.new_visibility,
    sbr.new_reason,
    NOW()
  FROM score_based_rules sbr
  ON CONFLICT (question_id)
  DO UPDATE SET
    visibility        = EXCLUDED.visibility,
    reason            = EXCLUDED.reason,
    last_evaluated_at = EXCLUDED.last_evaluated_at
  WHERE
    question_visibility_rules.visibility != EXCLUDED.visibility
    OR question_visibility_rules.reason  != EXCLUDED.reason
  RETURNING
    question_visibility_rules.question_id,
    question_visibility_rules.visibility::TEXT,
    question_visibility_rules.reason;
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_comment_reaction(p_comment_id uuid, p_reaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_existing text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT reaction INTO v_existing
  FROM public.comment_reactions
  WHERE comment_id = p_comment_id AND user_id = v_uid;

  IF v_existing = p_reaction THEN
    -- Toggle off — remove reaction
    DELETE FROM public.comment_reactions
    WHERE comment_id = p_comment_id AND user_id = v_uid;
    RETURN jsonb_build_object('action', 'removed', 'reaction', p_reaction);
  ELSE
    -- Upsert to new reaction
    INSERT INTO public.comment_reactions (comment_id, user_id, reaction)
    VALUES (p_comment_id, v_uid, p_reaction)
    ON CONFLICT (comment_id, user_id)
    DO UPDATE SET reaction = EXCLUDED.reaction;
    RETURN jsonb_build_object('action', 'set', 'reaction', p_reaction);
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_my_notification_preferences(p_stance_change_enabled boolean DEFAULT NULL::boolean, p_weekly_digest_enabled boolean DEFAULT NULL::boolean, p_topic_follow_enabled boolean DEFAULT NULL::boolean, p_digest_day_of_week integer DEFAULT NULL::integer, p_digest_hour_local integer DEFAULT NULL::integer, p_timezone text DEFAULT NULL::text)
 RETURNS public.notification_preferences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notification_preferences (
    user_id,
    stance_change_enabled,
    weekly_digest_enabled,
    topic_follow_enabled,
    digest_day_of_week,
    digest_hour_local,
    timezone
  )
  values (
    auth.uid(),
    coalesce(p_stance_change_enabled, true),
    coalesce(p_weekly_digest_enabled, true),
    coalesce(p_topic_follow_enabled,  true),
    coalesce(p_digest_day_of_week,    1),
    coalesce(p_digest_hour_local,     9),
    coalesce(p_timezone,              'America/New_York')
  )
  on conflict (user_id)
  do update set
    stance_change_enabled = coalesce(p_stance_change_enabled, notification_preferences.stance_change_enabled),
    weekly_digest_enabled = coalesce(p_weekly_digest_enabled, notification_preferences.weekly_digest_enabled),
    topic_follow_enabled  = coalesce(p_topic_follow_enabled,  notification_preferences.topic_follow_enabled),
    digest_day_of_week    = coalesce(p_digest_day_of_week,    notification_preferences.digest_day_of_week),
    digest_hour_local     = coalesce(p_digest_hour_local,     notification_preferences.digest_hour_local),
    timezone              = coalesce(p_timezone,              notification_preferences.timezone),
    updated_at            = now();

  return (
    select np
    from public.notification_preferences np
    where np.user_id = auth.uid()
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_my_notification_preferences(p_stance_change_enabled boolean DEFAULT NULL::boolean, p_weekly_digest_enabled boolean DEFAULT NULL::boolean, p_topic_follow_enabled boolean DEFAULT NULL::boolean, p_digest_day_of_week integer DEFAULT NULL::integer, p_digest_hour_local integer DEFAULT NULL::integer, p_timezone text DEFAULT NULL::text, p_email_enabled boolean DEFAULT NULL::boolean, p_inapp_enabled boolean DEFAULT NULL::boolean, p_digest_frequency text DEFAULT NULL::text, p_quiet_hours_start integer DEFAULT NULL::integer, p_quiet_hours_end integer DEFAULT NULL::integer, p_reminder_enabled boolean DEFAULT NULL::boolean, p_new_local_topic_enabled boolean DEFAULT NULL::boolean)
 RETURNS public.notification_preferences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notification_preferences (
    user_id,
    stance_change_enabled,
    weekly_digest_enabled,
    topic_follow_enabled,
    digest_day_of_week,
    digest_hour_local,
    timezone,
    email_enabled,
    inapp_enabled,
    digest_frequency,
    quiet_hours_start,
    quiet_hours_end,
    reminder_enabled,
    new_local_topic_enabled
  )
  values (
    auth.uid(),
    coalesce(p_stance_change_enabled,   true),
    coalesce(p_weekly_digest_enabled,   true),
    coalesce(p_topic_follow_enabled,    true),
    coalesce(p_digest_day_of_week,      1),
    coalesce(p_digest_hour_local,       9),
    coalesce(p_timezone,                'America/New_York'),
    coalesce(p_email_enabled,           false),
    coalesce(p_inapp_enabled,           true),
    coalesce(p_digest_frequency,        'weekly'),
    p_quiet_hours_start,   -- null = no quiet hours
    p_quiet_hours_end,
    coalesce(p_reminder_enabled,        true),
    coalesce(p_new_local_topic_enabled, true)
  )
  on conflict (user_id)
  do update set
    stance_change_enabled   = coalesce(p_stance_change_enabled,   notification_preferences.stance_change_enabled),
    weekly_digest_enabled   = coalesce(p_weekly_digest_enabled,   notification_preferences.weekly_digest_enabled),
    topic_follow_enabled    = coalesce(p_topic_follow_enabled,    notification_preferences.topic_follow_enabled),
    digest_day_of_week      = coalesce(p_digest_day_of_week,      notification_preferences.digest_day_of_week),
    digest_hour_local       = coalesce(p_digest_hour_local,       notification_preferences.digest_hour_local),
    timezone                = coalesce(p_timezone,                notification_preferences.timezone),
    email_enabled           = coalesce(p_email_enabled,           notification_preferences.email_enabled),
    inapp_enabled           = coalesce(p_inapp_enabled,           notification_preferences.inapp_enabled),
    digest_frequency        = coalesce(p_digest_frequency,        notification_preferences.digest_frequency),
    -- quiet hours: pass -1 to explicitly clear, null to leave unchanged
    quiet_hours_start       = case
                                when p_quiet_hours_start = -1 then null
                                when p_quiet_hours_start is null then notification_preferences.quiet_hours_start
                                else p_quiet_hours_start
                              end,
    quiet_hours_end         = case
                                when p_quiet_hours_end = -1 then null
                                when p_quiet_hours_end is null then notification_preferences.quiet_hours_end
                                else p_quiet_hours_end
                              end,
    reminder_enabled        = coalesce(p_reminder_enabled,        notification_preferences.reminder_enabled),
    new_local_topic_enabled = coalesce(p_new_local_topic_enabled, notification_preferences.new_local_topic_enabled),
    updated_at              = now();

  return (
    select np from public.notification_preferences np
    where np.user_id = auth.uid()
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_question_comment_sentiment(p_question_id uuid, p_avg_sentiment numeric, p_sentiment_variance numeric, p_comment_count integer, p_summary_text text, p_model text DEFAULT 'comment-sentiment-v1'::text)
 RETURNS public.question_comment_sentiment
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_row public.question_comment_sentiment;
BEGIN
  -- Only allow service role or admin
  IF auth.role() <> 'service_role'
     AND NOT public.is_admin(auth.uid())
  THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  INSERT INTO public.question_comment_sentiment AS qcs (
    question_id,
    avg_sentiment,
    sentiment_variance,
    comment_count,
    last_run_at,
    last_model,
    summary_text
  )
  VALUES (
    p_question_id,
    p_avg_sentiment,
    p_sentiment_variance,
    p_comment_count,
    now(),
    p_model,
    p_summary_text
  )
  ON CONFLICT (question_id) DO UPDATE
    SET avg_sentiment      = EXCLUDED.avg_sentiment,
        sentiment_variance = EXCLUDED.sentiment_variance,
        comment_count      = EXCLUDED.comment_count,
        last_run_at        = now(),
        last_model         = EXCLUDED.last_model,
        summary_text       = EXCLUDED.summary_text
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_question_impact_scores(p_question_id uuid, p_impact_score numeric, p_stance_potential_score numeric, p_cluster_density_score numeric, p_region_relevance_score numeric, p_engagement_prediction_score numeric, p_explanation text)
 RETURNS public.topic_impact_scores
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_row public.topic_impact_scores;
  v_composite numeric;
BEGIN
  PERFORM public._ensure_admin_or_service();

  -- Calculate composite score (weighted average matching your scoring system)
  v_composite := ROUND(
    (
      (COALESCE(p_impact_score, 0)               * 0.30) +
      (COALESCE(p_stance_potential_score, 0)     * 0.20) +
      (COALESCE(p_cluster_density_score, 0)      * 0.20) +
      (COALESCE(p_region_relevance_score, 0)     * 0.15) +
      (COALESCE(p_engagement_prediction_score, 0)* 0.15)
    )::numeric, 2
  );

  -- Insert or update by question_id
  -- Uses a unique index on question_id for the conflict target
  INSERT INTO public.topic_impact_scores (
    question_id,
    topic_id,                        -- intentionally NULL for question-level scores
    impact_score,
    stance_potential_score,
    cluster_density_score,
    region_relevance_score,
    engagement_prediction_score,
    composite_score,
    explanation,
    updated_at
  )
  VALUES (
    p_question_id,
    NULL,
    p_impact_score,
    p_stance_potential_score,
    p_cluster_density_score,
    p_region_relevance_score,
    p_engagement_prediction_score,
    v_composite,
    p_explanation,
    now()
  )
  ON CONFLICT (question_id) DO UPDATE
    SET impact_score                = EXCLUDED.impact_score,
        stance_potential_score      = EXCLUDED.stance_potential_score,
        cluster_density_score       = EXCLUDED.cluster_density_score,
        region_relevance_score      = EXCLUDED.region_relevance_score,
        engagement_prediction_score = EXCLUDED.engagement_prediction_score,
        composite_score             = EXCLUDED.composite_score,
        explanation                 = EXCLUDED.explanation,
        updated_at                  = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_social_auth_token(p_provider public.social_provider, p_provider_user_id text, p_access_token text, p_refresh_token text DEFAULT NULL::text, p_token_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scopes text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.social_auth_tokens (
    user_id, provider, provider_user_id,
    access_token, refresh_token, token_expires_at, scopes
  )
  VALUES (
    auth.uid(), p_provider, p_provider_user_id,
    p_access_token, p_refresh_token, p_token_expires_at, p_scopes
  )
  ON CONFLICT (user_id, provider) DO UPDATE SET
    provider_user_id  = EXCLUDED.provider_user_id,
    access_token      = EXCLUDED.access_token,
    refresh_token     = COALESCE(EXCLUDED.refresh_token, social_auth_tokens.refresh_token),
    token_expires_at  = EXCLUDED.token_expires_at,
    scopes            = EXCLUDED.scopes,
    updated_at        = now();
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_stance_confidence(p_question_id uuid, p_confidence smallint)
 RETURNS public.question_stance_confidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_row public.question_stance_confidence;
BEGIN
  -- Auth guard
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Range guard (mirrors DB constraint — explicit error is clearer than constraint violation)
  IF p_confidence < 1 OR p_confidence > 5 THEN
    RAISE EXCEPTION 'Invalid confidence score. Must be between 1 and 5.';
  END IF;

  -- Require an existing stance — confidence is meaningless without a committed position
  IF NOT EXISTS (
    SELECT 1
    FROM public.question_stances
    WHERE user_id    = auth.uid()
      AND question_id = p_question_id
  ) THEN
    RAISE EXCEPTION 'No stance found. Submit a stance before rating confidence.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.question_stance_confidence (user_id, question_id, confidence)
  VALUES (auth.uid(), p_question_id, p_confidence)
  ON CONFLICT (user_id, question_id)
  DO UPDATE SET
    confidence = EXCLUDED.confidence,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_stance_text(p_question_id uuid, p_rationale text DEFAULT NULL::text, p_links text[] DEFAULT '{}'::text[])
 RETURNS public.stance_texts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Only allow if user has actually answered this question
  if not exists (
    select 1 from public.question_stances
    where user_id = auth.uid() and question_id = p_question_id
  ) then
    raise exception 'You must answer the question before adding a rationale.'
      using errcode = '42501';
  end if;

  insert into public.stance_texts (user_id, question_id, rationale, links)
  values (auth.uid(), p_question_id, p_rationale, coalesce(p_links, '{}'))
  on conflict (user_id, question_id)
  do update set
    rationale  = coalesce(p_rationale, stance_texts.rationale),
    links      = coalesce(p_links, stance_texts.links),
    updated_at = now();

  return (
    select st from public.stance_texts st
    where st.user_id = auth.uid() and st.question_id = p_question_id
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_topic_impact_scores(p_topic_id uuid, p_impact_score numeric, p_stance_potential_score numeric, p_cluster_density_score numeric, p_region_relevance_score numeric, p_engagement_prediction_score numeric, p_explanation text)
 RETURNS public.topic_impact_scores
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_row public.topic_impact_scores;
BEGIN
  PERFORM public._ensure_admin_or_service();

  INSERT INTO public.topic_impact_scores AS tis (
    topic_id,
    impact_score,
    stance_potential_score,
    cluster_density_score,
    region_relevance_score,
    engagement_prediction_score,
    explanation,
    updated_at
  )
  VALUES (
    p_topic_id,
    p_impact_score,
    p_stance_potential_score,
    p_cluster_density_score,
    p_region_relevance_score,
    p_engagement_prediction_score,
    p_explanation,
    now()
  )
  ON CONFLICT (topic_id) DO UPDATE
    SET impact_score                = EXCLUDED.impact_score,
        stance_potential_score      = EXCLUDED.stance_potential_score,
        cluster_density_score       = EXCLUDED.cluster_density_score,
        region_relevance_score      = EXCLUDED.region_relevance_score,
        engagement_prediction_score = EXCLUDED.engagement_prediction_score,
        explanation                 = EXCLUDED.explanation,
        updated_at                  = now()
  RETURNING tis.* INTO v_row;

  RETURN v_row;
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_whatsapp_stance(p_question_id uuid, p_score smallint, p_phone_hash text, p_broadcast_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_user_id    uuid;
  v_stance_id  uuid;
BEGIN
  -- Validate score range
  IF p_score < -2 OR p_score > 2 THEN
    RAISE EXCEPTION 'Invalid score: must be between -2 and 2';
  END IF;

  -- Check if phone hash matches a verified profile
  SELECT user_id INTO v_user_id
  FROM public.profiles
  WHERE verified_phone_hash = p_phone_hash
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- ── Attributed stance: upsert on (user_id, question_id) ──────────────
    INSERT INTO public.question_stances (
      user_id, question_id, score, source, whatsapp_phone_hash, broadcast_id
    )
    VALUES (
      v_user_id, p_question_id, p_score, 'whatsapp_flow', p_phone_hash, p_broadcast_id
    )
    ON CONFLICT (user_id, question_id)
    DO UPDATE SET
      score               = EXCLUDED.score,
      source              = 'whatsapp_flow',
      whatsapp_phone_hash = EXCLUDED.whatsapp_phone_hash,
      broadcast_id        = COALESCE(EXCLUDED.broadcast_id, question_stances.broadcast_id),
      updated_at          = now()
    RETURNING id INTO v_stance_id;

  ELSE
    -- ── Anonymous stance: upsert on (whatsapp_phone_hash, question_id) ───
    INSERT INTO public.question_stances (
      user_id, question_id, score, source, whatsapp_phone_hash, broadcast_id
    )
    VALUES (
      NULL, p_question_id, p_score, 'whatsapp_flow', p_phone_hash, p_broadcast_id
    )
    ON CONFLICT (whatsapp_phone_hash, question_id)
    WHERE whatsapp_phone_hash IS NOT NULL
    DO UPDATE SET
      score        = EXCLUDED.score,
      broadcast_id = COALESCE(EXCLUDED.broadcast_id, question_stances.broadcast_id),
      updated_at   = now()
    RETURNING id INTO v_stance_id;
  END IF;

  RETURN jsonb_build_object(
    'stance_id',   v_stance_id,
    'user_id',     v_user_id,
    'attributed',  v_user_id IS NOT NULL
  );
END;
$function$;
create or replace view "public"."user_region_dimensions" as  SELECT u.id AS user_id,
    max(
        CASE
            WHEN (l.type = 'city'::public.location_tier_enum) THEN l.name
            ELSE NULL::text
        END) AS city_label,
    max(
        CASE
            WHEN (l.type = 'county'::public.location_tier_enum) THEN l.name
            ELSE NULL::text
        END) AS county_label,
    max(
        CASE
            WHEN (l.type = 'state'::public.location_tier_enum) THEN l.name
            ELSE NULL::text
        END) AS state_label,
    max(
        CASE
            WHEN (l.type = 'country'::public.location_tier_enum) THEN l.name
            ELSE NULL::text
        END) AS country_label,
    'Global'::text AS global_label,
    max(
        CASE
            WHEN (l.type = 'country'::public.location_tier_enum) THEN l.iso_code
            ELSE NULL::text
        END) AS country_code
   FROM ((auth.users u
     LEFT JOIN public.user_location_settings uls ON ((uls.user_id = u.id)))
     LEFT JOIN public.locations l ON ((l.id = uls.location_id)))
  GROUP BY u.id;
create or replace view "public"."user_stance_summary" as  SELECT qs.user_id,
    count(DISTINCT qs.question_id) AS total_questions,
    count(DISTINCT q.topic_id) AS active_topics,
    (avg(qs.score))::numeric(4,2) AS mean_stance,
    (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((qs.score)::double precision)))::numeric(4,2) AS median_stance,
    (stddev(qs.score))::numeric(4,2) AS stance_stddev,
    min(qs.created_at) AS first_stance_at,
    max(qs.created_at) AS last_stance_at,
    count(*) FILTER (WHERE (qs.score = '-2'::integer)) AS strong_disagree_count,
    count(*) FILTER (WHERE (qs.score = '-1'::integer)) AS disagree_count,
    count(*) FILTER (WHERE (qs.score = 0)) AS neutral_count,
    count(*) FILTER (WHERE (qs.score = 1)) AS agree_count,
    count(*) FILTER (WHERE (qs.score = 2)) AS strong_agree_count,
    array_agg(DISTINCT q.topic_id) AS topic_ids
   FROM (public.question_stances qs
     JOIN public.questions q ON ((q.id = qs.question_id)))
  GROUP BY qs.user_id;
CREATE OR REPLACE FUNCTION public.username_available(p_username text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  with u as (
    select lower(p_username) as u
  )
  select not exists (
    select 1 from public.profiles p, u where lower(p.username) = u.u
  )
  and not exists (
    select 1 from public.username_history h, u where lower(h.username) = u.u
  )
  and not exists (
    select 1 from public.reserved_usernames r, u where lower(r.username) = u.u
  )
$function$;
CREATE OR REPLACE FUNCTION public.username_is_valid(p_username text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_username ~ '^[A-Za-z0-9_]{3,20}$'
$function$;
create or replace view "public"."v_hygiene_suppressed" as  SELECT q.id AS question_id,
    q.question,
    q.published_at,
    q.is_trending,
    q.trending_score,
    vr.visibility,
    vr.reason,
    vr.last_evaluated_at,
    qe.responses_total,
    qe.responses_last_24h,
    tis.composite_score
   FROM (((public.questions q
     JOIN public.question_visibility_rules vr ON ((vr.question_id = q.id)))
     LEFT JOIN public.question_engagement_metrics qe ON ((qe.question_id = q.id)))
     LEFT JOIN public.topic_impact_scores tis ON ((tis.question_id = q.id)))
  WHERE ((vr.reason ~~ 'Feed hygiene:%'::text) AND (vr.visibility = ANY (ARRAY['suppressed'::public.question_visibility_enum, 'archived'::public.question_visibility_enum])))
  ORDER BY vr.last_evaluated_at DESC;
create or replace view "public"."v_question_impact_admin" as  WITH latest_scores AS (
         SELECT DISTINCT ON (topic_impact_scores.question_id) topic_impact_scores.question_id,
            topic_impact_scores.impact_score,
            topic_impact_scores.stance_potential_score,
            topic_impact_scores.cluster_density_score,
            topic_impact_scores.region_relevance_score,
            topic_impact_scores.engagement_prediction_score,
            topic_impact_scores.composite_score,
            topic_impact_scores.explanation,
            topic_impact_scores.updated_at
           FROM public.topic_impact_scores
          WHERE (topic_impact_scores.question_id IS NOT NULL)
          ORDER BY topic_impact_scores.question_id, topic_impact_scores.updated_at DESC NULLS LAST
        ), latest_visibility AS (
         SELECT DISTINCT ON (question_visibility_rules.question_id) question_visibility_rules.question_id,
            question_visibility_rules.visibility,
            question_visibility_rules.reason,
            question_visibility_rules.last_evaluated_at
           FROM public.question_visibility_rules
          WHERE (question_visibility_rules.question_id IS NOT NULL)
          ORDER BY question_visibility_rules.question_id, question_visibility_rules.last_evaluated_at DESC NULLS LAST
        )
 SELECT q.id AS question_id,
    q.question AS question_text,
    q.summary AS question_summary,
    q.tags AS question_tags,
    q.location_label AS question_location_label,
    q.status AS question_status,
    q.published_at AS question_published_at,
    NULL::uuid AS topic_id,
    NULL::text AS topic_title,
    NULL::text AS topic_summary,
    NULL::text AS topic_tier,
    NULL::text AS topic_location_label,
    NULL::text[] AS topic_tags,
    NULL::uuid AS cluster_id,
    ls.impact_score,
    ls.stance_potential_score,
    ls.cluster_density_score,
    ls.region_relevance_score,
    ls.engagement_prediction_score,
    ls.composite_score,
    ls.explanation AS impact_explanation,
    ls.updated_at AS scores_updated_at,
    lv.visibility,
    lv.reason AS visibility_reason,
    lv.last_evaluated_at,
    q.is_featured
   FROM ((public.questions q
     LEFT JOIN latest_scores ls ON ((ls.question_id = q.id)))
     LEFT JOIN latest_visibility lv ON ((lv.question_id = q.id)))
  WHERE (q.status = 'active'::text);
create or replace view "public"."v_source_health" as  SELECT ts.id,
    ts.name,
    ts.kind,
    ts.endpoint,
    ts.is_enabled,
    ts.last_polled_at,
    ts.last_status,
    ts.last_error,
    ts.success_count,
    ts.failure_count,
    ts.polling_interval,
    ts.country_name,
    ts.country_code,
    ts.created_at,
    count(ni.id) AS total_articles,
    max(ni.published_at) AS latest_article_at,
    sum(
        CASE
            WHEN (ni.published_at > (now() - '24:00:00'::interval)) THEN 1
            ELSE 0
        END) AS articles_last_24h
   FROM (public.topic_sources ts
     LEFT JOIN public.news_items ni ON ((ni.source_id = ts.id)))
  GROUP BY ts.id, ts.name, ts.kind, ts.endpoint, ts.is_enabled, ts.last_polled_at, ts.last_status, ts.last_error, ts.success_count, ts.failure_count, ts.polling_interval, ts.country_name, ts.country_code, ts.created_at;
create or replace view "public"."v_topic_impact_admin" as  SELECT t.id AS topic_id,
    t.title AS topic_title,
    t.summary AS topic_summary,
    t.tier AS topic_tier,
    t.location_label AS topic_location_label,
    t.tags AS topic_tags,
    t.cluster_id,
    tis.impact_score,
    tis.stance_potential_score,
    tis.cluster_density_score,
    tis.region_relevance_score,
    tis.engagement_prediction_score,
    tis.composite_score,
    tis.explanation,
    tis.updated_at AS scores_updated_at
   FROM (public.topics t
     LEFT JOIN public.topic_impact_scores tis ON ((tis.topic_id = t.id)));
CREATE OR REPLACE FUNCTION public.verify_whatsapp_phone(p_verification_token uuid, p_otp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_rec       record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Look up the verification token
  SELECT * INTO v_rec
  FROM public.whatsapp_phone_verifications
  WHERE verification_token = p_verification_token
    AND used = false
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired verification code';
  END IF;

  -- Check OTP matches
  IF v_rec.otp_code != p_otp THEN
    RAISE EXCEPTION 'Invalid verification code';
  END IF;

  -- Mark token as used
  UPDATE public.whatsapp_phone_verifications
  SET used = true
  WHERE id = v_rec.id;

  -- Store phone hash on profile
  UPDATE public.profiles
  SET verified_phone_hash = v_rec.phone_hash,
      updated_at          = now()
  WHERE user_id = v_uid;

  RETURN jsonb_build_object('verified', true);
END;
$function$;
create or replace view "public"."vw_topic_questions_with_impact_v1" as  WITH latest_scores AS (
         SELECT DISTINCT ON (tis.question_id) tis.question_id,
            tis.composite_score,
            tis.impact_score,
            tis.updated_at
           FROM public.topic_impact_scores tis
          WHERE (tis.question_id IS NOT NULL)
          ORDER BY tis.question_id, tis.updated_at DESC NULLS LAST, tis.id DESC
        )
 SELECT public.get_canonical_topic_id(q.topic_id) AS canonical_topic_id,
    q.topic_id,
    q.id AS question_id,
    q.question,
    COALESCE(q.context_summary, q.summary) AS summary,
    q.tags,
    q.location_label,
    q.published_at,
    q.status,
    q.state,
    q.is_resolved,
    q.is_trending,
    q.trending_score,
    COALESCE(ls.composite_score, ls.impact_score) AS latest_question_score,
    ls.updated_at AS score_updated_at,
    ( SELECT count(*) AS count
           FROM public.question_stances qs
          WHERE (qs.question_id = q.id)) AS response_count
   FROM (public.questions q
     LEFT JOIN latest_scores ls ON ((ls.question_id = q.id)))
  WHERE ((q.status = 'active'::text) AND (q.published_at IS NOT NULL));
create or replace view "public"."vw_topic_scores_top5_v1" as  WITH ranked AS (
         SELECT v.canonical_topic_id AS topic_id,
            v.question_id,
            v.latest_question_score,
            v.published_at,
            row_number() OVER (PARTITION BY v.canonical_topic_id ORDER BY v.latest_question_score DESC NULLS LAST, v.published_at DESC NULLS LAST, v.question_id DESC) AS rn
           FROM public.vw_topic_questions_with_impact_v1 v
          WHERE (v.latest_question_score IS NOT NULL)
        )
 SELECT topic_id,
    COALESCE(sum(latest_question_score) FILTER (WHERE (rn <= 5)), (0)::numeric) AS topic_score_top5,
    (count(*))::integer AS scored_questions_count,
    (count(*) FILTER (WHERE (rn <= 5)))::integer AS top5_questions_count
   FROM ranked
  GROUP BY topic_id;
create or replace view "public"."vw_topic_top_questions_v1" as  WITH params AS (
         SELECT 5 AS top_n
        ), canonical_topics AS (
         SELECT t.id AS topic_id,
            COALESCE(t.parent_topic_id, t.id) AS canonical_topic_id
           FROM public.topics t
        ), latest_question_scores AS (
         SELECT DISTINCT ON (tis.question_id) tis.question_id,
            tis.impact_score,
            tis.stance_potential_score,
            tis.cluster_density_score,
            tis.region_relevance_score,
            tis.engagement_prediction_score,
            tis.composite_score,
            tis.explanation,
            tis.updated_at
           FROM public.topic_impact_scores tis
          WHERE (tis.question_id IS NOT NULL)
          ORDER BY tis.question_id, tis.updated_at DESC
        ), scored_questions AS (
         SELECT ct.canonical_topic_id,
            q.topic_id,
            q.id AS question_id,
            q.question AS question_text,
            q.summary AS question_summary,
            q.tags AS question_tags,
            q.location_label AS question_location_label,
            q.published_at AS question_published_at,
            q.status AS question_status,
            COALESCE(lqs.composite_score, (0)::numeric) AS composite_score,
            lqs.updated_at AS score_updated_at
           FROM ((public.questions q
             JOIN canonical_topics ct ON ((ct.topic_id = q.topic_id)))
             LEFT JOIN latest_question_scores lqs ON ((lqs.question_id = q.id)))
          WHERE (q.status = 'active'::text)
        ), ranked AS (
         SELECT sq.canonical_topic_id,
            sq.topic_id,
            sq.question_id,
            sq.question_text,
            sq.question_summary,
            sq.question_tags,
            sq.question_location_label,
            sq.question_published_at,
            sq.question_status,
            sq.composite_score,
            sq.score_updated_at,
            row_number() OVER (PARTITION BY sq.canonical_topic_id ORDER BY sq.composite_score DESC NULLS LAST, sq.score_updated_at DESC NULLS LAST, sq.question_published_at DESC NULLS LAST, sq.question_id DESC) AS score_rank
           FROM scored_questions sq
        )
 SELECT r.canonical_topic_id,
    r.topic_id,
    r.question_id,
    r.question_text,
    r.question_summary,
    r.question_tags,
    r.question_location_label,
    r.question_published_at,
    r.composite_score,
    r.score_updated_at,
    r.score_rank
   FROM ranked r,
    params p
  WHERE (r.score_rank <= p.top_n);
create or replace view "public"."vw_topics_with_score_v1" as  WITH latest_scores AS (
         SELECT DISTINCT ON (tis.question_id) tis.question_id,
            tis.composite_score,
            tis.impact_score,
            tis.updated_at
           FROM public.topic_impact_scores tis
          WHERE (tis.question_id IS NOT NULL)
          ORDER BY tis.question_id, tis.updated_at DESC NULLS LAST
        ), q_scored AS (
         SELECT q.id AS question_id,
            q.topic_id,
            q.published_at,
            q.status,
            COALESCE(ls.composite_score, ls.impact_score) AS question_score
           FROM (public.questions q
             LEFT JOIN latest_scores ls ON ((ls.question_id = q.id)))
          WHERE (q.status = 'active'::text)
        )
 SELECT id AS topic_id,
    title,
    summary,
    tier,
    location_label,
    tags,
    created_at,
    ( SELECT count(*) AS count
           FROM public.questions q
          WHERE ((q.topic_id = t.id) AND (q.status = 'active'::text))) AS total_active_questions_count,
    ( SELECT count(*) AS count
           FROM q_scored qs
          WHERE ((qs.topic_id = t.id) AND (qs.question_score IS NOT NULL))) AS scored_questions_count,
    ( SELECT COALESCE(sum(x.question_score), (0)::numeric) AS "coalesce"
           FROM ( SELECT qs.question_score
                   FROM q_scored qs
                  WHERE ((qs.topic_id = t.id) AND (qs.question_score IS NOT NULL))
                  ORDER BY qs.question_score DESC, qs.published_at DESC, qs.question_id DESC
                 LIMIT 5) x) AS topic_score_top5,
    ( SELECT COALESCE(array_agg(x.question_id ORDER BY x.question_score DESC, x.published_at DESC, x.question_id DESC), '{}'::uuid[]) AS "coalesce"
           FROM ( SELECT qs.question_id,
                    qs.question_score,
                    qs.published_at
                   FROM q_scored qs
                  WHERE ((qs.topic_id = t.id) AND (qs.question_score IS NOT NULL))
                  ORDER BY qs.question_score DESC, qs.published_at DESC, qs.question_id DESC
                 LIMIT 5) x) AS top_question_ids,
    ( SELECT COALESCE(array_agg(x.question_score ORDER BY x.question_score DESC, x.published_at DESC, x.question_id DESC), '{}'::numeric[]) AS "coalesce"
           FROM ( SELECT qs.question_id,
                    qs.question_score,
                    qs.published_at
                   FROM q_scored qs
                  WHERE ((qs.topic_id = t.id) AND (qs.question_score IS NOT NULL))
                  ORDER BY qs.question_score DESC, qs.published_at DESC, qs.question_id DESC
                 LIMIT 5) x) AS top_question_scores
   FROM public.topics t;
CREATE OR REPLACE FUNCTION public.whoami()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$ select auth.uid() $function$;
CREATE OR REPLACE FUNCTION public.write_audit_log(p_election_id uuid, p_action text, p_target_table text DEFAULT NULL::text, p_target_id uuid DEFAULT NULL::uuid, p_old_value jsonb DEFAULT NULL::jsonb, p_new_value jsonb DEFAULT NULL::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.election_audit_log (
    election_id, action, actor_id, target_table, target_id,
    old_value, new_value, notes
  )
  VALUES (
    p_election_id, p_action, auth.uid(), p_target_table, p_target_id,
    p_old_value, p_new_value, p_notes
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
create or replace view "public"."question_stance_momentum_region_v" as  WITH base AS (
         SELECT qs.question_id,
            qs.user_id,
            qs.created_at,
            ur.city_label,
            ur.county_label,
            ur.state_label,
            ur.country_label,
            ur.global_label
           FROM (public.question_stances qs
             JOIN public.user_region_dimensions ur ON ((ur.user_id = qs.user_id)))
        ), expanded AS (
         SELECT base.question_id,
            'local'::text AS region_scope,
            base.city_label AS region_key,
            base.user_id,
            base.created_at
           FROM base
          WHERE ((base.city_label IS NOT NULL) AND (length(TRIM(BOTH FROM base.city_label)) > 0))
        UNION ALL
         SELECT base.question_id,
            'county'::text AS text,
            base.county_label,
            base.user_id,
            base.created_at
           FROM base
          WHERE ((base.county_label IS NOT NULL) AND (length(TRIM(BOTH FROM base.county_label)) > 0))
        UNION ALL
         SELECT base.question_id,
            'state'::text AS text,
            base.state_label,
            base.user_id,
            base.created_at
           FROM base
          WHERE ((base.state_label IS NOT NULL) AND (length(TRIM(BOTH FROM base.state_label)) > 0))
        UNION ALL
         SELECT base.question_id,
            'national'::text AS text,
            base.country_label,
            base.user_id,
            base.created_at
           FROM base
          WHERE ((base.country_label IS NOT NULL) AND (length(TRIM(BOTH FROM base.country_label)) > 0))
        UNION ALL
         SELECT base.question_id,
            'global'::text AS text,
            COALESCE(NULLIF(TRIM(BOTH FROM base.global_label), ''::text), 'Global'::text) AS "coalesce",
            base.user_id,
            base.created_at
           FROM base
        )
 SELECT question_id,
    region_scope,
    region_key,
    count(DISTINCT user_id) FILTER (WHERE (created_at >= (now() - '24:00:00'::interval))) AS unique_users_24h,
    count(DISTINCT user_id) FILTER (WHERE (created_at >= (now() - '7 days'::interval))) AS unique_users_7d,
    count(*) FILTER (WHERE (created_at >= (now() - '06:00:00'::interval))) AS velocity_6h,
    max(created_at) AS last_activity_at
   FROM expanded
  GROUP BY question_id, region_scope, region_key;
create or replace view "public"."vw_topic_scores_v1" as  WITH params AS (
         SELECT 5 AS top_n
        ), canonical AS (
         SELECT t.id AS topic_id,
            COALESCE(t.parent_topic_id, t.id) AS canonical_topic_id
           FROM public.topics t
        ), canonical_topic_rows AS (
         SELECT t.id AS canonical_topic_id,
            t.title,
            t.summary,
            t.tags,
            t.tier,
            t.location_label,
            t.created_at
           FROM public.topics t
          WHERE (t.parent_topic_id IS NULL)
        ), topq AS (
         SELECT vw_topic_top_questions_v1.canonical_topic_id,
            vw_topic_top_questions_v1.topic_id,
            vw_topic_top_questions_v1.question_id,
            vw_topic_top_questions_v1.question_text,
            vw_topic_top_questions_v1.question_summary,
            vw_topic_top_questions_v1.question_tags,
            vw_topic_top_questions_v1.question_location_label,
            vw_topic_top_questions_v1.question_published_at,
            vw_topic_top_questions_v1.composite_score,
            vw_topic_top_questions_v1.score_updated_at,
            vw_topic_top_questions_v1.score_rank
           FROM public.vw_topic_top_questions_v1
        ), agg AS (
         SELECT topq.canonical_topic_id,
            sum(topq.composite_score) AS topic_score,
            (count(*))::integer AS contributing_questions,
            max(topq.score_updated_at) AS score_updated_at,
            jsonb_agg(jsonb_build_object('question_id', topq.question_id, 'question', topq.question_text, 'summary', topq.question_summary, 'tags', COALESCE(topq.question_tags, ARRAY[]::text[]), 'location_label', topq.question_location_label, 'published_at', topq.question_published_at, 'composite_score', topq.composite_score, 'rank', topq.score_rank, 'score_updated_at', topq.score_updated_at) ORDER BY topq.score_rank) AS top_questions
           FROM topq
          GROUP BY topq.canonical_topic_id
        )
 SELECT ctr.canonical_topic_id AS topic_id,
    ctr.title,
    ctr.summary,
    COALESCE(ctr.tags, ARRAY[]::text[]) AS tags,
    ctr.tier,
    ctr.location_label,
    ctr.created_at,
    COALESCE(a.topic_score, (0)::numeric) AS topic_score,
    COALESCE(a.contributing_questions, 0) AS contributing_questions,
    a.score_updated_at,
    ( SELECT params.top_n
           FROM params) AS top_n,
    COALESCE(a.top_questions, '[]'::jsonb) AS top_questions
   FROM (canonical_topic_rows ctr
     LEFT JOIN agg a ON ((a.canonical_topic_id = ctr.canonical_topic_id)));
CREATE INDEX idx_topic_pulse_mv_location_id ON public.topic_pulse_metrics_mv USING btree (location_id);
CREATE INDEX idx_topic_pulse_mv_movement_score ON public.topic_pulse_metrics_mv USING btree (movement_score DESC NULLS LAST);
CREATE INDEX idx_topic_pulse_mv_region_label ON public.topic_pulse_metrics_mv USING btree (region_label);
CREATE UNIQUE INDEX idx_topic_pulse_mv_topic_location_id ON public.topic_pulse_metrics_mv USING btree (topic_id, location_id);
grant insert on table "admin"."fn_perf" to "service_role";
grant delete on table "public"."admin_fn_perf" to "anon";
grant insert on table "public"."admin_fn_perf" to "anon";
grant references on table "public"."admin_fn_perf" to "anon";
grant select on table "public"."admin_fn_perf" to "anon";
grant trigger on table "public"."admin_fn_perf" to "anon";
grant truncate on table "public"."admin_fn_perf" to "anon";
grant update on table "public"."admin_fn_perf" to "anon";
grant delete on table "public"."admin_fn_perf" to "authenticated";
grant insert on table "public"."admin_fn_perf" to "authenticated";
grant references on table "public"."admin_fn_perf" to "authenticated";
grant select on table "public"."admin_fn_perf" to "authenticated";
grant trigger on table "public"."admin_fn_perf" to "authenticated";
grant truncate on table "public"."admin_fn_perf" to "authenticated";
grant update on table "public"."admin_fn_perf" to "authenticated";
grant delete on table "public"."admin_fn_perf" to "service_role";
grant insert on table "public"."admin_fn_perf" to "service_role";
grant references on table "public"."admin_fn_perf" to "service_role";
grant select on table "public"."admin_fn_perf" to "service_role";
grant trigger on table "public"."admin_fn_perf" to "service_role";
grant truncate on table "public"."admin_fn_perf" to "service_role";
grant update on table "public"."admin_fn_perf" to "service_role";
grant delete on table "public"."admin_users" to "anon";
grant insert on table "public"."admin_users" to "anon";
grant references on table "public"."admin_users" to "anon";
grant select on table "public"."admin_users" to "anon";
grant trigger on table "public"."admin_users" to "anon";
grant truncate on table "public"."admin_users" to "anon";
grant update on table "public"."admin_users" to "anon";
grant delete on table "public"."admin_users" to "authenticated";
grant insert on table "public"."admin_users" to "authenticated";
grant references on table "public"."admin_users" to "authenticated";
grant select on table "public"."admin_users" to "authenticated";
grant trigger on table "public"."admin_users" to "authenticated";
grant truncate on table "public"."admin_users" to "authenticated";
grant update on table "public"."admin_users" to "authenticated";
grant delete on table "public"."admin_users" to "service_role";
grant insert on table "public"."admin_users" to "service_role";
grant references on table "public"."admin_users" to "service_role";
grant select on table "public"."admin_users" to "service_role";
grant trigger on table "public"."admin_users" to "service_role";
grant truncate on table "public"."admin_users" to "service_role";
grant update on table "public"."admin_users" to "service_role";
grant delete on table "public"."ai_prompts" to "anon";
grant insert on table "public"."ai_prompts" to "anon";
grant references on table "public"."ai_prompts" to "anon";
grant select on table "public"."ai_prompts" to "anon";
grant trigger on table "public"."ai_prompts" to "anon";
grant truncate on table "public"."ai_prompts" to "anon";
grant update on table "public"."ai_prompts" to "anon";
grant delete on table "public"."ai_prompts" to "authenticated";
grant insert on table "public"."ai_prompts" to "authenticated";
grant references on table "public"."ai_prompts" to "authenticated";
grant select on table "public"."ai_prompts" to "authenticated";
grant trigger on table "public"."ai_prompts" to "authenticated";
grant truncate on table "public"."ai_prompts" to "authenticated";
grant update on table "public"."ai_prompts" to "authenticated";
grant delete on table "public"."ai_prompts" to "service_role";
grant insert on table "public"."ai_prompts" to "service_role";
grant references on table "public"."ai_prompts" to "service_role";
grant select on table "public"."ai_prompts" to "service_role";
grant trigger on table "public"."ai_prompts" to "service_role";
grant truncate on table "public"."ai_prompts" to "service_role";
grant update on table "public"."ai_prompts" to "service_role";
grant delete on table "public"."ai_question_draft_versions" to "anon";
grant insert on table "public"."ai_question_draft_versions" to "anon";
grant references on table "public"."ai_question_draft_versions" to "anon";
grant select on table "public"."ai_question_draft_versions" to "anon";
grant trigger on table "public"."ai_question_draft_versions" to "anon";
grant truncate on table "public"."ai_question_draft_versions" to "anon";
grant update on table "public"."ai_question_draft_versions" to "anon";
grant delete on table "public"."ai_question_draft_versions" to "authenticated";
grant insert on table "public"."ai_question_draft_versions" to "authenticated";
grant references on table "public"."ai_question_draft_versions" to "authenticated";
grant select on table "public"."ai_question_draft_versions" to "authenticated";
grant trigger on table "public"."ai_question_draft_versions" to "authenticated";
grant truncate on table "public"."ai_question_draft_versions" to "authenticated";
grant update on table "public"."ai_question_draft_versions" to "authenticated";
grant delete on table "public"."ai_question_draft_versions" to "service_role";
grant insert on table "public"."ai_question_draft_versions" to "service_role";
grant references on table "public"."ai_question_draft_versions" to "service_role";
grant select on table "public"."ai_question_draft_versions" to "service_role";
grant trigger on table "public"."ai_question_draft_versions" to "service_role";
grant truncate on table "public"."ai_question_draft_versions" to "service_role";
grant update on table "public"."ai_question_draft_versions" to "service_role";
grant delete on table "public"."ai_question_drafts" to "anon";
grant insert on table "public"."ai_question_drafts" to "anon";
grant references on table "public"."ai_question_drafts" to "anon";
grant select on table "public"."ai_question_drafts" to "anon";
grant trigger on table "public"."ai_question_drafts" to "anon";
grant truncate on table "public"."ai_question_drafts" to "anon";
grant update on table "public"."ai_question_drafts" to "anon";
grant delete on table "public"."ai_question_drafts" to "authenticated";
grant insert on table "public"."ai_question_drafts" to "authenticated";
grant references on table "public"."ai_question_drafts" to "authenticated";
grant select on table "public"."ai_question_drafts" to "authenticated";
grant trigger on table "public"."ai_question_drafts" to "authenticated";
grant truncate on table "public"."ai_question_drafts" to "authenticated";
grant update on table "public"."ai_question_drafts" to "authenticated";
grant delete on table "public"."ai_question_drafts" to "service_role";
grant insert on table "public"."ai_question_drafts" to "service_role";
grant references on table "public"."ai_question_drafts" to "service_role";
grant select on table "public"."ai_question_drafts" to "service_role";
grant trigger on table "public"."ai_question_drafts" to "service_role";
grant truncate on table "public"."ai_question_drafts" to "service_role";
grant update on table "public"."ai_question_drafts" to "service_role";
grant delete on table "public"."app_config_trending" to "anon";
grant insert on table "public"."app_config_trending" to "anon";
grant references on table "public"."app_config_trending" to "anon";
grant select on table "public"."app_config_trending" to "anon";
grant trigger on table "public"."app_config_trending" to "anon";
grant truncate on table "public"."app_config_trending" to "anon";
grant update on table "public"."app_config_trending" to "anon";
grant delete on table "public"."app_config_trending" to "authenticated";
grant insert on table "public"."app_config_trending" to "authenticated";
grant references on table "public"."app_config_trending" to "authenticated";
grant select on table "public"."app_config_trending" to "authenticated";
grant trigger on table "public"."app_config_trending" to "authenticated";
grant truncate on table "public"."app_config_trending" to "authenticated";
grant update on table "public"."app_config_trending" to "authenticated";
grant delete on table "public"."app_config_trending" to "service_role";
grant insert on table "public"."app_config_trending" to "service_role";
grant references on table "public"."app_config_trending" to "service_role";
grant select on table "public"."app_config_trending" to "service_role";
grant trigger on table "public"."app_config_trending" to "service_role";
grant truncate on table "public"."app_config_trending" to "service_role";
grant update on table "public"."app_config_trending" to "service_role";
grant delete on table "public"."audience_segments" to "anon";
grant insert on table "public"."audience_segments" to "anon";
grant references on table "public"."audience_segments" to "anon";
grant select on table "public"."audience_segments" to "anon";
grant trigger on table "public"."audience_segments" to "anon";
grant truncate on table "public"."audience_segments" to "anon";
grant update on table "public"."audience_segments" to "anon";
grant delete on table "public"."audience_segments" to "authenticated";
grant insert on table "public"."audience_segments" to "authenticated";
grant references on table "public"."audience_segments" to "authenticated";
grant select on table "public"."audience_segments" to "authenticated";
grant trigger on table "public"."audience_segments" to "authenticated";
grant truncate on table "public"."audience_segments" to "authenticated";
grant update on table "public"."audience_segments" to "authenticated";
grant delete on table "public"."audience_segments" to "service_role";
grant insert on table "public"."audience_segments" to "service_role";
grant references on table "public"."audience_segments" to "service_role";
grant select on table "public"."audience_segments" to "service_role";
grant trigger on table "public"."audience_segments" to "service_role";
grant truncate on table "public"."audience_segments" to "service_role";
grant update on table "public"."audience_segments" to "service_role";
grant delete on table "public"."avatars" to "anon";
grant insert on table "public"."avatars" to "anon";
grant references on table "public"."avatars" to "anon";
grant select on table "public"."avatars" to "anon";
grant trigger on table "public"."avatars" to "anon";
grant truncate on table "public"."avatars" to "anon";
grant update on table "public"."avatars" to "anon";
grant delete on table "public"."avatars" to "authenticated";
grant insert on table "public"."avatars" to "authenticated";
grant references on table "public"."avatars" to "authenticated";
grant select on table "public"."avatars" to "authenticated";
grant trigger on table "public"."avatars" to "authenticated";
grant truncate on table "public"."avatars" to "authenticated";
grant update on table "public"."avatars" to "authenticated";
grant delete on table "public"."avatars" to "service_role";
grant insert on table "public"."avatars" to "service_role";
grant references on table "public"."avatars" to "service_role";
grant select on table "public"."avatars" to "service_role";
grant trigger on table "public"."avatars" to "service_role";
grant truncate on table "public"."avatars" to "service_role";
grant update on table "public"."avatars" to "service_role";
grant delete on table "public"."backup_codes" to "anon";
grant insert on table "public"."backup_codes" to "anon";
grant references on table "public"."backup_codes" to "anon";
grant select on table "public"."backup_codes" to "anon";
grant trigger on table "public"."backup_codes" to "anon";
grant truncate on table "public"."backup_codes" to "anon";
grant update on table "public"."backup_codes" to "anon";
grant delete on table "public"."backup_codes" to "authenticated";
grant insert on table "public"."backup_codes" to "authenticated";
grant references on table "public"."backup_codes" to "authenticated";
grant select on table "public"."backup_codes" to "authenticated";
grant trigger on table "public"."backup_codes" to "authenticated";
grant truncate on table "public"."backup_codes" to "authenticated";
grant update on table "public"."backup_codes" to "authenticated";
grant delete on table "public"."backup_codes" to "service_role";
grant insert on table "public"."backup_codes" to "service_role";
grant references on table "public"."backup_codes" to "service_role";
grant select on table "public"."backup_codes" to "service_role";
grant trigger on table "public"."backup_codes" to "service_role";
grant truncate on table "public"."backup_codes" to "service_role";
grant update on table "public"."backup_codes" to "service_role";
grant delete on table "public"."cognitive_state_snapshots" to "anon";
grant insert on table "public"."cognitive_state_snapshots" to "anon";
grant references on table "public"."cognitive_state_snapshots" to "anon";
grant select on table "public"."cognitive_state_snapshots" to "anon";
grant trigger on table "public"."cognitive_state_snapshots" to "anon";
grant truncate on table "public"."cognitive_state_snapshots" to "anon";
grant update on table "public"."cognitive_state_snapshots" to "anon";
grant delete on table "public"."cognitive_state_snapshots" to "authenticated";
grant insert on table "public"."cognitive_state_snapshots" to "authenticated";
grant references on table "public"."cognitive_state_snapshots" to "authenticated";
grant select on table "public"."cognitive_state_snapshots" to "authenticated";
grant trigger on table "public"."cognitive_state_snapshots" to "authenticated";
grant truncate on table "public"."cognitive_state_snapshots" to "authenticated";
grant update on table "public"."cognitive_state_snapshots" to "authenticated";
grant delete on table "public"."cognitive_state_snapshots" to "service_role";
grant insert on table "public"."cognitive_state_snapshots" to "service_role";
grant references on table "public"."cognitive_state_snapshots" to "service_role";
grant select on table "public"."cognitive_state_snapshots" to "service_role";
grant trigger on table "public"."cognitive_state_snapshots" to "service_role";
grant truncate on table "public"."cognitive_state_snapshots" to "service_role";
grant update on table "public"."cognitive_state_snapshots" to "service_role";
grant delete on table "public"."comment_reactions" to "anon";
grant insert on table "public"."comment_reactions" to "anon";
grant references on table "public"."comment_reactions" to "anon";
grant select on table "public"."comment_reactions" to "anon";
grant trigger on table "public"."comment_reactions" to "anon";
grant truncate on table "public"."comment_reactions" to "anon";
grant update on table "public"."comment_reactions" to "anon";
grant delete on table "public"."comment_reactions" to "authenticated";
grant insert on table "public"."comment_reactions" to "authenticated";
grant references on table "public"."comment_reactions" to "authenticated";
grant select on table "public"."comment_reactions" to "authenticated";
grant trigger on table "public"."comment_reactions" to "authenticated";
grant truncate on table "public"."comment_reactions" to "authenticated";
grant update on table "public"."comment_reactions" to "authenticated";
grant delete on table "public"."comment_reactions" to "service_role";
grant insert on table "public"."comment_reactions" to "service_role";
grant references on table "public"."comment_reactions" to "service_role";
grant select on table "public"."comment_reactions" to "service_role";
grant trigger on table "public"."comment_reactions" to "service_role";
grant truncate on table "public"."comment_reactions" to "service_role";
grant update on table "public"."comment_reactions" to "service_role";
grant delete on table "public"."comment_reports" to "anon";
grant insert on table "public"."comment_reports" to "anon";
grant references on table "public"."comment_reports" to "anon";
grant select on table "public"."comment_reports" to "anon";
grant trigger on table "public"."comment_reports" to "anon";
grant truncate on table "public"."comment_reports" to "anon";
grant update on table "public"."comment_reports" to "anon";
grant delete on table "public"."comment_reports" to "authenticated";
grant insert on table "public"."comment_reports" to "authenticated";
grant references on table "public"."comment_reports" to "authenticated";
grant select on table "public"."comment_reports" to "authenticated";
grant trigger on table "public"."comment_reports" to "authenticated";
grant truncate on table "public"."comment_reports" to "authenticated";
grant update on table "public"."comment_reports" to "authenticated";
grant delete on table "public"."comment_reports" to "service_role";
grant insert on table "public"."comment_reports" to "service_role";
grant references on table "public"."comment_reports" to "service_role";
grant select on table "public"."comment_reports" to "service_role";
grant trigger on table "public"."comment_reports" to "service_role";
grant truncate on table "public"."comment_reports" to "service_role";
grant update on table "public"."comment_reports" to "service_role";
grant delete on table "public"."comments" to "anon";
grant insert on table "public"."comments" to "anon";
grant references on table "public"."comments" to "anon";
grant select on table "public"."comments" to "anon";
grant trigger on table "public"."comments" to "anon";
grant truncate on table "public"."comments" to "anon";
grant update on table "public"."comments" to "anon";
grant delete on table "public"."comments" to "authenticated";
grant insert on table "public"."comments" to "authenticated";
grant references on table "public"."comments" to "authenticated";
grant select on table "public"."comments" to "authenticated";
grant trigger on table "public"."comments" to "authenticated";
grant truncate on table "public"."comments" to "authenticated";
grant update on table "public"."comments" to "authenticated";
grant delete on table "public"."comments" to "service_role";
grant insert on table "public"."comments" to "service_role";
grant references on table "public"."comments" to "service_role";
grant select on table "public"."comments" to "service_role";
grant trigger on table "public"."comments" to "service_role";
grant truncate on table "public"."comments" to "service_role";
grant update on table "public"."comments" to "service_role";
grant delete on table "public"."community_trends" to "anon";
grant insert on table "public"."community_trends" to "anon";
grant references on table "public"."community_trends" to "anon";
grant select on table "public"."community_trends" to "anon";
grant trigger on table "public"."community_trends" to "anon";
grant truncate on table "public"."community_trends" to "anon";
grant update on table "public"."community_trends" to "anon";
grant delete on table "public"."community_trends" to "authenticated";
grant insert on table "public"."community_trends" to "authenticated";
grant references on table "public"."community_trends" to "authenticated";
grant select on table "public"."community_trends" to "authenticated";
grant trigger on table "public"."community_trends" to "authenticated";
grant truncate on table "public"."community_trends" to "authenticated";
grant update on table "public"."community_trends" to "authenticated";
grant delete on table "public"."community_trends" to "service_role";
grant insert on table "public"."community_trends" to "service_role";
grant references on table "public"."community_trends" to "service_role";
grant select on table "public"."community_trends" to "service_role";
grant trigger on table "public"."community_trends" to "service_role";
grant truncate on table "public"."community_trends" to "service_role";
grant update on table "public"."community_trends" to "service_role";
grant delete on table "public"."consent_logs" to "anon";
grant insert on table "public"."consent_logs" to "anon";
grant references on table "public"."consent_logs" to "anon";
grant select on table "public"."consent_logs" to "anon";
grant trigger on table "public"."consent_logs" to "anon";
grant truncate on table "public"."consent_logs" to "anon";
grant update on table "public"."consent_logs" to "anon";
grant delete on table "public"."consent_logs" to "authenticated";
grant insert on table "public"."consent_logs" to "authenticated";
grant references on table "public"."consent_logs" to "authenticated";
grant select on table "public"."consent_logs" to "authenticated";
grant trigger on table "public"."consent_logs" to "authenticated";
grant truncate on table "public"."consent_logs" to "authenticated";
grant update on table "public"."consent_logs" to "authenticated";
grant delete on table "public"."consent_logs" to "service_role";
grant insert on table "public"."consent_logs" to "service_role";
grant references on table "public"."consent_logs" to "service_role";
grant select on table "public"."consent_logs" to "service_role";
grant trigger on table "public"."consent_logs" to "service_role";
grant truncate on table "public"."consent_logs" to "service_role";
grant update on table "public"."consent_logs" to "service_role";
grant delete on table "public"."contribution_acknowledgements" to "anon";
grant insert on table "public"."contribution_acknowledgements" to "anon";
grant references on table "public"."contribution_acknowledgements" to "anon";
grant select on table "public"."contribution_acknowledgements" to "anon";
grant trigger on table "public"."contribution_acknowledgements" to "anon";
grant truncate on table "public"."contribution_acknowledgements" to "anon";
grant update on table "public"."contribution_acknowledgements" to "anon";
grant delete on table "public"."contribution_acknowledgements" to "authenticated";
grant insert on table "public"."contribution_acknowledgements" to "authenticated";
grant references on table "public"."contribution_acknowledgements" to "authenticated";
grant select on table "public"."contribution_acknowledgements" to "authenticated";
grant trigger on table "public"."contribution_acknowledgements" to "authenticated";
grant truncate on table "public"."contribution_acknowledgements" to "authenticated";
grant update on table "public"."contribution_acknowledgements" to "authenticated";
grant delete on table "public"."contribution_acknowledgements" to "service_role";
grant insert on table "public"."contribution_acknowledgements" to "service_role";
grant references on table "public"."contribution_acknowledgements" to "service_role";
grant select on table "public"."contribution_acknowledgements" to "service_role";
grant trigger on table "public"."contribution_acknowledgements" to "service_role";
grant truncate on table "public"."contribution_acknowledgements" to "service_role";
grant update on table "public"."contribution_acknowledgements" to "service_role";
grant delete on table "public"."daily_curated_questions" to "anon";
grant insert on table "public"."daily_curated_questions" to "anon";
grant references on table "public"."daily_curated_questions" to "anon";
grant select on table "public"."daily_curated_questions" to "anon";
grant trigger on table "public"."daily_curated_questions" to "anon";
grant truncate on table "public"."daily_curated_questions" to "anon";
grant update on table "public"."daily_curated_questions" to "anon";
grant delete on table "public"."daily_curated_questions" to "authenticated";
grant insert on table "public"."daily_curated_questions" to "authenticated";
grant references on table "public"."daily_curated_questions" to "authenticated";
grant select on table "public"."daily_curated_questions" to "authenticated";
grant trigger on table "public"."daily_curated_questions" to "authenticated";
grant truncate on table "public"."daily_curated_questions" to "authenticated";
grant update on table "public"."daily_curated_questions" to "authenticated";
grant delete on table "public"."daily_curated_questions" to "service_role";
grant insert on table "public"."daily_curated_questions" to "service_role";
grant references on table "public"."daily_curated_questions" to "service_role";
grant select on table "public"."daily_curated_questions" to "service_role";
grant trigger on table "public"."daily_curated_questions" to "service_role";
grant truncate on table "public"."daily_curated_questions" to "service_role";
grant update on table "public"."daily_curated_questions" to "service_role";
grant delete on table "public"."deletion_requests" to "anon";
grant insert on table "public"."deletion_requests" to "anon";
grant references on table "public"."deletion_requests" to "anon";
grant select on table "public"."deletion_requests" to "anon";
grant trigger on table "public"."deletion_requests" to "anon";
grant truncate on table "public"."deletion_requests" to "anon";
grant update on table "public"."deletion_requests" to "anon";
grant delete on table "public"."deletion_requests" to "authenticated";
grant insert on table "public"."deletion_requests" to "authenticated";
grant references on table "public"."deletion_requests" to "authenticated";
grant select on table "public"."deletion_requests" to "authenticated";
grant trigger on table "public"."deletion_requests" to "authenticated";
grant truncate on table "public"."deletion_requests" to "authenticated";
grant update on table "public"."deletion_requests" to "authenticated";
grant delete on table "public"."deletion_requests" to "service_role";
grant insert on table "public"."deletion_requests" to "service_role";
grant references on table "public"."deletion_requests" to "service_role";
grant select on table "public"."deletion_requests" to "service_role";
grant trigger on table "public"."deletion_requests" to "service_role";
grant truncate on table "public"."deletion_requests" to "service_role";
grant update on table "public"."deletion_requests" to "service_role";
grant delete on table "public"."demographic_breakdowns" to "anon";
grant insert on table "public"."demographic_breakdowns" to "anon";
grant references on table "public"."demographic_breakdowns" to "anon";
grant select on table "public"."demographic_breakdowns" to "anon";
grant trigger on table "public"."demographic_breakdowns" to "anon";
grant truncate on table "public"."demographic_breakdowns" to "anon";
grant update on table "public"."demographic_breakdowns" to "anon";
grant delete on table "public"."demographic_breakdowns" to "authenticated";
grant insert on table "public"."demographic_breakdowns" to "authenticated";
grant references on table "public"."demographic_breakdowns" to "authenticated";
grant select on table "public"."demographic_breakdowns" to "authenticated";
grant trigger on table "public"."demographic_breakdowns" to "authenticated";
grant truncate on table "public"."demographic_breakdowns" to "authenticated";
grant update on table "public"."demographic_breakdowns" to "authenticated";
grant delete on table "public"."demographic_breakdowns" to "service_role";
grant insert on table "public"."demographic_breakdowns" to "service_role";
grant references on table "public"."demographic_breakdowns" to "service_role";
grant select on table "public"."demographic_breakdowns" to "service_role";
grant trigger on table "public"."demographic_breakdowns" to "service_role";
grant truncate on table "public"."demographic_breakdowns" to "service_role";
grant update on table "public"."demographic_breakdowns" to "service_role";
grant delete on table "public"."devices" to "anon";
grant insert on table "public"."devices" to "anon";
grant references on table "public"."devices" to "anon";
grant select on table "public"."devices" to "anon";
grant trigger on table "public"."devices" to "anon";
grant truncate on table "public"."devices" to "anon";
grant update on table "public"."devices" to "anon";
grant delete on table "public"."devices" to "authenticated";
grant insert on table "public"."devices" to "authenticated";
grant references on table "public"."devices" to "authenticated";
grant select on table "public"."devices" to "authenticated";
grant trigger on table "public"."devices" to "authenticated";
grant truncate on table "public"."devices" to "authenticated";
grant update on table "public"."devices" to "authenticated";
grant delete on table "public"."devices" to "service_role";
grant insert on table "public"."devices" to "service_role";
grant references on table "public"."devices" to "service_role";
grant select on table "public"."devices" to "service_role";
grant trigger on table "public"."devices" to "service_role";
grant truncate on table "public"."devices" to "service_role";
grant update on table "public"."devices" to "service_role";
grant delete on table "public"."election_anomaly_events" to "anon";
grant insert on table "public"."election_anomaly_events" to "anon";
grant references on table "public"."election_anomaly_events" to "anon";
grant select on table "public"."election_anomaly_events" to "anon";
grant trigger on table "public"."election_anomaly_events" to "anon";
grant truncate on table "public"."election_anomaly_events" to "anon";
grant update on table "public"."election_anomaly_events" to "anon";
grant delete on table "public"."election_anomaly_events" to "authenticated";
grant insert on table "public"."election_anomaly_events" to "authenticated";
grant references on table "public"."election_anomaly_events" to "authenticated";
grant select on table "public"."election_anomaly_events" to "authenticated";
grant trigger on table "public"."election_anomaly_events" to "authenticated";
grant truncate on table "public"."election_anomaly_events" to "authenticated";
grant update on table "public"."election_anomaly_events" to "authenticated";
grant delete on table "public"."election_anomaly_events" to "service_role";
grant insert on table "public"."election_anomaly_events" to "service_role";
grant references on table "public"."election_anomaly_events" to "service_role";
grant select on table "public"."election_anomaly_events" to "service_role";
grant trigger on table "public"."election_anomaly_events" to "service_role";
grant truncate on table "public"."election_anomaly_events" to "service_role";
grant update on table "public"."election_anomaly_events" to "service_role";
grant delete on table "public"."election_audit_log" to "anon";
grant insert on table "public"."election_audit_log" to "anon";
grant references on table "public"."election_audit_log" to "anon";
grant select on table "public"."election_audit_log" to "anon";
grant trigger on table "public"."election_audit_log" to "anon";
grant truncate on table "public"."election_audit_log" to "anon";
grant update on table "public"."election_audit_log" to "anon";
grant delete on table "public"."election_audit_log" to "authenticated";
grant insert on table "public"."election_audit_log" to "authenticated";
grant references on table "public"."election_audit_log" to "authenticated";
grant select on table "public"."election_audit_log" to "authenticated";
grant trigger on table "public"."election_audit_log" to "authenticated";
grant truncate on table "public"."election_audit_log" to "authenticated";
grant update on table "public"."election_audit_log" to "authenticated";
grant delete on table "public"."election_audit_log" to "service_role";
grant insert on table "public"."election_audit_log" to "service_role";
grant references on table "public"."election_audit_log" to "service_role";
grant select on table "public"."election_audit_log" to "service_role";
grant trigger on table "public"."election_audit_log" to "service_role";
grant truncate on table "public"."election_audit_log" to "service_role";
grant update on table "public"."election_audit_log" to "service_role";
grant delete on table "public"."election_candidates" to "anon";
grant insert on table "public"."election_candidates" to "anon";
grant references on table "public"."election_candidates" to "anon";
grant select on table "public"."election_candidates" to "anon";
grant trigger on table "public"."election_candidates" to "anon";
grant truncate on table "public"."election_candidates" to "anon";
grant update on table "public"."election_candidates" to "anon";
grant delete on table "public"."election_candidates" to "authenticated";
grant insert on table "public"."election_candidates" to "authenticated";
grant references on table "public"."election_candidates" to "authenticated";
grant select on table "public"."election_candidates" to "authenticated";
grant trigger on table "public"."election_candidates" to "authenticated";
grant truncate on table "public"."election_candidates" to "authenticated";
grant update on table "public"."election_candidates" to "authenticated";
grant delete on table "public"."election_candidates" to "service_role";
grant insert on table "public"."election_candidates" to "service_role";
grant references on table "public"."election_candidates" to "service_role";
grant select on table "public"."election_candidates" to "service_role";
grant trigger on table "public"."election_candidates" to "service_role";
grant truncate on table "public"."election_candidates" to "service_role";
grant update on table "public"."election_candidates" to "service_role";
grant delete on table "public"."election_compliance_rules" to "anon";
grant insert on table "public"."election_compliance_rules" to "anon";
grant references on table "public"."election_compliance_rules" to "anon";
grant select on table "public"."election_compliance_rules" to "anon";
grant trigger on table "public"."election_compliance_rules" to "anon";
grant truncate on table "public"."election_compliance_rules" to "anon";
grant update on table "public"."election_compliance_rules" to "anon";
grant delete on table "public"."election_compliance_rules" to "authenticated";
grant insert on table "public"."election_compliance_rules" to "authenticated";
grant references on table "public"."election_compliance_rules" to "authenticated";
grant select on table "public"."election_compliance_rules" to "authenticated";
grant trigger on table "public"."election_compliance_rules" to "authenticated";
grant truncate on table "public"."election_compliance_rules" to "authenticated";
grant update on table "public"."election_compliance_rules" to "authenticated";
grant delete on table "public"."election_compliance_rules" to "service_role";
grant insert on table "public"."election_compliance_rules" to "service_role";
grant references on table "public"."election_compliance_rules" to "service_role";
grant select on table "public"."election_compliance_rules" to "service_role";
grant trigger on table "public"."election_compliance_rules" to "service_role";
grant truncate on table "public"."election_compliance_rules" to "service_role";
grant update on table "public"."election_compliance_rules" to "service_role";
grant delete on table "public"."election_constituencies" to "anon";
grant insert on table "public"."election_constituencies" to "anon";
grant references on table "public"."election_constituencies" to "anon";
grant select on table "public"."election_constituencies" to "anon";
grant trigger on table "public"."election_constituencies" to "anon";
grant truncate on table "public"."election_constituencies" to "anon";
grant update on table "public"."election_constituencies" to "anon";
grant delete on table "public"."election_constituencies" to "authenticated";
grant insert on table "public"."election_constituencies" to "authenticated";
grant references on table "public"."election_constituencies" to "authenticated";
grant select on table "public"."election_constituencies" to "authenticated";
grant trigger on table "public"."election_constituencies" to "authenticated";
grant truncate on table "public"."election_constituencies" to "authenticated";
grant update on table "public"."election_constituencies" to "authenticated";
grant delete on table "public"."election_constituencies" to "service_role";
grant insert on table "public"."election_constituencies" to "service_role";
grant references on table "public"."election_constituencies" to "service_role";
grant select on table "public"."election_constituencies" to "service_role";
grant trigger on table "public"."election_constituencies" to "service_role";
grant truncate on table "public"."election_constituencies" to "service_role";
grant update on table "public"."election_constituencies" to "service_role";
grant delete on table "public"."election_issue_tag_allowlists" to "anon";
grant insert on table "public"."election_issue_tag_allowlists" to "anon";
grant references on table "public"."election_issue_tag_allowlists" to "anon";
grant select on table "public"."election_issue_tag_allowlists" to "anon";
grant trigger on table "public"."election_issue_tag_allowlists" to "anon";
grant truncate on table "public"."election_issue_tag_allowlists" to "anon";
grant update on table "public"."election_issue_tag_allowlists" to "anon";
grant delete on table "public"."election_issue_tag_allowlists" to "authenticated";
grant insert on table "public"."election_issue_tag_allowlists" to "authenticated";
grant references on table "public"."election_issue_tag_allowlists" to "authenticated";
grant select on table "public"."election_issue_tag_allowlists" to "authenticated";
grant trigger on table "public"."election_issue_tag_allowlists" to "authenticated";
grant truncate on table "public"."election_issue_tag_allowlists" to "authenticated";
grant update on table "public"."election_issue_tag_allowlists" to "authenticated";
grant delete on table "public"."election_issue_tag_allowlists" to "service_role";
grant insert on table "public"."election_issue_tag_allowlists" to "service_role";
grant references on table "public"."election_issue_tag_allowlists" to "service_role";
grant select on table "public"."election_issue_tag_allowlists" to "service_role";
grant trigger on table "public"."election_issue_tag_allowlists" to "service_role";
grant truncate on table "public"."election_issue_tag_allowlists" to "service_role";
grant update on table "public"."election_issue_tag_allowlists" to "service_role";
grant delete on table "public"."election_parties" to "anon";
grant insert on table "public"."election_parties" to "anon";
grant references on table "public"."election_parties" to "anon";
grant select on table "public"."election_parties" to "anon";
grant trigger on table "public"."election_parties" to "anon";
grant truncate on table "public"."election_parties" to "anon";
grant update on table "public"."election_parties" to "anon";
grant delete on table "public"."election_parties" to "authenticated";
grant insert on table "public"."election_parties" to "authenticated";
grant references on table "public"."election_parties" to "authenticated";
grant select on table "public"."election_parties" to "authenticated";
grant trigger on table "public"."election_parties" to "authenticated";
grant truncate on table "public"."election_parties" to "authenticated";
grant update on table "public"."election_parties" to "authenticated";
grant delete on table "public"."election_parties" to "service_role";
grant insert on table "public"."election_parties" to "service_role";
grant references on table "public"."election_parties" to "service_role";
grant select on table "public"."election_parties" to "service_role";
grant trigger on table "public"."election_parties" to "service_role";
grant truncate on table "public"."election_parties" to "service_role";
grant update on table "public"."election_parties" to "service_role";
grant delete on table "public"."election_party_elections" to "anon";
grant insert on table "public"."election_party_elections" to "anon";
grant references on table "public"."election_party_elections" to "anon";
grant select on table "public"."election_party_elections" to "anon";
grant trigger on table "public"."election_party_elections" to "anon";
grant truncate on table "public"."election_party_elections" to "anon";
grant update on table "public"."election_party_elections" to "anon";
grant delete on table "public"."election_party_elections" to "authenticated";
grant insert on table "public"."election_party_elections" to "authenticated";
grant references on table "public"."election_party_elections" to "authenticated";
grant select on table "public"."election_party_elections" to "authenticated";
grant trigger on table "public"."election_party_elections" to "authenticated";
grant truncate on table "public"."election_party_elections" to "authenticated";
grant update on table "public"."election_party_elections" to "authenticated";
grant delete on table "public"."election_party_elections" to "service_role";
grant insert on table "public"."election_party_elections" to "service_role";
grant references on table "public"."election_party_elections" to "service_role";
grant select on table "public"."election_party_elections" to "service_role";
grant trigger on table "public"."election_party_elections" to "service_role";
grant truncate on table "public"."election_party_elections" to "service_role";
grant update on table "public"."election_party_elections" to "service_role";
grant delete on table "public"."election_party_regions" to "anon";
grant insert on table "public"."election_party_regions" to "anon";
grant references on table "public"."election_party_regions" to "anon";
grant select on table "public"."election_party_regions" to "anon";
grant trigger on table "public"."election_party_regions" to "anon";
grant truncate on table "public"."election_party_regions" to "anon";
grant update on table "public"."election_party_regions" to "anon";
grant delete on table "public"."election_party_regions" to "authenticated";
grant insert on table "public"."election_party_regions" to "authenticated";
grant references on table "public"."election_party_regions" to "authenticated";
grant select on table "public"."election_party_regions" to "authenticated";
grant trigger on table "public"."election_party_regions" to "authenticated";
grant truncate on table "public"."election_party_regions" to "authenticated";
grant update on table "public"."election_party_regions" to "authenticated";
grant delete on table "public"."election_party_regions" to "service_role";
grant insert on table "public"."election_party_regions" to "service_role";
grant references on table "public"."election_party_regions" to "service_role";
grant select on table "public"."election_party_regions" to "service_role";
grant trigger on table "public"."election_party_regions" to "service_role";
grant truncate on table "public"."election_party_regions" to "service_role";
grant update on table "public"."election_party_regions" to "service_role";
grant delete on table "public"."election_question_drafts" to "anon";
grant insert on table "public"."election_question_drafts" to "anon";
grant references on table "public"."election_question_drafts" to "anon";
grant select on table "public"."election_question_drafts" to "anon";
grant trigger on table "public"."election_question_drafts" to "anon";
grant truncate on table "public"."election_question_drafts" to "anon";
grant update on table "public"."election_question_drafts" to "anon";
grant delete on table "public"."election_question_drafts" to "authenticated";
grant insert on table "public"."election_question_drafts" to "authenticated";
grant references on table "public"."election_question_drafts" to "authenticated";
grant select on table "public"."election_question_drafts" to "authenticated";
grant trigger on table "public"."election_question_drafts" to "authenticated";
grant truncate on table "public"."election_question_drafts" to "authenticated";
grant update on table "public"."election_question_drafts" to "authenticated";
grant delete on table "public"."election_question_drafts" to "service_role";
grant insert on table "public"."election_question_drafts" to "service_role";
grant references on table "public"."election_question_drafts" to "service_role";
grant select on table "public"."election_question_drafts" to "service_role";
grant trigger on table "public"."election_question_drafts" to "service_role";
grant truncate on table "public"."election_question_drafts" to "service_role";
grant update on table "public"."election_question_drafts" to "service_role";
grant delete on table "public"."election_source_documents" to "anon";
grant insert on table "public"."election_source_documents" to "anon";
grant references on table "public"."election_source_documents" to "anon";
grant select on table "public"."election_source_documents" to "anon";
grant trigger on table "public"."election_source_documents" to "anon";
grant truncate on table "public"."election_source_documents" to "anon";
grant update on table "public"."election_source_documents" to "anon";
grant delete on table "public"."election_source_documents" to "authenticated";
grant insert on table "public"."election_source_documents" to "authenticated";
grant references on table "public"."election_source_documents" to "authenticated";
grant select on table "public"."election_source_documents" to "authenticated";
grant trigger on table "public"."election_source_documents" to "authenticated";
grant truncate on table "public"."election_source_documents" to "authenticated";
grant update on table "public"."election_source_documents" to "authenticated";
grant delete on table "public"."election_source_documents" to "service_role";
grant insert on table "public"."election_source_documents" to "service_role";
grant references on table "public"."election_source_documents" to "service_role";
grant select on table "public"."election_source_documents" to "service_role";
grant trigger on table "public"."election_source_documents" to "service_role";
grant truncate on table "public"."election_source_documents" to "service_role";
grant update on table "public"."election_source_documents" to "service_role";
grant delete on table "public"."election_stance_aggregates" to "anon";
grant insert on table "public"."election_stance_aggregates" to "anon";
grant references on table "public"."election_stance_aggregates" to "anon";
grant select on table "public"."election_stance_aggregates" to "anon";
grant trigger on table "public"."election_stance_aggregates" to "anon";
grant truncate on table "public"."election_stance_aggregates" to "anon";
grant update on table "public"."election_stance_aggregates" to "anon";
grant delete on table "public"."election_stance_aggregates" to "authenticated";
grant insert on table "public"."election_stance_aggregates" to "authenticated";
grant references on table "public"."election_stance_aggregates" to "authenticated";
grant select on table "public"."election_stance_aggregates" to "authenticated";
grant trigger on table "public"."election_stance_aggregates" to "authenticated";
grant truncate on table "public"."election_stance_aggregates" to "authenticated";
grant update on table "public"."election_stance_aggregates" to "authenticated";
grant delete on table "public"."election_stance_aggregates" to "service_role";
grant insert on table "public"."election_stance_aggregates" to "service_role";
grant references on table "public"."election_stance_aggregates" to "service_role";
grant select on table "public"."election_stance_aggregates" to "service_role";
grant trigger on table "public"."election_stance_aggregates" to "service_role";
grant truncate on table "public"."election_stance_aggregates" to "service_role";
grant update on table "public"."election_stance_aggregates" to "service_role";
grant delete on table "public"."election_tiers" to "anon";
grant insert on table "public"."election_tiers" to "anon";
grant references on table "public"."election_tiers" to "anon";
grant select on table "public"."election_tiers" to "anon";
grant trigger on table "public"."election_tiers" to "anon";
grant truncate on table "public"."election_tiers" to "anon";
grant update on table "public"."election_tiers" to "anon";
grant delete on table "public"."election_tiers" to "authenticated";
grant insert on table "public"."election_tiers" to "authenticated";
grant references on table "public"."election_tiers" to "authenticated";
grant select on table "public"."election_tiers" to "authenticated";
grant trigger on table "public"."election_tiers" to "authenticated";
grant truncate on table "public"."election_tiers" to "authenticated";
grant update on table "public"."election_tiers" to "authenticated";
grant delete on table "public"."election_tiers" to "service_role";
grant insert on table "public"."election_tiers" to "service_role";
grant references on table "public"."election_tiers" to "service_role";
grant select on table "public"."election_tiers" to "service_role";
grant trigger on table "public"."election_tiers" to "service_role";
grant truncate on table "public"."election_tiers" to "service_role";
grant update on table "public"."election_tiers" to "service_role";
grant delete on table "public"."elections" to "anon";
grant insert on table "public"."elections" to "anon";
grant references on table "public"."elections" to "anon";
grant select on table "public"."elections" to "anon";
grant trigger on table "public"."elections" to "anon";
grant truncate on table "public"."elections" to "anon";
grant update on table "public"."elections" to "anon";
grant delete on table "public"."elections" to "authenticated";
grant insert on table "public"."elections" to "authenticated";
grant references on table "public"."elections" to "authenticated";
grant select on table "public"."elections" to "authenticated";
grant trigger on table "public"."elections" to "authenticated";
grant truncate on table "public"."elections" to "authenticated";
grant update on table "public"."elections" to "authenticated";
grant delete on table "public"."elections" to "service_role";
grant insert on table "public"."elections" to "service_role";
grant references on table "public"."elections" to "service_role";
grant select on table "public"."elections" to "service_role";
grant trigger on table "public"."elections" to "service_role";
grant truncate on table "public"."elections" to "service_role";
grant update on table "public"."elections" to "service_role";
grant delete on table "public"."email_events" to "anon";
grant insert on table "public"."email_events" to "anon";
grant references on table "public"."email_events" to "anon";
grant select on table "public"."email_events" to "anon";
grant trigger on table "public"."email_events" to "anon";
grant truncate on table "public"."email_events" to "anon";
grant update on table "public"."email_events" to "anon";
grant delete on table "public"."email_events" to "authenticated";
grant insert on table "public"."email_events" to "authenticated";
grant references on table "public"."email_events" to "authenticated";
grant select on table "public"."email_events" to "authenticated";
grant trigger on table "public"."email_events" to "authenticated";
grant truncate on table "public"."email_events" to "authenticated";
grant update on table "public"."email_events" to "authenticated";
grant delete on table "public"."email_events" to "service_role";
grant insert on table "public"."email_events" to "service_role";
grant references on table "public"."email_events" to "service_role";
grant select on table "public"."email_events" to "service_role";
grant trigger on table "public"."email_events" to "service_role";
grant truncate on table "public"."email_events" to "service_role";
grant update on table "public"."email_events" to "service_role";
grant delete on table "public"."embed_cta_events" to "anon";
grant insert on table "public"."embed_cta_events" to "anon";
grant references on table "public"."embed_cta_events" to "anon";
grant select on table "public"."embed_cta_events" to "anon";
grant trigger on table "public"."embed_cta_events" to "anon";
grant truncate on table "public"."embed_cta_events" to "anon";
grant update on table "public"."embed_cta_events" to "anon";
grant delete on table "public"."embed_cta_events" to "authenticated";
grant insert on table "public"."embed_cta_events" to "authenticated";
grant references on table "public"."embed_cta_events" to "authenticated";
grant select on table "public"."embed_cta_events" to "authenticated";
grant trigger on table "public"."embed_cta_events" to "authenticated";
grant truncate on table "public"."embed_cta_events" to "authenticated";
grant update on table "public"."embed_cta_events" to "authenticated";
grant delete on table "public"."embed_cta_events" to "service_role";
grant insert on table "public"."embed_cta_events" to "service_role";
grant references on table "public"."embed_cta_events" to "service_role";
grant select on table "public"."embed_cta_events" to "service_role";
grant trigger on table "public"."embed_cta_events" to "service_role";
grant truncate on table "public"."embed_cta_events" to "service_role";
grant update on table "public"."embed_cta_events" to "service_role";
grant delete on table "public"."embed_impressions" to "anon";
grant insert on table "public"."embed_impressions" to "anon";
grant references on table "public"."embed_impressions" to "anon";
grant select on table "public"."embed_impressions" to "anon";
grant trigger on table "public"."embed_impressions" to "anon";
grant truncate on table "public"."embed_impressions" to "anon";
grant update on table "public"."embed_impressions" to "anon";
grant delete on table "public"."embed_impressions" to "authenticated";
grant insert on table "public"."embed_impressions" to "authenticated";
grant references on table "public"."embed_impressions" to "authenticated";
grant select on table "public"."embed_impressions" to "authenticated";
grant trigger on table "public"."embed_impressions" to "authenticated";
grant truncate on table "public"."embed_impressions" to "authenticated";
grant update on table "public"."embed_impressions" to "authenticated";
grant delete on table "public"."embed_impressions" to "service_role";
grant insert on table "public"."embed_impressions" to "service_role";
grant references on table "public"."embed_impressions" to "service_role";
grant select on table "public"."embed_impressions" to "service_role";
grant trigger on table "public"."embed_impressions" to "service_role";
grant truncate on table "public"."embed_impressions" to "service_role";
grant update on table "public"."embed_impressions" to "service_role";
grant delete on table "public"."embed_rate_limits" to "anon";
grant insert on table "public"."embed_rate_limits" to "anon";
grant references on table "public"."embed_rate_limits" to "anon";
grant select on table "public"."embed_rate_limits" to "anon";
grant trigger on table "public"."embed_rate_limits" to "anon";
grant truncate on table "public"."embed_rate_limits" to "anon";
grant update on table "public"."embed_rate_limits" to "anon";
grant delete on table "public"."embed_rate_limits" to "authenticated";
grant insert on table "public"."embed_rate_limits" to "authenticated";
grant references on table "public"."embed_rate_limits" to "authenticated";
grant select on table "public"."embed_rate_limits" to "authenticated";
grant trigger on table "public"."embed_rate_limits" to "authenticated";
grant truncate on table "public"."embed_rate_limits" to "authenticated";
grant update on table "public"."embed_rate_limits" to "authenticated";
grant delete on table "public"."embed_rate_limits" to "service_role";
grant insert on table "public"."embed_rate_limits" to "service_role";
grant references on table "public"."embed_rate_limits" to "service_role";
grant select on table "public"."embed_rate_limits" to "service_role";
grant trigger on table "public"."embed_rate_limits" to "service_role";
grant truncate on table "public"."embed_rate_limits" to "service_role";
grant update on table "public"."embed_rate_limits" to "service_role";
grant delete on table "public"."embed_snippet_versions" to "anon";
grant insert on table "public"."embed_snippet_versions" to "anon";
grant references on table "public"."embed_snippet_versions" to "anon";
grant select on table "public"."embed_snippet_versions" to "anon";
grant trigger on table "public"."embed_snippet_versions" to "anon";
grant truncate on table "public"."embed_snippet_versions" to "anon";
grant update on table "public"."embed_snippet_versions" to "anon";
grant delete on table "public"."embed_snippet_versions" to "authenticated";
grant insert on table "public"."embed_snippet_versions" to "authenticated";
grant references on table "public"."embed_snippet_versions" to "authenticated";
grant select on table "public"."embed_snippet_versions" to "authenticated";
grant trigger on table "public"."embed_snippet_versions" to "authenticated";
grant truncate on table "public"."embed_snippet_versions" to "authenticated";
grant update on table "public"."embed_snippet_versions" to "authenticated";
grant delete on table "public"."embed_snippet_versions" to "service_role";
grant insert on table "public"."embed_snippet_versions" to "service_role";
grant references on table "public"."embed_snippet_versions" to "service_role";
grant select on table "public"."embed_snippet_versions" to "service_role";
grant trigger on table "public"."embed_snippet_versions" to "service_role";
grant truncate on table "public"."embed_snippet_versions" to "service_role";
grant update on table "public"."embed_snippet_versions" to "service_role";
grant delete on table "public"."embedded_stances" to "anon";
grant insert on table "public"."embedded_stances" to "anon";
grant references on table "public"."embedded_stances" to "anon";
grant select on table "public"."embedded_stances" to "anon";
grant trigger on table "public"."embedded_stances" to "anon";
grant truncate on table "public"."embedded_stances" to "anon";
grant update on table "public"."embedded_stances" to "anon";
grant delete on table "public"."embedded_stances" to "authenticated";
grant insert on table "public"."embedded_stances" to "authenticated";
grant references on table "public"."embedded_stances" to "authenticated";
grant select on table "public"."embedded_stances" to "authenticated";
grant trigger on table "public"."embedded_stances" to "authenticated";
grant truncate on table "public"."embedded_stances" to "authenticated";
grant update on table "public"."embedded_stances" to "authenticated";
grant delete on table "public"."embedded_stances" to "service_role";
grant insert on table "public"."embedded_stances" to "service_role";
grant references on table "public"."embedded_stances" to "service_role";
grant select on table "public"."embedded_stances" to "service_role";
grant trigger on table "public"."embedded_stances" to "service_role";
grant truncate on table "public"."embedded_stances" to "service_role";
grant update on table "public"."embedded_stances" to "service_role";
grant delete on table "public"."feed_policies" to "anon";
grant insert on table "public"."feed_policies" to "anon";
grant references on table "public"."feed_policies" to "anon";
grant select on table "public"."feed_policies" to "anon";
grant trigger on table "public"."feed_policies" to "anon";
grant truncate on table "public"."feed_policies" to "anon";
grant update on table "public"."feed_policies" to "anon";
grant delete on table "public"."feed_policies" to "authenticated";
grant insert on table "public"."feed_policies" to "authenticated";
grant references on table "public"."feed_policies" to "authenticated";
grant select on table "public"."feed_policies" to "authenticated";
grant trigger on table "public"."feed_policies" to "authenticated";
grant truncate on table "public"."feed_policies" to "authenticated";
grant update on table "public"."feed_policies" to "authenticated";
grant delete on table "public"."feed_policies" to "service_role";
grant insert on table "public"."feed_policies" to "service_role";
grant references on table "public"."feed_policies" to "service_role";
grant select on table "public"."feed_policies" to "service_role";
grant trigger on table "public"."feed_policies" to "service_role";
grant truncate on table "public"."feed_policies" to "service_role";
grant update on table "public"."feed_policies" to "service_role";
grant delete on table "public"."feed_policy_lanes" to "anon";
grant insert on table "public"."feed_policy_lanes" to "anon";
grant references on table "public"."feed_policy_lanes" to "anon";
grant select on table "public"."feed_policy_lanes" to "anon";
grant trigger on table "public"."feed_policy_lanes" to "anon";
grant truncate on table "public"."feed_policy_lanes" to "anon";
grant update on table "public"."feed_policy_lanes" to "anon";
grant delete on table "public"."feed_policy_lanes" to "authenticated";
grant insert on table "public"."feed_policy_lanes" to "authenticated";
grant references on table "public"."feed_policy_lanes" to "authenticated";
grant select on table "public"."feed_policy_lanes" to "authenticated";
grant trigger on table "public"."feed_policy_lanes" to "authenticated";
grant truncate on table "public"."feed_policy_lanes" to "authenticated";
grant update on table "public"."feed_policy_lanes" to "authenticated";
grant delete on table "public"."feed_policy_lanes" to "service_role";
grant insert on table "public"."feed_policy_lanes" to "service_role";
grant references on table "public"."feed_policy_lanes" to "service_role";
grant select on table "public"."feed_policy_lanes" to "service_role";
grant trigger on table "public"."feed_policy_lanes" to "service_role";
grant truncate on table "public"."feed_policy_lanes" to "service_role";
grant update on table "public"."feed_policy_lanes" to "service_role";
grant delete on table "public"."ingested_stances" to "anon";
grant insert on table "public"."ingested_stances" to "anon";
grant references on table "public"."ingested_stances" to "anon";
grant select on table "public"."ingested_stances" to "anon";
grant trigger on table "public"."ingested_stances" to "anon";
grant truncate on table "public"."ingested_stances" to "anon";
grant update on table "public"."ingested_stances" to "anon";
grant delete on table "public"."ingested_stances" to "authenticated";
grant insert on table "public"."ingested_stances" to "authenticated";
grant references on table "public"."ingested_stances" to "authenticated";
grant select on table "public"."ingested_stances" to "authenticated";
grant trigger on table "public"."ingested_stances" to "authenticated";
grant truncate on table "public"."ingested_stances" to "authenticated";
grant update on table "public"."ingested_stances" to "authenticated";
grant delete on table "public"."ingested_stances" to "service_role";
grant insert on table "public"."ingested_stances" to "service_role";
grant references on table "public"."ingested_stances" to "service_role";
grant select on table "public"."ingested_stances" to "service_role";
grant trigger on table "public"."ingested_stances" to "service_role";
grant truncate on table "public"."ingested_stances" to "service_role";
grant update on table "public"."ingested_stances" to "service_role";
grant delete on table "public"."ingestion_queue" to "anon";
grant insert on table "public"."ingestion_queue" to "anon";
grant references on table "public"."ingestion_queue" to "anon";
grant select on table "public"."ingestion_queue" to "anon";
grant trigger on table "public"."ingestion_queue" to "anon";
grant truncate on table "public"."ingestion_queue" to "anon";
grant update on table "public"."ingestion_queue" to "anon";
grant delete on table "public"."ingestion_queue" to "authenticated";
grant insert on table "public"."ingestion_queue" to "authenticated";
grant references on table "public"."ingestion_queue" to "authenticated";
grant select on table "public"."ingestion_queue" to "authenticated";
grant trigger on table "public"."ingestion_queue" to "authenticated";
grant truncate on table "public"."ingestion_queue" to "authenticated";
grant update on table "public"."ingestion_queue" to "authenticated";
grant delete on table "public"."ingestion_queue" to "service_role";
grant insert on table "public"."ingestion_queue" to "service_role";
grant references on table "public"."ingestion_queue" to "service_role";
grant select on table "public"."ingestion_queue" to "service_role";
grant trigger on table "public"."ingestion_queue" to "service_role";
grant truncate on table "public"."ingestion_queue" to "service_role";
grant update on table "public"."ingestion_queue" to "service_role";
grant delete on table "public"."location_audits" to "anon";
grant insert on table "public"."location_audits" to "anon";
grant references on table "public"."location_audits" to "anon";
grant select on table "public"."location_audits" to "anon";
grant trigger on table "public"."location_audits" to "anon";
grant truncate on table "public"."location_audits" to "anon";
grant update on table "public"."location_audits" to "anon";
grant delete on table "public"."location_audits" to "authenticated";
grant insert on table "public"."location_audits" to "authenticated";
grant references on table "public"."location_audits" to "authenticated";
grant select on table "public"."location_audits" to "authenticated";
grant trigger on table "public"."location_audits" to "authenticated";
grant truncate on table "public"."location_audits" to "authenticated";
grant update on table "public"."location_audits" to "authenticated";
grant delete on table "public"."location_audits" to "service_role";
grant insert on table "public"."location_audits" to "service_role";
grant references on table "public"."location_audits" to "service_role";
grant select on table "public"."location_audits" to "service_role";
grant trigger on table "public"."location_audits" to "service_role";
grant truncate on table "public"."location_audits" to "service_role";
grant update on table "public"."location_audits" to "service_role";
grant delete on table "public"."locations" to "anon";
grant insert on table "public"."locations" to "anon";
grant references on table "public"."locations" to "anon";
grant select on table "public"."locations" to "anon";
grant trigger on table "public"."locations" to "anon";
grant truncate on table "public"."locations" to "anon";
grant update on table "public"."locations" to "anon";
grant delete on table "public"."locations" to "authenticated";
grant insert on table "public"."locations" to "authenticated";
grant references on table "public"."locations" to "authenticated";
grant select on table "public"."locations" to "authenticated";
grant trigger on table "public"."locations" to "authenticated";
grant truncate on table "public"."locations" to "authenticated";
grant update on table "public"."locations" to "authenticated";
grant delete on table "public"."locations" to "service_role";
grant insert on table "public"."locations" to "service_role";
grant references on table "public"."locations" to "service_role";
grant select on table "public"."locations" to "service_role";
grant trigger on table "public"."locations" to "service_role";
grant truncate on table "public"."locations" to "service_role";
grant update on table "public"."locations" to "service_role";
grant delete on table "public"."mfa_methods" to "anon";
grant insert on table "public"."mfa_methods" to "anon";
grant references on table "public"."mfa_methods" to "anon";
grant select on table "public"."mfa_methods" to "anon";
grant trigger on table "public"."mfa_methods" to "anon";
grant truncate on table "public"."mfa_methods" to "anon";
grant update on table "public"."mfa_methods" to "anon";
grant delete on table "public"."mfa_methods" to "authenticated";
grant insert on table "public"."mfa_methods" to "authenticated";
grant references on table "public"."mfa_methods" to "authenticated";
grant select on table "public"."mfa_methods" to "authenticated";
grant trigger on table "public"."mfa_methods" to "authenticated";
grant truncate on table "public"."mfa_methods" to "authenticated";
grant update on table "public"."mfa_methods" to "authenticated";
grant delete on table "public"."mfa_methods" to "service_role";
grant insert on table "public"."mfa_methods" to "service_role";
grant references on table "public"."mfa_methods" to "service_role";
grant select on table "public"."mfa_methods" to "service_role";
grant trigger on table "public"."mfa_methods" to "service_role";
grant truncate on table "public"."mfa_methods" to "service_role";
grant update on table "public"."mfa_methods" to "service_role";
grant delete on table "public"."moderation_actions" to "anon";
grant insert on table "public"."moderation_actions" to "anon";
grant references on table "public"."moderation_actions" to "anon";
grant select on table "public"."moderation_actions" to "anon";
grant trigger on table "public"."moderation_actions" to "anon";
grant truncate on table "public"."moderation_actions" to "anon";
grant update on table "public"."moderation_actions" to "anon";
grant delete on table "public"."moderation_actions" to "authenticated";
grant insert on table "public"."moderation_actions" to "authenticated";
grant references on table "public"."moderation_actions" to "authenticated";
grant select on table "public"."moderation_actions" to "authenticated";
grant trigger on table "public"."moderation_actions" to "authenticated";
grant truncate on table "public"."moderation_actions" to "authenticated";
grant update on table "public"."moderation_actions" to "authenticated";
grant delete on table "public"."moderation_actions" to "service_role";
grant insert on table "public"."moderation_actions" to "service_role";
grant references on table "public"."moderation_actions" to "service_role";
grant select on table "public"."moderation_actions" to "service_role";
grant trigger on table "public"."moderation_actions" to "service_role";
grant truncate on table "public"."moderation_actions" to "service_role";
grant update on table "public"."moderation_actions" to "service_role";
grant delete on table "public"."moderators" to "anon";
grant insert on table "public"."moderators" to "anon";
grant references on table "public"."moderators" to "anon";
grant select on table "public"."moderators" to "anon";
grant trigger on table "public"."moderators" to "anon";
grant truncate on table "public"."moderators" to "anon";
grant update on table "public"."moderators" to "anon";
grant delete on table "public"."moderators" to "authenticated";
grant insert on table "public"."moderators" to "authenticated";
grant references on table "public"."moderators" to "authenticated";
grant select on table "public"."moderators" to "authenticated";
grant trigger on table "public"."moderators" to "authenticated";
grant truncate on table "public"."moderators" to "authenticated";
grant update on table "public"."moderators" to "authenticated";
grant delete on table "public"."moderators" to "service_role";
grant insert on table "public"."moderators" to "service_role";
grant references on table "public"."moderators" to "service_role";
grant select on table "public"."moderators" to "service_role";
grant trigger on table "public"."moderators" to "service_role";
grant truncate on table "public"."moderators" to "service_role";
grant update on table "public"."moderators" to "service_role";
grant delete on table "public"."news_items" to "anon";
grant insert on table "public"."news_items" to "anon";
grant references on table "public"."news_items" to "anon";
grant select on table "public"."news_items" to "anon";
grant trigger on table "public"."news_items" to "anon";
grant truncate on table "public"."news_items" to "anon";
grant update on table "public"."news_items" to "anon";
grant delete on table "public"."news_items" to "authenticated";
grant insert on table "public"."news_items" to "authenticated";
grant references on table "public"."news_items" to "authenticated";
grant select on table "public"."news_items" to "authenticated";
grant trigger on table "public"."news_items" to "authenticated";
grant truncate on table "public"."news_items" to "authenticated";
grant update on table "public"."news_items" to "authenticated";
grant delete on table "public"."news_items" to "service_role";
grant insert on table "public"."news_items" to "service_role";
grant references on table "public"."news_items" to "service_role";
grant select on table "public"."news_items" to "service_role";
grant trigger on table "public"."news_items" to "service_role";
grant truncate on table "public"."news_items" to "service_role";
grant update on table "public"."news_items" to "service_role";
grant delete on table "public"."notification_event_log" to "anon";
grant insert on table "public"."notification_event_log" to "anon";
grant references on table "public"."notification_event_log" to "anon";
grant select on table "public"."notification_event_log" to "anon";
grant trigger on table "public"."notification_event_log" to "anon";
grant truncate on table "public"."notification_event_log" to "anon";
grant update on table "public"."notification_event_log" to "anon";
grant delete on table "public"."notification_event_log" to "authenticated";
grant insert on table "public"."notification_event_log" to "authenticated";
grant references on table "public"."notification_event_log" to "authenticated";
grant select on table "public"."notification_event_log" to "authenticated";
grant trigger on table "public"."notification_event_log" to "authenticated";
grant truncate on table "public"."notification_event_log" to "authenticated";
grant update on table "public"."notification_event_log" to "authenticated";
grant delete on table "public"."notification_event_log" to "service_role";
grant insert on table "public"."notification_event_log" to "service_role";
grant references on table "public"."notification_event_log" to "service_role";
grant select on table "public"."notification_event_log" to "service_role";
grant trigger on table "public"."notification_event_log" to "service_role";
grant truncate on table "public"."notification_event_log" to "service_role";
grant update on table "public"."notification_event_log" to "service_role";
grant delete on table "public"."notification_preferences" to "anon";
grant insert on table "public"."notification_preferences" to "anon";
grant references on table "public"."notification_preferences" to "anon";
grant select on table "public"."notification_preferences" to "anon";
grant trigger on table "public"."notification_preferences" to "anon";
grant truncate on table "public"."notification_preferences" to "anon";
grant update on table "public"."notification_preferences" to "anon";
grant delete on table "public"."notification_preferences" to "authenticated";
grant insert on table "public"."notification_preferences" to "authenticated";
grant references on table "public"."notification_preferences" to "authenticated";
grant select on table "public"."notification_preferences" to "authenticated";
grant trigger on table "public"."notification_preferences" to "authenticated";
grant truncate on table "public"."notification_preferences" to "authenticated";
grant update on table "public"."notification_preferences" to "authenticated";
grant delete on table "public"."notification_preferences" to "service_role";
grant insert on table "public"."notification_preferences" to "service_role";
grant references on table "public"."notification_preferences" to "service_role";
grant select on table "public"."notification_preferences" to "service_role";
grant trigger on table "public"."notification_preferences" to "service_role";
grant truncate on table "public"."notification_preferences" to "service_role";
grant update on table "public"."notification_preferences" to "service_role";
grant delete on table "public"."notification_topic_prefs" to "anon";
grant insert on table "public"."notification_topic_prefs" to "anon";
grant references on table "public"."notification_topic_prefs" to "anon";
grant select on table "public"."notification_topic_prefs" to "anon";
grant trigger on table "public"."notification_topic_prefs" to "anon";
grant truncate on table "public"."notification_topic_prefs" to "anon";
grant update on table "public"."notification_topic_prefs" to "anon";
grant delete on table "public"."notification_topic_prefs" to "authenticated";
grant insert on table "public"."notification_topic_prefs" to "authenticated";
grant references on table "public"."notification_topic_prefs" to "authenticated";
grant select on table "public"."notification_topic_prefs" to "authenticated";
grant trigger on table "public"."notification_topic_prefs" to "authenticated";
grant truncate on table "public"."notification_topic_prefs" to "authenticated";
grant update on table "public"."notification_topic_prefs" to "authenticated";
grant delete on table "public"."notification_topic_prefs" to "service_role";
grant insert on table "public"."notification_topic_prefs" to "service_role";
grant references on table "public"."notification_topic_prefs" to "service_role";
grant select on table "public"."notification_topic_prefs" to "service_role";
grant trigger on table "public"."notification_topic_prefs" to "service_role";
grant truncate on table "public"."notification_topic_prefs" to "service_role";
grant update on table "public"."notification_topic_prefs" to "service_role";
grant delete on table "public"."og_image_cache" to "anon";
grant insert on table "public"."og_image_cache" to "anon";
grant references on table "public"."og_image_cache" to "anon";
grant select on table "public"."og_image_cache" to "anon";
grant trigger on table "public"."og_image_cache" to "anon";
grant truncate on table "public"."og_image_cache" to "anon";
grant update on table "public"."og_image_cache" to "anon";
grant delete on table "public"."og_image_cache" to "authenticated";
grant insert on table "public"."og_image_cache" to "authenticated";
grant references on table "public"."og_image_cache" to "authenticated";
grant select on table "public"."og_image_cache" to "authenticated";
grant trigger on table "public"."og_image_cache" to "authenticated";
grant truncate on table "public"."og_image_cache" to "authenticated";
grant update on table "public"."og_image_cache" to "authenticated";
grant delete on table "public"."og_image_cache" to "service_role";
grant insert on table "public"."og_image_cache" to "service_role";
grant references on table "public"."og_image_cache" to "service_role";
grant select on table "public"."og_image_cache" to "service_role";
grant trigger on table "public"."og_image_cache" to "service_role";
grant truncate on table "public"."og_image_cache" to "service_role";
grant update on table "public"."og_image_cache" to "service_role";
grant delete on table "public"."party_alliance_members" to "anon";
grant insert on table "public"."party_alliance_members" to "anon";
grant references on table "public"."party_alliance_members" to "anon";
grant select on table "public"."party_alliance_members" to "anon";
grant trigger on table "public"."party_alliance_members" to "anon";
grant truncate on table "public"."party_alliance_members" to "anon";
grant update on table "public"."party_alliance_members" to "anon";
grant delete on table "public"."party_alliance_members" to "authenticated";
grant insert on table "public"."party_alliance_members" to "authenticated";
grant references on table "public"."party_alliance_members" to "authenticated";
grant select on table "public"."party_alliance_members" to "authenticated";
grant trigger on table "public"."party_alliance_members" to "authenticated";
grant truncate on table "public"."party_alliance_members" to "authenticated";
grant update on table "public"."party_alliance_members" to "authenticated";
grant delete on table "public"."party_alliance_members" to "service_role";
grant insert on table "public"."party_alliance_members" to "service_role";
grant references on table "public"."party_alliance_members" to "service_role";
grant select on table "public"."party_alliance_members" to "service_role";
grant trigger on table "public"."party_alliance_members" to "service_role";
grant truncate on table "public"."party_alliance_members" to "service_role";
grant update on table "public"."party_alliance_members" to "service_role";
grant delete on table "public"."password_resets" to "anon";
grant insert on table "public"."password_resets" to "anon";
grant references on table "public"."password_resets" to "anon";
grant select on table "public"."password_resets" to "anon";
grant trigger on table "public"."password_resets" to "anon";
grant truncate on table "public"."password_resets" to "anon";
grant update on table "public"."password_resets" to "anon";
grant delete on table "public"."password_resets" to "authenticated";
grant insert on table "public"."password_resets" to "authenticated";
grant references on table "public"."password_resets" to "authenticated";
grant select on table "public"."password_resets" to "authenticated";
grant trigger on table "public"."password_resets" to "authenticated";
grant truncate on table "public"."password_resets" to "authenticated";
grant update on table "public"."password_resets" to "authenticated";
grant delete on table "public"."password_resets" to "service_role";
grant insert on table "public"."password_resets" to "service_role";
grant references on table "public"."password_resets" to "service_role";
grant select on table "public"."password_resets" to "service_role";
grant trigger on table "public"."password_resets" to "service_role";
grant truncate on table "public"."password_resets" to "service_role";
grant update on table "public"."password_resets" to "service_role";
grant delete on table "public"."pipeline_jobs" to "anon";
grant insert on table "public"."pipeline_jobs" to "anon";
grant references on table "public"."pipeline_jobs" to "anon";
grant select on table "public"."pipeline_jobs" to "anon";
grant trigger on table "public"."pipeline_jobs" to "anon";
grant truncate on table "public"."pipeline_jobs" to "anon";
grant update on table "public"."pipeline_jobs" to "anon";
grant delete on table "public"."pipeline_jobs" to "authenticated";
grant insert on table "public"."pipeline_jobs" to "authenticated";
grant references on table "public"."pipeline_jobs" to "authenticated";
grant select on table "public"."pipeline_jobs" to "authenticated";
grant trigger on table "public"."pipeline_jobs" to "authenticated";
grant truncate on table "public"."pipeline_jobs" to "authenticated";
grant update on table "public"."pipeline_jobs" to "authenticated";
grant delete on table "public"."pipeline_jobs" to "service_role";
grant insert on table "public"."pipeline_jobs" to "service_role";
grant references on table "public"."pipeline_jobs" to "service_role";
grant select on table "public"."pipeline_jobs" to "service_role";
grant trigger on table "public"."pipeline_jobs" to "service_role";
grant truncate on table "public"."pipeline_jobs" to "service_role";
grant update on table "public"."pipeline_jobs" to "service_role";
grant delete on table "public"."profiles" to "anon";
grant insert on table "public"."profiles" to "anon";
grant references on table "public"."profiles" to "anon";
grant select on table "public"."profiles" to "anon";
grant trigger on table "public"."profiles" to "anon";
grant truncate on table "public"."profiles" to "anon";
grant update on table "public"."profiles" to "anon";
grant delete on table "public"."profiles" to "authenticated";
grant insert on table "public"."profiles" to "authenticated";
grant references on table "public"."profiles" to "authenticated";
grant select on table "public"."profiles" to "authenticated";
grant trigger on table "public"."profiles" to "authenticated";
grant truncate on table "public"."profiles" to "authenticated";
grant update on table "public"."profiles" to "authenticated";
grant delete on table "public"."profiles" to "service_role";
grant insert on table "public"."profiles" to "service_role";
grant references on table "public"."profiles" to "service_role";
grant select on table "public"."profiles" to "service_role";
grant trigger on table "public"."profiles" to "service_role";
grant truncate on table "public"."profiles" to "service_role";
grant update on table "public"."profiles" to "service_role";
grant delete on table "public"."publishers" to "anon";
grant insert on table "public"."publishers" to "anon";
grant references on table "public"."publishers" to "anon";
grant select on table "public"."publishers" to "anon";
grant trigger on table "public"."publishers" to "anon";
grant truncate on table "public"."publishers" to "anon";
grant update on table "public"."publishers" to "anon";
grant delete on table "public"."publishers" to "authenticated";
grant insert on table "public"."publishers" to "authenticated";
grant references on table "public"."publishers" to "authenticated";
grant select on table "public"."publishers" to "authenticated";
grant trigger on table "public"."publishers" to "authenticated";
grant truncate on table "public"."publishers" to "authenticated";
grant update on table "public"."publishers" to "authenticated";
grant delete on table "public"."publishers" to "service_role";
grant insert on table "public"."publishers" to "service_role";
grant references on table "public"."publishers" to "service_role";
grant select on table "public"."publishers" to "service_role";
grant trigger on table "public"."publishers" to "service_role";
grant truncate on table "public"."publishers" to "service_role";
grant update on table "public"."publishers" to "service_role";
grant delete on table "public"."question_audience_fit" to "anon";
grant insert on table "public"."question_audience_fit" to "anon";
grant references on table "public"."question_audience_fit" to "anon";
grant select on table "public"."question_audience_fit" to "anon";
grant trigger on table "public"."question_audience_fit" to "anon";
grant truncate on table "public"."question_audience_fit" to "anon";
grant update on table "public"."question_audience_fit" to "anon";
grant delete on table "public"."question_audience_fit" to "authenticated";
grant insert on table "public"."question_audience_fit" to "authenticated";
grant references on table "public"."question_audience_fit" to "authenticated";
grant select on table "public"."question_audience_fit" to "authenticated";
grant trigger on table "public"."question_audience_fit" to "authenticated";
grant truncate on table "public"."question_audience_fit" to "authenticated";
grant update on table "public"."question_audience_fit" to "authenticated";
grant delete on table "public"."question_audience_fit" to "service_role";
grant insert on table "public"."question_audience_fit" to "service_role";
grant references on table "public"."question_audience_fit" to "service_role";
grant select on table "public"."question_audience_fit" to "service_role";
grant trigger on table "public"."question_audience_fit" to "service_role";
grant truncate on table "public"."question_audience_fit" to "service_role";
grant update on table "public"."question_audience_fit" to "service_role";
grant delete on table "public"."question_comment_sentiment" to "anon";
grant insert on table "public"."question_comment_sentiment" to "anon";
grant references on table "public"."question_comment_sentiment" to "anon";
grant select on table "public"."question_comment_sentiment" to "anon";
grant trigger on table "public"."question_comment_sentiment" to "anon";
grant truncate on table "public"."question_comment_sentiment" to "anon";
grant update on table "public"."question_comment_sentiment" to "anon";
grant delete on table "public"."question_comment_sentiment" to "authenticated";
grant insert on table "public"."question_comment_sentiment" to "authenticated";
grant references on table "public"."question_comment_sentiment" to "authenticated";
grant select on table "public"."question_comment_sentiment" to "authenticated";
grant trigger on table "public"."question_comment_sentiment" to "authenticated";
grant truncate on table "public"."question_comment_sentiment" to "authenticated";
grant update on table "public"."question_comment_sentiment" to "authenticated";
grant delete on table "public"."question_comment_sentiment" to "service_role";
grant insert on table "public"."question_comment_sentiment" to "service_role";
grant references on table "public"."question_comment_sentiment" to "service_role";
grant select on table "public"."question_comment_sentiment" to "service_role";
grant trigger on table "public"."question_comment_sentiment" to "service_role";
grant truncate on table "public"."question_comment_sentiment" to "service_role";
grant update on table "public"."question_comment_sentiment" to "service_role";
grant delete on table "public"."question_context_updates" to "anon";
grant insert on table "public"."question_context_updates" to "anon";
grant references on table "public"."question_context_updates" to "anon";
grant select on table "public"."question_context_updates" to "anon";
grant trigger on table "public"."question_context_updates" to "anon";
grant truncate on table "public"."question_context_updates" to "anon";
grant update on table "public"."question_context_updates" to "anon";
grant delete on table "public"."question_context_updates" to "authenticated";
grant insert on table "public"."question_context_updates" to "authenticated";
grant references on table "public"."question_context_updates" to "authenticated";
grant select on table "public"."question_context_updates" to "authenticated";
grant trigger on table "public"."question_context_updates" to "authenticated";
grant truncate on table "public"."question_context_updates" to "authenticated";
grant update on table "public"."question_context_updates" to "authenticated";
grant delete on table "public"."question_context_updates" to "service_role";
grant insert on table "public"."question_context_updates" to "service_role";
grant references on table "public"."question_context_updates" to "service_role";
grant select on table "public"."question_context_updates" to "service_role";
grant trigger on table "public"."question_context_updates" to "service_role";
grant truncate on table "public"."question_context_updates" to "service_role";
grant update on table "public"."question_context_updates" to "service_role";
grant delete on table "public"."question_draft_audience_fit" to "anon";
grant insert on table "public"."question_draft_audience_fit" to "anon";
grant references on table "public"."question_draft_audience_fit" to "anon";
grant select on table "public"."question_draft_audience_fit" to "anon";
grant trigger on table "public"."question_draft_audience_fit" to "anon";
grant truncate on table "public"."question_draft_audience_fit" to "anon";
grant update on table "public"."question_draft_audience_fit" to "anon";
grant delete on table "public"."question_draft_audience_fit" to "authenticated";
grant insert on table "public"."question_draft_audience_fit" to "authenticated";
grant references on table "public"."question_draft_audience_fit" to "authenticated";
grant select on table "public"."question_draft_audience_fit" to "authenticated";
grant trigger on table "public"."question_draft_audience_fit" to "authenticated";
grant truncate on table "public"."question_draft_audience_fit" to "authenticated";
grant update on table "public"."question_draft_audience_fit" to "authenticated";
grant delete on table "public"."question_draft_audience_fit" to "service_role";
grant insert on table "public"."question_draft_audience_fit" to "service_role";
grant references on table "public"."question_draft_audience_fit" to "service_role";
grant select on table "public"."question_draft_audience_fit" to "service_role";
grant trigger on table "public"."question_draft_audience_fit" to "service_role";
grant truncate on table "public"."question_draft_audience_fit" to "service_role";
grant update on table "public"."question_draft_audience_fit" to "service_role";
grant delete on table "public"."question_drafts" to "anon";
grant insert on table "public"."question_drafts" to "anon";
grant references on table "public"."question_drafts" to "anon";
grant select on table "public"."question_drafts" to "anon";
grant trigger on table "public"."question_drafts" to "anon";
grant truncate on table "public"."question_drafts" to "anon";
grant update on table "public"."question_drafts" to "anon";
grant delete on table "public"."question_drafts" to "authenticated";
grant insert on table "public"."question_drafts" to "authenticated";
grant references on table "public"."question_drafts" to "authenticated";
grant select on table "public"."question_drafts" to "authenticated";
grant trigger on table "public"."question_drafts" to "authenticated";
grant truncate on table "public"."question_drafts" to "authenticated";
grant update on table "public"."question_drafts" to "authenticated";
grant delete on table "public"."question_drafts" to "service_role";
grant insert on table "public"."question_drafts" to "service_role";
grant references on table "public"."question_drafts" to "service_role";
grant select on table "public"."question_drafts" to "service_role";
grant trigger on table "public"."question_drafts" to "service_role";
grant truncate on table "public"."question_drafts" to "service_role";
grant update on table "public"."question_drafts" to "service_role";
grant delete on table "public"."question_duplicates" to "anon";
grant insert on table "public"."question_duplicates" to "anon";
grant references on table "public"."question_duplicates" to "anon";
grant select on table "public"."question_duplicates" to "anon";
grant trigger on table "public"."question_duplicates" to "anon";
grant truncate on table "public"."question_duplicates" to "anon";
grant update on table "public"."question_duplicates" to "anon";
grant delete on table "public"."question_duplicates" to "authenticated";
grant insert on table "public"."question_duplicates" to "authenticated";
grant references on table "public"."question_duplicates" to "authenticated";
grant select on table "public"."question_duplicates" to "authenticated";
grant trigger on table "public"."question_duplicates" to "authenticated";
grant truncate on table "public"."question_duplicates" to "authenticated";
grant update on table "public"."question_duplicates" to "authenticated";
grant delete on table "public"."question_duplicates" to "service_role";
grant insert on table "public"."question_duplicates" to "service_role";
grant references on table "public"."question_duplicates" to "service_role";
grant select on table "public"."question_duplicates" to "service_role";
grant trigger on table "public"."question_duplicates" to "service_role";
grant truncate on table "public"."question_duplicates" to "service_role";
grant update on table "public"."question_duplicates" to "service_role";
grant delete on table "public"."question_engagement_metrics" to "anon";
grant insert on table "public"."question_engagement_metrics" to "anon";
grant references on table "public"."question_engagement_metrics" to "anon";
grant select on table "public"."question_engagement_metrics" to "anon";
grant trigger on table "public"."question_engagement_metrics" to "anon";
grant truncate on table "public"."question_engagement_metrics" to "anon";
grant update on table "public"."question_engagement_metrics" to "anon";
grant delete on table "public"."question_engagement_metrics" to "authenticated";
grant insert on table "public"."question_engagement_metrics" to "authenticated";
grant references on table "public"."question_engagement_metrics" to "authenticated";
grant select on table "public"."question_engagement_metrics" to "authenticated";
grant trigger on table "public"."question_engagement_metrics" to "authenticated";
grant truncate on table "public"."question_engagement_metrics" to "authenticated";
grant update on table "public"."question_engagement_metrics" to "authenticated";
grant delete on table "public"."question_engagement_metrics" to "service_role";
grant insert on table "public"."question_engagement_metrics" to "service_role";
grant references on table "public"."question_engagement_metrics" to "service_role";
grant select on table "public"."question_engagement_metrics" to "service_role";
grant trigger on table "public"."question_engagement_metrics" to "service_role";
grant truncate on table "public"."question_engagement_metrics" to "service_role";
grant update on table "public"."question_engagement_metrics" to "service_role";
grant delete on table "public"."question_lifecycle_config" to "anon";
grant insert on table "public"."question_lifecycle_config" to "anon";
grant references on table "public"."question_lifecycle_config" to "anon";
grant select on table "public"."question_lifecycle_config" to "anon";
grant trigger on table "public"."question_lifecycle_config" to "anon";
grant truncate on table "public"."question_lifecycle_config" to "anon";
grant update on table "public"."question_lifecycle_config" to "anon";
grant delete on table "public"."question_lifecycle_config" to "authenticated";
grant insert on table "public"."question_lifecycle_config" to "authenticated";
grant references on table "public"."question_lifecycle_config" to "authenticated";
grant select on table "public"."question_lifecycle_config" to "authenticated";
grant trigger on table "public"."question_lifecycle_config" to "authenticated";
grant truncate on table "public"."question_lifecycle_config" to "authenticated";
grant update on table "public"."question_lifecycle_config" to "authenticated";
grant delete on table "public"."question_lifecycle_config" to "service_role";
grant insert on table "public"."question_lifecycle_config" to "service_role";
grant references on table "public"."question_lifecycle_config" to "service_role";
grant select on table "public"."question_lifecycle_config" to "service_role";
grant trigger on table "public"."question_lifecycle_config" to "service_role";
grant truncate on table "public"."question_lifecycle_config" to "service_role";
grant update on table "public"."question_lifecycle_config" to "service_role";
grant delete on table "public"."question_links" to "anon";
grant insert on table "public"."question_links" to "anon";
grant references on table "public"."question_links" to "anon";
grant select on table "public"."question_links" to "anon";
grant trigger on table "public"."question_links" to "anon";
grant truncate on table "public"."question_links" to "anon";
grant update on table "public"."question_links" to "anon";
grant delete on table "public"."question_links" to "authenticated";
grant insert on table "public"."question_links" to "authenticated";
grant references on table "public"."question_links" to "authenticated";
grant select on table "public"."question_links" to "authenticated";
grant trigger on table "public"."question_links" to "authenticated";
grant truncate on table "public"."question_links" to "authenticated";
grant update on table "public"."question_links" to "authenticated";
grant delete on table "public"."question_links" to "service_role";
grant insert on table "public"."question_links" to "service_role";
grant references on table "public"."question_links" to "service_role";
grant select on table "public"."question_links" to "service_role";
grant trigger on table "public"."question_links" to "service_role";
grant truncate on table "public"."question_links" to "service_role";
grant update on table "public"."question_links" to "service_role";
grant delete on table "public"."question_stance_confidence" to "anon";
grant insert on table "public"."question_stance_confidence" to "anon";
grant references on table "public"."question_stance_confidence" to "anon";
grant select on table "public"."question_stance_confidence" to "anon";
grant trigger on table "public"."question_stance_confidence" to "anon";
grant truncate on table "public"."question_stance_confidence" to "anon";
grant update on table "public"."question_stance_confidence" to "anon";
grant delete on table "public"."question_stance_confidence" to "authenticated";
grant insert on table "public"."question_stance_confidence" to "authenticated";
grant references on table "public"."question_stance_confidence" to "authenticated";
grant select on table "public"."question_stance_confidence" to "authenticated";
grant trigger on table "public"."question_stance_confidence" to "authenticated";
grant truncate on table "public"."question_stance_confidence" to "authenticated";
grant update on table "public"."question_stance_confidence" to "authenticated";
grant delete on table "public"."question_stance_confidence" to "service_role";
grant insert on table "public"."question_stance_confidence" to "service_role";
grant references on table "public"."question_stance_confidence" to "service_role";
grant select on table "public"."question_stance_confidence" to "service_role";
grant trigger on table "public"."question_stance_confidence" to "service_role";
grant truncate on table "public"."question_stance_confidence" to "service_role";
grant update on table "public"."question_stance_confidence" to "service_role";
grant delete on table "public"."question_stance_stats" to "anon";
grant insert on table "public"."question_stance_stats" to "anon";
grant references on table "public"."question_stance_stats" to "anon";
grant select on table "public"."question_stance_stats" to "anon";
grant trigger on table "public"."question_stance_stats" to "anon";
grant truncate on table "public"."question_stance_stats" to "anon";
grant update on table "public"."question_stance_stats" to "anon";
grant delete on table "public"."question_stance_stats" to "authenticated";
grant insert on table "public"."question_stance_stats" to "authenticated";
grant references on table "public"."question_stance_stats" to "authenticated";
grant select on table "public"."question_stance_stats" to "authenticated";
grant trigger on table "public"."question_stance_stats" to "authenticated";
grant truncate on table "public"."question_stance_stats" to "authenticated";
grant update on table "public"."question_stance_stats" to "authenticated";
grant delete on table "public"."question_stance_stats" to "service_role";
grant insert on table "public"."question_stance_stats" to "service_role";
grant references on table "public"."question_stance_stats" to "service_role";
grant select on table "public"."question_stance_stats" to "service_role";
grant trigger on table "public"."question_stance_stats" to "service_role";
grant truncate on table "public"."question_stance_stats" to "service_role";
grant update on table "public"."question_stance_stats" to "service_role";
grant delete on table "public"."question_stance_stats_history" to "anon";
grant insert on table "public"."question_stance_stats_history" to "anon";
grant references on table "public"."question_stance_stats_history" to "anon";
grant select on table "public"."question_stance_stats_history" to "anon";
grant trigger on table "public"."question_stance_stats_history" to "anon";
grant truncate on table "public"."question_stance_stats_history" to "anon";
grant update on table "public"."question_stance_stats_history" to "anon";
grant delete on table "public"."question_stance_stats_history" to "authenticated";
grant insert on table "public"."question_stance_stats_history" to "authenticated";
grant references on table "public"."question_stance_stats_history" to "authenticated";
grant select on table "public"."question_stance_stats_history" to "authenticated";
grant trigger on table "public"."question_stance_stats_history" to "authenticated";
grant truncate on table "public"."question_stance_stats_history" to "authenticated";
grant update on table "public"."question_stance_stats_history" to "authenticated";
grant delete on table "public"."question_stance_stats_history" to "service_role";
grant insert on table "public"."question_stance_stats_history" to "service_role";
grant references on table "public"."question_stance_stats_history" to "service_role";
grant select on table "public"."question_stance_stats_history" to "service_role";
grant trigger on table "public"."question_stance_stats_history" to "service_role";
grant truncate on table "public"."question_stance_stats_history" to "service_role";
grant update on table "public"."question_stance_stats_history" to "service_role";
grant delete on table "public"."question_stance_stats_region" to "anon";
grant insert on table "public"."question_stance_stats_region" to "anon";
grant references on table "public"."question_stance_stats_region" to "anon";
grant select on table "public"."question_stance_stats_region" to "anon";
grant trigger on table "public"."question_stance_stats_region" to "anon";
grant truncate on table "public"."question_stance_stats_region" to "anon";
grant update on table "public"."question_stance_stats_region" to "anon";
grant delete on table "public"."question_stance_stats_region" to "authenticated";
grant insert on table "public"."question_stance_stats_region" to "authenticated";
grant references on table "public"."question_stance_stats_region" to "authenticated";
grant select on table "public"."question_stance_stats_region" to "authenticated";
grant trigger on table "public"."question_stance_stats_region" to "authenticated";
grant truncate on table "public"."question_stance_stats_region" to "authenticated";
grant update on table "public"."question_stance_stats_region" to "authenticated";
grant delete on table "public"."question_stance_stats_region" to "service_role";
grant insert on table "public"."question_stance_stats_region" to "service_role";
grant references on table "public"."question_stance_stats_region" to "service_role";
grant select on table "public"."question_stance_stats_region" to "service_role";
grant trigger on table "public"."question_stance_stats_region" to "service_role";
grant truncate on table "public"."question_stance_stats_region" to "service_role";
grant update on table "public"."question_stance_stats_region" to "service_role";
grant delete on table "public"."question_stances" to "anon";
grant insert on table "public"."question_stances" to "anon";
grant references on table "public"."question_stances" to "anon";
grant select on table "public"."question_stances" to "anon";
grant trigger on table "public"."question_stances" to "anon";
grant truncate on table "public"."question_stances" to "anon";
grant update on table "public"."question_stances" to "anon";
grant delete on table "public"."question_stances" to "authenticated";
grant insert on table "public"."question_stances" to "authenticated";
grant references on table "public"."question_stances" to "authenticated";
grant select on table "public"."question_stances" to "authenticated";
grant trigger on table "public"."question_stances" to "authenticated";
grant truncate on table "public"."question_stances" to "authenticated";
grant update on table "public"."question_stances" to "authenticated";
grant delete on table "public"."question_stances" to "service_role";
grant insert on table "public"."question_stances" to "service_role";
grant references on table "public"."question_stances" to "service_role";
grant select on table "public"."question_stances" to "service_role";
grant trigger on table "public"."question_stances" to "service_role";
grant truncate on table "public"."question_stances" to "service_role";
grant update on table "public"."question_stances" to "service_role";
grant delete on table "public"."question_state_history" to "anon";
grant insert on table "public"."question_state_history" to "anon";
grant references on table "public"."question_state_history" to "anon";
grant select on table "public"."question_state_history" to "anon";
grant trigger on table "public"."question_state_history" to "anon";
grant truncate on table "public"."question_state_history" to "anon";
grant update on table "public"."question_state_history" to "anon";
grant delete on table "public"."question_state_history" to "authenticated";
grant insert on table "public"."question_state_history" to "authenticated";
grant references on table "public"."question_state_history" to "authenticated";
grant select on table "public"."question_state_history" to "authenticated";
grant trigger on table "public"."question_state_history" to "authenticated";
grant truncate on table "public"."question_state_history" to "authenticated";
grant update on table "public"."question_state_history" to "authenticated";
grant delete on table "public"."question_state_history" to "service_role";
grant insert on table "public"."question_state_history" to "service_role";
grant references on table "public"."question_state_history" to "service_role";
grant select on table "public"."question_state_history" to "service_role";
grant trigger on table "public"."question_state_history" to "service_role";
grant truncate on table "public"."question_state_history" to "service_role";
grant update on table "public"."question_state_history" to "service_role";
grant delete on table "public"."question_tradeoffs" to "anon";
grant insert on table "public"."question_tradeoffs" to "anon";
grant references on table "public"."question_tradeoffs" to "anon";
grant select on table "public"."question_tradeoffs" to "anon";
grant trigger on table "public"."question_tradeoffs" to "anon";
grant truncate on table "public"."question_tradeoffs" to "anon";
grant update on table "public"."question_tradeoffs" to "anon";
grant delete on table "public"."question_tradeoffs" to "authenticated";
grant insert on table "public"."question_tradeoffs" to "authenticated";
grant references on table "public"."question_tradeoffs" to "authenticated";
grant select on table "public"."question_tradeoffs" to "authenticated";
grant trigger on table "public"."question_tradeoffs" to "authenticated";
grant truncate on table "public"."question_tradeoffs" to "authenticated";
grant update on table "public"."question_tradeoffs" to "authenticated";
grant delete on table "public"."question_tradeoffs" to "service_role";
grant insert on table "public"."question_tradeoffs" to "service_role";
grant references on table "public"."question_tradeoffs" to "service_role";
grant select on table "public"."question_tradeoffs" to "service_role";
grant trigger on table "public"."question_tradeoffs" to "service_role";
grant truncate on table "public"."question_tradeoffs" to "service_role";
grant update on table "public"."question_tradeoffs" to "service_role";
grant delete on table "public"."question_trending_metrics" to "anon";
grant insert on table "public"."question_trending_metrics" to "anon";
grant references on table "public"."question_trending_metrics" to "anon";
grant select on table "public"."question_trending_metrics" to "anon";
grant trigger on table "public"."question_trending_metrics" to "anon";
grant truncate on table "public"."question_trending_metrics" to "anon";
grant update on table "public"."question_trending_metrics" to "anon";
grant delete on table "public"."question_trending_metrics" to "authenticated";
grant insert on table "public"."question_trending_metrics" to "authenticated";
grant references on table "public"."question_trending_metrics" to "authenticated";
grant select on table "public"."question_trending_metrics" to "authenticated";
grant trigger on table "public"."question_trending_metrics" to "authenticated";
grant truncate on table "public"."question_trending_metrics" to "authenticated";
grant update on table "public"."question_trending_metrics" to "authenticated";
grant delete on table "public"."question_trending_metrics" to "service_role";
grant insert on table "public"."question_trending_metrics" to "service_role";
grant references on table "public"."question_trending_metrics" to "service_role";
grant select on table "public"."question_trending_metrics" to "service_role";
grant trigger on table "public"."question_trending_metrics" to "service_role";
grant truncate on table "public"."question_trending_metrics" to "service_role";
grant update on table "public"."question_trending_metrics" to "service_role";
grant delete on table "public"."question_view_events" to "anon";
grant insert on table "public"."question_view_events" to "anon";
grant references on table "public"."question_view_events" to "anon";
grant select on table "public"."question_view_events" to "anon";
grant trigger on table "public"."question_view_events" to "anon";
grant truncate on table "public"."question_view_events" to "anon";
grant update on table "public"."question_view_events" to "anon";
grant delete on table "public"."question_view_events" to "authenticated";
grant insert on table "public"."question_view_events" to "authenticated";
grant references on table "public"."question_view_events" to "authenticated";
grant select on table "public"."question_view_events" to "authenticated";
grant trigger on table "public"."question_view_events" to "authenticated";
grant truncate on table "public"."question_view_events" to "authenticated";
grant update on table "public"."question_view_events" to "authenticated";
grant delete on table "public"."question_view_events" to "service_role";
grant insert on table "public"."question_view_events" to "service_role";
grant references on table "public"."question_view_events" to "service_role";
grant select on table "public"."question_view_events" to "service_role";
grant trigger on table "public"."question_view_events" to "service_role";
grant truncate on table "public"."question_view_events" to "service_role";
grant update on table "public"."question_view_events" to "service_role";
grant delete on table "public"."question_visibility_rules" to "anon";
grant insert on table "public"."question_visibility_rules" to "anon";
grant references on table "public"."question_visibility_rules" to "anon";
grant select on table "public"."question_visibility_rules" to "anon";
grant trigger on table "public"."question_visibility_rules" to "anon";
grant truncate on table "public"."question_visibility_rules" to "anon";
grant update on table "public"."question_visibility_rules" to "anon";
grant delete on table "public"."question_visibility_rules" to "authenticated";
grant insert on table "public"."question_visibility_rules" to "authenticated";
grant references on table "public"."question_visibility_rules" to "authenticated";
grant select on table "public"."question_visibility_rules" to "authenticated";
grant trigger on table "public"."question_visibility_rules" to "authenticated";
grant truncate on table "public"."question_visibility_rules" to "authenticated";
grant update on table "public"."question_visibility_rules" to "authenticated";
grant delete on table "public"."question_visibility_rules" to "service_role";
grant insert on table "public"."question_visibility_rules" to "service_role";
grant references on table "public"."question_visibility_rules" to "service_role";
grant select on table "public"."question_visibility_rules" to "service_role";
grant trigger on table "public"."question_visibility_rules" to "service_role";
grant truncate on table "public"."question_visibility_rules" to "service_role";
grant update on table "public"."question_visibility_rules" to "service_role";
grant delete on table "public"."questions" to "anon";
grant insert on table "public"."questions" to "anon";
grant references on table "public"."questions" to "anon";
grant select on table "public"."questions" to "anon";
grant trigger on table "public"."questions" to "anon";
grant truncate on table "public"."questions" to "anon";
grant update on table "public"."questions" to "anon";
grant delete on table "public"."questions" to "authenticated";
grant insert on table "public"."questions" to "authenticated";
grant references on table "public"."questions" to "authenticated";
grant select on table "public"."questions" to "authenticated";
grant trigger on table "public"."questions" to "authenticated";
grant truncate on table "public"."questions" to "authenticated";
grant update on table "public"."questions" to "authenticated";
grant delete on table "public"."questions" to "service_role";
grant insert on table "public"."questions" to "service_role";
grant references on table "public"."questions" to "service_role";
grant select on table "public"."questions" to "service_role";
grant trigger on table "public"."questions" to "service_role";
grant truncate on table "public"."questions" to "service_role";
grant update on table "public"."questions" to "service_role";
grant delete on table "public"."reserved_usernames" to "anon";
grant insert on table "public"."reserved_usernames" to "anon";
grant references on table "public"."reserved_usernames" to "anon";
grant select on table "public"."reserved_usernames" to "anon";
grant trigger on table "public"."reserved_usernames" to "anon";
grant truncate on table "public"."reserved_usernames" to "anon";
grant update on table "public"."reserved_usernames" to "anon";
grant delete on table "public"."reserved_usernames" to "authenticated";
grant insert on table "public"."reserved_usernames" to "authenticated";
grant references on table "public"."reserved_usernames" to "authenticated";
grant select on table "public"."reserved_usernames" to "authenticated";
grant trigger on table "public"."reserved_usernames" to "authenticated";
grant truncate on table "public"."reserved_usernames" to "authenticated";
grant update on table "public"."reserved_usernames" to "authenticated";
grant delete on table "public"."reserved_usernames" to "service_role";
grant insert on table "public"."reserved_usernames" to "service_role";
grant references on table "public"."reserved_usernames" to "service_role";
grant select on table "public"."reserved_usernames" to "service_role";
grant trigger on table "public"."reserved_usernames" to "service_role";
grant truncate on table "public"."reserved_usernames" to "service_role";
grant update on table "public"."reserved_usernames" to "service_role";
grant delete on table "public"."sessions" to "anon";
grant insert on table "public"."sessions" to "anon";
grant references on table "public"."sessions" to "anon";
grant select on table "public"."sessions" to "anon";
grant trigger on table "public"."sessions" to "anon";
grant truncate on table "public"."sessions" to "anon";
grant update on table "public"."sessions" to "anon";
grant delete on table "public"."sessions" to "authenticated";
grant insert on table "public"."sessions" to "authenticated";
grant references on table "public"."sessions" to "authenticated";
grant select on table "public"."sessions" to "authenticated";
grant trigger on table "public"."sessions" to "authenticated";
grant truncate on table "public"."sessions" to "authenticated";
grant update on table "public"."sessions" to "authenticated";
grant delete on table "public"."sessions" to "service_role";
grant insert on table "public"."sessions" to "service_role";
grant references on table "public"."sessions" to "service_role";
grant select on table "public"."sessions" to "service_role";
grant trigger on table "public"."sessions" to "service_role";
grant truncate on table "public"."sessions" to "service_role";
grant update on table "public"."sessions" to "service_role";
grant delete on table "public"."share_click_events" to "anon";
grant insert on table "public"."share_click_events" to "anon";
grant references on table "public"."share_click_events" to "anon";
grant select on table "public"."share_click_events" to "anon";
grant trigger on table "public"."share_click_events" to "anon";
grant truncate on table "public"."share_click_events" to "anon";
grant update on table "public"."share_click_events" to "anon";
grant delete on table "public"."share_click_events" to "authenticated";
grant insert on table "public"."share_click_events" to "authenticated";
grant references on table "public"."share_click_events" to "authenticated";
grant select on table "public"."share_click_events" to "authenticated";
grant trigger on table "public"."share_click_events" to "authenticated";
grant truncate on table "public"."share_click_events" to "authenticated";
grant update on table "public"."share_click_events" to "authenticated";
grant delete on table "public"."share_click_events" to "service_role";
grant insert on table "public"."share_click_events" to "service_role";
grant references on table "public"."share_click_events" to "service_role";
grant select on table "public"."share_click_events" to "service_role";
grant trigger on table "public"."share_click_events" to "service_role";
grant truncate on table "public"."share_click_events" to "service_role";
grant update on table "public"."share_click_events" to "service_role";
grant delete on table "public"."share_events" to "anon";
grant insert on table "public"."share_events" to "anon";
grant references on table "public"."share_events" to "anon";
grant select on table "public"."share_events" to "anon";
grant trigger on table "public"."share_events" to "anon";
grant truncate on table "public"."share_events" to "anon";
grant update on table "public"."share_events" to "anon";
grant delete on table "public"."share_events" to "authenticated";
grant insert on table "public"."share_events" to "authenticated";
grant references on table "public"."share_events" to "authenticated";
grant select on table "public"."share_events" to "authenticated";
grant trigger on table "public"."share_events" to "authenticated";
grant truncate on table "public"."share_events" to "authenticated";
grant update on table "public"."share_events" to "authenticated";
grant delete on table "public"."share_events" to "service_role";
grant insert on table "public"."share_events" to "service_role";
grant references on table "public"."share_events" to "service_role";
grant select on table "public"."share_events" to "service_role";
grant trigger on table "public"."share_events" to "service_role";
grant truncate on table "public"."share_events" to "service_role";
grant update on table "public"."share_events" to "service_role";
grant delete on table "public"."social_auth_tokens" to "anon";
grant insert on table "public"."social_auth_tokens" to "anon";
grant references on table "public"."social_auth_tokens" to "anon";
grant select on table "public"."social_auth_tokens" to "anon";
grant trigger on table "public"."social_auth_tokens" to "anon";
grant truncate on table "public"."social_auth_tokens" to "anon";
grant update on table "public"."social_auth_tokens" to "anon";
grant delete on table "public"."social_auth_tokens" to "authenticated";
grant insert on table "public"."social_auth_tokens" to "authenticated";
grant references on table "public"."social_auth_tokens" to "authenticated";
grant select on table "public"."social_auth_tokens" to "authenticated";
grant trigger on table "public"."social_auth_tokens" to "authenticated";
grant truncate on table "public"."social_auth_tokens" to "authenticated";
grant update on table "public"."social_auth_tokens" to "authenticated";
grant delete on table "public"."social_auth_tokens" to "service_role";
grant insert on table "public"."social_auth_tokens" to "service_role";
grant references on table "public"."social_auth_tokens" to "service_role";
grant select on table "public"."social_auth_tokens" to "service_role";
grant trigger on table "public"."social_auth_tokens" to "service_role";
grant truncate on table "public"."social_auth_tokens" to "service_role";
grant update on table "public"."social_auth_tokens" to "service_role";
grant delete on table "public"."social_reply_inbox" to "anon";
grant insert on table "public"."social_reply_inbox" to "anon";
grant references on table "public"."social_reply_inbox" to "anon";
grant select on table "public"."social_reply_inbox" to "anon";
grant trigger on table "public"."social_reply_inbox" to "anon";
grant truncate on table "public"."social_reply_inbox" to "anon";
grant update on table "public"."social_reply_inbox" to "anon";
grant delete on table "public"."social_reply_inbox" to "authenticated";
grant insert on table "public"."social_reply_inbox" to "authenticated";
grant references on table "public"."social_reply_inbox" to "authenticated";
grant select on table "public"."social_reply_inbox" to "authenticated";
grant trigger on table "public"."social_reply_inbox" to "authenticated";
grant truncate on table "public"."social_reply_inbox" to "authenticated";
grant update on table "public"."social_reply_inbox" to "authenticated";
grant delete on table "public"."social_reply_inbox" to "service_role";
grant insert on table "public"."social_reply_inbox" to "service_role";
grant references on table "public"."social_reply_inbox" to "service_role";
grant select on table "public"."social_reply_inbox" to "service_role";
grant trigger on table "public"."social_reply_inbox" to "service_role";
grant truncate on table "public"."social_reply_inbox" to "service_role";
grant update on table "public"."social_reply_inbox" to "service_role";
grant delete on table "public"."societal_pulse_config" to "anon";
grant insert on table "public"."societal_pulse_config" to "anon";
grant references on table "public"."societal_pulse_config" to "anon";
grant select on table "public"."societal_pulse_config" to "anon";
grant trigger on table "public"."societal_pulse_config" to "anon";
grant truncate on table "public"."societal_pulse_config" to "anon";
grant update on table "public"."societal_pulse_config" to "anon";
grant delete on table "public"."societal_pulse_config" to "authenticated";
grant insert on table "public"."societal_pulse_config" to "authenticated";
grant references on table "public"."societal_pulse_config" to "authenticated";
grant select on table "public"."societal_pulse_config" to "authenticated";
grant trigger on table "public"."societal_pulse_config" to "authenticated";
grant truncate on table "public"."societal_pulse_config" to "authenticated";
grant update on table "public"."societal_pulse_config" to "authenticated";
grant delete on table "public"."societal_pulse_config" to "service_role";
grant insert on table "public"."societal_pulse_config" to "service_role";
grant references on table "public"."societal_pulse_config" to "service_role";
grant select on table "public"."societal_pulse_config" to "service_role";
grant trigger on table "public"."societal_pulse_config" to "service_role";
grant truncate on table "public"."societal_pulse_config" to "service_role";
grant update on table "public"."societal_pulse_config" to "service_role";
grant delete on table "public"."stance_history" to "anon";
grant insert on table "public"."stance_history" to "anon";
grant references on table "public"."stance_history" to "anon";
grant select on table "public"."stance_history" to "anon";
grant trigger on table "public"."stance_history" to "anon";
grant truncate on table "public"."stance_history" to "anon";
grant update on table "public"."stance_history" to "anon";
grant delete on table "public"."stance_history" to "authenticated";
grant insert on table "public"."stance_history" to "authenticated";
grant references on table "public"."stance_history" to "authenticated";
grant select on table "public"."stance_history" to "authenticated";
grant trigger on table "public"."stance_history" to "authenticated";
grant truncate on table "public"."stance_history" to "authenticated";
grant update on table "public"."stance_history" to "authenticated";
grant delete on table "public"."stance_history" to "service_role";
grant insert on table "public"."stance_history" to "service_role";
grant references on table "public"."stance_history" to "service_role";
grant select on table "public"."stance_history" to "service_role";
grant trigger on table "public"."stance_history" to "service_role";
grant truncate on table "public"."stance_history" to "service_role";
grant update on table "public"."stance_history" to "service_role";
grant delete on table "public"."stance_texts" to "anon";
grant insert on table "public"."stance_texts" to "anon";
grant references on table "public"."stance_texts" to "anon";
grant select on table "public"."stance_texts" to "anon";
grant trigger on table "public"."stance_texts" to "anon";
grant truncate on table "public"."stance_texts" to "anon";
grant update on table "public"."stance_texts" to "anon";
grant delete on table "public"."stance_texts" to "authenticated";
grant insert on table "public"."stance_texts" to "authenticated";
grant references on table "public"."stance_texts" to "authenticated";
grant select on table "public"."stance_texts" to "authenticated";
grant trigger on table "public"."stance_texts" to "authenticated";
grant truncate on table "public"."stance_texts" to "authenticated";
grant update on table "public"."stance_texts" to "authenticated";
grant delete on table "public"."stance_texts" to "service_role";
grant insert on table "public"."stance_texts" to "service_role";
grant references on table "public"."stance_texts" to "service_role";
grant select on table "public"."stance_texts" to "service_role";
grant trigger on table "public"."stance_texts" to "service_role";
grant truncate on table "public"."stance_texts" to "service_role";
grant update on table "public"."stance_texts" to "service_role";
grant delete on table "public"."topic_cluster_items" to "anon";
grant insert on table "public"."topic_cluster_items" to "anon";
grant references on table "public"."topic_cluster_items" to "anon";
grant select on table "public"."topic_cluster_items" to "anon";
grant trigger on table "public"."topic_cluster_items" to "anon";
grant truncate on table "public"."topic_cluster_items" to "anon";
grant update on table "public"."topic_cluster_items" to "anon";
grant delete on table "public"."topic_cluster_items" to "authenticated";
grant insert on table "public"."topic_cluster_items" to "authenticated";
grant references on table "public"."topic_cluster_items" to "authenticated";
grant select on table "public"."topic_cluster_items" to "authenticated";
grant trigger on table "public"."topic_cluster_items" to "authenticated";
grant truncate on table "public"."topic_cluster_items" to "authenticated";
grant update on table "public"."topic_cluster_items" to "authenticated";
grant delete on table "public"."topic_cluster_items" to "service_role";
grant insert on table "public"."topic_cluster_items" to "service_role";
grant references on table "public"."topic_cluster_items" to "service_role";
grant select on table "public"."topic_cluster_items" to "service_role";
grant trigger on table "public"."topic_cluster_items" to "service_role";
grant truncate on table "public"."topic_cluster_items" to "service_role";
grant update on table "public"."topic_cluster_items" to "service_role";
grant delete on table "public"."topic_clusters" to "anon";
grant insert on table "public"."topic_clusters" to "anon";
grant references on table "public"."topic_clusters" to "anon";
grant select on table "public"."topic_clusters" to "anon";
grant trigger on table "public"."topic_clusters" to "anon";
grant truncate on table "public"."topic_clusters" to "anon";
grant update on table "public"."topic_clusters" to "anon";
grant delete on table "public"."topic_clusters" to "authenticated";
grant insert on table "public"."topic_clusters" to "authenticated";
grant references on table "public"."topic_clusters" to "authenticated";
grant select on table "public"."topic_clusters" to "authenticated";
grant trigger on table "public"."topic_clusters" to "authenticated";
grant truncate on table "public"."topic_clusters" to "authenticated";
grant update on table "public"."topic_clusters" to "authenticated";
grant delete on table "public"."topic_clusters" to "service_role";
grant insert on table "public"."topic_clusters" to "service_role";
grant references on table "public"."topic_clusters" to "service_role";
grant select on table "public"."topic_clusters" to "service_role";
grant trigger on table "public"."topic_clusters" to "service_role";
grant truncate on table "public"."topic_clusters" to "service_role";
grant update on table "public"."topic_clusters" to "service_role";
grant delete on table "public"."topic_drafts" to "anon";
grant insert on table "public"."topic_drafts" to "anon";
grant references on table "public"."topic_drafts" to "anon";
grant select on table "public"."topic_drafts" to "anon";
grant trigger on table "public"."topic_drafts" to "anon";
grant truncate on table "public"."topic_drafts" to "anon";
grant update on table "public"."topic_drafts" to "anon";
grant delete on table "public"."topic_drafts" to "authenticated";
grant insert on table "public"."topic_drafts" to "authenticated";
grant references on table "public"."topic_drafts" to "authenticated";
grant select on table "public"."topic_drafts" to "authenticated";
grant trigger on table "public"."topic_drafts" to "authenticated";
grant truncate on table "public"."topic_drafts" to "authenticated";
grant update on table "public"."topic_drafts" to "authenticated";
grant delete on table "public"."topic_drafts" to "service_role";
grant insert on table "public"."topic_drafts" to "service_role";
grant references on table "public"."topic_drafts" to "service_role";
grant select on table "public"."topic_drafts" to "service_role";
grant trigger on table "public"."topic_drafts" to "service_role";
grant truncate on table "public"."topic_drafts" to "service_role";
grant update on table "public"."topic_drafts" to "service_role";
grant delete on table "public"."topic_impact_scores" to "anon";
grant insert on table "public"."topic_impact_scores" to "anon";
grant references on table "public"."topic_impact_scores" to "anon";
grant select on table "public"."topic_impact_scores" to "anon";
grant trigger on table "public"."topic_impact_scores" to "anon";
grant truncate on table "public"."topic_impact_scores" to "anon";
grant update on table "public"."topic_impact_scores" to "anon";
grant delete on table "public"."topic_impact_scores" to "authenticated";
grant insert on table "public"."topic_impact_scores" to "authenticated";
grant references on table "public"."topic_impact_scores" to "authenticated";
grant select on table "public"."topic_impact_scores" to "authenticated";
grant trigger on table "public"."topic_impact_scores" to "authenticated";
grant truncate on table "public"."topic_impact_scores" to "authenticated";
grant update on table "public"."topic_impact_scores" to "authenticated";
grant delete on table "public"."topic_impact_scores" to "service_role";
grant insert on table "public"."topic_impact_scores" to "service_role";
grant references on table "public"."topic_impact_scores" to "service_role";
grant select on table "public"."topic_impact_scores" to "service_role";
grant trigger on table "public"."topic_impact_scores" to "service_role";
grant truncate on table "public"."topic_impact_scores" to "service_role";
grant update on table "public"."topic_impact_scores" to "service_role";
grant delete on table "public"."topic_region_trends" to "anon";
grant insert on table "public"."topic_region_trends" to "anon";
grant references on table "public"."topic_region_trends" to "anon";
grant select on table "public"."topic_region_trends" to "anon";
grant trigger on table "public"."topic_region_trends" to "anon";
grant truncate on table "public"."topic_region_trends" to "anon";
grant update on table "public"."topic_region_trends" to "anon";
grant delete on table "public"."topic_region_trends" to "authenticated";
grant insert on table "public"."topic_region_trends" to "authenticated";
grant references on table "public"."topic_region_trends" to "authenticated";
grant select on table "public"."topic_region_trends" to "authenticated";
grant trigger on table "public"."topic_region_trends" to "authenticated";
grant truncate on table "public"."topic_region_trends" to "authenticated";
grant update on table "public"."topic_region_trends" to "authenticated";
grant delete on table "public"."topic_region_trends" to "service_role";
grant insert on table "public"."topic_region_trends" to "service_role";
grant references on table "public"."topic_region_trends" to "service_role";
grant select on table "public"."topic_region_trends" to "service_role";
grant trigger on table "public"."topic_region_trends" to "service_role";
grant truncate on table "public"."topic_region_trends" to "service_role";
grant update on table "public"."topic_region_trends" to "service_role";
grant delete on table "public"."topic_regions" to "anon";
grant insert on table "public"."topic_regions" to "anon";
grant references on table "public"."topic_regions" to "anon";
grant select on table "public"."topic_regions" to "anon";
grant trigger on table "public"."topic_regions" to "anon";
grant truncate on table "public"."topic_regions" to "anon";
grant update on table "public"."topic_regions" to "anon";
grant delete on table "public"."topic_regions" to "authenticated";
grant insert on table "public"."topic_regions" to "authenticated";
grant references on table "public"."topic_regions" to "authenticated";
grant select on table "public"."topic_regions" to "authenticated";
grant trigger on table "public"."topic_regions" to "authenticated";
grant truncate on table "public"."topic_regions" to "authenticated";
grant update on table "public"."topic_regions" to "authenticated";
grant delete on table "public"."topic_regions" to "service_role";
grant insert on table "public"."topic_regions" to "service_role";
grant references on table "public"."topic_regions" to "service_role";
grant select on table "public"."topic_regions" to "service_role";
grant trigger on table "public"."topic_regions" to "service_role";
grant truncate on table "public"."topic_regions" to "service_role";
grant update on table "public"."topic_regions" to "service_role";
grant delete on table "public"."topic_sources" to "anon";
grant insert on table "public"."topic_sources" to "anon";
grant references on table "public"."topic_sources" to "anon";
grant select on table "public"."topic_sources" to "anon";
grant trigger on table "public"."topic_sources" to "anon";
grant truncate on table "public"."topic_sources" to "anon";
grant update on table "public"."topic_sources" to "anon";
grant delete on table "public"."topic_sources" to "authenticated";
grant insert on table "public"."topic_sources" to "authenticated";
grant references on table "public"."topic_sources" to "authenticated";
grant select on table "public"."topic_sources" to "authenticated";
grant trigger on table "public"."topic_sources" to "authenticated";
grant truncate on table "public"."topic_sources" to "authenticated";
grant update on table "public"."topic_sources" to "authenticated";
grant delete on table "public"."topic_sources" to "service_role";
grant insert on table "public"."topic_sources" to "service_role";
grant references on table "public"."topic_sources" to "service_role";
grant select on table "public"."topic_sources" to "service_role";
grant trigger on table "public"."topic_sources" to "service_role";
grant truncate on table "public"."topic_sources" to "service_role";
grant update on table "public"."topic_sources" to "service_role";
grant delete on table "public"."topics" to "anon";
grant insert on table "public"."topics" to "anon";
grant references on table "public"."topics" to "anon";
grant select on table "public"."topics" to "anon";
grant trigger on table "public"."topics" to "anon";
grant truncate on table "public"."topics" to "anon";
grant update on table "public"."topics" to "anon";
grant delete on table "public"."topics" to "authenticated";
grant insert on table "public"."topics" to "authenticated";
grant references on table "public"."topics" to "authenticated";
grant select on table "public"."topics" to "authenticated";
grant trigger on table "public"."topics" to "authenticated";
grant truncate on table "public"."topics" to "authenticated";
grant update on table "public"."topics" to "authenticated";
grant delete on table "public"."topics" to "service_role";
grant insert on table "public"."topics" to "service_role";
grant references on table "public"."topics" to "service_role";
grant select on table "public"."topics" to "service_role";
grant trigger on table "public"."topics" to "service_role";
grant truncate on table "public"."topics" to "service_role";
grant update on table "public"."topics" to "service_role";
grant delete on table "public"."toxicity_scores" to "anon";
grant insert on table "public"."toxicity_scores" to "anon";
grant references on table "public"."toxicity_scores" to "anon";
grant select on table "public"."toxicity_scores" to "anon";
grant trigger on table "public"."toxicity_scores" to "anon";
grant truncate on table "public"."toxicity_scores" to "anon";
grant update on table "public"."toxicity_scores" to "anon";
grant delete on table "public"."toxicity_scores" to "authenticated";
grant insert on table "public"."toxicity_scores" to "authenticated";
grant references on table "public"."toxicity_scores" to "authenticated";
grant select on table "public"."toxicity_scores" to "authenticated";
grant trigger on table "public"."toxicity_scores" to "authenticated";
grant truncate on table "public"."toxicity_scores" to "authenticated";
grant update on table "public"."toxicity_scores" to "authenticated";
grant delete on table "public"."toxicity_scores" to "service_role";
grant insert on table "public"."toxicity_scores" to "service_role";
grant references on table "public"."toxicity_scores" to "service_role";
grant select on table "public"."toxicity_scores" to "service_role";
grant trigger on table "public"."toxicity_scores" to "service_role";
grant truncate on table "public"."toxicity_scores" to "service_role";
grant update on table "public"."toxicity_scores" to "service_role";
grant delete on table "public"."user_cognitive_states" to "anon";
grant insert on table "public"."user_cognitive_states" to "anon";
grant references on table "public"."user_cognitive_states" to "anon";
grant select on table "public"."user_cognitive_states" to "anon";
grant trigger on table "public"."user_cognitive_states" to "anon";
grant truncate on table "public"."user_cognitive_states" to "anon";
grant update on table "public"."user_cognitive_states" to "anon";
grant delete on table "public"."user_cognitive_states" to "authenticated";
grant insert on table "public"."user_cognitive_states" to "authenticated";
grant references on table "public"."user_cognitive_states" to "authenticated";
grant select on table "public"."user_cognitive_states" to "authenticated";
grant trigger on table "public"."user_cognitive_states" to "authenticated";
grant truncate on table "public"."user_cognitive_states" to "authenticated";
grant update on table "public"."user_cognitive_states" to "authenticated";
grant delete on table "public"."user_cognitive_states" to "service_role";
grant insert on table "public"."user_cognitive_states" to "service_role";
grant references on table "public"."user_cognitive_states" to "service_role";
grant select on table "public"."user_cognitive_states" to "service_role";
grant trigger on table "public"."user_cognitive_states" to "service_role";
grant truncate on table "public"."user_cognitive_states" to "service_role";
grant update on table "public"."user_cognitive_states" to "service_role";
grant delete on table "public"."user_follows" to "anon";
grant insert on table "public"."user_follows" to "anon";
grant references on table "public"."user_follows" to "anon";
grant select on table "public"."user_follows" to "anon";
grant trigger on table "public"."user_follows" to "anon";
grant truncate on table "public"."user_follows" to "anon";
grant update on table "public"."user_follows" to "anon";
grant delete on table "public"."user_follows" to "authenticated";
grant insert on table "public"."user_follows" to "authenticated";
grant references on table "public"."user_follows" to "authenticated";
grant select on table "public"."user_follows" to "authenticated";
grant trigger on table "public"."user_follows" to "authenticated";
grant truncate on table "public"."user_follows" to "authenticated";
grant update on table "public"."user_follows" to "authenticated";
grant delete on table "public"."user_follows" to "service_role";
grant insert on table "public"."user_follows" to "service_role";
grant references on table "public"."user_follows" to "service_role";
grant select on table "public"."user_follows" to "service_role";
grant trigger on table "public"."user_follows" to "service_role";
grant truncate on table "public"."user_follows" to "service_role";
grant update on table "public"."user_follows" to "service_role";
grant delete on table "public"."user_location_settings" to "anon";
grant insert on table "public"."user_location_settings" to "anon";
grant references on table "public"."user_location_settings" to "anon";
grant select on table "public"."user_location_settings" to "anon";
grant trigger on table "public"."user_location_settings" to "anon";
grant truncate on table "public"."user_location_settings" to "anon";
grant update on table "public"."user_location_settings" to "anon";
grant delete on table "public"."user_location_settings" to "authenticated";
grant insert on table "public"."user_location_settings" to "authenticated";
grant references on table "public"."user_location_settings" to "authenticated";
grant select on table "public"."user_location_settings" to "authenticated";
grant trigger on table "public"."user_location_settings" to "authenticated";
grant truncate on table "public"."user_location_settings" to "authenticated";
grant update on table "public"."user_location_settings" to "authenticated";
grant delete on table "public"."user_location_settings" to "service_role";
grant insert on table "public"."user_location_settings" to "service_role";
grant references on table "public"."user_location_settings" to "service_role";
grant select on table "public"."user_location_settings" to "service_role";
grant trigger on table "public"."user_location_settings" to "service_role";
grant truncate on table "public"."user_location_settings" to "service_role";
grant update on table "public"."user_location_settings" to "service_role";
grant delete on table "public"."user_notifications" to "anon";
grant insert on table "public"."user_notifications" to "anon";
grant references on table "public"."user_notifications" to "anon";
grant select on table "public"."user_notifications" to "anon";
grant trigger on table "public"."user_notifications" to "anon";
grant truncate on table "public"."user_notifications" to "anon";
grant update on table "public"."user_notifications" to "anon";
grant delete on table "public"."user_notifications" to "authenticated";
grant insert on table "public"."user_notifications" to "authenticated";
grant references on table "public"."user_notifications" to "authenticated";
grant select on table "public"."user_notifications" to "authenticated";
grant trigger on table "public"."user_notifications" to "authenticated";
grant truncate on table "public"."user_notifications" to "authenticated";
grant update on table "public"."user_notifications" to "authenticated";
grant delete on table "public"."user_notifications" to "service_role";
grant insert on table "public"."user_notifications" to "service_role";
grant references on table "public"."user_notifications" to "service_role";
grant select on table "public"."user_notifications" to "service_role";
grant trigger on table "public"."user_notifications" to "service_role";
grant truncate on table "public"."user_notifications" to "service_role";
grant update on table "public"."user_notifications" to "service_role";
grant delete on table "public"."user_privacy" to "anon";
grant insert on table "public"."user_privacy" to "anon";
grant references on table "public"."user_privacy" to "anon";
grant select on table "public"."user_privacy" to "anon";
grant trigger on table "public"."user_privacy" to "anon";
grant truncate on table "public"."user_privacy" to "anon";
grant update on table "public"."user_privacy" to "anon";
grant delete on table "public"."user_privacy" to "authenticated";
grant insert on table "public"."user_privacy" to "authenticated";
grant references on table "public"."user_privacy" to "authenticated";
grant select on table "public"."user_privacy" to "authenticated";
grant trigger on table "public"."user_privacy" to "authenticated";
grant truncate on table "public"."user_privacy" to "authenticated";
grant update on table "public"."user_privacy" to "authenticated";
grant delete on table "public"."user_privacy" to "service_role";
grant insert on table "public"."user_privacy" to "service_role";
grant references on table "public"."user_privacy" to "service_role";
grant select on table "public"."user_privacy" to "service_role";
grant trigger on table "public"."user_privacy" to "service_role";
grant truncate on table "public"."user_privacy" to "service_role";
grant update on table "public"."user_privacy" to "service_role";
grant delete on table "public"."user_region_follows" to "anon";
grant insert on table "public"."user_region_follows" to "anon";
grant references on table "public"."user_region_follows" to "anon";
grant select on table "public"."user_region_follows" to "anon";
grant trigger on table "public"."user_region_follows" to "anon";
grant truncate on table "public"."user_region_follows" to "anon";
grant update on table "public"."user_region_follows" to "anon";
grant delete on table "public"."user_region_follows" to "authenticated";
grant insert on table "public"."user_region_follows" to "authenticated";
grant references on table "public"."user_region_follows" to "authenticated";
grant select on table "public"."user_region_follows" to "authenticated";
grant trigger on table "public"."user_region_follows" to "authenticated";
grant truncate on table "public"."user_region_follows" to "authenticated";
grant update on table "public"."user_region_follows" to "authenticated";
grant delete on table "public"."user_region_follows" to "service_role";
grant insert on table "public"."user_region_follows" to "service_role";
grant references on table "public"."user_region_follows" to "service_role";
grant select on table "public"."user_region_follows" to "service_role";
grant trigger on table "public"."user_region_follows" to "service_role";
grant truncate on table "public"."user_region_follows" to "service_role";
grant update on table "public"."user_region_follows" to "service_role";
grant delete on table "public"."user_region_preferences" to "anon";
grant insert on table "public"."user_region_preferences" to "anon";
grant references on table "public"."user_region_preferences" to "anon";
grant select on table "public"."user_region_preferences" to "anon";
grant trigger on table "public"."user_region_preferences" to "anon";
grant truncate on table "public"."user_region_preferences" to "anon";
grant update on table "public"."user_region_preferences" to "anon";
grant delete on table "public"."user_region_preferences" to "authenticated";
grant insert on table "public"."user_region_preferences" to "authenticated";
grant references on table "public"."user_region_preferences" to "authenticated";
grant select on table "public"."user_region_preferences" to "authenticated";
grant trigger on table "public"."user_region_preferences" to "authenticated";
grant truncate on table "public"."user_region_preferences" to "authenticated";
grant update on table "public"."user_region_preferences" to "authenticated";
grant delete on table "public"."user_region_preferences" to "service_role";
grant insert on table "public"."user_region_preferences" to "service_role";
grant references on table "public"."user_region_preferences" to "service_role";
grant select on table "public"."user_region_preferences" to "service_role";
grant trigger on table "public"."user_region_preferences" to "service_role";
grant truncate on table "public"."user_region_preferences" to "service_role";
grant update on table "public"."user_region_preferences" to "service_role";
grant delete on table "public"."user_restrictions" to "anon";
grant insert on table "public"."user_restrictions" to "anon";
grant references on table "public"."user_restrictions" to "anon";
grant select on table "public"."user_restrictions" to "anon";
grant trigger on table "public"."user_restrictions" to "anon";
grant truncate on table "public"."user_restrictions" to "anon";
grant update on table "public"."user_restrictions" to "anon";
grant delete on table "public"."user_restrictions" to "authenticated";
grant insert on table "public"."user_restrictions" to "authenticated";
grant references on table "public"."user_restrictions" to "authenticated";
grant select on table "public"."user_restrictions" to "authenticated";
grant trigger on table "public"."user_restrictions" to "authenticated";
grant truncate on table "public"."user_restrictions" to "authenticated";
grant update on table "public"."user_restrictions" to "authenticated";
grant delete on table "public"."user_restrictions" to "service_role";
grant insert on table "public"."user_restrictions" to "service_role";
grant references on table "public"."user_restrictions" to "service_role";
grant select on table "public"."user_restrictions" to "service_role";
grant trigger on table "public"."user_restrictions" to "service_role";
grant truncate on table "public"."user_restrictions" to "service_role";
grant update on table "public"."user_restrictions" to "service_role";
grant delete on table "public"."user_topic_follows" to "anon";
grant insert on table "public"."user_topic_follows" to "anon";
grant references on table "public"."user_topic_follows" to "anon";
grant select on table "public"."user_topic_follows" to "anon";
grant trigger on table "public"."user_topic_follows" to "anon";
grant truncate on table "public"."user_topic_follows" to "anon";
grant update on table "public"."user_topic_follows" to "anon";
grant delete on table "public"."user_topic_follows" to "authenticated";
grant insert on table "public"."user_topic_follows" to "authenticated";
grant references on table "public"."user_topic_follows" to "authenticated";
grant select on table "public"."user_topic_follows" to "authenticated";
grant trigger on table "public"."user_topic_follows" to "authenticated";
grant truncate on table "public"."user_topic_follows" to "authenticated";
grant update on table "public"."user_topic_follows" to "authenticated";
grant delete on table "public"."user_topic_follows" to "service_role";
grant insert on table "public"."user_topic_follows" to "service_role";
grant references on table "public"."user_topic_follows" to "service_role";
grant select on table "public"."user_topic_follows" to "service_role";
grant trigger on table "public"."user_topic_follows" to "service_role";
grant truncate on table "public"."user_topic_follows" to "service_role";
grant update on table "public"."user_topic_follows" to "service_role";
grant delete on table "public"."user_topic_interactions" to "anon";
grant insert on table "public"."user_topic_interactions" to "anon";
grant references on table "public"."user_topic_interactions" to "anon";
grant select on table "public"."user_topic_interactions" to "anon";
grant trigger on table "public"."user_topic_interactions" to "anon";
grant truncate on table "public"."user_topic_interactions" to "anon";
grant update on table "public"."user_topic_interactions" to "anon";
grant delete on table "public"."user_topic_interactions" to "authenticated";
grant insert on table "public"."user_topic_interactions" to "authenticated";
grant references on table "public"."user_topic_interactions" to "authenticated";
grant select on table "public"."user_topic_interactions" to "authenticated";
grant trigger on table "public"."user_topic_interactions" to "authenticated";
grant truncate on table "public"."user_topic_interactions" to "authenticated";
grant update on table "public"."user_topic_interactions" to "authenticated";
grant delete on table "public"."user_topic_interactions" to "service_role";
grant insert on table "public"."user_topic_interactions" to "service_role";
grant references on table "public"."user_topic_interactions" to "service_role";
grant select on table "public"."user_topic_interactions" to "service_role";
grant trigger on table "public"."user_topic_interactions" to "service_role";
grant truncate on table "public"."user_topic_interactions" to "service_role";
grant update on table "public"."user_topic_interactions" to "service_role";
grant delete on table "public"."username_history" to "anon";
grant insert on table "public"."username_history" to "anon";
grant references on table "public"."username_history" to "anon";
grant select on table "public"."username_history" to "anon";
grant trigger on table "public"."username_history" to "anon";
grant truncate on table "public"."username_history" to "anon";
grant update on table "public"."username_history" to "anon";
grant delete on table "public"."username_history" to "authenticated";
grant insert on table "public"."username_history" to "authenticated";
grant references on table "public"."username_history" to "authenticated";
grant select on table "public"."username_history" to "authenticated";
grant trigger on table "public"."username_history" to "authenticated";
grant truncate on table "public"."username_history" to "authenticated";
grant update on table "public"."username_history" to "authenticated";
grant delete on table "public"."username_history" to "service_role";
grant insert on table "public"."username_history" to "service_role";
grant references on table "public"."username_history" to "service_role";
grant select on table "public"."username_history" to "service_role";
grant trigger on table "public"."username_history" to "service_role";
grant truncate on table "public"."username_history" to "service_role";
grant update on table "public"."username_history" to "service_role";
grant delete on table "public"."users" to "anon";
grant insert on table "public"."users" to "anon";
grant references on table "public"."users" to "anon";
grant select on table "public"."users" to "anon";
grant trigger on table "public"."users" to "anon";
grant truncate on table "public"."users" to "anon";
grant update on table "public"."users" to "anon";
grant delete on table "public"."users" to "authenticated";
grant insert on table "public"."users" to "authenticated";
grant references on table "public"."users" to "authenticated";
grant select on table "public"."users" to "authenticated";
grant trigger on table "public"."users" to "authenticated";
grant truncate on table "public"."users" to "authenticated";
grant update on table "public"."users" to "authenticated";
grant delete on table "public"."users" to "service_role";
grant insert on table "public"."users" to "service_role";
grant references on table "public"."users" to "service_role";
grant select on table "public"."users" to "service_role";
grant trigger on table "public"."users" to "service_role";
grant truncate on table "public"."users" to "service_role";
grant update on table "public"."users" to "service_role";
grant delete on table "public"."v_total_articles" to "anon";
grant insert on table "public"."v_total_articles" to "anon";
grant references on table "public"."v_total_articles" to "anon";
grant select on table "public"."v_total_articles" to "anon";
grant trigger on table "public"."v_total_articles" to "anon";
grant truncate on table "public"."v_total_articles" to "anon";
grant update on table "public"."v_total_articles" to "anon";
grant delete on table "public"."v_total_articles" to "authenticated";
grant insert on table "public"."v_total_articles" to "authenticated";
grant references on table "public"."v_total_articles" to "authenticated";
grant select on table "public"."v_total_articles" to "authenticated";
grant trigger on table "public"."v_total_articles" to "authenticated";
grant truncate on table "public"."v_total_articles" to "authenticated";
grant update on table "public"."v_total_articles" to "authenticated";
grant delete on table "public"."v_total_articles" to "service_role";
grant insert on table "public"."v_total_articles" to "service_role";
grant references on table "public"."v_total_articles" to "service_role";
grant select on table "public"."v_total_articles" to "service_role";
grant trigger on table "public"."v_total_articles" to "service_role";
grant truncate on table "public"."v_total_articles" to "service_role";
grant update on table "public"."v_total_articles" to "service_role";
grant delete on table "public"."weekly_digests" to "anon";
grant insert on table "public"."weekly_digests" to "anon";
grant references on table "public"."weekly_digests" to "anon";
grant select on table "public"."weekly_digests" to "anon";
grant trigger on table "public"."weekly_digests" to "anon";
grant truncate on table "public"."weekly_digests" to "anon";
grant update on table "public"."weekly_digests" to "anon";
grant delete on table "public"."weekly_digests" to "authenticated";
grant insert on table "public"."weekly_digests" to "authenticated";
grant references on table "public"."weekly_digests" to "authenticated";
grant select on table "public"."weekly_digests" to "authenticated";
grant trigger on table "public"."weekly_digests" to "authenticated";
grant truncate on table "public"."weekly_digests" to "authenticated";
grant update on table "public"."weekly_digests" to "authenticated";
grant delete on table "public"."weekly_digests" to "service_role";
grant insert on table "public"."weekly_digests" to "service_role";
grant references on table "public"."weekly_digests" to "service_role";
grant select on table "public"."weekly_digests" to "service_role";
grant trigger on table "public"."weekly_digests" to "service_role";
grant truncate on table "public"."weekly_digests" to "service_role";
grant update on table "public"."weekly_digests" to "service_role";
grant delete on table "public"."whatsapp_active_sessions" to "anon";
grant insert on table "public"."whatsapp_active_sessions" to "anon";
grant references on table "public"."whatsapp_active_sessions" to "anon";
grant select on table "public"."whatsapp_active_sessions" to "anon";
grant trigger on table "public"."whatsapp_active_sessions" to "anon";
grant truncate on table "public"."whatsapp_active_sessions" to "anon";
grant update on table "public"."whatsapp_active_sessions" to "anon";
grant delete on table "public"."whatsapp_active_sessions" to "authenticated";
grant insert on table "public"."whatsapp_active_sessions" to "authenticated";
grant references on table "public"."whatsapp_active_sessions" to "authenticated";
grant select on table "public"."whatsapp_active_sessions" to "authenticated";
grant trigger on table "public"."whatsapp_active_sessions" to "authenticated";
grant truncate on table "public"."whatsapp_active_sessions" to "authenticated";
grant update on table "public"."whatsapp_active_sessions" to "authenticated";
grant delete on table "public"."whatsapp_active_sessions" to "service_role";
grant insert on table "public"."whatsapp_active_sessions" to "service_role";
grant references on table "public"."whatsapp_active_sessions" to "service_role";
grant select on table "public"."whatsapp_active_sessions" to "service_role";
grant trigger on table "public"."whatsapp_active_sessions" to "service_role";
grant truncate on table "public"."whatsapp_active_sessions" to "service_role";
grant update on table "public"."whatsapp_active_sessions" to "service_role";
grant delete on table "public"."whatsapp_broadcasts" to "anon";
grant insert on table "public"."whatsapp_broadcasts" to "anon";
grant references on table "public"."whatsapp_broadcasts" to "anon";
grant select on table "public"."whatsapp_broadcasts" to "anon";
grant trigger on table "public"."whatsapp_broadcasts" to "anon";
grant truncate on table "public"."whatsapp_broadcasts" to "anon";
grant update on table "public"."whatsapp_broadcasts" to "anon";
grant delete on table "public"."whatsapp_broadcasts" to "authenticated";
grant insert on table "public"."whatsapp_broadcasts" to "authenticated";
grant references on table "public"."whatsapp_broadcasts" to "authenticated";
grant select on table "public"."whatsapp_broadcasts" to "authenticated";
grant trigger on table "public"."whatsapp_broadcasts" to "authenticated";
grant truncate on table "public"."whatsapp_broadcasts" to "authenticated";
grant update on table "public"."whatsapp_broadcasts" to "authenticated";
grant delete on table "public"."whatsapp_broadcasts" to "service_role";
grant insert on table "public"."whatsapp_broadcasts" to "service_role";
grant references on table "public"."whatsapp_broadcasts" to "service_role";
grant select on table "public"."whatsapp_broadcasts" to "service_role";
grant trigger on table "public"."whatsapp_broadcasts" to "service_role";
grant truncate on table "public"."whatsapp_broadcasts" to "service_role";
grant update on table "public"."whatsapp_broadcasts" to "service_role";
grant delete on table "public"."whatsapp_config" to "anon";
grant insert on table "public"."whatsapp_config" to "anon";
grant references on table "public"."whatsapp_config" to "anon";
grant select on table "public"."whatsapp_config" to "anon";
grant trigger on table "public"."whatsapp_config" to "anon";
grant truncate on table "public"."whatsapp_config" to "anon";
grant update on table "public"."whatsapp_config" to "anon";
grant delete on table "public"."whatsapp_config" to "authenticated";
grant insert on table "public"."whatsapp_config" to "authenticated";
grant references on table "public"."whatsapp_config" to "authenticated";
grant select on table "public"."whatsapp_config" to "authenticated";
grant trigger on table "public"."whatsapp_config" to "authenticated";
grant truncate on table "public"."whatsapp_config" to "authenticated";
grant update on table "public"."whatsapp_config" to "authenticated";
grant delete on table "public"."whatsapp_config" to "service_role";
grant insert on table "public"."whatsapp_config" to "service_role";
grant references on table "public"."whatsapp_config" to "service_role";
grant select on table "public"."whatsapp_config" to "service_role";
grant trigger on table "public"."whatsapp_config" to "service_role";
grant truncate on table "public"."whatsapp_config" to "service_role";
grant update on table "public"."whatsapp_config" to "service_role";
grant delete on table "public"."whatsapp_contact_list_numbers" to "anon";
grant insert on table "public"."whatsapp_contact_list_numbers" to "anon";
grant references on table "public"."whatsapp_contact_list_numbers" to "anon";
grant select on table "public"."whatsapp_contact_list_numbers" to "anon";
grant trigger on table "public"."whatsapp_contact_list_numbers" to "anon";
grant truncate on table "public"."whatsapp_contact_list_numbers" to "anon";
grant update on table "public"."whatsapp_contact_list_numbers" to "anon";
grant delete on table "public"."whatsapp_contact_list_numbers" to "authenticated";
grant insert on table "public"."whatsapp_contact_list_numbers" to "authenticated";
grant references on table "public"."whatsapp_contact_list_numbers" to "authenticated";
grant select on table "public"."whatsapp_contact_list_numbers" to "authenticated";
grant trigger on table "public"."whatsapp_contact_list_numbers" to "authenticated";
grant truncate on table "public"."whatsapp_contact_list_numbers" to "authenticated";
grant update on table "public"."whatsapp_contact_list_numbers" to "authenticated";
grant delete on table "public"."whatsapp_contact_list_numbers" to "service_role";
grant insert on table "public"."whatsapp_contact_list_numbers" to "service_role";
grant references on table "public"."whatsapp_contact_list_numbers" to "service_role";
grant select on table "public"."whatsapp_contact_list_numbers" to "service_role";
grant trigger on table "public"."whatsapp_contact_list_numbers" to "service_role";
grant truncate on table "public"."whatsapp_contact_list_numbers" to "service_role";
grant update on table "public"."whatsapp_contact_list_numbers" to "service_role";
grant delete on table "public"."whatsapp_contact_lists" to "anon";
grant insert on table "public"."whatsapp_contact_lists" to "anon";
grant references on table "public"."whatsapp_contact_lists" to "anon";
grant select on table "public"."whatsapp_contact_lists" to "anon";
grant trigger on table "public"."whatsapp_contact_lists" to "anon";
grant truncate on table "public"."whatsapp_contact_lists" to "anon";
grant update on table "public"."whatsapp_contact_lists" to "anon";
grant delete on table "public"."whatsapp_contact_lists" to "authenticated";
grant insert on table "public"."whatsapp_contact_lists" to "authenticated";
grant references on table "public"."whatsapp_contact_lists" to "authenticated";
grant select on table "public"."whatsapp_contact_lists" to "authenticated";
grant trigger on table "public"."whatsapp_contact_lists" to "authenticated";
grant truncate on table "public"."whatsapp_contact_lists" to "authenticated";
grant update on table "public"."whatsapp_contact_lists" to "authenticated";
grant delete on table "public"."whatsapp_contact_lists" to "service_role";
grant insert on table "public"."whatsapp_contact_lists" to "service_role";
grant references on table "public"."whatsapp_contact_lists" to "service_role";
grant select on table "public"."whatsapp_contact_lists" to "service_role";
grant trigger on table "public"."whatsapp_contact_lists" to "service_role";
grant truncate on table "public"."whatsapp_contact_lists" to "service_role";
grant update on table "public"."whatsapp_contact_lists" to "service_role";
grant delete on table "public"."whatsapp_delivery_log" to "anon";
grant insert on table "public"."whatsapp_delivery_log" to "anon";
grant references on table "public"."whatsapp_delivery_log" to "anon";
grant select on table "public"."whatsapp_delivery_log" to "anon";
grant trigger on table "public"."whatsapp_delivery_log" to "anon";
grant truncate on table "public"."whatsapp_delivery_log" to "anon";
grant update on table "public"."whatsapp_delivery_log" to "anon";
grant delete on table "public"."whatsapp_delivery_log" to "authenticated";
grant insert on table "public"."whatsapp_delivery_log" to "authenticated";
grant references on table "public"."whatsapp_delivery_log" to "authenticated";
grant select on table "public"."whatsapp_delivery_log" to "authenticated";
grant trigger on table "public"."whatsapp_delivery_log" to "authenticated";
grant truncate on table "public"."whatsapp_delivery_log" to "authenticated";
grant update on table "public"."whatsapp_delivery_log" to "authenticated";
grant delete on table "public"."whatsapp_delivery_log" to "service_role";
grant insert on table "public"."whatsapp_delivery_log" to "service_role";
grant references on table "public"."whatsapp_delivery_log" to "service_role";
grant select on table "public"."whatsapp_delivery_log" to "service_role";
grant trigger on table "public"."whatsapp_delivery_log" to "service_role";
grant truncate on table "public"."whatsapp_delivery_log" to "service_role";
grant update on table "public"."whatsapp_delivery_log" to "service_role";
grant delete on table "public"."whatsapp_forward_chains" to "anon";
grant insert on table "public"."whatsapp_forward_chains" to "anon";
grant references on table "public"."whatsapp_forward_chains" to "anon";
grant select on table "public"."whatsapp_forward_chains" to "anon";
grant trigger on table "public"."whatsapp_forward_chains" to "anon";
grant truncate on table "public"."whatsapp_forward_chains" to "anon";
grant update on table "public"."whatsapp_forward_chains" to "anon";
grant delete on table "public"."whatsapp_forward_chains" to "authenticated";
grant insert on table "public"."whatsapp_forward_chains" to "authenticated";
grant references on table "public"."whatsapp_forward_chains" to "authenticated";
grant select on table "public"."whatsapp_forward_chains" to "authenticated";
grant trigger on table "public"."whatsapp_forward_chains" to "authenticated";
grant truncate on table "public"."whatsapp_forward_chains" to "authenticated";
grant update on table "public"."whatsapp_forward_chains" to "authenticated";
grant delete on table "public"."whatsapp_forward_chains" to "service_role";
grant insert on table "public"."whatsapp_forward_chains" to "service_role";
grant references on table "public"."whatsapp_forward_chains" to "service_role";
grant select on table "public"."whatsapp_forward_chains" to "service_role";
grant trigger on table "public"."whatsapp_forward_chains" to "service_role";
grant truncate on table "public"."whatsapp_forward_chains" to "service_role";
grant update on table "public"."whatsapp_forward_chains" to "service_role";
grant delete on table "public"."whatsapp_optouts" to "anon";
grant insert on table "public"."whatsapp_optouts" to "anon";
grant references on table "public"."whatsapp_optouts" to "anon";
grant select on table "public"."whatsapp_optouts" to "anon";
grant trigger on table "public"."whatsapp_optouts" to "anon";
grant truncate on table "public"."whatsapp_optouts" to "anon";
grant update on table "public"."whatsapp_optouts" to "anon";
grant delete on table "public"."whatsapp_optouts" to "authenticated";
grant insert on table "public"."whatsapp_optouts" to "authenticated";
grant references on table "public"."whatsapp_optouts" to "authenticated";
grant select on table "public"."whatsapp_optouts" to "authenticated";
grant trigger on table "public"."whatsapp_optouts" to "authenticated";
grant truncate on table "public"."whatsapp_optouts" to "authenticated";
grant update on table "public"."whatsapp_optouts" to "authenticated";
grant delete on table "public"."whatsapp_optouts" to "service_role";
grant insert on table "public"."whatsapp_optouts" to "service_role";
grant references on table "public"."whatsapp_optouts" to "service_role";
grant select on table "public"."whatsapp_optouts" to "service_role";
grant trigger on table "public"."whatsapp_optouts" to "service_role";
grant truncate on table "public"."whatsapp_optouts" to "service_role";
grant update on table "public"."whatsapp_optouts" to "service_role";
grant delete on table "public"."whatsapp_phone_verifications" to "anon";
grant insert on table "public"."whatsapp_phone_verifications" to "anon";
grant references on table "public"."whatsapp_phone_verifications" to "anon";
grant select on table "public"."whatsapp_phone_verifications" to "anon";
grant trigger on table "public"."whatsapp_phone_verifications" to "anon";
grant truncate on table "public"."whatsapp_phone_verifications" to "anon";
grant update on table "public"."whatsapp_phone_verifications" to "anon";
grant delete on table "public"."whatsapp_phone_verifications" to "authenticated";
grant insert on table "public"."whatsapp_phone_verifications" to "authenticated";
grant references on table "public"."whatsapp_phone_verifications" to "authenticated";
grant select on table "public"."whatsapp_phone_verifications" to "authenticated";
grant trigger on table "public"."whatsapp_phone_verifications" to "authenticated";
grant truncate on table "public"."whatsapp_phone_verifications" to "authenticated";
grant update on table "public"."whatsapp_phone_verifications" to "authenticated";
grant delete on table "public"."whatsapp_phone_verifications" to "service_role";
grant insert on table "public"."whatsapp_phone_verifications" to "service_role";
grant references on table "public"."whatsapp_phone_verifications" to "service_role";
grant select on table "public"."whatsapp_phone_verifications" to "service_role";
grant trigger on table "public"."whatsapp_phone_verifications" to "service_role";
grant truncate on table "public"."whatsapp_phone_verifications" to "service_role";
grant update on table "public"."whatsapp_phone_verifications" to "service_role";
grant delete on table "public"."whatsapp_question_subscriptions" to "anon";
grant insert on table "public"."whatsapp_question_subscriptions" to "anon";
grant references on table "public"."whatsapp_question_subscriptions" to "anon";
grant select on table "public"."whatsapp_question_subscriptions" to "anon";
grant trigger on table "public"."whatsapp_question_subscriptions" to "anon";
grant truncate on table "public"."whatsapp_question_subscriptions" to "anon";
grant update on table "public"."whatsapp_question_subscriptions" to "anon";
grant delete on table "public"."whatsapp_question_subscriptions" to "authenticated";
grant insert on table "public"."whatsapp_question_subscriptions" to "authenticated";
grant references on table "public"."whatsapp_question_subscriptions" to "authenticated";
grant select on table "public"."whatsapp_question_subscriptions" to "authenticated";
grant trigger on table "public"."whatsapp_question_subscriptions" to "authenticated";
grant truncate on table "public"."whatsapp_question_subscriptions" to "authenticated";
grant update on table "public"."whatsapp_question_subscriptions" to "authenticated";
grant delete on table "public"."whatsapp_question_subscriptions" to "service_role";
grant insert on table "public"."whatsapp_question_subscriptions" to "service_role";
grant references on table "public"."whatsapp_question_subscriptions" to "service_role";
grant select on table "public"."whatsapp_question_subscriptions" to "service_role";
grant trigger on table "public"."whatsapp_question_subscriptions" to "service_role";
grant truncate on table "public"."whatsapp_question_subscriptions" to "service_role";
grant update on table "public"."whatsapp_question_subscriptions" to "service_role";
grant delete on table "public"."whatsapp_webhook_errors" to "anon";
grant insert on table "public"."whatsapp_webhook_errors" to "anon";
grant references on table "public"."whatsapp_webhook_errors" to "anon";
grant select on table "public"."whatsapp_webhook_errors" to "anon";
grant trigger on table "public"."whatsapp_webhook_errors" to "anon";
grant truncate on table "public"."whatsapp_webhook_errors" to "anon";
grant update on table "public"."whatsapp_webhook_errors" to "anon";
grant delete on table "public"."whatsapp_webhook_errors" to "authenticated";
grant insert on table "public"."whatsapp_webhook_errors" to "authenticated";
grant references on table "public"."whatsapp_webhook_errors" to "authenticated";
grant select on table "public"."whatsapp_webhook_errors" to "authenticated";
grant trigger on table "public"."whatsapp_webhook_errors" to "authenticated";
grant truncate on table "public"."whatsapp_webhook_errors" to "authenticated";
grant update on table "public"."whatsapp_webhook_errors" to "authenticated";
grant delete on table "public"."whatsapp_webhook_errors" to "service_role";
grant insert on table "public"."whatsapp_webhook_errors" to "service_role";
grant references on table "public"."whatsapp_webhook_errors" to "service_role";
grant select on table "public"."whatsapp_webhook_errors" to "service_role";
grant trigger on table "public"."whatsapp_webhook_errors" to "service_role";
grant truncate on table "public"."whatsapp_webhook_errors" to "service_role";
grant update on table "public"."whatsapp_webhook_errors" to "service_role";
create policy "admin_read"
  on "public"."admin_users"
  as permissive
  for select
  to public
using (public.is_admin(auth.uid()));
create policy "admin_users_select_self"
  on "public"."admin_users"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));
create policy "Admins can insert ai_prompts"
  on "public"."ai_prompts"
  as permissive
  for insert
  to public
with check (public.is_admin_me());
create policy "Admins can read ai_prompts"
  on "public"."ai_prompts"
  as permissive
  for select
  to public
using ((public.is_admin_me() OR (auth.role() = 'service_role'::text)));
create policy "Admins can update ai_prompts"
  on "public"."ai_prompts"
  as permissive
  for update
  to public
using (public.is_admin_me());
create policy "epicb_admin_ai_draft_versions_all"
  on "public"."ai_question_draft_versions"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "epicb_admin_ai_drafts_all"
  on "public"."ai_question_drafts"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "audience_segments_admin_all"
  on "public"."audience_segments"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "audience_segments_select_active"
  on "public"."audience_segments"
  as permissive
  for select
  to public
using ((status = 'active'::text));
create policy "avatars_mutate_owner"
  on "public"."avatars"
  as permissive
  for all
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "avatars_select_public"
  on "public"."avatars"
  as permissive
  for select
  to public
using (true);
create policy "backup_codes_owner_or_service"
  on "public"."backup_codes"
  as permissive
  for all
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "Admins can view all snapshots"
  on "public"."cognitive_state_snapshots"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "Service role full access to snapshots"
  on "public"."cognitive_state_snapshots"
  as permissive
  for all
  to service_role
using (true)
with check (true);
create policy "Users can view own snapshots"
  on "public"."cognitive_state_snapshots"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));
create policy "reactions_delete"
  on "public"."comment_reactions"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));
create policy "reactions_insert"
  on "public"."comment_reactions"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));
create policy "reactions_read"
  on "public"."comment_reactions"
  as permissive
  for select
  to public
using (true);
create policy "reports_insert"
  on "public"."comment_reports"
  as permissive
  for insert
  to public
with check ((auth.uid() = reporter_id));
create policy "comments_delete_own"
  on "public"."comments"
  as permissive
  for delete
  to authenticated
using (((user_id = auth.uid()) OR (auth.role() = 'service_role'::text)));
create policy "comments_insert_own"
  on "public"."comments"
  as permissive
  for insert
  to authenticated
with check (((user_id = auth.uid()) OR (auth.role() = 'service_role'::text)));
create policy "comments_update_own"
  on "public"."comments"
  as permissive
  for update
  to authenticated
using (((user_id = auth.uid()) OR (auth.role() = 'service_role'::text)))
with check (((user_id = auth.uid()) OR (auth.role() = 'service_role'::text)));
create policy "public_read_comments"
  on "public"."comments"
  as permissive
  for select
  to anon, authenticated
using (true);
create policy "community_trends_select_all"
  on "public"."community_trends"
  as permissive
  for select
  to anon, authenticated
using (true);
create policy "consent_owner_or_service"
  on "public"."consent_logs"
  as permissive
  for all
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "Users can update their own acknowledgements"
  on "public"."contribution_acknowledgements"
  as permissive
  for update
  to authenticated
using ((auth.uid() = user_id));
create policy "Users can view their own acknowledgements"
  on "public"."contribution_acknowledgements"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "daily_curated_questions_admin_write"
  on "public"."daily_curated_questions"
  as permissive
  for all
  to public
using (((auth.role() = 'service_role'::text) OR public.is_admin()))
with check (((auth.role() = 'service_role'::text) OR public.is_admin()));
create policy "daily_curated_questions_public_read"
  on "public"."daily_curated_questions"
  as permissive
  for select
  to authenticated, anon
using (true);
create policy "deletion_own"
  on "public"."deletion_requests"
  as permissive
  for all
  to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "demographic_breakdowns_select_all"
  on "public"."demographic_breakdowns"
  as permissive
  for select
  to anon, authenticated
using (true);
create policy "devices_insert_own"
  on "public"."devices"
  as permissive
  for insert
  to authenticated
with check ((user_id = auth.uid()));
create policy "devices_owner_access"
  on "public"."devices"
  as permissive
  for all
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "devices_select_own"
  on "public"."devices"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));
create policy "devices_update_own"
  on "public"."devices"
  as permissive
  for update
  to authenticated
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));
create policy "eae_admin_all"
  on "public"."election_anomaly_events"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "audit_log_admin_insert"
  on "public"."election_audit_log"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "audit_log_admin_read"
  on "public"."election_audit_log"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_candidates_admin_write"
  on "public"."election_candidates"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_candidates_public_read"
  on "public"."election_candidates"
  as permissive
  for select
  to public
using (true);
create policy "election_compliance_rules_admin_write"
  on "public"."election_compliance_rules"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_compliance_rules_public_read"
  on "public"."election_compliance_rules"
  as permissive
  for select
  to public
using (((is_active = true) OR (EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid())))));
create policy "election_constituencies_admin_write"
  on "public"."election_constituencies"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_constituencies_read_all"
  on "public"."election_constituencies"
  as permissive
  for select
  to public
using (true);
create policy "eitl_admin_write"
  on "public"."election_issue_tag_allowlists"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "eitl_public_read"
  on "public"."election_issue_tag_allowlists"
  as permissive
  for select
  to public
using (true);
create policy "election_parties_admin_write"
  on "public"."election_parties"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_parties_public_read"
  on "public"."election_parties"
  as permissive
  for select
  to public
using (true);
create policy "election_party_elections_admin_write"
  on "public"."election_party_elections"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_party_elections_public_read"
  on "public"."election_party_elections"
  as permissive
  for select
  to public
using (true);
create policy "election_party_regions_admin_write"
  on "public"."election_party_regions"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_party_regions_public_read"
  on "public"."election_party_regions"
  as permissive
  for select
  to public
using (true);
create policy "eqd_admin_all"
  on "public"."election_question_drafts"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "esd_admin_all"
  on "public"."election_source_documents"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "esa_public_read"
  on "public"."election_stance_aggregates"
  as permissive
  for select
  to public
using ((((is_gated = false) AND (meets_minimum_threshold = true)) OR (EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid())))));
create policy "esa_service_write"
  on "public"."election_stance_aggregates"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_tiers_admin_write"
  on "public"."election_tiers"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "election_tiers_read_all"
  on "public"."election_tiers"
  as permissive
  for select
  to public
using (true);
create policy "elections_admin_write"
  on "public"."elections"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "elections_public_read"
  on "public"."elections"
  as permissive
  for select
  to public
using (((state <> 'UPCOMING'::public.election_state_enum) OR (EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid())))));
create policy "email_events_select_own"
  on "public"."email_events"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "embed_cta_insert"
  on "public"."embed_cta_events"
  as permissive
  for insert
  to public
with check (true);
create policy "embed_impressions_insert"
  on "public"."embed_impressions"
  as permissive
  for insert
  to public
with check (true);
create policy "embedded_stances_service_insert"
  on "public"."embedded_stances"
  as permissive
  for insert
  to public
with check (true);
create policy "embedded_stances_user_read"
  on "public"."embedded_stances"
  as permissive
  for select
  to public
using ((attributed_user_id = auth.uid()));
create policy "feed_policies_admin_all"
  on "public"."feed_policies"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "feed_policies_select_active"
  on "public"."feed_policies"
  as permissive
  for select
  to public
using ((status = 'active'::text));
create policy "feed_policy_lanes_admin_all"
  on "public"."feed_policy_lanes"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "feed_policy_lanes_select"
  on "public"."feed_policy_lanes"
  as permissive
  for select
  to authenticated
using (true);
create policy "ingested_stances_admin_read"
  on "public"."ingested_stances"
  as permissive
  for select
  to authenticated
using (public.is_admin());
create policy "epicb_admin_ingestion_all"
  on "public"."ingestion_queue"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "read_queue"
  on "public"."ingestion_queue"
  as permissive
  for select
  to authenticated
using (true);
create policy "la_delete"
  on "public"."location_audits"
  as permissive
  for delete
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "la_insert"
  on "public"."location_audits"
  as permissive
  for insert
  to public
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "la_mod_read"
  on "public"."location_audits"
  as permissive
  for select
  to public
using (public.is_moderator());
create policy "la_owner"
  on "public"."location_audits"
  as permissive
  for all
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "la_owner_read"
  on "public"."location_audits"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));
create policy "la_select"
  on "public"."location_audits"
  as permissive
  for select
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "la_update"
  on "public"."location_audits"
  as permissive
  for update
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "locations_read_all"
  on "public"."locations"
  as permissive
  for select
  to public
using (true);
create policy "locations_select_public"
  on "public"."locations"
  as permissive
  for select
  to public
using (true);
create policy "locations_write_service"
  on "public"."locations"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));
create policy "mfa_mutate_owner_or_service"
  on "public"."mfa_methods"
  as permissive
  for all
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "mfa_select_owner"
  on "public"."mfa_methods"
  as permissive
  for select
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "moderation_actions_service"
  on "public"."moderation_actions"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text));
create policy "moderators_read_self"
  on "public"."moderators"
  as permissive
  for select
  to public
using (((auth.uid() = user_id) OR public.is_moderator()));
create policy "Admins can read news_items"
  on "public"."news_items"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE (au.user_id = auth.uid()))));
create policy "read_news_items"
  on "public"."news_items"
  as permissive
  for select
  to authenticated
using (true);
create policy "notification_preferences_insert_own"
  on "public"."notification_preferences"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = user_id));
create policy "notification_preferences_select_own"
  on "public"."notification_preferences"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "notification_preferences_update_own"
  on "public"."notification_preferences"
  as permissive
  for update
  to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "notification_topic_prefs_own"
  on "public"."notification_topic_prefs"
  as permissive
  for all
  to authenticated
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));
create policy "og_image_cache_readable"
  on "public"."og_image_cache"
  as permissive
  for select
  to public
using (true);
create policy "party_alliance_members_admin_write"
  on "public"."party_alliance_members"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "party_alliance_members_public_read"
  on "public"."party_alliance_members"
  as permissive
  for select
  to public
using (true);
create policy "pr_service_only"
  on "public"."password_resets"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));
create policy "pipeline_jobs_service"
  on "public"."pipeline_jobs"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text));
create policy "profiles_insert_self"
  on "public"."profiles"
  as permissive
  for insert
  to public
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "profiles_moderator_read"
  on "public"."profiles"
  as permissive
  for select
  to public
using (public.is_moderator());
create policy "profiles_owner_rw"
  on "public"."profiles"
  as permissive
  for all
  to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));
create policy "profiles_select_public"
  on "public"."profiles"
  as permissive
  for select
  to public
using (true);
create policy "profiles_update_self"
  on "public"."profiles"
  as permissive
  for update
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "publishers_public_read"
  on "public"."publishers"
  as permissive
  for select
  to public
using ((status = 'approved'::public.publisher_status));
create policy "question_audience_fit_admin_all"
  on "public"."question_audience_fit"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "question_audience_fit_select_authenticated"
  on "public"."question_audience_fit"
  as permissive
  for select
  to authenticated
using (true);
create policy "qcs_public_read"
  on "public"."question_comment_sentiment"
  as permissive
  for select
  to authenticated, anon
using (true);
create policy "qcs_service_or_admin_write"
  on "public"."question_comment_sentiment"
  as permissive
  for all
  to public
using (((auth.role() = 'service_role'::text) OR public.is_admin(auth.uid())))
with check (((auth.role() = 'service_role'::text) OR public.is_admin(auth.uid())));
create policy "context_updates_read"
  on "public"."question_context_updates"
  as permissive
  for select
  to public
using (true);
create policy "question_draft_audience_fit_admin_all"
  on "public"."question_draft_audience_fit"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "Admins can insert question_drafts"
  on "public"."question_drafts"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE (au.user_id = auth.uid()))));
create policy "Admins can read question_drafts"
  on "public"."question_drafts"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE (au.user_id = auth.uid()))));
create policy "Admins can update question_drafts"
  on "public"."question_drafts"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE (au.user_id = auth.uid()))));
create policy "Users manage own confidence"
  on "public"."question_stance_confidence"
  as permissive
  for all
  to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "Anyone can read question stance aggregates"
  on "public"."question_stance_stats"
  as permissive
  for select
  to public
using (true);
create policy "Anyone can read regional stance aggregates"
  on "public"."question_stance_stats_region"
  as permissive
  for select
  to public
using (true);
create policy "Users can delete their own stances"
  on "public"."question_stances"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));
create policy "Users can insert their own stances"
  on "public"."question_stances"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));
create policy "Users can update their own stances"
  on "public"."question_stances"
  as permissive
  for update
  to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "Users can view their own stances"
  on "public"."question_stances"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));
create policy "question_tradeoffs_read"
  on "public"."question_tradeoffs"
  as permissive
  for select
  to public
using (true);
create policy "question_visibility_admin_all"
  on "public"."question_visibility_rules"
  as permissive
  for all
  to public
using (((auth.role() = 'service_role'::text) OR public.is_admin()))
with check (((auth.role() = 'service_role'::text) OR public.is_admin()));
create policy "questions_admin_write"
  on "public"."questions"
  as permissive
  for all
  to public
using (public.is_admin_me());
create policy "questions_public_read"
  on "public"."questions"
  as permissive
  for select
  to public
using (true);
create policy "rsv_admin_delete"
  on "public"."reserved_usernames"
  as permissive
  for delete
  to public
using ((auth.role() = 'service_role'::text));
create policy "rsv_admin_insert"
  on "public"."reserved_usernames"
  as permissive
  for insert
  to public
with check ((auth.role() = 'service_role'::text));
create policy "rsv_admin_update"
  on "public"."reserved_usernames"
  as permissive
  for update
  to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));
create policy "rsv_admin_write"
  on "public"."reserved_usernames"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));
create policy "rsv_public_read"
  on "public"."reserved_usernames"
  as permissive
  for select
  to public
using (true);
create policy "sessions_insert_own"
  on "public"."sessions"
  as permissive
  for insert
  to authenticated
with check ((user_id = auth.uid()));
create policy "sessions_owner_access"
  on "public"."sessions"
  as permissive
  for all
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "sessions_select_own"
  on "public"."sessions"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));
create policy "sessions_update_own"
  on "public"."sessions"
  as permissive
  for update
  to authenticated
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));
create policy "share_clicks_insert"
  on "public"."share_click_events"
  as permissive
  for insert
  to public
with check (true);
create policy "share_clicks_readable"
  on "public"."share_click_events"
  as permissive
  for select
  to public
using (true);
create policy "share_events_insert_authed"
  on "public"."share_events"
  as permissive
  for insert
  to public
with check (((auth.uid() = shared_by_user_id) OR (shared_by_user_id IS NULL)));
create policy "share_events_readable"
  on "public"."share_events"
  as permissive
  for select
  to public
using (true);
create policy "users_delete_own_social_tokens"
  on "public"."social_auth_tokens"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));
create policy "users_insert_own_social_tokens"
  on "public"."social_auth_tokens"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));
create policy "users_see_own_social_tokens"
  on "public"."social_auth_tokens"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));
create policy "users_update_own_social_tokens"
  on "public"."social_auth_tokens"
  as permissive
  for update
  to public
using ((auth.uid() = user_id));
create policy "social_reply_inbox_admin_read"
  on "public"."social_reply_inbox"
  as permissive
  for select
  to authenticated
using (public.is_admin());
create policy "stance_history_select_own"
  on "public"."stance_history"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "stance_texts_delete_own"
  on "public"."stance_texts"
  as permissive
  for delete
  to authenticated
using ((auth.uid() = user_id));
create policy "stance_texts_insert_own"
  on "public"."stance_texts"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = user_id));
create policy "stance_texts_select_own"
  on "public"."stance_texts"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "stance_texts_update_own"
  on "public"."stance_texts"
  as permissive
  for update
  to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "epicb_admin_cluster_items_all"
  on "public"."topic_cluster_items"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "epicb_admin_clusters_all"
  on "public"."topic_clusters"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "Admins can read topic_drafts"
  on "public"."topic_drafts"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE (au.user_id = auth.uid()))));
create policy "Admins can update topic_drafts"
  on "public"."topic_drafts"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE (au.user_id = auth.uid()))))
with check ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE (au.user_id = auth.uid()))));
create policy "topic_impact_scores_admin_write"
  on "public"."topic_impact_scores"
  as permissive
  for all
  to public
using (((auth.role() = 'service_role'::text) OR public.is_admin()))
with check (((auth.role() = 'service_role'::text) OR public.is_admin()));
create policy "topic_impact_scores_public_read"
  on "public"."topic_impact_scores"
  as permissive
  for select
  to authenticated, anon
using (true);
create policy "public_read_trends"
  on "public"."topic_region_trends"
  as permissive
  for select
  to anon, authenticated
using (true);
create policy "epicb_admin_topic_regions_all"
  on "public"."topic_regions"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "Admins can read topic_sources"
  on "public"."topic_sources"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.admin_users au
  WHERE (au.user_id = auth.uid()))));
create policy "epicb_admin_topic_sources_all"
  on "public"."topic_sources"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "temp_auth_all"
  on "public"."topic_sources"
  as permissive
  for all
  to authenticated
using (true)
with check (true);
create policy "ts_admin_all"
  on "public"."topic_sources"
  as permissive
  for all
  to authenticated
using (public.is_admin())
with check (public.is_admin());
create policy "ts_read_auth"
  on "public"."topic_sources"
  as permissive
  for select
  to authenticated
using (true);
create policy "anon_can_read_published_topics"
  on "public"."topics"
  as permissive
  for select
  to anon
using ((published_at IS NOT NULL));
create policy "public_read_topics"
  on "public"."topics"
  as permissive
  for select
  to anon, authenticated
using (true);
create policy "topics_admin_write"
  on "public"."topics"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "topics_select_published_anon"
  on "public"."topics"
  as permissive
  for select
  to anon
using ((published_at IS NOT NULL));
create policy "toxicity_scores_service"
  on "public"."toxicity_scores"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text));
create policy "Admins can view all cognitive states"
  on "public"."user_cognitive_states"
  as permissive
  for select
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.admin_users
  WHERE (admin_users.user_id = auth.uid()))));
create policy "Service role full access to cognitive states"
  on "public"."user_cognitive_states"
  as permissive
  for all
  to service_role
using (true)
with check (true);
create policy "Users can view own cognitive states"
  on "public"."user_cognitive_states"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));
create policy "uls_delete_authenticated"
  on "public"."user_location_settings"
  as permissive
  for delete
  to authenticated
using ((auth.uid() = user_id));
create policy "uls_owner_access"
  on "public"."user_location_settings"
  as permissive
  for all
  to public
using (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "uls_select_authenticated"
  on "public"."user_location_settings"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "uls_service_role_all"
  on "public"."user_location_settings"
  as permissive
  for all
  to service_role
using (true)
with check (true);
create policy "uls_update_authenticated"
  on "public"."user_location_settings"
  as permissive
  for update
  to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "uls_write_authenticated"
  on "public"."user_location_settings"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = user_id));
create policy "user_notifications_select_own"
  on "public"."user_notifications"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "user_notifications_update_own"
  on "public"."user_notifications"
  as permissive
  for update
  to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "privacy_own"
  on "public"."user_privacy"
  as permissive
  for all
  to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "Users can manage their own region follows"
  on "public"."user_region_follows"
  as permissive
  for all
  to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "Users can view their own region follows"
  on "public"."user_region_follows"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "urp_admin_all"
  on "public"."user_region_preferences"
  as permissive
  for all
  to public
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
create policy "urp_owner_rw"
  on "public"."user_region_preferences"
  as permissive
  for all
  to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "Users can manage their own follows"
  on "public"."user_topic_follows"
  as permissive
  for all
  to authenticated
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));
create policy "Users can view their own follows"
  on "public"."user_topic_follows"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "hist_admin_delete"
  on "public"."username_history"
  as permissive
  for delete
  to public
using ((auth.role() = 'service_role'::text));
create policy "hist_owner_or_admin"
  on "public"."username_history"
  as permissive
  for insert
  to public
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "hist_owner_or_admin_insert"
  on "public"."username_history"
  as permissive
  for insert
  to public
with check (((auth.uid() = user_id) OR (auth.role() = 'service_role'::text)));
create policy "hist_public_read"
  on "public"."username_history"
  as permissive
  for select
  to public
using (true);
create policy "uh_mod_read"
  on "public"."username_history"
  as permissive
  for select
  to public
using (public.is_moderator());
create policy "uh_owner_read"
  on "public"."username_history"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));
create policy "users_insert_service"
  on "public"."users"
  as permissive
  for insert
  to public
with check ((auth.role() = 'service_role'::text));
create policy "users_select_self"
  on "public"."users"
  as permissive
  for select
  to public
using (((auth.uid() = id) OR (auth.role() = 'service_role'::text)));
create policy "users_update_self"
  on "public"."users"
  as permissive
  for update
  to public
using (((auth.uid() = id) OR (auth.role() = 'service_role'::text)))
with check (((auth.uid() = id) OR (auth.role() = 'service_role'::text)));
create policy "weekly_digests_select_own"
  on "public"."weekly_digests"
  as permissive
  for select
  to authenticated
using ((auth.uid() = user_id));
create policy "service_role_all_whatsapp_active_sessions"
  on "public"."whatsapp_active_sessions"
  as permissive
  for all
  to public
using (true)
with check (true);
create policy "whatsapp_broadcasts_admin_only"
  on "public"."whatsapp_broadcasts"
  as permissive
  for all
  to public
using (public.is_admin_me());
create policy "whatsapp_config_admin_only"
  on "public"."whatsapp_config"
  as permissive
  for all
  to public
using (public.is_admin_me());
create policy "whatsapp_contact_list_numbers_admin_only"
  on "public"."whatsapp_contact_list_numbers"
  as permissive
  for all
  to public
using (public.is_admin_me());
create policy "whatsapp_contact_lists_admin_only"
  on "public"."whatsapp_contact_lists"
  as permissive
  for all
  to public
using (public.is_admin_me());
create policy "whatsapp_delivery_log_admin_read"
  on "public"."whatsapp_delivery_log"
  as permissive
  for select
  to public
using (public.is_admin_me());
create policy "service_role_all_whatsapp_forward_chains"
  on "public"."whatsapp_forward_chains"
  as permissive
  for all
  to public
using (true)
with check (true);
create policy "whatsapp_optouts_admin_read"
  on "public"."whatsapp_optouts"
  as permissive
  for select
  to public
using (public.is_admin_me());
create policy "service_role_all_whatsapp_question_subscriptions"
  on "public"."whatsapp_question_subscriptions"
  as permissive
  for all
  to public
using (true)
with check (true);
create policy "whatsapp_webhook_errors_admin_only"
  on "public"."whatsapp_webhook_errors"
  as permissive
  for all
  to public
using (public.is_admin_me());
CREATE TRIGGER trg_snap_ai_draft_version AFTER INSERT OR UPDATE ON public.ai_question_drafts FOR EACH ROW EXECUTE FUNCTION public.snap_ai_draft_version();
CREATE TRIGGER election_candidates_updated_at BEFORE UPDATE ON public.election_candidates FOR EACH ROW EXECUTE FUNCTION public.fn_election_candidates_updated_at();
CREATE TRIGGER election_compliance_rules_updated_at_trigger BEFORE UPDATE ON public.election_compliance_rules FOR EACH ROW EXECUTE FUNCTION public.fn_election_compliance_rules_updated_at();
CREATE TRIGGER election_parties_updated_at BEFORE UPDATE ON public.election_parties FOR EACH ROW EXECUTE FUNCTION public.fn_election_parties_updated_at();
CREATE TRIGGER election_party_elections_updated_at BEFORE UPDATE ON public.election_party_elections FOR EACH ROW EXECUTE FUNCTION public.fn_election_party_elections_updated_at();
CREATE TRIGGER election_party_regions_updated_at BEFORE UPDATE ON public.election_party_regions FOR EACH ROW EXECUTE FUNCTION public.fn_election_party_regions_updated_at();
CREATE TRIGGER eqd_updated_at BEFORE UPDATE ON public.election_question_drafts FOR EACH ROW EXECUTE FUNCTION public.fn_eqd_updated_at();
CREATE TRIGGER esd_updated_at BEFORE UPDATE ON public.election_source_documents FOR EACH ROW EXECUTE FUNCTION public.fn_esd_updated_at();
CREATE TRIGGER elections_insert_gate_trigger BEFORE INSERT ON public.elections FOR EACH ROW EXECUTE FUNCTION public.fn_elections_insert_gate();
CREATE TRIGGER elections_legal_review_gate_trigger BEFORE UPDATE ON public.elections FOR EACH ROW EXECUTE FUNCTION public.fn_elections_legal_review_gate();
CREATE TRIGGER elections_updated_at_trigger BEFORE UPDATE ON public.elections FOR EACH ROW EXECUTE FUNCTION public.fn_elections_updated_at();
CREATE TRIGGER news_items_touch BEFORE UPDATE ON public.news_items FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER party_alliance_members_updated_at BEFORE UPDATE ON public.party_alliance_members FOR EACH ROW EXECUTE FUNCTION public.fn_party_alliance_members_updated_at();
CREATE TRIGGER profiles_normalize_username BEFORE INSERT OR UPDATE OF username ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.normalize_username();
CREATE TRIGGER profiles_set_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_enforce_username_quota BEFORE UPDATE OF username ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_username_change_quota();
CREATE TRIGGER trg_profiles_log_username AFTER UPDATE OF username ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.log_username_history();
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_profiles_updated_at();
CREATE TRIGGER auto_update_engagement_on_stance AFTER INSERT ON public.question_stances FOR EACH ROW EXECUTE FUNCTION public.trigger_update_engagement_on_stance();
CREATE TRIGGER election_stance_aggregate_refresh_trigger AFTER INSERT OR UPDATE ON public.question_stances FOR EACH ROW EXECUTE FUNCTION public.fn_trigger_election_aggregate_refresh();
CREATE TRIGGER question_stances_refresh_stats AFTER INSERT OR DELETE OR UPDATE ON public.question_stances FOR EACH ROW EXECUTE FUNCTION public.trg_question_stances_refresh_stats();
CREATE TRIGGER question_stances_refresh_stats_region AFTER INSERT OR DELETE OR UPDATE ON public.question_stances FOR EACH ROW EXECUTE FUNCTION public.trg_question_stances_refresh_stats_region();
CREATE TRIGGER trg_calculate_cognitive_state AFTER INSERT OR UPDATE ON public.question_stances FOR EACH ROW EXECUTE FUNCTION public.trigger_cognitive_state_calculation();
CREATE TRIGGER trg_log_stance_history AFTER INSERT OR DELETE OR UPDATE ON public.question_stances FOR EACH ROW EXECUTE FUNCTION public.trg_log_stance_history();
CREATE TRIGGER trigger_trending_update AFTER INSERT ON public.question_stances FOR EACH ROW EXECUTE FUNCTION public.trigger_update_trending_on_new_response();
CREATE TRIGGER questions_search_vector_update BEFORE INSERT OR UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION public.update_question_search_vector();
CREATE TRIGGER trg_ensure_audience_on_insert BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION public.fn_ensure_audience_on_insert();
CREATE TRIGGER trg_ensure_audience_on_publish BEFORE UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION public.fn_ensure_audience_on_publish();
CREATE TRIGGER trigger_question_dedup_fields BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION public.trigger_generate_dedup_fields();
CREATE TRIGGER topic_cluster_items_set_updated_at BEFORE UPDATE ON public.topic_cluster_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER topics_search_vector_update BEFORE INSERT OR UPDATE ON public.topics FOR EACH ROW EXECUTE FUNCTION public.update_topic_search_vector();
CREATE TRIGGER users_normalize_email BEFORE INSERT OR UPDATE OF email ON public.users FOR EACH ROW EXECUTE FUNCTION public.normalize_email();
create policy "Avatar images are publicly readable"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));
create policy "Users can delete their own avatar"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));
create policy "Users can update their own avatar"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));
create policy "Users can upload their own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'avatars'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text)));
