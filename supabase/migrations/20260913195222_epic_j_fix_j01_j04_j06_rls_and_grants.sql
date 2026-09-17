-- Epic J remediation, Sep 2026 — J-01, J-04, J-06 (RLS / GRANT layer only).

-- ── J-01: topic_sources — drop the leftover blanket-write policy ─────────────
-- temp_auth_all was FOR ALL TO authenticated USING(true) WITH CHECK(true); because
-- RLS policies are OR-ed it defeated the three admin policies beside it, so any
-- signed-in user could insert/update/delete news sources.
drop policy if exists temp_auth_all on public.topic_sources;

-- ── J-04: admin_fn_perf — enable RLS and drop the anon/authenticated write grants
alter table public.admin_fn_perf enable row level security;

drop policy if exists admin_fn_perf_service_all on public.admin_fn_perf;
create policy admin_fn_perf_service_all on public.admin_fn_perf
  for all to service_role using (true) with check (true);

drop policy if exists admin_fn_perf_admin_read on public.admin_fn_perf;
create policy admin_fn_perf_admin_read on public.admin_fn_perf
  for select to authenticated using (public.is_admin());

revoke all on public.admin_fn_perf from anon;
revoke insert, update, delete, truncate, references, trigger on public.admin_fn_perf from authenticated;

-- ── J-06: ingested_stances — the review workflow had no write policy at all ──
-- RLS was enabled with only a SELECT policy, so the admin UI's accept/reject
-- UPDATE matched zero rows and reported success.
drop policy if exists ingested_stances_admin_update on public.ingested_stances;
create policy ingested_stances_admin_update on public.ingested_stances
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
