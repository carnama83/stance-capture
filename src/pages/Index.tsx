// src/pages/Index.tsx
// NEW HOMEPAGE (Attention-first, Country-first, Global adjacent)
// - Trending Now: Country tab default + Global tab
// - Optional "Global Breaking" banner above Trending (does not replace country section)
// - Today’s Questions: reuses existing PersonalizedFeed / ThreeTierQuestionsFeed (so stance slider + RPCs remain intact)
// - Close to home: collapsed (geo is a boost, not a gate)

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import PageLayout from "@/components/PageLayout";

import { PersonalizedFeed } from "@/components/feed/PersonalizedFeed";
import { ThreeTierQuestionsFeed } from "@/components/question/ThreeTierQuestionsFeed";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search } from "lucide-react";

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
  topic_region_trends: "topic_region_trends_v",
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
  if (!sb) {
    console.warn("No supabase client; returning empty array.");
    return [];
  }

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
      if (!error && data) {
        return data as T[];
      }
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

// ---------- Trending topics (reused as-is) ----------
async function fetchTrendingTopics(
  sb: ReturnType<typeof getSupabase> | null,
  opts: { personalized: boolean; userId: string | null }
): Promise<Topic[]> {
  const baseSelect =
    "id, title, summary, tags, updated_at, tier, location_label, trending_score, activity_7d";

  if (opts.personalized && opts.userId && sb) {
    try {
      const { data, error } = await sb.rpc("get_personalized_trending_topics", {
        p_user_id: opts.userId,
        p_limit: 10, // allow more so tabs have enough items
      });
      if (!error && data) {
        return data as Topic[];
      }
    } catch {
      // Fallback to global
    }
  }

  return fetchFromSource<Topic>(sb, {
    sourceCandidates: ["vw_topics_trending", "topics_trending"],
    defaultSource: "vw_topics_trending",
    select: baseSelect,
    order: [
      { column: "trending_score", ascending: false },
      { column: "updated_at", ascending: false },
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
    // Fallback to email local-part if profile not loaded
    if (!session?.user?.email) return "there";
    const email = session.user.email;
    const atIdx = email.indexOf("@");
    if (atIdx > 0) {
      const local = email.slice(0, atIdx);
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    return email;
  }

  // Use profile's chosen display mode
  if (profile.display_handle_mode === "username" && profile.username) {
    return profile.username;
  }

  return profile.random_id;
}

// ---------- Hero CTA (anonymous users) ----------
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
          See what’s trending, take a stance, and track how your views evolve
          over time.
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

// ---------- Hero welcome (authenticated users) ----------
function HeroWelcome({ name }: { name: string }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-gradient-to-br from-slate-50 to-white shadow-sm">
      <div className="px-4 py-5 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Welcome back, {name}!
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Start with what’s trending, then take a stance on today’s questions.
        </p>
      </div>
    </section>
  );
}

// ---------- Small UI helpers ----------
function formatScore(n?: number | null) {
  if (n == null || Number.isNaN(n)) return null;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return `${Math.round(n)}`;
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
      className="text-left min-w-[260px] max-w-[320px] rounded-lg border bg-white p-3 shadow-sm hover:bg-slate-50 transition"
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
        {topic.tier ? (
          <span className="rounded border px-1.5 py-0.5">
            {topic.tier.toUpperCase()}
          </span>
        ) : (
          <span className="rounded border px-1.5 py-0.5">TRENDING</span>
        )}

        {typeof topic.activity_7d === "number" ? (
          <span className="rounded border px-1.5 py-0.5">
            {formatScore(topic.activity_7d)} activity (7d)
          </span>
        ) : null}

        {topic.location_label ? (
          <span className="truncate">{topic.location_label}</span>
        ) : null}
      </div>
    </button>
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

// ---------- Main component ----------
export default function IndexPage() {
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;
  const sb = React.useMemo(getSupabase, []);

  const userId = session?.user?.id ?? null;

  // Top-right actions
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

  // Profile for display handle
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

  // Region dimensions (for label + location nudge)
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

  const countryLabel = myRegion?.country_label ?? "Your country";

  const showLocationNudge =
    isAuthed &&
    !myRegionLoading &&
    myRegion &&
    !myRegion.city_label &&
    !myRegion.state_label &&
    !myRegion.country_label &&
    !myRegion.county_label;

  // Trending topics data (powers Trending Now + Global Breaking heuristic)
  const trendingQuery = useQuery({
    queryKey: ["trending", isAuthed ? session?.user?.id : "anon"],
    queryFn: async () => {
      if (!sb)
        return fetchTrendingTopics(null, { personalized: false, userId: null });
      try {
        return await fetchTrendingTopics(sb, {
          personalized: isAuthed,
          userId: session?.user?.id ?? null,
        });
      } catch {
        return fetchTrendingTopics(null, { personalized: false, userId: null });
      }
    },
    staleTime: 60_000,
  });

  const trending = trendingQuery.data ?? [];

  // Split for tabs (best-effort; if tiers are missing we degrade gracefully)
  const countryTopics = React.useMemo(() => {
    const byTier = trending.filter((t) => t.tier === "country");
    if (byTier.length >= 3) return byTier;

    const byLabel = trending.filter((t) => {
      const loc = (t.location_label ?? "").toLowerCase();
      const c = (countryLabel ?? "").toLowerCase();
      return c && loc.includes(c);
    });
    if (byLabel.length >= 3) return byLabel;

    // fallback: show all
    return trending;
  }, [trending, countryLabel]);

  const globalTopics = React.useMemo(() => {
    const byTier = trending.filter((t) => t.tier === "global");
    if (byTier.length >= 2) return byTier;

    const byLabel = trending.filter((t) => {
      const loc = (t.location_label ?? "").toLowerCase();
      return loc === "global" || loc.includes("global");
    });
    if (byLabel.length >= 2) return byLabel;

    // fallback: best-effort subset
    return trending;
  }, [trending]);

  // Auto-switch banner heuristic:
  // If max(global_score) > threshold * max(country_score), show Global Breaking
  const globalBreaking = React.useMemo(() => {
    const threshold = 1.4;

    const maxCountry = Math.max(
      0,
      ...countryTopics.map((t) => (typeof t.trending_score === "number" ? t.trending_score : 0))
    );
    const maxGlobal = Math.max(
      0,
      ...globalTopics.map((t) => (typeof t.trending_score === "number" ? t.trending_score : 0))
    );

    if (maxCountry <= 0 || maxGlobal <= 0) return null;
    if (maxGlobal <= threshold * maxCountry) return null;

    // Pick top global topic as banner headline
    const topGlobal = [...globalTopics].sort((a, b) => {
      const sa = typeof a.trending_score === "number" ? a.trending_score : 0;
      const sb = typeof b.trending_score === "number" ? b.trending_score : 0;
      return sb - sa;
    })[0];

    return topGlobal ?? null;
  }, [countryTopics, globalTopics]);

  const openTopic = (topicId: string) => {
    // You currently have /topics and /topics/:id route
    navigate(`/topics/${topicId}`);
  };

  return (
    <PageLayout rightSlot={actions}>
      {/* Hero */}
      {isAuthed ? (
        <HeroWelcome name={getDisplayHandle(profile, session)} />
      ) : (
        <HeroCta onLogin={() => navigate("/login")} onSignup={() => navigate("/signup")} />
      )}

      {/* Main */}
      <section className="py-4">
        {/* Location Setup Nudge (kept) */}
        {showLocationNudge && (
          <div className="mb-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
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

        {/* Global Breaking Banner (optional enhancement) */}
        {globalBreaking ? (
          <GlobalBreakingBanner headline={globalBreaking} onOpen={openTopic} />
        ) : null}

        {/* Trending Now (Country first + Global adjacent) */}
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Trending Now</h3>
              <p className="mt-0.5 text-xs text-slate-600">
                Start here. These topics are getting the most attention right now.
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
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {(countryTopics.length ? countryTopics : trending).slice(0, 8).map((t) => (
                    <TopicCard key={t.id} topic={t} onOpen={openTopic} />
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="global" className="mt-0">
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {(globalTopics.length ? globalTopics : trending).slice(0, 8).map((t) => (
                    <TopicCard key={t.id} topic={t} onOpen={openTopic} />
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Today’s Questions (uses existing feeds; your QuestionStanceSlider remains unchanged inside those flows) */}
        <div className="mt-4 rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Today’s Questions</h3>
              <p className="mt-0.5 text-xs text-slate-600">
                Take a stance quickly. Updates and reopened questions appear automatically.
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

          <div className="mt-3">
            {isAuthed ? (
              <PersonalizedFeed />
            ) : (
              <ThreeTierQuestionsFeed />
            )}
          </div>
        </div>

        {/* Close to home (collapsed; geo is not gating) */}
        <div className="mt-4">
          <details className="rounded-lg border bg-white p-4 shadow-sm">
            <summary className="cursor-pointer select-none list-none">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Close to home (optional)
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    Browse regional questions when you want — not as the default feed.
                  </div>
                </div>
                <span className="text-xs text-slate-500">Expand</span>
              </div>
            </summary>

            <div className="mt-4">
              <ThreeTierQuestionsFeed />
            </div>
          </details>
        </div>

        {/* Explore all topics (kept) */}
        <div className="text-center pt-6">
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
