ALTER TABLE pipeline_jobs DROP CONSTRAINT pipeline_jobs_job_type_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_job_type_check
  CHECK (job_type = ANY (ARRAY[
    'ingest'::text, 'embed'::text, 'extract_entities'::text, 'cluster'::text,
    'create_topic_drafts'::text, 'enrich_images'::text, 'classify_parent_topics'::text,
    'question_draft'::text, 'generate'::text, 'score'::text, 'notify'::text, 'other'::text
  ]));
