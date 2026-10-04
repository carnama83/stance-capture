-- Facebook Campaign Manager: posts are made only as the Stance Capture Page.
--
-- Product decision (4 Oct 2026): nobody posts in Facebook groups under their
-- own name. Posting identities can only be Facebook Pages, and the scheduler
-- assigns group tasks only to a Page. An empty "who may post here" on a group
-- now means "any active Page" (it used to mean "any active personal profile").
-- Groups that do not accept Pages should not be registered.

-- ── 1. identities are Pages only ────────────────────────────────────────────
do $$ begin
  if exists (select 1 from public.social_posting_identities where kind <> 'page') then
    raise exception 'PAGE_ONLY: personal-profile identities exist; retire them before applying';
  end if;
end $$;

alter table public.social_posting_identities drop constraint if exists social_posting_identities_kind_check;
alter table public.social_posting_identities alter column kind set default 'page';
alter table public.social_posting_identities add constraint social_posting_identities_kind_check
  check (kind = 'page');
comment on column public.social_posting_identities.kind is
  'Always ''page'': Stance Capture posts in groups only as its Facebook Page, never from a personal profile.';

-- ── 2. scheduler: group tasks go only to a Page identity ────────────────────
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
  select pg_get_functiondef('public.admin_plan_social_campaign(uuid,boolean,text,boolean)'::regprocedure) into v_def;
  v_def := pg_temp.sub1(v_def,
    '((cardinality(g.allowed_identity_ids) = 0 and i.kind = ''profile'') or i.id = any(g.allowed_identity_ids))',
    'i.kind = ''page'' and (cardinality(g.allowed_identity_ids) = 0 or i.id = any(g.allowed_identity_ids))',
    'admin_plan_social_campaign/page-only identity');
  v_def := pg_temp.sub1(v_def,
    '''Add an active, unrestricted posting identity before scheduling group tasks.''',
    '''Add the Stance Capture Page as an active, unrestricted posting identity before scheduling group tasks.''',
    'admin_plan_social_campaign/no-identity message');
  execute v_def;
end
$patch$;

notify pgrst, 'reload schema';
