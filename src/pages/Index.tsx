// src/pages/Index.tsx — with region-aware trending via list_trending_topics_for_me
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";

// ---------- Types ----------
type Session = import("@supabase/supabase-js").Session;

type Topic = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  updated_at?: string | null; // may be alias of published_at
  tier?: "city" | "county" | "state" | "country" | "global" | null;
  location_label?: string | null;
  trending_score?: number | null;
  activity_7d?: number | null;
};

type LiveQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
};

type RegionalStat = {
  region_scope: "city" | "county" | "state" | "country" | "global" | string;
  region_label: string;
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
};

type QuestionStatsCard = {
  my_stance: number | null;
  location: {
    city: string | null;
    county: string | null;
    state: string | null;
    country: string | null;
  } | null;
  regions: {
    global?: RegionalStat | null;
    city?: RegionalStat | null;
    county?: RegionalStat | null;
    state?: RegionalStat | null;
    country?: RegionalStat | null;
    [key: string]: RegionalStat | null | undefined;
  } | null;
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
  // Legacy alias: table -> view
  topic_region_trends: "topic_region_trends_v",
  // Extra safety: if some code asks for topics_trending, route to vw_topics_trending
  topics_trending: "vw_topics_trending",
};

// ---------- Generic utilities ----------
async function fetchFromSource<T>(
  sb: ReturnType<typeof getSupabase> | null,
  options: {
    sourceCandidates: string[];
    defaultSource: string;
    defaultSelect: string;
    defaultOrderCandidates?: string[];
    limit?: number;
    search?: string | null;
  }
) {
  const {
    sourceCandidates,
    defaultSource,
    defaultSelect,
    defaultOrderCandidates = [],
    limit = 12,
    search,
  } = options;

  const orderCandidates = defaultOrderCandidates;

  async function trySource(sourceLabel: string) {
    const source = SOURCE_ALIAS[sourceLabel] ?? sourceLabel;
    const table = sb?.from(source);
    if (!table) return null;

    let q = table.select(defaultSelect).limit(limit);

    if (search && search.trim()) {
      q = (q as any).ilike?.("title", `%${search.trim()}%`) ?? q;
    }

    let ok: T[] | null = null;
    for (let i = 0; i <= orderCandidates.length; i++) {
      const orderBy = orderCandidates[i];
      const run = orderBy
        ? (q as any).order(orderBy as any, { ascending: false })
        : q;
      const { data, error } = await run;
      if (!error) {
        let rows = (data ?? []) as T[];
        if (search && search.trim() && !(q as any).ilike) {
          const needle = search.trim().toLowerCase();
          rows = rows.filter((r: any) =>
            (r.title ?? "").toLowerCase().includes(needle)
          );
        }
        if (rows.length > 0) return rows.slice(0, limit);
        ok = rows;
        break;
      }
    }

    return ok;
  }

  for (const src of sourceCandidates) {
    const rows = await trySource(src);
    if (rows) return rows;
  }

  if (sb) {
    const source = SOURCE_ALIAS[defaultSource] ?? defaultSource;
    const table = sb.from(source);
    let q = table.select(defaultSelect).limit(limit);
    if (search && search.trim()) {
      q = (q as any).ilike?.("title", `%${search.trim()}%`) ?? q;
    }

    for (let i = 0; i <= orderCandidates.length; i++) {
      const orderBy = orderCandidates[i];
      const run = orderBy
        ? (q as any).order(orderBy as any, { ascending: false })
        : q;
      const { data, error } = await run;
      if (!error) {
        let rows = (data ?? []) as T[];
        if (search && search.trim() && !(q as any).ilike) {
          const needle = search.trim().toLowerCase();
          rows = rows.filter((r: any) =>
            (r.title ?? "").toLowerCase().includes(needle)
          );
        }
        return rows.slice(0, limit);
      }
    }
  }

  return [];
}

// ---------- Trending topics (now region-aware when personalized) ----------
async function fetchTrendingTopics(
  sb: ReturnType<typeof getSupabase> | null,
  options: { personalized: boolean; userId?: string | null }
): Promise<Topic[]> {
  const { personalized } = options;
  const defaultSelect =
    "id, title, summary, tags, location_label, tier, updated_at, trending_score, activity_7d";
  const limit = 8;

  // If no client (SSR-ish / fallback), just use global trending via view
  if (!sb) {
    return fetchFromSource<Topic>(null, {
      sourceCandidates: [],
      defaultSource: "vw_topics_trending",
      defaultSelect,
      defaultOrderCandidates: ["trending_score", "activity_7d", "updated_at"],
      limit,
      search: null,
    });
  }

  // 1) Try region-aware RPC when personalization is ON
  if (personalized) {
    try {
      const { data, error } = await sb.rpc("list_trending_topics_for_me", {
        p_limit: limit,
      });

      if (error) {
        console.warn(
          "[fetchTrendingTopics] list_trending_topics_for_me error",
          error
        );
      } else if (data && Array.isArray(data)) {
        return data as Topic[];
      }
    } catch (err) {
      console.warn(
        "[fetchTrendingTopics] list_trending_topics_for_me exception",
        err
      );
    }
  }

  // 2) Fallback: global trending via your existing views
  return fetchFromSource<Topic>(sb, {
    // Try the explicit global views first, fall back to the older view if needed
    sourceCandidates: [
      "vw_topics_trending",
      "topics_trending",
      "topic_region_trends_v",
    ],
    defaultSource: "vw_topics_trending",
    defaultSelect,
    defaultOrderCandidates: ["trending_score", "activity_7d", "updated_at"],
    limit,
    search: null,
  });
}

// ---------- Topics grid ----------
async function fetchTopicsGrid(
  sb: ReturnType<typeof getSupabase> | null,
  options: { search: string; page: number; pageSize: number }
) {
  const { search, page, pageSize } = options;
  const baseLimit = pageSize;
  const offset = page * pageSize;

  const defaultSelect =
    "id, title, summary, tags, location_label, tier, updated_at, trending_score, activity_7d";

  // Anonymous / SSR-ish fallback: use the same global trending view via helper
  if (!sb) {
    return fetchFromSource<Topic>(null, {
      sourceCandidates: [],
      defaultSource: "vw_topics_trending",
      defaultSelect,
      defaultOrderCandidates: ["trending_score", "activity_7d", "updated_at"],
      limit: baseLimit,
      search,
    });
  }

  // Authenticated / normal client: paginate directly from vw_topics_trending
  const table = sb.from("vw_topics_trending");
  let q = table
    .select(defaultSelect, { count: "exact" })
    .order("trending_score", { ascending: false })
    .range(offset, offset + baseLimit - 1);

  if (search && search.trim()) {
    q = q.ilike("title", `%${search.trim()}%`);
  }

  const { data, error, count } = await q;
  if (error) {
    console.error("topics grid error", error);
    throw error;
  }

  return {
    items: (data ?? []) as Topic[],
    total: count ?? 0,
  };
}

// ---------- Homepage ----------
export default function Index() {
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;
  const sb = React.useMemo(getSupabase, []);

  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);
  const pageSize = 9;
  const latestLimit = 10;

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

  const liveQuestionsQuery = useQuery<LiveQuestion[], Error>({
    queryKey: [
      "live-questions",
      isAuthed ? session?.user?.id : "anon",
      latestLimit,
    ],
    queryFn: async () => {
      if (!sb) return [];
      try {
        if (isAuthed && session?.user?.id) {
          // NOTE: no p_user_id here; function uses auth.uid() internally
          const { data, error } = await sb.rpc("get_tailored_feed", {
            p_limit: latestLimit,
          });
          if (error) throw error;
          return (data ?? []) as LiveQuestion[];
        } else {
          const { data, error } = await sb
            .from("v_live_questions")
            .select(
              "id, question, summary, tags, location_label, published_at, status"
            )
            .order("published_at", { ascending: false })
            .limit(latestLimit);
          if (error) throw error;
          return (data ?? []) as LiveQuestion[];
        }
      } catch (err) {
        console.error("live questions feed error", err);
        throw err instanceof Error ? err : new Error("Failed to load feed");
      }
    },
    staleTime: 60_000,
  });

  const liveQuestionIds = React.useMemo(
    () => (liveQuestionsQuery.data ?? []).map((q) => q.id),
    [liveQuestionsQuery.data]
  );

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
        .select(
          "user_id, city_label, county_label, state_label, country_label"
        )
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
    !myRegion.county_label &&
    liveQuestionIds.length > 0;

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
              Set your location to compare your stance with people in your
              region.
            </span>
            <Link
              to="/settings/location"
              className="inline-flex items-center rounded bg-slate-900 text-white px-2 py-1 text-[11px]"
            >
              Set location
            </Link>
          </div>
        )}
        <LatestQuestions
          loading={liveQuestionsQuery.isLoading}
          error={liveQuestionsQuery.error}
          items={liveQuestionsQuery.data ?? []}
          isAuthed={isAuthed}
        />
      </section>

      <section className="py-4">
        <Trending
          personalized={isAuthed}
          loading={trendingQuery.isLoading}
          items={trendingQuery.data ?? []}
        />
      </section>

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
    </PageLayout>
  );
}

// Utility to pick a display name
function displayName(session: Session | null): string {
  if (!session) return "there";
  const user = session.user;
  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined);
  if (fullName) return fullName.split(" ")[0];
  const email = user.email ?? "";
  if (!email) return "there";
  return email.split("@")[0];
}

// ---------- Hero components ----------
function HeroCta({
  onLogin,
  onSignup,
}: {
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <section className="bg-white rounded-lg border">
      <div className="px-4 py-4 sm:px-6 sm:py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2 max-w-xl">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
            Capture your stance on the issues that matter.
          </h1>
          <p className="text-xs sm:text-sm text-slate-700">
            See what&apos;s trending in your city, state, country, and around
            the world. Share where you stand, and track how opinions shift over
            time.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
            onClick={onSignup}
          >
            Get started
          </button>
          <div className="text-[11px] text-slate-600 text-center sm:text-left">
            Already have an account?{" "}
            <button
              type="button"
              className="underline"
              onClick={onLogin}
            >
              Log in
            </button>
          </div>
        </div>
      </div>
      <div className="border-t px-4 py-3 sm:px-6 bg-slate-50/80">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-slate-600">
          <div>
            <span className="font-medium text-slate-800">
              Built for nuance.
            </span>{" "}
            Not just &quot;yes/no&quot; — capture how strongly you agree or
            disagree.
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full border px-2 py-0.5">
              City · State · Country · Global
            </span>
            <span className="inline-flex items-center rounded-full border px-2 py-0.5">
              Track your stance over time
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroWelcome({ name }: { name: string }) {
  return (
    <section className="bg-white rounded-lg border">
      <div className="px-4 py-4 sm:px-6 sm:py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2 max-w-xl">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
            Welcome back, {name}.
          </h1>
          <p className="text-xs sm:text-sm text-slate-700">
            New questions are live. Capture your stance and see how it compares
            with your city, state, country, and the world.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            View latest questions
          </button>
          <Link
            to="/me/stances"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900"
          >
            View my stances
          </Link>
        </div>
      </div>
      <div className="border-t px-4 py-3 sm:px-6 bg-slate-50/80">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-slate-600">
          <div>
            Continue where you left off, or explore what&apos;s trending in
            your region.
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
        <div className="mt-2 text-[11px] text-slate-500">
          Tip: You can update your location and profile in Settings.
        </div>
      </div>
    </section>
  );
}

// ---------- Card stance pill ----------
function stanceLabelShort(score: number | null | undefined): string {
  if (score === 2) return "Strongly agree";
  if (score === 1) return "Agree";
  if (score === 0) return "Neutral";
  if (score === -1) return "Disagree";
  if (score === -2) return "Strongly disagree";
  return "No stance";
}

async function fetchQuestionStatsForCard(
  questionId: string
): Promise<QuestionStatsCard | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb.rpc("get_question_stats_for_user", {
    p_question_id: questionId,
  });

  if (error) {
    console.error("Failed to load question stats for card", error);
    return null;
  }

  if (!data) return null;

  const raw = data as any;
  return {
    my_stance: typeof raw.my_stance === "number" ? raw.my_stance : null,
    location: raw.location ?? null,
    regions: raw.regions ?? {},
  } as QuestionStatsCard;
}

function QuestionStancePill({
  questionId,
  isAuthed,
}: {
  questionId: string;
  isAuthed: boolean;
}) {
  const { data, isLoading } = useQuery<QuestionStatsCard | null, Error>({
    enabled: !!questionId,
    queryKey: ["question-stats-card", questionId],
    queryFn: () => fetchQuestionStatsForCard(questionId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-slate-500 bg-slate-50">
        Loading…
      </span>
    );
  }

  if (!data) {
    return null;
  }

  const my = data.my_stance;
  const regions = data.regions ?? {};
  const loc = data.location ?? null;

  let regionRow: RegionalStat | null = null;
  let regionLabel: string | null = null;

  if (loc?.city && regions.city) {
    regionRow = regions.city ?? null;
    regionLabel = loc.city;
  } else if (loc?.county && regions.county) {
    regionRow = regions.county ?? null;
    regionLabel = loc.county;
  } else if (loc?.state && regions.state) {
    regionRow = regions.state ?? null;
    regionLabel = loc.state;
  } else if (loc?.country && regions.country) {
    regionRow = regions.country ?? null;
    regionLabel = loc.country;
  } else if (regions.global) {
    regionRow = regions.global ?? null;
    regionLabel = "Global";
  }

  if (!isAuthed && !regionRow) {
    return null;
  }

  const youPart = isAuthed ? `You: ${stanceLabelShort(my)}` : null;

  let regionPart: string | null = null;
  if (regionRow && regionRow.pct_agree != null && regionLabel) {
    const pct = Math.round(regionRow.pct_agree);
    const shortLabel =
      regionLabel.length > 18
        ? regionLabel.replace(/ county/i, "").trim()
        : regionLabel;
    regionPart = `${shortLabel}: ${pct}% agree`;
  }

  const text = [youPart, regionPart].filter(Boolean).join(" · ");
  if (!text) return null;

  // mini bar like detail page, but condensed
  let disagreePct = 0;
  let neutralPct = 0;
  let agreePct = 0;

  if (regionRow) {
    const agree = Math.max(0, regionRow.pct_agree ?? 0);
    const disagree = Math.max(0, regionRow.pct_disagree ?? 0);
    const neutral = Math.max(0, regionRow.pct_neutral ?? 0);
    const totalPct = agree + disagree + neutral || 1;
    agreePct = (agree / totalPct) * 100;
    disagreePct = (disagree / totalPct) * 100;
    neutralPct = (neutral / totalPct) * 100;
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5 rounded-full border px-2 py-1 text-[11px] bg-slate-50">
      <span className="text-slate-700 whitespace-nowrap">{text}</span>
      {regionRow && (
        <div className="flex items-center gap-1 text-[10px] text-slate-600">
          <div className="flex h-1 w-16 overflow-hidden rounded-full bg-slate-100">
            <div
              className="bg-rose-400"
              style={{ width: `${disagreePct}%` }}
            />
            <div
              className="bg-slate-400"
              style={{ width: `${neutralPct}%` }}
            />
            <div
              className="bg-emerald-500"
              style={{ width: `${agreePct}%` }}
            />
          </div>
          <span>{Math.round(regionRow.pct_agree ?? 0)}% agree</span>
        </div>
      )}
    </div>
  );
}

// ---------- Latest Questions section ----------
function LatestQuestions({
  loading,
  error,
  items,
  isAuthed,
}: {
  loading: boolean;
  error: Error | null;
  items: LiveQuestion[];
  isAuthed: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">
          {isAuthed ? "Latest questions for you" : "Latest questions"}
        </div>
        <Link
          to="/me/stances"
          className="text-xs text-slate-600 hover:underline"
        >
          View your stances
        </Link>
      </div>

      {loading && items.length === 0 && (
        <div className="text-xs text-slate-500">Loading questions…</div>
      )}
      {error && !loading && (
        <div className="text-xs text-red-600">
          Failed to load questions. Please try again.
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="text-xs text-slate-500">
          No live questions yet. Once questions are published from the admin
          area, they will appear here.
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((q) => (
            <div
              key={q.id}
              className="rounded-lg border px-3 py-2 hover:border-slate-900/70 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    <Link to={`/q/${q.id}`} className="hover:underline">
                      {q.question}
                    </Link>
                  </div>
                  {q.summary && (
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                      {q.summary}
                    </p>
                  )}
                  {q.tags && q.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {q.tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {q.location_label && (
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                      {q.location_label}
                    </span>
                  )}
                  {q.published_at && (
                    <span className="text-[10px] text-slate-500">
                      {new Date(q.published_at).toLocaleDateString(
                        undefined,
                        {
                          dateStyle: "medium",
                        }
                      )}
                    </span>
                  )}
                  <QuestionStancePill
                    questionId={q.id}
                    isAuthed={isAuthed}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
        {loading && (
          <div className="text-xs text-slate-500">Loading…</div>
        )}
      </div>

      {!loading && items.length === 0 && (
        <div className="text-xs text-slate-500">
          No trending topics yet. As news comes in, we&apos;ll surface what&apos;s
          most active.
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
                      {topic.tier === "city"
                        ? "City"
                        : topic.tier === "county"
                        ? "County"
                        : topic.tier === "state"
                        ? "State"
                        : topic.tier === "country"
                        ? "Country"
                        : topic.tier === "global"
                        ? "Global"
                        : topic.tier}
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
          No topics found yet. As questions get published, we&apos;ll surface
          more ways to explore by topic.
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
                        {topic.tier === "city"
                          ? "City"
                          : topic.tier === "county"
                          ? "County"
                          : topic.tier === "state"
                          ? "State"
                          : topic.tier === "country"
                          ? "Country"
                          : topic.tier === "global"
                          ? "Global"
                          : topic.tier}
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
                  onClick={() =>
                    setPage(Math.min(pageCount - 1, page + 1))
                  }
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
