// src/pages/Index.tsx
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";

// --------------------- Types ---------------------
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

// --------------------- Session hook ---------------------
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

// --------------------- Source aliasing (Option 2) ---------------------
const SOURCE_ALIAS: Record<string, string> = {
  // Keep UI label "topic_region_trends" but actually query the view
  topic_region_trends: "topic_region_trends_v",
};

function resolveSource(name: string) {
  return SOURCE_ALIAS[name] ?? name;
}

// --------------------- Data adapters ---------------------
async function trySelectTopics(
  sb: any,
  options: {
    sourceCandidates: string[];
    select: string;
    limit?: number;
    orderCandidates?: string[];
    search?: string | null;
  }
) {
  const { sourceCandidates, select, orderCandidates = [], limit = 12, search } = options;

  for (const source of sourceCandidates) {
    try {
      const table = resolveSource(source);
      let q = sb.from(table).select(select).limit(limit);

      if (search && search.trim()) {
        q = q.ilike?.("title", `%${search.trim()}%`) ?? q;
      }

      let dataResp: any = null;
      for (let i = 0; i <= orderCandidates.length; i++) {
        const orderBy = orderCandidates[i];
        const queryToRun = orderBy ? q.order(orderBy as any, { ascending: false }) : q;
        const { data, error } = await queryToRun;
        if (!error) {
          let rows: Topic[] = (data ?? []) as Topic[];
          if (search && search.trim() && (!q.ilike)) {
            const needle = search.trim().toLowerCase();
            rows = rows.filter((r) => (r.title ?? "").toLowerCase().includes(needle));
          }
          if (rows.length > 0) return rows.slice(0, limit);
          dataResp = rows;
          break;
        }
      }

      if (Array.isArray(dataResp) && dataResp.length > 0) return dataResp.slice(0, limit);
    } catch {
      // continue
    }
  }

  return [] as Topic[];
}

const TRENDING_SOURCES = [
  "topics_trending",
  "vw_topics_trending",
  "topic_region_trends", // keep label; alias maps this to the view
  "topics_with_counts",
  "topics",
];

async function fetchTrendingTopics(sb: any, opts: { personalized: boolean; userId?: string | null }) {
  const rows = await trySelectTopics(sb, {
    sourceCandidates: TRENDING_SOURCES,
    select:
      "id, title, summary, tags, updated_at, tier, location_label, trending_score, activity_7d",
    limit: 12,
    orderCandidates: ["trending_score", "activity_7d", "updated_at"],
  });

  if (rows.length > 0) return rows;

  // Mock fallback
  return [
    { id: "t1", title: "Elections", summary: "Key races and policy stances." },
    { id: "t2", title: "EVs", summary: "Charging rollout and incentives." },
    { id: "t3", title: "Housing", summary: "Supply, zoning, and prices." },
    { id: "t4", title: "AI Safety", summary: "Guardrails and governance." },
    { id: "t5", title: "Taxes", summary: "Reforms and fiscal impact." },
  ] as Topic[];
}

async function fetchTopicsGrid(sb: any, opts: { search: string; page: number; pageSize: number }) {
  const { search, page, pageSize } = opts;
  const from = page * pageSize;

  const rows = await trySelectTopics(sb, {
    sourceCandidates: ["topics_with_counts", "vw_topics", "topics"],
    select: "id, title, summary, tags, updated_at, tier, location_label, activity_7d",
    limit: pageSize,
    orderCandidates: ["activity_7d", "updated_at"],
    search,
  });

  if (rows.length > 0) {
    return {
      items: rows.slice(0, pageSize),
      total: rows.length >= pageSize ? from + rows.length + 1 : from + rows.length,
      hasMore: rows.length === pageSize,
    };
  }

  // Mock fallback
  const mocks: Topic[] = [
    { id: "m1", title: "Carbon Tax", summary: "Pricing emissions to reduce CO₂." },
    { id: "m2", title: "Rent Control", summary: "Capping rents to protect tenants." },
    { id: "m3", title: "Crypto Regulation", summary: "Rules for digital assets." },
    { id: "m4", title: "School Vouchers", summary: "Funding portability for families." },
  ];
  return {
    items: mocks.filter((t) => (search ? t.title.toLowerCase().includes(search.toLowerCase()) : true)),
    total: mocks.length,
    hasMore: false,
  };
}

// --------------------- Page ---------------------
export default function Index() {
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;
  const sb = React.useMemo(getSupabase, []);

  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);
  const pageSize = 9;

  const requireLogin = React.useCallback(() => {
    const returnTo = window.location.hash || "#/";
    sessionStorage.setItem("return_to", returnTo);
    navigate("/login");
  }, [navigate]);

  const trendingQuery = useQuery({
    queryKey: ["trending", isAuthed ? session?.user?.id : "anon"],
    queryFn: async () => {
      if (!sb) return fetchTrendingTopics(null, { personalized: false });
      try {
        return await fetchTrendingTopics(sb, { personalized: isAuthed, userId: session?.user?.id ?? null });
      } catch {
        return fetchTrendingTopics(null, { personalized: false });
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

  // Example: page-specific action on the right side of the ribbon
  const actions = (
    <button className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => navigate("/topics")}>
      Explore topics
    </button>
  );

  return (
    <PageLayout rightSlot={actions}>
      {/* Hero */}
      {isAuthed ? (
        <HeroWelcome name={displayName(session)} />
      ) : (
        <HeroCta onLogin={() => navigate("/login")} onSignup={() => navigate("/signup")} />
      )}

      {/* Trending */}
      <section className="py-4">
        <Trending personalized={isAuthed} loading={trendingQuery.isLoading} items={trendingQuery.data ?? []} />
      </section>

      {/* Topics grid */}
      <section className="py-6">
        <TopicGrid
          interactive={isAuthed}
          onRequireLogin={requireLogin}
          search={search}
          setSearch={(v) => { setPage(0); setSearch(v); }}
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

      {/* Logged-out only */}
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

// --------------------- Helpers & UI blocks ---------------------
function displayName(session: Session | null) {
  if (!session) return "";
  const name =
    (session.user.user_metadata?.full_name as string | undefined) ||
    (session.user.user_metadata?.name as string | undefined) ||
    session.user.email ||
    "there";
  return name;
}

function HeroCta({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <section className="bg-slate-50 rounded-lg border">
      <div className="px-4 py-10 grid md:grid-cols-2 gap-8">
        <div>
          <h1 className="text-3xl font-bold">See how your region thinks</h1>
          <p className="mt-2 text-slate-600">Take a stance, compare with your city, county, state, country, and globally.</p>
          <div className="mt-6 flex gap-3">
            <button className="rounded bg-slate-900 text-white px-4 py-2" onClick={onSignup}>Sign up</button>
            <button className="rounded border px-4 py-2" onClick={onLogin}>Log in</button>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-6">[mock hero card]</div>
      </div>
    </section>
  );
}

function HeroWelcome({ name }: { name: string }) {
  return (
    <section className="bg-white rounded-lg border">
      <div className="px-4 py-8">
        <h2 className="text-2xl font-semibold">Welcome back, {name} 👋</h2>
        <p className="text-slate-600 mt-1">Pick up where you left off or explore new topics below.</p>
        <div className="mt-4 flex gap-3">
          <button className="rounded bg-slate-900 text-white px-4 py-2">Continue</button>
          <button className="rounded border px-4 py-2">My topics</button>
        </div>
      </div>
    </section>
  );
}

function Trending({ personalized, loading, items }: { personalized: boolean; loading: boolean; items: Topic[] }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">
          {personalized ? "Trending for you" : "Trending topics"}
        </div>
        {loading && <div className="text-xs text-slate-500">Loading…</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((t) => (
          <span key={t.id} className="text-xs rounded-full border px-2 py-1" title={t.summary ?? ""}>
            {t.title}
          </span>
        ))}
        {!loading && items.length === 0 && (
          <span className="text-xs text-slate-500">No topics yet.</span>
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
    interactive, onRequireLogin, search, setSearch,
    page, setPage, pageSize, loading, result
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
                  <div className="text-[11px] text-slate-500 mt-0.5">{t.location_label}</div>
                )}
                <p className="text-sm text-slate-600 mt-1 line-clamp-3">{t.summary ?? ""}</p>
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
              Page {page + 1} · {items.length} / {result?.total ?? items.length}
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
      <div className="space-y-2">
        {["City", "County", "State", "Country", "Global"].map((lvl) => (
          <div key={lvl} className="flex items-center gap-2">
            <span className="w-24 text-sm text-slate-600">{lvl}</span>
            <div className="flex-1 h-2 bg-slate-200 rounded">
              <div className="h-2 rounded" style={{ width: `${50 + (Math.random() * 40 - 20)}%` }} />
            </div>
            {showUserBadge && <span className="text-xs rounded-full border px-2 py-0.5 ml-2">Your stance: +1</span>}
          </div>
        ))}
      </div>
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
            <div className="text-sm font-medium">{i + 1}. {s}</div>
            <p className="text-sm text-slate-600 mt-1">Quick explainer about {s.toLowerCase()}…</p>
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
        <li className="rounded-lg border p-4">Neutral, region-aware insights</li>
        <li className="rounded-lg border p-4">Privacy-first, pseudonymous identity</li>
        <li className="rounded-lg border p-4">Simple stance scale (-2..+2)</li>
        <li className="rounded-lg border p-4">Admin-reviewed questions & sources</li>
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
          <div className="text-sm text-slate-600">Create your profile and start taking stances.</div>
        </div>
        <button className="rounded bg-slate-900 text-white px-4 py-2" onClick={onSignup}>
          Create your profile
        </button>
      </div>
    </div>
  );
}
