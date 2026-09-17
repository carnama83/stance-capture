-- Epic J, Sep 2026 — J-18: close the remaining unguarded SECURITY DEFINER admin RPCs.
--
-- Scope correction: an earlier sweep reported NINE unguarded functions. Reading them
-- showed four (admin_publish_rendition, admin_regenerate_rendition, admin_flag_rendition,
-- admin_edit_and_publish_rendition) already call public._ensure_admin_or_service(), a real
-- guard (service_role bypass, else is_admin(), raises 42501) — the sweep regex matched on
-- is_admin|admin_users|service_role and that helper's name contains none of them. A fifth,
-- admin_publish_draft_timed, inherits a real is_admin_me() check from admin_publish_draft.
-- The genuine gap is FOUR functions.
--
-- Callers traced first: no DB-internal callers exist, and admin.cron_generate_renditions
-- reaches generate-question-renditions over HTTP with a service_role bearer, so these RPCs
-- arrive as service_role. assert_admin_caller() admits service_role, internal DB sessions
-- and admin_users members, so the Edge Function paths keep working.
--
-- Surgical: each function is rewritten from its OWN pg_get_functiondef() with the guard
-- inserted after the first BEGIN. Bodies are not retyped (admin_create_question_draft
-- alone takes 16 parameters).
do $mig$
declare
  r        record;
  newdef   text;
  n        int := 0;
  missing  text;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_claim_rendition_jobs','admin_claim_rendition_job_by_id',
                        'admin_create_question_draft','admin_create_topic_draft',
                        'admin_publish_draft_timed')
      and p.prosrc not ilike '%assert_admin_caller%'
    order by p.proname
  loop
    newdef := regexp_replace(r.def, '\ybegin\y',
                'begin' || chr(10) || '  perform public.assert_admin_caller();',
                1, 1, 'i');

    if newdef = r.def then
      raise exception 'J-18: could not insert guard into % (no BEGIN matched)', r.proname;
    end if;

    execute newdef;
    n := n + 1;
  end loop;

  -- Re-audit rather than trust the loop: every target must now carry the guard.
  select string_agg(p.proname, ', ') into missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('admin_claim_rendition_jobs','admin_claim_rendition_job_by_id',
                      'admin_create_question_draft','admin_create_topic_draft',
                      'admin_publish_draft_timed')
    and p.prosrc not ilike '%assert_admin_caller%';

  if missing is not null then
    raise exception 'J-18: guard missing after the pass on: %', missing;
  end if;

  raise notice 'J-18: guarded % functions', n;
end
$mig$;

-- Revoke anon EXECUTE across all nine, including the four that were already guarded:
-- anon has no business reaching a SECURITY DEFINER admin RPC even when the body refuses it.
do $rev$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.admin_claim_rendition_jobs(integer)',
    'public.admin_claim_rendition_job_by_id(uuid)',
    'public.admin_create_question_draft(uuid, text, text, text[], text, text, jsonb, jsonb, text, text[], boolean, text, text, uuid, numeric, text)',
    'public.admin_create_topic_draft(uuid, text, text, text[], text, text, jsonb, jsonb)',
    'public.admin_publish_draft_timed(uuid, uuid[])',
    'public.admin_publish_rendition(uuid)',
    'public.admin_regenerate_rendition(uuid)',
    'public.admin_flag_rendition(uuid, text)',
    'public.admin_edit_and_publish_rendition(uuid, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end
$rev$;
