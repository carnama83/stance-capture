-- Campaigns: admin-chosen ad image + headline, and the AI/altered-media flag.
--
-- The ad used the auto-generated og-image share card and a headline cut at 40
-- characters mid-word ("…infrastructure failu", Prod, 29 Sep 2026). Admins can
-- now upload their own image and write the headline/primary text.
--
-- creative_digitally_created: Meta requires social-issue ads whose photorealistic
-- imagery was digitally created or altered (e.g. AI-generated) to say so. When
-- true, create-meta-campaign sends authorization_category
-- POLITICAL_WITH_DIGITALLY_CREATED_MEDIA instead of POLITICAL.

alter table public.campaigns
  add column if not exists creative_digitally_created boolean not null default false;

-- Public-read bucket: Meta and the launch function fetch the image by URL.
-- JPEG/PNG only — the admin page converts other formats (e.g. WebP) to JPEG
-- before upload, since Meta's /adimages takes JPG/PNG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-creatives', 'campaign-creatives', true, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Only admins write; reads go through the public URL.
drop policy if exists campaign_creatives_admin_insert on storage.objects;
create policy campaign_creatives_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'campaign-creatives' and public.is_admin());

drop policy if exists campaign_creatives_admin_update on storage.objects;
create policy campaign_creatives_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'campaign-creatives' and public.is_admin())
  with check (bucket_id = 'campaign-creatives' and public.is_admin());

drop policy if exists campaign_creatives_admin_delete on storage.objects;
create policy campaign_creatives_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'campaign-creatives' and public.is_admin());
