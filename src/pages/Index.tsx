// Homepage V3 (minimal, wired with Supabase + safe fallbacks)
// - Hero CTA
// - Trending (top 3 topics)
// - Filters + Search + Grid
// - RegionThinks + HowItWorks
// Tailwind only. Supabase optional (auto-fallback to mocks).

import * as React from "react";
import { supabase } from "@/integrations/supabase/client";

type LocationTier = "city" | "county" | "state" | "country" | "global";
type Topic = {
  id: string;
  title: string;
  summary: string;
  created_at: string;
  tier: LocationTier;
  tags?: string[];
  location_label?: string;
};

// Check if Supabase is configured
const hasSupabase = !!(supabase && process.env.NODE_ENV);

// ---------- Mocks (used when Supabase isn't configured) ----------
const MOCK_TOPICS: Topic[] = [
  { id: "t1", title: "Playground safety upgrade budget", summary: "Proposal to resurface and add inclusive equipment in parks.", created_at: new Date().toISOString(), tier: "city", tags: ["Civic","Budget"], location_label: "Mahwah, NJ" },
  { id: "t2", title: "EV chargers grants for multi-family", summary: "State program to fund charging in apartment complexes.", created_at: new Date().toISOString(), tier: "state", tags: ["Energy"], location_label: "New Jersey" },
  { id: "t3", title: "National broadband expansion", summary: "Federal plan to improve last-mile connectivity.", created_at: new Date().toISOString(), tier: "country", tags: ["Infrastructure"], location_label: "United States" },
  { id: "t4", title: "Single-use plastics pilot ban", summary: "County pilot to reduce litter and boost recycling downtown.", created_at: new Date().toISOString(), tier: "county", tags: ["Environment"], location_label: "Bergen County, NJ" },
  { id: "t5", title: "AI transparency for public services", summary: "Require agencies to publish model transparency reports.", created_at: new Date().toISOString(), tier: "global", tags: ["Technology"], location_label: "Global" },
];

const USER_LOC = { city: "Mahwah, NJ", county: "Bergen County, NJ", state: "New Jersey", country: "United States" };

function cx(...s: Array<string | false | null | undefined>) { return s.filter(Boolean).join(" "); }
function clamp(n: number) { return Math.max(0, Math.min(100, n)); }

// ---------- Data Adapters ----------

// ==========================================
// Homepage V3 — Data Adapters (Canonical tables)
// Replace the current fetchTopics/fetchTrend functions with these.
// Uses: topics, topic_region_trends, stances
// ==========================================

type Trend = { agree: number; neutral: number; disagree: number; total: number };

/** Fetch topics from canonical `topics` */
async function fetchTopics(): Promise<Topic[]> {
  if (!sb) return MOCK_TOPICS;

  const { data, error } = await sb
    .from("topics")
    .select("id,title,summary,created_at,tier,location_label,tags")
    .order("created_at", { ascending: false })
    .limit(48);

  if (error || !data) return MOCK_TOPICS;

  return (data as any[]).map((t) => ({
    id: String(t.id),
    title: t.title,
    summary: t.summary ?? "",
    created_at: t.created_at ?? new Date().toISOString(),
    tier: (t.tier ?? "city") as LocationTier,
    tags:
      Array.isArray(t.tags)
        ? t.tags
        : typeof t.tags === "string"
          ? t.tags.split(",").map((s: string) => s.trim()).filter(Boolean)
          : [],
    location_label: t.location_label ?? undefined,
  }));
}

/** Preferred source: canonical `topic_region_trends`
 *  Combines across locations for simple overall bar
 */
async function fetchTrendFromRegionTrends(topicId: string): Promise<Trend | null> {
  const { data, error } = await sb!
    .from("topic_region_trends")
    .select("agree,neutral,disagree,total")
    .eq("topic_id", topicId);

  if (error || !data || data.length === 0) return null;

  const agg = data.reduce(
    (acc, r) => {
      acc.agree += Number(r.agree) || 0;
      acc.neutral += Number(r.neutral) || 0;
      acc.disagree += Number(r.disagree) || 0;
      acc.total += Number(r.total) || 0;
      return acc;
    },
    { agree: 0, neutral: 0, disagree: 0, total: 0 }
  );

  if (agg.total <= 0) return { agree: 0, neutral: 0, disagree: 0, total: 0 };

  return {
    agree: Math.round((agg.agree * 100) / agg.total),
    neutral: Math.round((agg.neutral * 100) / agg.total),
    disagree: Math.round((agg.disagree * 100) / agg.total),
    total: agg.total,
  };
}

/** Fallback: compute 7-day trend client-side from canonical `stances` */
async function fetchTrendFromStances(topicId: string): Promise<Trend | null> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb!
    .from("stances")
    .select("stance, created_at")
    .eq("topic_id", topicId)
    .gte("created_at", sevenDaysAgo)
    .limit(5000); // guardrail

  if (error || !data || data.length === 0) return null;

  let agreeCt = 0, neutralCt = 0, disagreeCt = 0;
  for (const row of data as any[]) {
    const s = Number(row.stance);
    if (s > 0) agreeCt++;
    else if (s === 0) neutralCt++;
    else disagreeCt++;
  }
  const total = agreeCt + neutralCt + disagreeCt;
  if (total <= 0) return { agree: 0, neutral: 0, disagree: 0, total: 0 };

  return {
    agree: Math.round((agreeCt * 100) / total),
    neutral: Math.round((neutralCt * 100) / total),
    disagree: Math.round((disagreeCt * 100) / total),
    total,
  };
}

/** Unified trend fetcher — tries `topic_region_trends` first, then `stances` */
async function fetchTrend(topicId: string): Promise<Trend | null> {
  if (!sb) return { agree: 55, neutral: 25, disagree: 20, total: 500 }; // mock
  const r1 = await fetchTrendFromRegionTrends(topicId);
  if (r1) return r1;
  const r2 = await fetchTrendFromStances(topicId);
  if (r2) return r2;
  return null;
}




// async function fetchTopics(): Promise<Topic[]> {
  // Always use mock data for now since tables don't exist yet
//  return MOCK_TOPICS;
//}

//// Optional: trends by region (for inline bars in cards). If missing, show nothing.
//async function fetchTrend(topicId: string): Promise<{agree:number;neutral:number;disagree:number;total:number} | null> {
//  // Return mock trend data for now
//  return { agree: 55, neutral: 25, disagree: 20, total: 500 };
//}

// ---------- UI Pieces ----------
function TrendMini({ agree, neutral }: { agree:number; neutral:number }) {
  const a = clamp(agree);
  const an = clamp(agree + neutral);
  return (
    <div className="relative h-2 w-full overflow-hidden rounded bg-rose-500/60" aria-hidden>
      <div className="absolute left-0 top-0 h-2 bg-zinc-400/70" style={{ width: `${an}%` }} />
      <div className="absolute left-0 top-0 h-2 bg-emerald-500" style={{ width: `${a}%` }} />
    </div>
  );
}

function TopicCard({ topic }: { topic: Topic }) {
  const [t, setT] = React.useState<{agree:number;neutral:number;disagree:number;total:number} | null>(null);
  React.useEffect(() => { (async () => setT(await fetchTrend(topic.id)))(); }, [topic.id]);
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold leading-tight">{topic.title}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span>📍 {topic.location_label}</span><span>•</span><span className="capitalize">{topic.tier}</span>
          </div>
        </div>
        <button className="rounded p-2 hover:bg-slate-50" aria-label="Open details">↗</button>
      </div>
      <p className="mt-2 text-sm text-slate-600">{topic.summary}</p>
      {topic.tags && topic.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {topic.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{tag}</span>
          ))}
        </div>
      )}
      {t && (
        <div className="mt-3 space-y-1">
          <div className="text-xs text-slate-500">Trending (7d)</div>
          <TrendMini agree={t.agree} neutral={t.neutral} />
          <div className="text-right text-[11px] text-slate-500 tabular-nums">{t.agree}% · {t.total.toLocaleString()} votes</div>
        </div>
      )}
    </div>
  );
}

function HeroCTA() {
  return (
    <section className="mb-6 rounded-2xl border bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">See how your community thinks — and make your voice count</h1>
          <p className="mt-1 text-slate-600">AI-generated, location-aware topics with transparent local trends.</p>
        </div>
        <div className="flex gap-2">
          <a href="/signup" className="rounded-full bg-slate-900 px-4 py-2 text-white">Sign up</a>
          <a href="/login" className="rounded-full border border-slate-300 px-4 py-2">Log in</a>
        </div>
      </div>
    </section>
  );
}

function RegionThinks() {
  const rows = [
    { label: USER_LOC.city, agree: 62, neutral: 22 },
    { label: USER_LOC.county, agree: 58, neutral: 24 },
    { label: USER_LOC.state, agree: 51, neutral: 30 },
    { label: USER_LOC.country, agree: 45, neutral: 27 },
  ];
  return (
    <section className="mb-6" aria-labelledby="region">
      <h2 id="region" className="mb-2 text-lg font-semibold">See how your region thinks</h2>
      <div className="space-y-2 rounded-xl border bg-white p-4 shadow-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 text-slate-600">{r.label}</span>
            <div className="relative mx-1 h-2 flex-1 overflow-hidden rounded bg-rose-500/60">
              <div className="absolute left-0 top-0 h-2 bg-zinc-400/70" style={{ width: `${clamp(r.agree + r.neutral)}%` }} />
              <div className="absolute left-0 top-0 h-2 bg-emerald-500" style={{ width: `${clamp(r.agree)}%` }} />
            </div>
            <span className="w-24 text-right tabular-nums text-slate-500">{r.agree}% agree</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const items = [
    { t: "1) We generate topics", d: "AI analyzes local news and proposals to draft concise, unbiased topics." },
    { t: "2) You weigh in", d: "Take a stance in seconds, with optional context in a comment." },
    { t: "3) Transparent trends", d: "See rolling 7-day trends for your city, county, state, and beyond." },
  ];
  return (
    <section className="mb-6" aria-labelledby="hiw">
      <h2 id="hiw" className="mb-2 text-lg font-semibold">How it works</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {items.map((s) => (
          <div key={s.t} className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="text-base font-medium">{s.t}</div>
            <p className="mt-1 text-sm text-slate-600">{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Page ----------
const Index = () => {
  const [tab, setTab] = React.useState<"foryou" | LocationTier>("foryou");
  const [q, setQ] = React.useState("");
  const [topics, setTopics] = React.useState<Topic[]>(MOCK_TOPICS);

  React.useEffect(() => { (async () => { setTopics(await fetchTopics()); })(); }, []);

  const filtered = React.useMemo(() => {
    const items = tab === "foryou" ? topics : topics.filter((t) => t.tier === tab);
    if (!q.trim()) return items;
    const needle = q.toLowerCase();
    return items.filter((t) => t.title.toLowerCase().includes(needle) || t.summary.toLowerCase().includes(needle));
  }, [tab, q, topics]);

  const trending = React.useMemo(() => {
    return [...topics]
      .sort((a, b) => (b.tags?.length || 0) - (a.tags?.length || 0) || (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 3);
  }, [topics]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {/* Header */}
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold">🏠 Homepage <span className="text-slate-400 text-sm">V3</span></div>
        <div className="text-sm text-slate-500">Supabase {hasSupabase ? "ON" : "OFF (mock data)"}</div>
      </header>

      <HeroCTA />

      {/* Trending */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Trending Topics</h2>
          <a href="#topics" className="text-sm text-slate-600 hover:underline">See all</a>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {trending.map((t) => (<TopicCard key={`trend-${t.id}`} topic={t} />))}
        </div>
      </section>

      {/* Filters */}
      <div id="topics" className="mb-4 rounded-2xl border bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-600">📍 <b>{USER_LOC.city}</b> • {USER_LOC.county} • {USER_LOC.state} • {USER_LOC.country}</div>
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics…" className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm" />
            <div className="flex flex-wrap gap-2 text-sm">
              {(["foryou","city","county","state","country","global"] as const).map((k) => (
                <button key={k} onClick={() => setTab(k)}
                  className={cx("rounded-full px-3 py-1 border",
                    tab===k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300 hover:bg-slate-50")}>
                  {k === "foryou" ? "For You" : k[0].toUpperCase()+k.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">No topics here yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (<TopicCard key={t.id} topic={t} />))}
        </div>
      )}

      <RegionThinks />
      <HowItWorks />
    </div>
  );
};

export default Index;
