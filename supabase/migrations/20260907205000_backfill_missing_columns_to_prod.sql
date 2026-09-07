-- Backfill columns that exist on UAT/dev but are missing on prod's older
-- baseline. Reconstructed via catalog introspection against UAT. Applied
-- before the new-table/view migration since admin_rendition_review_queue
-- depends on questions.canonical_language.

ALTER TABLE public.news_items
  ADD COLUMN hosted_image_url text,
  ADD COLUMN image_hosted_at timestamp with time zone,
  ADD COLUMN image_hosting_status text;

ALTER TABLE public.profiles
  ADD COLUMN anonymous_avatar_config jsonb,
  ADD COLUMN preferred_language_code text NOT NULL DEFAULT 'en'::text;

ALTER TABLE public.question_drafts
  ADD COLUMN location_id uuid REFERENCES public.locations(id);

ALTER TABLE public.questions
  ADD COLUMN admin_reviewed_at timestamp with time zone,
  ADD COLUMN admin_reviewed_by uuid,
  ADD COLUMN auto_published boolean NOT NULL DEFAULT false,
  ADD COLUMN canonical_language text NOT NULL DEFAULT 'en'::text,
  ADD COLUMN content_type text NOT NULL DEFAULT 'general'::text,
  ADD COLUMN location_id uuid REFERENCES public.locations(id),
  ADD COLUMN video_duration_seconds integer,
  ADD COLUMN video_publish_choice text,
  ADD COLUMN video_raw_archival_path text,
  ADD COLUMN video_recorded_anonymous boolean NOT NULL DEFAULT false,
  ADD COLUMN video_recording_path text;

ALTER TABLE public.user_question_proposals
  ADD COLUMN derogatory_flag boolean,
  ADD COLUMN derogatory_flag_reason text,
  ADD COLUMN framing_flag text,
  ADD COLUMN framing_flag_reason text,
  ADD COLUMN input_mode text NOT NULL DEFAULT 'text'::text,
  ADD COLUMN preview_reframe jsonb,
  ADD COLUMN proposal_language text,
  ADD COLUMN video_duration_seconds integer,
  ADD COLUMN video_publish_choice text,
  ADD COLUMN video_raw_archival_path text,
  ADD COLUMN video_raw_transcript text,
  ADD COLUMN video_recorded_anonymous boolean NOT NULL DEFAULT false,
  ADD COLUMN video_recording_path text,
  ADD COLUMN video_resubmit_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN voice_recording_path text;

ALTER TABLE public.whatsapp_forward_chains
  ADD COLUMN location_id uuid REFERENCES public.locations(id);

-- v_live_questions needs to expose the two new questions columns (matches
-- the same fix already applied to dev/UAT's v_live_questions definition).
CREATE OR REPLACE VIEW public.v_live_questions AS
 SELECT q.id,
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
    q.slider_high_label,
    q.content_type,
    q.video_recording_path
   FROM ((questions q
     JOIN topics t ON ((t.id = q.topic_id)))
     LEFT JOIN question_visibility_rules vr ON ((vr.question_id = q.id)))
  WHERE ((q.status = 'active'::text) AND (q.published_at IS NOT NULL) AND ((vr.visibility IS NULL) OR (vr.visibility = 'visible'::question_visibility_enum)));
