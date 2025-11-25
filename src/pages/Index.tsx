// src/pages/Index.tsx — with Latest Questions section added (Epic C C1)
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
  updated_at?: string | null;   // may be alias of published_at
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

// ---------- Source aliasing (Option 2 from earlier) ----------
const SOURCE_ALIAS: Record<string, string> = {
  // Keep label "topic_region_trends" in code, but actually query the view
  topic_region_trends: "topic_region_trends_v",
};
const resolveSource = (name: string) => SOURCE_ALIAS[name] ?? name;

// ---------- Per-source selects & order-by (use real columns for order) ----------
const SELECT_BY_SOURCE: Record<string, string> = {
  topic_region_trends:
    "id,title,summary,tags,updated_at,tier,location_label,trending_score,activity_7d",
  topic_region_trends_v:
    "id,title,summary,tags,updated_at,tier,location_label,trending_score,activity_7d",
  topics_with_counts:
    "id,title,summary,tags,updated_at,tier,location_label,activity_7d",
  vw_topics: "id,title,summary,tags,updated_at,tier,location_label",
  // raw table fallback; alias published_at -> updated_at
  topics: "id,title,summary,tags,updated_at:published_at,tier,location_label",
};

const ORDER_BY_SOURCE: Record<string, string[]> = {
  topic_region_trends: ["trending_score", "activity_7d", "updated_at"],
  topic_region_trends_v: ["trending_score", "activity_7d", "updated_at"],
  topics_with_counts: ["activity_7d", "updated_at"],
  vw_topics: ["updated_at"],
  topics: ["published_at"], // real column on topics
};

// ---------- Data helpers ----------
async function trySelectTopics(
  sb: any,
  options: {
    sourceCandidates: string[];
    defaultSelect: string;
    defaultOrderCandidates?: string[];
    limit?: number;
    search?: string | null;
  }
) {
  const {
    sourceCandidates,
    defaultSelect,
    defaultOrderCandidates = [],
    limit = 12,
    search,
  } = options;

  for (const sourceLabel of sourceCandidates) {
    const table = resolveSource(sourceLabel);
    const select =
      SELECT_BY_SOURCE[sourceLabel] ??
      SELECT_BY_SOURCE[table] ??
      defaultSelect;
    const orderCandidates =
      ORDER_BY_SOURCE[sourceLabel] ??
      ORDER_BY_SOURCE[table] ??
      defaultOrderCandidates;

    try {
      let q = sb.from(table).select(select).limit(limit);

      // If ilike exists on this query builder, use it; otherwise we’ll filter client-side
      if (search && search.trim()) {
        q = (q as any).ilike?.("title", `%${search.trim()}%`) ?? q;
      }

      // Attempt orders in sequence
      let ok: Topic[] | null = null;
      for (let i = 0; i <= orderCandidates.length; i++) {
        const orderBy = orderCandidates[i];
        const run = orderBy
          ? (q as any).order(orderBy as any, { ascending: false })
          : q;
        const { data, error } = await run;
        if (!error) {
          let rows = (data ?? []) as Topic[];
          if (search && search.trim() && !(q as any).ilike) {
            const needle = search.trim().toLowerCase();
            rows = rows.filter((r) =>
              (r.title ?? "").toLowerCase().includes(needle)
            );
          }
          if (rows.length > 0) return rows.slice(0, limit);
          ok = rows;
          break;
        }
      }
      if (Array.isArray(ok) && ok.length > 0) return ok.slice(0, limit);
    } catch {
      // try next source candidate
    }
  }

  return [] as Topic[];
}

const TRENDING_SOURCES = [
  "topics_trending",
  "vw_topics_trending",
  "topic_region_trends", // alias → topic_region_trends_v
  "topics_with_counts",
  "topics",
];

async function fetchTrendingTopics(
  sb: any,
  _opts: { personalized: boolean; userId?: string | null }
) {
  const rows = await trySelectTopics(sb, {
    sourceCandidates: TRENDING_SOURCES,
    defaultSelect:
      "id,title,summary,tags,updated_at,tier,location_label,trending_score,activity_7d",
    defaultOrderCandidates: ["trending_score", "activity_7d", "updated_at"],
    limit: 12,
  });
  if (rows.length > 0) return rows;

  // Mock fallback (small, lightweight)
  return [
    { id: "t1", title: "Elections", summary: "Key races and policy stances." },
    { id: "t2", title: "EVs", summary: "Charging rollout and incentives." },
    { id: "t3", title: "Housing", summary: "Supply, zoning, and prices." },
    { id: "t4", title: "AI Safety", summary: "Guardrails and governance." },
    { id: "t5", title: "Taxes", summary: "Reforms and fiscal impact." },
  ] as Topic[];
}

async function fetchTopicsGrid(
  sb: any,
  opts: { search: string; page: number; pageSize: number }
) {
  const { search, page, pageSize } = opts;
  const from = page * pageSize;

  const rows = await trySelectTopics(sb, {
    sourceCandidates: ["topics_with_counts", "vw_topics", "topics"],
    defaultSelect:
      "id,title,summary,tags,updated_at,tier,location_label,activity_7d",
    defaultOrderCandidates: ["activity_7d", "updated_at"],
    limit: pageSize,
    search,
  });

  if (rows.length > 0) {
    return {
      items: rows.slice(0, pageSize),
      total:
        rows.length >= pageSize ? from + rows.length + 1 : from + rows.length,
      hasMore: rows.length === pageSize,
    };
  }

  // Mock fallback
  const mocks: Topic[] = [
    {
      id: "m1",
      title: "Carbon Tax",
      summary: "Pricing emissions to reduce CO₂.",
    },
    {
      id: "m2",
      title: "Rent Control",
      summary: "Capping rents to protect tenants.",
    },
    {
      id: "m3",
      title: "Crypto Regulation",
      summary: "Rules for digital assets.",
    },
    {
      id: "m4",
      title: "School Vouchers",
      summary: "Funding portability for families.",
    },
  ];
  return { items: mocks, total: mocks.length, hasMore: false };
}

// ---------- Page ----------
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
        return fetchTrendingTopics(null, { personalized: false });
      try {
        return await fetchTrendingTopics(sb, {
          personalized: isAuthed,
          userId: session?.user?.id ?? null,
        });
      } catch {
        return fetchTrendingTopics(null, { personalized: false });
      }
    },
    staleTime: 60_000,
  });

  const topicsQuery = useQuery({
    queryKey: ["topics-grid", search, page, pageSize],
    queryFn: async () => {
      if (!sb)
        return fetchTopicsGrid(null, { search, page, pageSize });
      try {
        return await fetchTopicsGrid(sb, { search, page, pageSize });
      } catch {
        return fetchTopicsGrid(null, { search, page, pageSize });
      }
    },
    keepPreviousData: true,
  });

  // ---------- Live questions feed (Epic C C1) ----------
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
          const { data, error } = await sb.rpc("get_tailored_feed", {
            p_user_id: session.user.id,
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
      {/* Hero */}
      {isAuthed ? (
        <HeroWelcome name={displayName(session)} />
      ) : (
        <HeroCta
          onLogin={() => navigate("/login")}
          onSignup={() => navigate("/signup")}
        />
      )}

      {/* Latest Questions (from questions table via Epic B pipeline) */}
      <section className="py-4">
        <LatestQuestions
          loading={liveQuestionsQuery.isLoading}
          error={liveQuestionsQuery.error}
          items={liveQuestionsQuery.data ?? []}
          isAuthed={isAuthed}
        />
      </section>

      {/* Trending topics */}
      <section className="py-4">
        <Trending
          personalized={isAuthed}
          loading={trendingQuery.isLoading}
          items={trendingQuery.data ?? []}
        />
      </section>

      {/* Topics grid */}
      <section className="py-6">
        <TopicGrid
          interactive={isAuthed}
          onRequireLogin={requireLogin}
          search={search}
          setSearch={(v) => {
            setPage(0);
            setSearch(v);
          }}
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          loading={topicsQuery.isLoading}
          result={topicsQuery.data}
        />
      </section>

      {/* Region thinks */}
      <section className="py-6">
        <RegionThinks showUserBadge={isAuthed} />
      </section>

      {/* Logged-out extras */}
      {!isAuthed && (
        <>
          <section className="border-t">
            <HowItWorks />
          </section>
          <section className="border-t bg-slate-50/60">
            <WhyDifferent />
          </section>
          <section className="border-t">
            <FooterCta onSignup={() => navigate("/signup")} />
          </section>
        </>
      )}
    </PageLayout>
  );
}

// ---------- Small UI blocks ----------
function displayName(session: Session | null) {
  if (!session) return "";
  const name =
    (session.user.user_metadata?.full_name as string | undefined) ||
    (session.user.user_metadata?.name as string | undefined) ||
    session.user.email ||
    "there";
  return name;
}

function HeroCta({
  onLogin,
  onSignup,
}: {
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <section className="bg-slate-50 rounded-lg border">
      <div className="px-4 py-10 grid md:grid-cols-2 gap-8">
        <div>
          <h1 className="text-3xl font-bold">See how your region thinks</h1>
          <p className="mt-2 text-slate-600">
            Take a stance, compare with your city, county, state, country, and
            globally.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              className="rounded bg-slate-900 text-white px-4 py-2"
              onClick={onSignup}
            >
              Sign up
            </button>
            <button
              className="rounded border px-4 py-2"
              onClick={onLogin}
            >
              Log in
            </button>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-6">[hero card]</div>
      </div>
    </section>
  );
}

function HeroWelcome({ name }: { name: string }) {
  return (
    <section className="bg-white rounded-lg border">
      <div className="px-4 py-8">
        <h2 className="text-2xl font-semibold">Welcome back, {name} 👋</h2>
        <p className="text-slate-600 mt-1">
          Pick up where you left off or explore new topics below.
        </p>
      </div>
    </section>
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
          {isAuthed ? "Latest questions for your region" : "Latest questions"}
        </div>
        {loading && (
          <div className="text-xs text-slate-500">Loading…</div>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 mb-2">
          Could not load questions: {error.message}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="text-xs text-slate-500">
          No questions are live yet. Once questions are published from the
          admin area, they will appear here.
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
                <div>
                  <div className="text-sm font-semibold">
                    <Link
                      to={`/q/${q.id}`}
                      className="hover:underline"
                    >
                      {q.question}
                    </Link>
                  </div>
                  {q.summary && (
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                      {q.summary}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {q.location_label && (
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                      {q.location_label}
                    </span>
                  )}
                  {q.published_at && (
                    <span className="text-[10px] text-slate-500">
                      {new Date(q.published_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  )}
                </div>
              </div>
              {q.tags && q.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {q.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-slate-50 border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700"
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
          {personalized ? "Trending for you" : "Trending topics"}
        </div>
        {loading && (
          <div className="text-xs text-slate-500">Loading…</div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((t) => (
          <span
            key={t.id}
            className="text-xs rounded-full border px-2 py-1"
            title={t.summary ?? ""}
          >
            {t.title}
          </span>
        ))}
        {!loading && items.length === 0 && (
          <span className="text-xs text-slate-500">
            No topics yet.
          </span>
        )}
      </div>
    </div>
  );
}

function TopicGrid(props: {
  interactive: boolean;
  onRequireLogin: () => void;
  search: string;
  setSearch: (v: string) => void;
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  loading: boolean;
  result?: { items: Topic[]; total: number; hasMore: boolean };
}) {
  const {
    interactive,
    onRequireLogin,
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    loading,
    result,
  } = props;
  const items = result?.items ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Topics</h3>
        <input
          placeholder="Search topics…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        />
      </div>

      {loading && items.length === 0 ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((t) => (
              <div key={t.id} className="rounded-lg border p-4">
                <div className="font-medium">{t.title}</div>
                {t.location_label && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {t.location_label}
                  </div>
                )}
                <p className="text-sm text-slate-600 mt-1 line-clamp-3">
                  {t.summary ?? ""}
                </p>
                <div className="mt-3">
                  {interactive ? (
                    <button className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm">
                      Take stance
                    </button>
                  ) : (
                    <button
                      className="rounded border px-3 py-1.5 text-sm"
                      onClick={onRequireLogin}
                      title="Log in to take your stance"
                    >
                      Take stance (log in)
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="text-xs text-slate-500">
              Page {page + 1} · {items.length} /{" "}
              {result?.total ?? items.length}
            </div>
            <div className="flex gap-2">
              <button
                className="rounded border px-3 py-1.5 text-sm"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
              >
                Prev
              </button>
              <button
                className="rounded border px-3 py-1.5 text-sm"
                onClick={() => setPage(page + 1)}
                disabled={!result?.hasMore}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RegionThinks({ showUserBadge }: { showUserBadge: boolean }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium mb-2">See how your region thinks</div>
      {["City", "County", "State", "Country", "Global"].map((lvl) => (
        <div key={lvl} className="flex items-center gap-2 mb-2">
          <span className="w-24 text-sm text-slate-600">{lvl}</span>
          <div className="flex-1 h-2 bg-slate-200 rounded">
            <div
              className="h-2 rounded"
              style={{
                width: `${50 + (Math.random() * 40 - 20)}%`,
              }}
            />
          </div>
          {showUserBadge && (
            <span className="text-xs rounded-full border px-2 py-0.5 ml-2">
              Your stance: +1
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="py-6">
      <h3 className="text-lg font-semibold mb-4">How it works</h3>
      <div className="grid sm:grid-cols-3 gap-4">
        {["Pick topics", "Take stance", "Compare & discuss"].map((s, i) => (
          <div key={s} className="rounded-lg border p-4">
            <div className="text-sm font-medium">
              {i + 1}. {s}
            </div>
            <p className="text-sm text-slate-600 mt-1">
              Quick explainer about {s.toLowerCase()}…
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhyDifferent() {
  return (
    <div className="py-6">
      <h3 className="text-lg font-semibold mb-4">Why we’re different</h3>
      <ul className="grid sm:grid-cols-2 gap-4 text-sm text-slate-700">
        <li className="rounded-lg border p-4">
          Neutral, region-aware insights
        </li>
        <li className="rounded-lg border p-4">
          Privacy-first, pseudonymous identity
        </li>
        <li className="rounded-lg border p-4">
          Simple stance scale (-2..+2)
        </li>
        <li className="rounded-lg border p-4">
          Admin-reviewed questions & sources
        </li>
      </ul>
    </div>
  );
}

function FooterCta({ onSignup }: { onSignup: () => void }) {
  return (
    <div className="py-6">
      <div className="rounded-lg border p-6 flex items-center justify-between">
        <div>
          <div className="font-semibold">Ready to add your voice?</div>
          <div className="text-sm text-slate-600">
            Create your profile and start taking stances.
          </div>
        </div>
        <button
          className="rounded bg-slate-900 text-white px-4 py-2"
          onClick={onSignup}
        >
          Create your profile
        </button>
      </div>
    </div>
  );
}
