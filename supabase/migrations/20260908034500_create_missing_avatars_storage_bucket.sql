-- BUG FIX: the "avatars" Storage bucket was never created on this project,
-- even though its RLS policies already exist (SELECT public read, INSERT/
-- UPDATE/DELETE scoped to the uploader's own auth.uid() via the
-- avatars/{uid}/{filename} path convention) -- confirmed via pg_policies.
-- Every avatar upload failed with "Bucket not found" (found live-testing
-- QA-A12 on stance-capture-dev, 2026-09-08). Public read matches the
-- existing "Avatar images are publicly readable" policy and the documented
-- public.avatars RLS (SELECT: true).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
