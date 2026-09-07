-- Seed data for the languages/language_regions tables just backfilled to
-- prod, copied verbatim from UAT (same 2 language rows + the Hindi/India
-- region mapping seeded during the original dev->UAT sync).
INSERT INTO public.languages (language_code, display_name_native, display_name_english, script, is_active_for_ugq, is_active_for_ui)
VALUES
  ('en', 'English', 'English', 'Latin', true, true),
  ('hi', 'हिन्दी', 'Hindi', 'Devanagari', true, true);

INSERT INTO public.language_regions (language_code, region_id)
VALUES ('hi', '951ec16f-4d63-4556-9710-4ca8eecc7a1b');
