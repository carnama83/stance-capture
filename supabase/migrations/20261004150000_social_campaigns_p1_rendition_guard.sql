-- Facebook Campaign Manager, Phase 1: invalidated / superseded wording stops
-- campaign outreach (PDD v1.2 §12, AC07).
--
-- "An invalidated rendition blocks future distribution; superseded content
--  requires review before further outreach."
--
--   1. When a rendition leaves 'published' for 'invalidated' or 'superseded',
--      every scheduled or claimed task bound to it is cancelled with a reason.
--      Cancelled (not skipped) so a re-plan schedules replacements with the
--      current published wording.
--   2. Claiming a task requires its rendition to still be the published one
--      (backstop if a rendition is ever changed without the trigger).
--   3. Re-planning is blocked while an approved caption was checked before the
--      current wording was published: re-mark it neutral after reviewing it.

-- ── 1. cancel open tasks when the wording is withdrawn or replaced ──────────
create or replace function public.trg_social_jobs_follow_rendition()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  update public.social_campaign_jobs
     set status = 'cancelled',
         skip_reason = case new.lifecycle_status
           when 'invalidated' then 'Wording withdrawn (rendition invalidated)'
           else 'Wording replaced by a newer version; re-plan to use it' end
   where rendition_id = new.id
     and status in ('scheduled', 'claimed');
  return null;
end $$;
revoke all on function public.trg_social_jobs_follow_rendition() from public, anon, authenticated;

drop trigger if exists social_jobs_follow_rendition on public.question_renditions;
create trigger social_jobs_follow_rendition
  after update of lifecycle_status on public.question_renditions
  for each row
  when (old.lifecycle_status is distinct from new.lifecycle_status
        and new.lifecycle_status in ('invalidated', 'superseded'))
  execute function public.trg_social_jobs_follow_rendition();

-- ── 2 & 3: patch the live admin functions (exact-match anchors) ─────────────
create or replace function pg_temp.sub1(p_def text, p_old text, p_new text, p_fn text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(p_def) - length(replace(p_def, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then
    raise exception 'patch anchor for % matched % times (expected 1): %', p_fn, n, p_old;
  end if;
  return replace(p_def, p_old, p_new);
end $$;

do $patch$
declare v_def text;
begin
  -- 2. claim guard
  select pg_get_functiondef('public.admin_social_job_action(uuid,text,text,text)'::regprocedure) into v_def;
  v_def := pg_temp.sub1(v_def,
    E'      raise exception ''JOB_NOT_CLAIMABLE: job is %'', j.status using errcode = ''22023'';\n    end if;\n',
    E'      raise exception ''JOB_NOT_CLAIMABLE: job is %'', j.status using errcode = ''22023'';\n    end if;\n'
    || E'    if not exists (select 1 from public.question_renditions r\n'
    || E'                    where r.id = j.rendition_id and r.lifecycle_status = ''published'') then\n'
    || E'      raise exception ''RENDITION_NOT_CURRENT: the question''''s wording changed; re-plan the campaign'' using errcode = ''22023'';\n'
    || E'    end if;\n',
    'admin_social_job_action/claim');
  execute v_def;

  -- 3. captions must be re-checked after the wording changes
  select pg_get_functiondef('public.admin_plan_social_campaign(uuid,boolean,text,boolean)'::regprocedure) into v_def;
  v_def := pg_temp.sub1(v_def,
    E'  -- Busy times from every other live campaign plus this campaign''s kept jobs.\n',
    E'  -- Superseded content needs review before further outreach (PDD §12).\n'
    || E'  if exists (select 1 from public.social_campaign_caption_variants cv\n'
    || E'              join _sc_rend sr on sr.lang = cv.language_code\n'
    || E'              join public.question_renditions r on r.id = sr.rendition_id\n'
    || E'             where cv.campaign_id = c.id and cv.status = ''approved''\n'
    || E'               and cv.neutrality_checked_at < r.published_at) then\n'
    || E'    v_warn := v_warn || jsonb_build_object(''code'', ''captions_predate_wording'', ''blocking'', true,\n'
    || E'      ''message'', ''The question''''s wording changed after some captions were approved. Review each against the current wording and mark it neutral again.'');\n'
    || E'    v_block := true;\n'
    || E'  end if;\n\n'
    || E'  -- Busy times from every other live campaign plus this campaign''s kept jobs.\n',
    'admin_plan_social_campaign/captions_predate_wording');
  execute v_def;
end
$patch$;

notify pgrst, 'reload schema';
