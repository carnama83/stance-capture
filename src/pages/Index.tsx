// src/pages/Index.tsx
// HOMEPAGE V2 (section-owned layout)
// - Trending Now (Country first + Global) + optional Global Breaking banner
// - Today’s 5 Questions (inline stance slider)
// - Because you engaged with...
// - Reopened Questions for You (phase-aware)
// - Local topics collapsed
//
// Reuses existing RPCs:
// - get_personalized_feed
// - set_question_stance
// - record_question_view
// - get_three_tier_curated_feed_v2
// - get_personalized_trending_topics (fallback to vw_topics_trending)

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";

import PageLayout from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";

// ---------- Types ----------
type Session = import("@supabase/supabase-js").Session;

type Topic = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  updated_at?: string | null;
  tier?: "city" | "county" | "state" | "country" | "global" | null;
  location_label?: string | null;
  trending_score?: number | null;
  activity_7d?: number | null;
};

type RegionRow = {
  user_id: string;
  city_label: string | null;
  county_label: string | null;
  state_label: string | null;
  country_label: string | null;
};

// Matches all_schemas.sql signature (get_personalized_feed)
type PersonalizedFeedRow = {
  question_id: string;
  topic_id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  state: string;
  published_at: string | null;
  is_trending: boolean | null;
  trending_score: number | null;
  user_has_answered: boolean;
  topic_title: string | null;
  topic_tags: string[] | null;
  relevance_score: number | null;
  response_count: number | null;
  phase: string | null;
  is_new_phase: boolean;
};

// Matches all_schemas.sql signature (get_three_tier_curated_feed_v2)
type ThreeTierFeedRow = {
  tier: string; // "local" | "country" | "global" (or similar)
  tier_label: string;
  question_id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  composite_score: number | null;
  tier_position: number | null;
};

type QuestionMetaRow = {
  id: string;
  state: string | null;
  is_trending: boolean | null;
};

type QuestionEngagementRow = {
  question_id: string;
  responses_last_24h: number;
  responses_last_7d: number;
  responses_total: number;
  response_rate_24h: number;
  response_rate_7d: number;
};

type RelatedQuestionRow = {
  related_question_id: string;
  related_question: string;
  link_type: string;
  score: number;
  method: string;
  state: string;
};

// ---------- Session hook ----------
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

// ---------- Source aliasing ----------
const SOURCE_ALIAS: Record<string, string> = {
  topics_trending: "vw_topics_trending",
};

// ---------- Generic fetch utility ----------
async function fetchFromSource<T>(
  sb: ReturnType<typeof getSupabase> | null,
  options: {
    sourceCandidates: string[];
    defaultSource: string;
    select: string;
    filters?: Record<string, any>;
    order?: { column: string; ascending: boolean }[];
    limit?: number;
  }
): Promise<T[]> {
  if (!sb) return [];

  let lastError: any = null;

  for (const srcCandidate of options.sourceCandidates) {
    const actualSource = SOURCE_ALIAS[srcCandidate] ?? srcCandidate;
    try {
      let query = sb.from(actualSource).select(options.select);

      if (options.filters) {
        for (const [key, value] of Object.entries(options.filters)) {
          query = query.eq(key, value);
        }
      }
      if (options.order) {
        for (const o of options.order) {
          query = query.order(o.column, { ascending: o.ascending });
        }
      }
      if (options.limit != null) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;
      if (!error && data) return data as T[];
      lastError = error;
    } catch (err) {
      lastError = err;
    }
  }

  console.error(
    `Failed to fetch from all sources for "${options.defaultSource}". Last error:`,
    lastError
  );
  return [];
}

// ---------- Trending topics ----------
async function fetchTrendingTopics(
  sb: ReturnType<typeof getSupabase> | null,
  opts: { personalized: boolean; userId: string | null }
): Promise<Topic[]> {
  // NOTE: Some environments may not expose `updated_at` on vw_topics_trending/topics_trending.
  // Selecting or ordering by a missing column causes PostgREST 400s (and the UI falls back to skeletons).
  // We still *display* relative time when available (e.g., from personalized RPC), but we don't require it.
  const baseSelect =
    "id, title, summary, tags, tier, location_label, trending_score, activity_7d";

  if (opts.personalized && opts.userId && sb) {
    try {
      const { data, error } = await sb.rpc("get_personalized_trending_topics", {
        p_user_id: opts.userId,
        p_limit: 10,
      });
      if (!error && data) return data as Topic[];
    } catch {
      // fallback below
    }
  }

  return fetchFromSource<Topic>(sb, {
    sourceCandidates: ["vw_topics_trending", "topics_trending"],
    defaultSource: "vw_topics_trending",
    select: baseSelect,
    order: [
      { column: "trending_score", ascending: false },
      { column: "activity_7d", ascending: false },
    ],
    limit: 10,
  });
}

// ---------- Display name helper ----------
function getDisplayHandle(
  profile:
    | { random_id: string; username: string | null; display_handle_mode: string }
    | null
    | undefined,
  session: Session | null
): string {
  if (!profile) {
    if (!session?.user?.email) return "there";
    const email = session.user.email;
    const atIdx = email.indexOf("@");
    if (atIdx > 0) {
      const local = email.slice(0, atIdx);
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    return email;
  }

  if (profile.display_handle_mode === "username" && profile.username) {
    return profile.username;
  }
  return profile.random_id;
}

// ---------- Hero CTA ----------
function HeroCta({
  onLogin,
  onSignup,
}: {
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border bg-gradient-to-br from-slate-50 to-white shadow-sm">
      <div className="px-4 py-6 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Track your stance on what matters
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Start with what’s trending, take a stance, and track how your views
          evolve over time.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
            onClick={onSignup}
          >
            Sign up
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
            onClick={onLogin}
          >
            Log in
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- Hero Welcome ----------
function HeroWelcome({ name }: { name: string }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-gradient-to-br from-slate-50 to-white shadow-sm">
      <div className="px-4 py-5 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Welcome back, {name}!
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Start with what’s trending, then answer today’s questions.
        </p>
      </div>
    </section>
  );
}

// ---------- UI helpers ----------
function formatScore(n?: number | null) {
  if (n == null || Number.isNaN(n)) return null;
  if (n >= 1000) return `${Math.round((n / 1000) * 10) / 10}k`;
  return `${Math.round(n)}`;
}

function minutesAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  const t = dt.getTime();
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function TopicCard({
  topic,
  onOpen,
}: {
  topic: Topic;
  onOpen: (topicId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(topic.id)}
      className="text-left min-w-[260px] max-w-[340px] rounded-lg border bg-white p-3 shadow-sm hover:bg-slate-50 transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-slate-900 line-clamp-2">
          {topic.title}
        </div>
        {typeof topic.trending_score === "number" && (
          <span className="shrink-0 rounded bg-slate-900 text-white px-2 py-0.5 text-[10px]">
            {formatScore(topic.trending_score)}
          </span>
        )}
      </div>

      {topic.summary ? (
        <div className="mt-1 text-xs text-slate-600 line-clamp-2">
          {topic.summary}
        </div>
      ) : (
        <div className="mt-1 text-xs text-slate-500">
          Tap to view related questions.
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <span className="rounded border px-1.5 py-0.5">
          {(topic.tier ?? "trending").toUpperCase()}
        </span>
        {typeof topic.activity_7d === "number" ? (
          <span className="rounded border px-1.5 py-0.5">
            {formatScore(topic.activity_7d)} activity (7d)
          </span>
        ) : null}
        {topic.location_label ? <span>{topic.location_label}</span> : null}
      </div>
    </button>
  );
}

function WireframeTrendingCarousel({
  topics,
  onAnswer,
  onOpen,
}: {
  topics: Topic[];
  onAnswer: (topicId: string) => void;
  onOpen?: (topicId: string) => void;
}) {
  const [page, setPage] = React.useState(0);
  const totalPages = Math.max(1, Math.ceil((topics?.length ?? 0) / 3));

  React.useEffect(() => {
    // If topics change and current page is out of range, reset.
    if (page > totalPages - 1) setPage(0);
  }, [page, totalPages]);

  const slice = topics.slice(page * 3, page * 3 + 3);
  const [a, b, c] = slice;

  const Card = ({
    t,
    variant,
  }: {
    t: Topic;
    variant: "large" | "small";
  }) => {
    const tier = (t.tier ?? "global").toUpperCase();
    const time = minutesAgo(t.updated_at) ?? "";
    const sources =
      typeof t.activity_7d === "number" ? `${formatScore(t.activity_7d)} sources` : null;

    return (
      <div
        className={
          variant === "large"
            ? "rounded-lg border bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm"
            : "rounded-lg border bg-gradient-to-b from-slate-50 to-white p-3 shadow-sm"
        }
      >
        <button
          type="button"
          className={
            (variant === "large"
              ? "text-lg font-semibold text-slate-900 line-clamp-2"
              : "text-sm font-semibold text-slate-900 line-clamp-2") +
            " text-left hover:underline"
          }
          onClick={() => (onOpen ?? onAnswer)(t.id)}
        >
          {t.title}
        </button>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] text-white">
            {tier}
          </span>
          {(t.tags ?? []).map((tag) => {
            const up = tag.toUpperCase();
            if (up === "BREAKING" || up === "TRENDING" || up === "NATIONAL") {
              return (
                <span
                  key={tag}
                  className="rounded bg-slate-900/10 px-2 py-0.5 text-[10px] text-slate-900"
                >
                  {up}
                </span>
              );
            }
            return null;
          })}
        </div>

        {variant === "large" ? (
          <div className="mt-3 text-xs text-slate-600">
            {sources ? <span>{sources}</span> : <span>— sources</span>}
            {time ? <span> • {time}</span> : null}
          </div>
        ) : null}

        <div className={variant === "large" ? "mt-4" : "mt-3"}>
          <button
            type="button"
            className={
              variant === "large"
                ? "rounded bg-slate-700 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                : "rounded border bg-white px-4 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            }
            onClick={() => onAnswer(t.id)}
          >
            Answer
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="relative">
      {/* Cards row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        {a ? <Card t={a} variant="large" /> : <div className="rounded-lg border bg-slate-50 p-4" />}
        {b ? <Card t={b} variant="small" /> : <div className="rounded-lg border bg-slate-50 p-3" />}
        {c ? <Card t={c} variant="small" /> : <div className="rounded-lg border bg-slate-50 p-3" />}
      </div>

      {/* Right chevron */}
      {totalPages > 1 ? (
        <button
          type="button"
          aria-label="Next"
          className="absolute -right-2 top-1/2 -translate-y-1/2 rounded-full border bg-white p-2 shadow-sm hover:bg-slate-50"
          onClick={() => setPage((p) => (p + 1) % totalPages)}
        >
          ›
        </button>
      ) : null}

      {/* Dots */}
      {totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Page ${i + 1}`}
              onClick={() => setPage(i)}
              className={
                i === page
                  ? "h-2 w-4 rounded-full bg-slate-700"
                  : "h-2 w-2 rounded-full bg-slate-300"
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GlobalBreakingBanner({
  headline,
  onOpen,
}: {
  headline: Topic;
  onOpen: (topicId: string) => void;
}) {
  return (
    <div className="mb-3 rounded-lg border bg-slate-900 text-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-white/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide">
            GLOBAL BREAKING
          </span>
          <span className="text-sm font-semibold line-clamp-1">
            {headline.title}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onOpen(headline.id)}
          className="rounded bg-white text-slate-900 px-3 py-1 text-xs font-semibold hover:bg-slate-100"
        >
          View
        </button>
      </div>
      {headline.summary ? (
        <div className="mt-1 text-xs text-white/80 line-clamp-1">
          {headline.summary}
        </div>
      ) : null}
    </div>
  );
}

// Question row: left text, right slider
function QuestionRow({
  questionId,
  question,
  summary,
  state,
  phase,
  isTrending,
  engagement,
  related,
  initialStanceValue,
  onSubmitStance,
  onAnswer,
  showNewUpdateBadge,
}: {
  questionId: string;
  question: string;
  summary?: string | null;
  state?: string | null;
  phase?: string | null;
  isTrending?: boolean | null;
  engagement?: {
    responses_last_24h: number;
    responses_last_7d: number;
    responses_total: number;
    response_rate_24h: number;
    response_rate_7d: number;
  } | null;
  related?:
    | {
        related_question_id: string;
        related_question: string;
        link_type: string;
        score: number;
        method: string;
        state: string;
      }[]
    | null;
  initialStanceValue: number | null;
  onSubmitStance: (value: number) => Promise<void>;
  onAnswer: () => void;
  showNewUpdateBadge?: boolean;
}) {
  const stateLabel = (state ?? '').toUpperCase();

  const stateBadge = state ? (
    <span className="shrink-0 rounded bg-slate-900/10 px-2 py-0.5 text-[10px] text-slate-900">
      {stateLabel}
    </span>
  ) : null;

  const phaseBadge = phase && phase !== 'initial' ? (
    <span className="shrink-0 rounded bg-indigo-600/10 px-2 py-0.5 text-[10px] text-indigo-700">
      {phase.toUpperCase()}
    </span>
  ) : null;

  const trendingBadge = isTrending ? (
    <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-800">
      TRENDING
    </span>
  ) : null;

  const likelyDuplicate = React.useMemo(() => {
    if (!related || !related.length) return false;
    return related.some(
      (r) =>
        (r.link_type ?? "").toLowerCase() === "supersedes" ||
        (r.method ?? "").toLowerCase().includes("dedup")
    );
  }, [related]);

  const duplicateBadge = likelyDuplicate ? (
    <span className="shrink-0 rounded bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-800">
      POSSIBLE DUPLICATE
    </span>
  ) : null;

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-3 shadow-sm md:grid-cols-[1fr_460px]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link
            to={`/q/${questionId}`}
            className="min-w-0 font-semibold text-slate-900 line-clamp-2 hover:underline cursor-pointer"
            title="Open question details"
          >
            {question}
          </Link>
          {stateBadge}
          {phaseBadge}
          {trendingBadge}
          {duplicateBadge}
          {showNewUpdateBadge ? (
            <span className="shrink-0 rounded bg-slate-900/10 px-2 py-0.5 text-[10px] text-slate-900">
              New update
            </span>
          ) : null}
        </div>

        {summary ? (
          <div className="mt-1 text-xs text-slate-600 line-clamp-2">
            {summary}
          </div>
        ) : null}

        {/* Engagement metrics (24h/7d/total) */}
        {engagement ? (
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
            <span className="rounded bg-slate-900/5 px-2 py-0.5">
              24h: {engagement.responses_last_24h}
            </span>
            <span className="rounded bg-slate-900/5 px-2 py-0.5">
              7d: {engagement.responses_last_7d}
            </span>
            <span className="rounded bg-slate-900/5 px-2 py-0.5">
              total: {engagement.responses_total}
            </span>
          </div>
        ) : null}

        {/* Smart linking / dedup signals */}
        {related && related.length ? (
          <div className="mt-2">
            <div className="text-[11px] text-slate-600">Related</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {related.slice(0, 2).map((r) => (
                <button
                  key={r.related_question_id}
                  type="button"
                  className="rounded border px-2 py-1 text-[11px] hover:bg-slate-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.hash = `#/q/${r.related_question_id}`;
                  }}
                  title={`${r.link_type} • score ${Number(r.score).toFixed(2)}`}
                >
                  {r.related_question}
                </button>
              ))}
              {related.length > 2 ? (
                <span className="text-[11px] text-slate-500">
                  +{related.length - 2} more
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-2">
          <button
            type="button"
            onClick={onAnswer}
            className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            Answer
          </button>
        </div>
      </div>

      <div className="min-w-0">
        <QuestionStanceSlider
          questionId={questionId}
          questionText={question}
          summary={summary ?? null}
          initialValue={initialStanceValue}
          onSubmit={onSubmitStance}
        />
      </div>
    </div>
  );
}

// ---------- Main ----------
export default function IndexPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useSupabaseSession();
  const isAuthed = !!session;
  const sb = React.useMemo(getSupabase, []);

  const userId = session?.user?.id ?? null;

  const actions = (
    <div className="flex items-center gap-2">
      <button
        className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center gap-2"
        onClick={() => navigate("/search")}
        aria-label="Search questions"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
      </button>
      <button
        className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
        onClick={() => navigate("/topics")}
        aria-label="Explore topics"
      >
        Explore topics
      </button>
    </div>
  );

  // Profile (display handle)
  const { data: profile } = useQuery({
    enabled: !!userId,
    queryKey: ["profile", userId],
    queryFn: async () => {
      if (!sb || !userId) return null;
      const { data, error } = await sb
        .from("profiles")
        .select("random_id, username, display_handle_mode")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        console.error("Failed to load profile", error);
        return null;
      }
      return data;
    },
    staleTime: 60_000,
  });

  // Region dims (for country label + location nudge)
  const { data: myRegion, isLoading: myRegionLoading } = useQuery({
    enabled: !!userId,
    queryKey: ["my-region", userId],
    queryFn: async () => {
      if (!sb || !userId) return null;
      const { data, error } = await sb
        .from("user_region_dimensions")
        .select("user_id, city_label, county_label, state_label, country_label")
        .eq("user_id", userId)
        .maybeSingle<RegionRow>();
      if (error) {
        console.error("Failed to load user region dimensions", error);
        return null;
      }
      return data ?? null;
    },
    staleTime: 60_000,
  });

  const countryLabel = myRegion?.country_label ?? "Country";

  const showLocationNudge =
    isAuthed &&
    !myRegionLoading &&
    myRegion &&
    !myRegion.city_label &&
    !myRegion.state_label &&
    !myRegion.country_label &&
    !myRegion.county_label;

  // Trending
  const trendingQuery = useQuery({
    queryKey: ["trending", isAuthed ? session?.user?.id : "anon"],
    queryFn: async () => {
      if (!sb)
        return fetchTrendingTopics(null, { personalized: false, userId: null });

      return fetchTrendingTopics(sb, {
        personalized: isAuthed,
        userId: session?.user?.id ?? null,
      });
    },
    staleTime: 60_000,
  });

  const trending = trendingQuery.data ?? [];

  const countryTopics = React.useMemo(() => {
    const byTier = trending.filter((t) => t.tier === "country");
    return byTier.length ? byTier : trending;
  }, [trending]);

  const globalTopics = React.useMemo(() => {
    const byTier = trending.filter((t) => t.tier === "global");
    return byTier.length ? byTier : trending;
  }, [trending]);

  // Global Breaking banner heuristic:
  const globalBreaking = React.useMemo(() => {
    const threshold = 1.4;

    const maxCountry = Math.max(
      0,
      ...countryTopics.map((t) =>
        typeof t.trending_score === "number" ? t.trending_score : 0
      )
    );
    const maxGlobal = Math.max(
      0,
      ...globalTopics.map((t) =>
        typeof t.trending_score === "number" ? t.trending_score : 0
      )
    );

    if (maxCountry <= 0 || maxGlobal <= 0) return null;
    if (maxGlobal <= threshold * maxCountry) return null;

    const topGlobal = [...globalTopics].sort((a, b) => {
      const sa = typeof a.trending_score === "number" ? a.trending_score : 0;
      const sb2 = typeof b.trending_score === "number" ? b.trending_score : 0;
      return sb2 - sa;
    })[0];

    return topGlobal ?? null;
  }, [countryTopics, globalTopics]);

  const openTopic = (topicId: string) => navigate(`/topics/${topicId}`);

  // Personalized feed (for Today’s 5 + Because + Reopened)
  const personalizedFeedQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-personalized-feed", userId],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_personalized_feed", {
        p_user_id: userId,
        p_limit: 30,
        p_offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as PersonalizedFeedRow[];
    },
    staleTime: 30_000,
  });

  // Anonymous / Regional feed for local (collapsed) + anon Today’s 5
  const threeTierFeedQuery = useQuery({
    enabled: !!sb && (!isAuthed || !userId),
    queryKey: ["home-three-tier-feed", isAuthed ? "authed" : "anon"],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_three_tier_curated_feed_v2", {
        p_user_id: null,
        p_ip_country: null,
      });
      if (error) throw error;
      return (data ?? []) as ThreeTierFeedRow[];
    },
    staleTime: 30_000,
  });

  // Split personalized sections
  const personalized = personalizedFeedQuery.data ?? [];

  const todaysFive = React.useMemo(() => {
    // Prefer unanswered, then fill
    const unanswered = personalized.filter((r) => !r.user_has_answered);
    const pool = unanswered.length ? unanswered : personalized;
    return pool.slice(0, 5);
  }, [personalized]);

  const reopened = React.useMemo(() => {
    return personalized.filter((r) => r.is_new_phase).slice(0, 2);
  }, [personalized]);

  const topEngagedTags = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of personalized) {
      for (const tag of r.topic_tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 2).map(([t]) => t);
  }, [personalized]);

  const becauseYou = React.useMemo(() => {
    // Prefer items that are NOT in todaysFive and not reopened; take 2
    const exclude = new Set<string>([
      ...todaysFive.map((x) => x.question_id),
      ...reopened.map((x) => x.question_id),
    ]);
    const pool = personalized.filter((r) => !exclude.has(r.question_id));
    return pool.slice(0, 2);
  }, [personalized, todaysFive, reopened]);

  // Fallback Today’s for anonymous users
  const anonTodaysFive = React.useMemo(() => {
    const rows = threeTierFeedQuery.data ?? [];
    // Prefer country/global first
    const nonLocal = rows.filter((r) => (r.tier ?? "").toLowerCase() !== "local");
    const pool = nonLocal.length ? nonLocal : rows;
    return pool.slice(0, 5);
  }, [threeTierFeedQuery.data]);

  // ---------- Decorations for question cards (lifecycle, engagement metrics, linking) ----------
  const displayedQuestionIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const r of todaysFive) if (r.question_id) ids.add(r.question_id);
    for (const r of anonTodaysFive) if (r.question_id) ids.add(r.question_id);
    return Array.from(ids);
  }, [todaysFive, anonTodaysFive]);

  // For anon rows (and as a safety net), fetch question metadata including lifecycle state + trending flag
  const questionMetaQuery = useQuery({
    enabled: !!sb && displayedQuestionIds.length > 0,
    queryKey: ["home-question-meta", displayedQuestionIds.join(",")],
    queryFn: async () => {
      const { data, error } = await sb!
        .from("questions")
        .select("id, state, is_trending")
        .in("id", displayedQuestionIds);
      if (error) {
        console.error("Failed to load question metadata", error);
        return [] as QuestionMetaRow[];
      }
      return (data ?? []) as QuestionMetaRow[];
    },
    staleTime: 30_000,
  });

  const questionMetaById = React.useMemo(() => {
    const m = new Map<string, QuestionMetaRow>();
    for (const r of questionMetaQuery.data ?? []) m.set(r.id, r);
    return m;
  }, [questionMetaQuery.data]);

  // Engagement metrics per question (24h/7d/total)
  const engagementQuery = useQuery({
    enabled: !!sb && displayedQuestionIds.length > 0,
    queryKey: ["home-question-engagement", displayedQuestionIds.join(",")],
    queryFn: async () => {
      const { data, error } = await sb!
        .from("question_engagement_metrics")
        .select(
          "question_id, responses_last_24h, responses_last_7d, responses_total, response_rate_24h, response_rate_7d"
        )
        .in("question_id", displayedQuestionIds);
      if (error) {
        console.error("Failed to load engagement metrics", error);
        return [] as QuestionEngagementRow[];
      }
      return (data ?? []) as QuestionEngagementRow[];
    },
    staleTime: 30_000,
  });

  const engagementByQuestionId = React.useMemo(() => {
    const m = new Map<string, QuestionEngagementRow>();
    for (const r of engagementQuery.data ?? []) m.set(r.question_id, r);
    return m;
  }, [engagementQuery.data]);

  // Smart linking: fetch lightweight related questions for Today's 5 (kept small for perf)
  const relatedQuery = useQuery({
    enabled: !!sb && todaysFive.length > 0,
    queryKey: ["home-related", ...todaysFive.map((r) => r.question_id)],
    queryFn: async () => {
      const entries = await Promise.all(
        todaysFive.map(async (r) => {
          try {
            const { data, error } = await sb!.rpc(
              "find_related_questions_lightweight",
              {
                p_question_id: r.question_id,
                p_min_score: 0.3,
                p_limit: 5,
              }
            );
            if (error) {
              console.warn("Related questions RPC failed", error);
              return [r.question_id, []] as const;
            }
            return [r.question_id, (data ?? []) as RelatedQuestionRow[]] as const;
          } catch (e) {
            console.warn("Related questions RPC exception", e);
            return [r.question_id, []] as const;
          }
        })
      );

      const map: Record<string, RelatedQuestionRow[]> = {};
      for (const [qid, list] of entries) map[qid] = list;
      return map;
    },
    staleTime: 60_000,
  });

  // Submit stance + record view
  const submitStance = React.useCallback(
    async (questionId: string, value: number) => {
      if (!sb) return;

      // If not logged in, redirect to login (preserve return_to behavior)
      if (!userId) {
        const returnTo = window.location.hash || "#/";
        sessionStorage.setItem("return_to", returnTo);
        navigate("/login");
        return;
      }

      const { error } = await sb.rpc("set_question_stance", {
        p_question_id: questionId,
        p_score: value,
      });

      if (error) throw error;

      // Refresh homepage feed sections
      await qc.invalidateQueries({ queryKey: ["home-personalized-feed", userId] });
    },
    [sb, userId, qc, navigate]
  );

  // Record impressions for the 5 questions (best-effort)
  React.useEffect(() => {
    if (!sb || !userId) return;
    const ids = todaysFive.map((x) => x.question_id).filter(Boolean);
    if (!ids.length) return;

    let cancelled = false;

    (async () => {
      for (const qid of ids) {
        if (cancelled) break;
        try {
          await sb.rpc("record_question_view", {
            p_user_id: userId,
            p_question_id: qid,
          });
        } catch {
          // non-blocking
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sb, userId, todaysFive]);

  // Answer navigation (adjust route if your app uses a different one)
  const goToQuestion = (questionId: string) => {
    // Question detail route
    navigate(`/q/${questionId}`);
  };

  return (
    <PageLayout rightSlot={actions}>
      {/* Hero */}
      {isAuthed ? (
        <HeroWelcome name={getDisplayHandle(profile, session)} />
      ) : (
        <HeroCta
          onLogin={() => navigate("/login")}
          onSignup={() => navigate("/signup")}
        />
      )}

      <section className="py-4 space-y-4">
        {/* Location Setup Nudge */}
        {showLocationNudge && (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-700">
              Set your location to compare your stance with people in your region.
            </span>
            <Link
              to="/settings/location"
              className="inline-flex items-center rounded bg-slate-900 text-white px-2 py-1 text-[11px]"
            >
              Set location
            </Link>
          </div>
        )}

        {/* Wireframe-style top bar (only when there's a breaking headline) */}
        {globalBreaking ? (
          <div className="rounded-md border bg-white px-4 py-2 text-sm flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span aria-hidden="true">🌍</span>
              <span className="font-semibold">Global Breaking</span>
              <span aria-hidden="true">⚠️</span>
              <span className="text-slate-700 line-clamp-1">
                {globalBreaking.title}
              </span>
            </div>
            <button
              type="button"
              className="rounded border px-3 py-1 text-xs hover:bg-slate-50"
              onClick={() => openTopic(globalBreaking.id)}
            >
              Answer
            </button>
          </div>
        ) : null}

        {/* Global Breaking Banner */}
        {globalBreaking ? (
          <GlobalBreakingBanner headline={globalBreaking} onOpen={openTopic} />
        ) : null}

        {/* Trending Now */}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Trending Now
              </h3>
              <p className="mt-0.5 text-xs text-slate-600">
                Country-first, with Global alongside.
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-slate-600 hover:text-slate-900"
              onClick={() => navigate("/topics")}
            >
              Explore →
            </button>
          </div>

          <div className="mt-3">
            <Tabs defaultValue="country" className="w-full">
              <TabsList className="mb-3 w-full sm:w-auto">
                <TabsTrigger value="country" className="flex-1 sm:flex-initial">
                  {countryLabel}
                </TabsTrigger>
                <TabsTrigger value="global" className="flex-1 sm:flex-initial">
                  Global
                </TabsTrigger>
              </TabsList>

              <TabsContent value="country" className="mt-0">
                <WireframeTrendingCarousel
                  topics={(countryTopics.length ? countryTopics : trending).slice(0, 12)}
                  onAnswer={openTopic}
                  onOpen={openTopic}
                />
              </TabsContent>

              <TabsContent value="global" className="mt-0">
                <WireframeTrendingCarousel
                  topics={(globalTopics.length ? globalTopics : trending).slice(0, 12)}
                  onAnswer={openTopic}
                  onOpen={openTopic}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Today’s 5 Questions */}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Today’s 5 Questions
              </h3>
              <p className="mt-0.5 text-xs text-slate-600">
                Slide to save your stance (AI meaning updates automatically).
              </p>
            </div>
            {!isAuthed ? (
              <button
                type="button"
                className="text-xs text-slate-600 hover:text-slate-900"
                onClick={() => navigate("/signup")}
              >
                Personalize →
              </button>
            ) : null}
          </div>

          <div className="mt-3 space-y-3">
            {isAuthed ? (
              (todaysFive.length ? todaysFive : []).map((r) => (
                <QuestionRow
                  key={r.question_id}
                  questionId={r.question_id}
                  question={r.question}
                  summary={r.summary}
                  state={r.state ?? null}
                  phase={r.phase ?? null}
                  isTrending={r.is_trending ?? null}
                  engagement={
                    engagementByQuestionId.get(r.question_id)
                      ? {
                          responses_last_24h:
                            Number(
                              engagementByQuestionId.get(r.question_id)!
                                .responses_last_24h
                            ),
                          responses_last_7d:
                            Number(
                              engagementByQuestionId.get(r.question_id)!
                                .responses_last_7d
                            ),
                          responses_total: Number(
                            engagementByQuestionId.get(r.question_id)!
                              .responses_total
                          ),
                          response_rate_24h: Number(
                            engagementByQuestionId.get(r.question_id)!
                              .response_rate_24h
                          ),
                          response_rate_7d: Number(
                            engagementByQuestionId.get(r.question_id)!
                              .response_rate_7d
                          ),
                        }
                      : null
                  }
                  related={relatedQuery.data?.[r.question_id] ?? null}
                  initialStanceValue={null}
                  onSubmitStance={(v) => submitStance(r.question_id, v)}
                  onAnswer={() => goToQuestion(r.question_id)}
                  showNewUpdateBadge={false}
                />
              ))
            ) : (
              (anonTodaysFive.length ? anonTodaysFive : []).map((r) => (
                <QuestionRow
                  key={r.question_id}
                  questionId={r.question_id}
                  question={r.question}
                  summary={r.summary}
                  state={questionMetaById.get(r.question_id)?.state ?? null}
                  isTrending={
                    questionMetaById.get(r.question_id)?.is_trending ?? null
                  }
                  engagement={
                    engagementByQuestionId.get(r.question_id)
                      ? {
                          responses_last_24h:
                            Number(
                              engagementByQuestionId.get(r.question_id)!
                                .responses_last_24h
                            ),
                          responses_last_7d:
                            Number(
                              engagementByQuestionId.get(r.question_id)!
                                .responses_last_7d
                            ),
                          responses_total: Number(
                            engagementByQuestionId.get(r.question_id)!
                              .responses_total
                          ),
                          response_rate_24h: Number(
                            engagementByQuestionId.get(r.question_id)!
                              .response_rate_24h
                          ),
                          response_rate_7d: Number(
                            engagementByQuestionId.get(r.question_id)!
                              .response_rate_7d
                          ),
                        }
                      : null
                  }
                  initialStanceValue={null}
                  onSubmitStance={async () => {
                    // Anonymous: require login to save stance
                    const returnTo = window.location.hash || "#/";
                    sessionStorage.setItem("return_to", returnTo);
                    navigate("/login");
                  }}
                  onAnswer={() => goToQuestion(r.question_id)}
                />
              ))
            )}

            {isAuthed && !todaysFive.length ? (
              <div className="text-sm text-slate-600">
                No questions found right now.
              </div>
            ) : null}
          </div>
        </div>

        {/* Because you engaged with... (intent tiles; show for anon too) */}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Because you engaged with:{" "}
                {topEngagedTags.length ? topEngagedTags.join(", ") : "your topics"}
              </h3>
              <p className="mt-0.5 text-xs text-slate-600">
                {isAuthed
                  ? "Personalized follow-ups based on your recent activity."
                  : "Sign in to unlock personalized follow-ups and comparisons."}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Tile 1: Similar topics (intent-driven) */}
            <div className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="font-semibold text-slate-900">Explore similar topics</div>
              <div className="mt-1 text-xs text-slate-600">
                Discover topics related to what you’ve been engaging with recently.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50"
                  onClick={() => {
                    if (!isAuthed) {
                      const returnTo = window.location.hash || "#/";
                      sessionStorage.setItem("return_to", returnTo);
                      navigate("/login");
                      return;
                    }
                    navigate("/topics");
                  }}
                >
                  Explore topics
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50"
                  onClick={() => {
                    if (!isAuthed) {
                      const returnTo = window.location.hash || "#/";
                      sessionStorage.setItem("return_to", returnTo);
                      navigate("/login");
                      return;
                    }
                    navigate("/search");
                  }}
                >
                  Search
                </button>
              </div>
            </div>

            {/* Tile 2: Compare your views (intent-driven) */}
            <div className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="font-semibold text-slate-900">How your views compare</div>
              <div className="mt-1 text-xs text-slate-600">
                See how your saved stances align with others across your region and globally.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50"
                  onClick={() => {
                    if (!isAuthed) {
                      const returnTo = window.location.hash || "#/";
                      sessionStorage.setItem("return_to", returnTo);
                      navigate("/login");
                      return;
                    }
                    navigate("/for-you", { state: { focus: "compare" } });
                  }}
                >
                  See comparison
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50"
                  onClick={() => {
                    if (!isAuthed) {
                      const returnTo = window.location.hash || "#/";
                      sessionStorage.setItem("return_to", returnTo);
                      navigate("/login");
                      return;
                    }
                    navigate("/for-you");
                  }}
                >
                  View your feed
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Reopened Questions for You (intent tiles; show for anon too) */}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Reopened Questions for You</h3>
              <p className="mt-0.5 text-xs text-slate-600">
                {isAuthed
                  ? "These questions have new updates since you last saw them."
                  : "Sign in to review reopened questions and new updates."}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Tile 1: Reopened questions (intent-driven) */}
            <div className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="font-semibold text-slate-900">Reopened questions</div>
                <span className="shrink-0 rounded bg-slate-900/10 px-2 py-0.5 text-[10px] text-slate-900">
                  REOPENED
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Review questions you already answered that have re-opened due to new context.
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50"
                  onClick={() => {
                    if (!isAuthed) {
                      const returnTo = window.location.hash || "#/";
                      sessionStorage.setItem("return_to", returnTo);
                      navigate("/login");
                      return;
                    }
                    navigate("/for-you", { state: { focus: "reopened" } });
                  }}
                >
                  Review reopened
                </button>
              </div>
            </div>

            {/* Tile 2: New update since you answered (intent-driven) */}
            <div className="rounded-lg border bg-white p-3 shadow-sm">
              <div className="font-semibold text-slate-900">New update since you answered</div>
              <div className="mt-1 text-xs text-slate-600">
                See what changed since your last stance and decide if you still agree.
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50"
                  onClick={() => {
                    if (!isAuthed) {
                      const returnTo = window.location.hash || "#/";
                      sessionStorage.setItem("return_to", returnTo);
                      navigate("/login");
                      return;
                    }
                    navigate("/for-you", { state: { focus: "updates" } });
                  }}
                >
                  View updates
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Local topics collapsed */}
        <div className="text-center">
          <details className="inline-block w-full max-w-3xl rounded-lg border bg-white p-4 shadow-sm">
            <summary className="cursor-pointer select-none list-none">
              <div className="flex items-center justify-center gap-2 text-sm text-slate-700">
                <span>Show Local Topics</span>
                <span aria-hidden="true">▾</span>
              </div>
            </summary>

            <div className="mt-4">
              {/* Keep it simple: reuse the existing three-tier feed RPC result if anonymous,
                  or call get_three_tier_curated_feed_v2 for authed too if you want later.
                  For now, we render the anon query results when available. */}
              <div className="space-y-3 text-left">
                {(threeTierFeedQuery.data ?? [])
                  .filter((x) => (x.tier ?? "").toLowerCase() === "local")
                  .slice(0, 8)
                  .map((r) => (
                    <div
                      key={r.question_id}
                      className="rounded-lg border bg-white p-3 shadow-sm"
                    >
                      <Link
                        to={`/q/${r.question_id}`}
                        className="block font-semibold text-slate-900 line-clamp-2 hover:underline"
                      >
                        {r.question}
                      </Link>
                      {r.summary ? (
                        <div className="mt-1 text-xs text-slate-600 line-clamp-2">
                          {r.summary}
                        </div>
                      ) : null}
                      <div className="mt-2">
                        <button
                          type="button"
                          className="rounded border px-3 py-1.5 text-xs hover:bg-slate-50"
                          onClick={() => goToQuestion(r.question_id)}
                        >
                          Answer
                        </button>
                      </div>
                    </div>
                  ))}

                {!(threeTierFeedQuery.data ?? []).length ? (
                  <div className="text-sm text-slate-600">
                    Local feed not available yet.
                  </div>
                ) : null}
              </div>
            </div>
          </details>
        </div>

        {/* Explore all topics */}
        <div className="text-center pt-2">
          <Link
            to="/topics"
            className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition"
          >
            <span>Explore all topics</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </PageLayout>
  );
}
