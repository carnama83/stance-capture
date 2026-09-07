-- Security hardening: close 8 tables that had RLS disabled (anon/authenticated
-- had full SELECT/INSERT/UPDATE/DELETE/TRUNCATE via Postgres default grants,
-- so anyone with the public anon key could dump or corrupt them directly
-- through the Supabase REST API), and convert SECURITY DEFINER views that
-- don't need elevated privileges to SECURITY INVOKER so they respect the RLS
-- of the tables they query instead of bypassing it.
--
-- Four SECURITY DEFINER views are deliberately left untouched — see the
-- COMMENT ON VIEW notes at the bottom for why each one legitimately needs to
-- bypass the RLS of a table it reads (cross-user aggregation or moderation
-- visibility rules that must apply regardless of who is asking).

-- ─── question_engagement_metrics / question_trending_metrics /
--     question_stance_stats_history ────────────────────────────────────────
-- Already shown to every visitor (ThreeTierQuestionsFeed, WhyIsTrendingPanel,
-- TrendingAnsweredCard, TopicMomentumTimeline) — public read, admin/service
-- write only.

alter table public.question_engagement_metrics enable row level security;
revoke all on public.question_engagement_metrics from anon, authenticated;
grant select on public.question_engagement_metrics to anon, authenticated;

create policy question_engagement_metrics_public_read
  on public.question_engagement_metrics for select
  using (true);

create policy question_engagement_metrics_admin_write
  on public.question_engagement_metrics for all
  using (auth.role() = 'service_role' or is_admin())
  with check (auth.role() = 'service_role' or is_admin());

alter table public.question_trending_metrics enable row level security;
revoke all on public.question_trending_metrics from anon, authenticated;
grant select on public.question_trending_metrics to anon, authenticated;

create policy question_trending_metrics_public_read
  on public.question_trending_metrics for select
  using (true);

create policy question_trending_metrics_admin_write
  on public.question_trending_metrics for all
  using (auth.role() = 'service_role' or is_admin())
  with check (auth.role() = 'service_role' or is_admin());

alter table public.question_stance_stats_history enable row level security;
revoke all on public.question_stance_stats_history from anon, authenticated;
grant select on public.question_stance_stats_history to anon, authenticated;

create policy question_stance_stats_history_public_read
  on public.question_stance_stats_history for select
  using (true);

create policy question_stance_stats_history_admin_write
  on public.question_stance_stats_history for all
  using (auth.role() = 'service_role' or is_admin())
  with check (auth.role() = 'service_role' or is_admin());

-- ─── question_duplicates / question_links / question_lifecycle_config /
--     question_state_history ────────────────────────────────────────────────
-- No client code reads or writes these (confirmed by grep across src/ and
-- supabase/functions/) — pipeline/moderation-internal. Admin or service_role
-- only; anon gets no grant at all.

alter table public.question_duplicates enable row level security;
revoke all on public.question_duplicates from anon, authenticated;
grant select, insert, update, delete on public.question_duplicates to authenticated;

create policy question_duplicates_admin_all
  on public.question_duplicates for all
  using (auth.role() = 'service_role' or is_admin())
  with check (auth.role() = 'service_role' or is_admin());

alter table public.question_links enable row level security;
revoke all on public.question_links from anon, authenticated;
grant select, insert, update, delete on public.question_links to authenticated;

create policy question_links_admin_all
  on public.question_links for all
  using (auth.role() = 'service_role' or is_admin())
  with check (auth.role() = 'service_role' or is_admin());

alter table public.question_lifecycle_config enable row level security;
revoke all on public.question_lifecycle_config from anon, authenticated;
grant select, insert, update, delete on public.question_lifecycle_config to authenticated;

create policy question_lifecycle_config_admin_all
  on public.question_lifecycle_config for all
  using (auth.role() = 'service_role' or is_admin())
  with check (auth.role() = 'service_role' or is_admin());

alter table public.question_state_history enable row level security;
revoke all on public.question_state_history from anon, authenticated;
grant select, insert, update, delete on public.question_state_history to authenticated;

create policy question_state_history_admin_all
  on public.question_state_history for all
  using (auth.role() = 'service_role' or is_admin())
  with check (auth.role() = 'service_role' or is_admin());

-- ─── question_view_events ───────────────────────────────────────────────────
-- useQuestionView.ts only ever inserts a row for the signed-in caller's own
-- user_id, and never reads it back. Admin/service can read for analytics.

alter table public.question_view_events enable row level security;
revoke all on public.question_view_events from anon, authenticated;
grant insert, select on public.question_view_events to authenticated;

create policy question_view_events_insert_own
  on public.question_view_events for insert
  with check (auth.uid() = user_id);

create policy question_view_events_admin_read
  on public.question_view_events for select
  using (auth.role() = 'service_role' or is_admin());

-- ─── user_topic_interactions ────────────────────────────────────────────────
-- QuestionDetailPage.trackQuestionInteraction upserts the caller's own
-- (user_id, topic_id) row only.

alter table public.user_topic_interactions enable row level security;
revoke all on public.user_topic_interactions from anon, authenticated;
grant select, insert, update on public.user_topic_interactions to authenticated;

create policy user_topic_interactions_own
  on public.user_topic_interactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy user_topic_interactions_admin_read
  on public.user_topic_interactions for select
  using (auth.role() = 'service_role' or is_admin());

-- ─── SECURITY DEFINER views → SECURITY INVOKER ─────────────────────────────
-- These only read tables that are already fully public-read (questions,
-- topics, topic_impact_scores, daily_curated_questions, topic_region_trends)
-- or, for admin_question_drafts_v, tables that are correctly admin-only
-- (question_drafts, topic_drafts) — switching to invoker mode is what
-- actually makes that one admin-only instead of world-readable.

alter view public.active_questions set (security_invoker = true);
alter view public.admin_question_drafts_v set (security_invoker = true);
alter view public.feed_topics_v set (security_invoker = true);
alter view public.v_daily_curated_questions_expanded set (security_invoker = true);
alter view public.topic_region_trends_v set (security_invoker = true);
alter view public.question_impact_scores set (security_invoker = true);
alter view public.v_question_impact_admin set (security_invoker = true);
alter view public.v_topic_impact_admin set (security_invoker = true);
alter view public.vw_topic_top_questions_v1 set (security_invoker = true);
alter view public.vw_topic_scores_top5_v1 set (security_invoker = true);
alter view public.vw_topics_with_score_v1 set (security_invoker = true);
alter view public.vw_topic_scores_v1 set (security_invoker = true);

-- Left as SECURITY DEFINER on purpose (do not "fix" these without re-reading
-- the note — each one needs to see rows a normal caller's RLS would hide, to
-- either produce a correct cross-user aggregate or apply a moderation rule
-- that must hold regardless of who's asking):

comment on view public.v_live_questions is
  'SECURITY DEFINER by design: LEFT JOINs question_visibility_rules, which is '
  'admin/service-only under RLS. Needs elevated read on that table so the '
  '(vr.visibility IS NULL OR vr.visibility = ''visible'') filter can actually '
  'see and hide moderated/hidden questions. Converting to SECURITY INVOKER '
  'would make every hidden question look visible to non-admins, since RLS '
  'would block the view from seeing the hiding rule at all.';

comment on view public.question_stance_momentum_region_v is
  'SECURITY DEFINER by design: aggregates question_stances (RLS: owner-only '
  'SELECT) across all users into non-identifying per-region counts. Converting '
  'to SECURITY INVOKER would make every caller see only their own single '
  'stance instead of the true community counts.';

comment on view public.question_expectation_summary is
  'SECURITY DEFINER by design: aggregates question_expectations (RLS: '
  'owner-only SELECT) into the public, no-login Expectation Ledger '
  '(/ledger/:questionId/:regionId, see PublicLedgerPage.tsx). Converting to '
  'SECURITY INVOKER would return empty results for every anonymous visitor.';

comment on view public.vw_topic_questions_with_impact_v1 is
  'SECURITY DEFINER by design: its response_count column is a '
  'count(*) over question_stances (RLS: owner-only SELECT). Converting to '
  'SECURITY INVOKER would make response_count read as 0 or 1 for every '
  'caller instead of the true total. Downstream views '
  '(vw_topic_scores_top5_v1 and others) intentionally query this one so they '
  'inherit correct aggregation without needing definer rights themselves.';
