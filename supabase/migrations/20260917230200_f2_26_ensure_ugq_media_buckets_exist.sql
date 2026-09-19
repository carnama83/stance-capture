-- §5.1 of the epic doc lists both UGQ media buckets as a promotion step, but
-- nothing enforced it, so UAT came out of the promotion with only
-- ugq-video-recordings. The effect is narrow but total: every voice proposal
-- fails at upload, and ugq-transcribe-voice never gets a file to transcribe.
--
-- Both are PRIVATE with no client-side policies -- access is only ever granted
-- through a signed URL minted server-side (see ugq-video-url). Matching Dev:
-- private, no size limit, no MIME allow-list.
--
-- Idempotent, and asserts the end state rather than assuming the insert ran.
-- Deliberately does NOT create ugq-video-recordings-raw: that bucket belongs to
-- the rolled-back anonymous-video feature and is being retired (UGQ-O1).

insert into storage.buckets (id, name, public)
values ('ugq-voice-recordings', 'ugq-voice-recordings', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('ugq-video-recordings', 'ugq-video-recordings', false)
on conflict (id) do nothing;

do $chk$
declare n integer;
begin
  select count(*) into n from storage.buckets
  where id in ('ugq-voice-recordings','ugq-video-recordings');
  if n <> 2 then
    raise exception 'UGQ: expected both media buckets to exist, found %', n;
  end if;

  -- A public UGQ media bucket would expose raw proposer recordings to anyone
  -- holding the object path, defeating the signed-URL design entirely.
  if exists (
    select 1 from storage.buckets
    where id in ('ugq-voice-recordings','ugq-video-recordings') and public
  ) then
    raise exception 'UGQ: a media bucket is PUBLIC; these must be private and served via signed URLs only';
  end if;
end
$chk$;
