// src/routes/Index.tsx
// UPDATED: 3-Tier Regional Curated Feed (Epic P)
// Removed: Old TodayQuestionsFeed, LatestQuestions feed
// Added: ThreeTierQuestionsFeed (LOCAL + NATIONAL + GLOBAL)

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";
import { ThreeTierQuestionsFeed } from "@/components/question/ThreeTierQuestionsFeed";

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

// ---------- Trending topics ----------
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
        p_limit: 5,
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
    limit: 5,
  });
}

// ---------- Topics grid ----------
async function fetchTopicsGrid(
  sb: ReturnType<typeof getSupabase> | null,
  opts: { search: string; page: number; pageSize: number }
): Promise<{ items: Topic[]; total: number }> {
  if (!sb) return { items: [], total: 0 };

  const offset = opts.page * opts.pageSize;
  const baseSelect =
    "id, title, summary, tags, updated_at, tier, location_label";

  let query = sb
    .from("topics")
    .select(baseSelect, { count: "exact" })
    .eq("status", "active");

  if (opts.search) {
    query = query.ilike("title", `%${opts.search}%`);
  }

  query = query.order("updated_at", { ascending: false }).range(offset, offset + opts.pageSize - 1);

  const { data, error, count } = await query;
  if (error) {
    console.error("Error fetching topics grid:", error);
    return { items: [], total: 0 };
  }

  return {
    items: (data ?? []) as Topic[],
    total: count ?? 0,
  };
}

// ---------- Display name helper ----------
function displayName(session: Session | null): string {
  if (!session?.user?.email) return "there";
  const email = session.user.email;
  const atIdx = email.indexOf("@");
  if (atIdx > 0) {
    const local = email.slice(0, atIdx);
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return email;
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
          Compare your views with your city, state, and the world. See how your
          opinions evolve over time.
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
          Take a stance on today's questions. Compare your views with your city,
          state, country, and the world.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center px-4 pb-5 sm:px-6">
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          View latest questions
        </button>
        <Link
          to="/me/stances"
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          View my stances
        </Link>
      </div>
      <div className="border-t px-4 py-3 sm:px-6 bg-slate-50/80">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-600">
          <div>
            Continue where you left off, or explore what's trending in your region.
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full border px-2 py-0.5">
              Track how your stance evolves
            </span>
            <span className="inline-flex items-center rounded-full border px-2 py-0.5">
              Compare with your community
            </span>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Tip: You can update your location and profile in Settings.
        </div>
      </div>
    </section>
  );
}

// ---------- Trending topics ----------
function Trending({
  personalized,
  loading,
  items,
}: {
  personalized: boolean;
  loading: boolean;
  items: Topic[];
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">
          {personalized ? "Trending for you" : "Trending now"}
        </div>
        {loading && <div className="text-xs text-slate-500">Loading…</div>}
      </div>

      {!loading && items.length === 0 && (
        <div className="text-xs text-slate-500">
          No trending topics yet. As news comes in, we'll surface what's most
          active.
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((topic) => (
            <div
              key={topic.id}
              className="rounded-lg border px-3 py-2 hover:border-slate-900/70 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    <Link
                      to={`/topics/${encodeURIComponent(topic.id)}`}
                      className="hover:underline"
                    >
                      {topic.title}
                    </Link>
                  </div>
                  {topic.summary && (
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                      {topic.summary}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {topic.location_label && (
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                      {topic.location_label}
                    </span>
                  )}
                  {topic.tier && (
                    <span className="text-[10px] text-slate-500">
                      {topic.tier === "city" ? "City" :
                       topic.tier === "county" ? "County" :
                       topic.tier === "state" ? "State" :
                       topic.tier === "country" ? "Country" :
                       topic.tier === "global" ? "Global" : topic.tier}
                    </span>
                  )}
                </div>
              </div>
              {topic.tags && topic.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {topic.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Explore topics grid ----------
function ExploreTopicsGrid({
  search,
  setSearch,
  page,
  setPage,
  pageSize,
  loading,
  items,
  total,
  requireLogin,
  isAuthed,
}: {
  search: string;
  setSearch: (value: string) => void;
  page: number;
  setPage: (value: number) => void;
  pageSize: number;
  loading: boolean;
  items: Topic[];
  total: number;
  requireLogin: () => void;
  isAuthed: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="text-sm font-medium">Explore topics</div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search topics…"
            className="w-full sm:w-56 rounded border px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      {!loading && items.length === 0 && (
        <div className="text-xs text-slate-500">
          No topics found yet. As questions get published, we'll surface more
          ways to explore by topic.
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            {items.map((topic) => (
              <div
                key={topic.id}
                className="rounded-lg border px-3 py-2 hover:border-slate-900/70 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold">
                      <Link
                        to={`/topics/${encodeURIComponent(topic.id)}`}
                        className="hover:underline"
                      >
                        {topic.title}
                      </Link>
                    </div>
                    {topic.summary && (
                      <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">
                        {topic.summary}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {topic.location_label && (
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wide text-slate-600">
                        {topic.location_label}
                      </span>
                    )}
                    {topic.tier && (
                      <span className="text-[9px] text-slate-500">
                        {topic.tier === "city" ? "City" :
                         topic.tier === "county" ? "County" :
                         topic.tier === "state" ? "State" :
                         topic.tier === "country" ? "Country" :
                         topic.tier === "global" ? "Global" : topic.tier}
                      </span>
                    )}
                  </div>
                </div>
                {topic.tags && topic.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {topic.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wide text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between text-[11px] text-slate-600">
              <div>
                Page {page + 1} of {pageCount}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="px-2 py-1 rounded border text-[11px] disabled:opacity-50"
                  disabled={page === 0}
                  onClick={() => setPage(Math.max(0, page - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded border text-[11px] disabled:opacity-50"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {!isAuthed && (
        <div className="mt-3 text-[11px] text-slate-500">
          Want a personalized feed by your stances and region?{" "}
          <button className="underline" onClick={requireLogin}>
            Log in to unlock more.
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Main component ----------
export default function IndexPage() {
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;
  const sb = React.useMemo(getSupabase, []);

  // COMMENTED OUT: Topics grid state (not needed without ExploreTopicsGrid)
  // const [search, setSearch] = React.useState("");
  // const [page, setPage] = React.useState(0);
  // const pageSize = 9;

  const requireLogin = React.useCallback(() => {
    const returnTo = window.location.hash || "#/";
    sessionStorage.setItem("return_to", returnTo);
    navigate("/login");
  }, [navigate]);

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

  /* COMMENTED OUT: Topics grid query (causing 400 errors)
  const topicsQuery = useQuery({
    queryKey: ["topics-grid", search, page, pageSize],
    queryFn: async () => {
      if (!sb) return fetchTopicsGrid(null, { search, page, pageSize });
      try {
        return await fetchTopicsGrid(sb, { search, page, pageSize });
      } catch {
        return fetchTopicsGrid(null, { search, page, pageSize });
      }
    },
    keepPreviousData: true,
  });
  */

  const userId = session?.user?.id ?? null;

  const {
    data: myRegion,
    isLoading: myRegionLoading,
  } = useQuery({
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

  const showLocationNudge =
    isAuthed &&
    !myRegionLoading &&
    myRegion &&
    !myRegion.city_label &&
    !myRegion.state_label &&
    !myRegion.country_label &&
    !myRegion.county_label;

  const actions = (
    <button
      className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
      onClick={() => navigate("/topics")}
      aria-label="Explore topics"
    >
      Explore topics
    </button>
  );

  return (
    <PageLayout rightSlot={actions}>
      {isAuthed ? (
        <HeroWelcome name={displayName(session)} />
      ) : (
        <HeroCta
          onLogin={() => navigate("/login")}
          onSignup={() => navigate("/signup")}
        />
      )}

      <section className="py-4">
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

        {/* ✨ NEW: 3-Tier Regional Curated Feed (Epic P) */}
        <ThreeTierQuestionsFeed />

        {/* Optional: Link to browse more topics */}
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

      <section className="py-4">
        <Trending
          personalized={isAuthed}
          loading={trendingQuery.isLoading}
          items={trendingQuery.data ?? []}
        />
      </section>

      {/* COMMENTED OUT: Explore topics section (causing 400 errors)
      <section className="py-4">
        <ExploreTopicsGrid
          search={search}
          setSearch={setSearch}
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          loading={topicsQuery.isLoading}
          items={topicsQuery.data?.items ?? []}
          total={topicsQuery.data?.total ?? 0}
          requireLogin={requireLogin}
          isAuthed={isAuthed}
        />
      </section>
      */}
    </PageLayout>
  );
}
