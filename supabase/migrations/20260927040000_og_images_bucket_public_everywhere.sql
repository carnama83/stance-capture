-- The og-images storage bucket must exist, and be public, in every environment.
--
-- It was created by hand on Dev (public) and UAT (private, by mistake) and
-- never on Prod. On launch night every Prod news image failed to mirror with
-- "Bucket not found": enrich-images (news-covers/) and whatsapp-card write
-- here, and the site renders these images through getPublicUrl() links, which
-- only work on a public bucket. Writes come from edge functions using the
-- service role, so no storage.objects policies are needed; reads are public.
insert into storage.buckets (id, name, public)
values ('og-images', 'og-images', true)
on conflict (id) do update set public = true;
