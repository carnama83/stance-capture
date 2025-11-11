<<<<<<< Updated upstream
// src/pages/Index.tsx
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";
=======
// // Homepage V3 (canonical schema, safe fallbacks)
// // - Hero CTA
// // - Trending (top 3 topics)
// // - Filters + Search + Grid
// // - RegionThinks + HowItWorks
// // Supabase optional; falls back to mocks.

// import * as React from "react";
// import { supabase } from "@/integrations/supabase/client";

// // ---------- Types ----------
// type LocationTier = "city" | "county" | "state" | "country" | "global";

// type Topic = {
  // id: string;
  // title: string;
  // summary: string;
  // created_at: string;
  // tier: LocationTier;
  // tags?: string[];
  // location_label?: string;
// };

// type Trend = { agree: number; neutral: number; disagree: number; total: number };

// type Comment = {
  // id: string;
  // parent_id: string | null;
  // topic_id: string;
  // user_display?: string;
  // body: string;
  // created_at: string;
// };

// // ---------- Supabase client ----------
// const sb = supabase as any;          // use the provided client directly
// const hasSupabase = !!sb;            // truthy only if client instance is available

// // ---------- Mocks ----------
// const MOCK_TOPICS: Topic[] = [
  // { id: "t1", title: "Playground safety upgrade budget", summary: "Proposal to resurface and add inclusive equipment in parks.", created_at: new Date().toISOString(), tier: "city", tags: ["Civic","Budget"], location_label: "Mahwah, NJ" },
  // { id: "t2", title: "EV chargers grants for multi-family", summary: "State program to fund charging in apartment complexes.", created_at: new Date().toISOString(), tier: "state", tags: ["Energy"], location_label: "New Jersey" },
  // { id: "t3", title: "National broadband expansion", summary: "Federal plan to improve last-mile connectivity.", created_at: new Date().toISOString(), tier: "country", tags: ["Infrastructure"], location_label: "United States" },
  // { id: "t4", title: "Single-use plastics pilot ban", summary: "County pilot to reduce litter and boost recycling downtown.", created_at: new Date().toISOString(), tier: "county", tags: ["Environment"], location_label: "Bergen County, NJ" },
  // { id: "t5", title: "AI transparency for public services", summary: "Require agencies to publish model transparency reports.", created_at: new Date().toISOString(), tier: "global", tags: ["Technology"], location_label: "Global" },
// ];

// const USER_LOC = { city: "Mahwah, NJ", county: "Bergen County, NJ", state: "New Jersey", country: "United States" };

// const MOCK_COMMENTS: Record<string, Comment[]> = {
  // t1: [
    // { id: "c1", parent_id: null, topic_id: "t1", user_display: "MapleDad", body: "Love the inclusive equipment idea.", created_at: new Date().toISOString() },
    // { id: "c2", parent_id: "c1", topic_id: "t1", user_display: "SkaterMom", body: "Yes, and softer surfacing please.", created_at: new Date().toISOString() },
  // ],
// };

// // ---------- Utils ----------
// function cx(...s: Array<string | false | null | undefined>) { return s.filter(Boolean).join(" "); }
// function clamp(n: number) { return Math.max(0, Math.min(100, n)); }

// // ---------- Data Adapters (canonical: topics, topic_region_trends, stances) ----------
// async function fetchComments(topicId: string): Promise<Comment[]> {
  // if (!hasSupabase) return MOCK_COMMENTS[topicId] ?? [];
  // const { data, error } = await sb
    // .from("comments")
    // .select("id,parent_id,topic_id,user_display,body,created_at")
    // .eq("topic_id", topicId)
    // .order("created_at", { ascending: true })
    // .limit(200);
  // if (error || !data) return MOCK_COMMENTS[topicId] ?? [];
  // return (data as any[]).map((c) => ({
    // id: String(c.id),
    // parent_id: c.parent_id ? String(c.parent_id) : null,
    // topic_id: String(c.topic_id ?? topicId),
    // user_display: c.user_display ?? "User",
    // body: c.body ?? "",
    // created_at: c.created_at ?? new Date().toISOString(),
  // }));
// }

// async function fetchTopics(): Promise<Topic[]> {
  // if (!hasSupabase) return MOCK_TOPICS;
  // const { data, error } = await sb
    // .from("topics")
    // .select("id,title,summary,created_at,tier,location_label,tags")
    // .order("created_at", { ascending: false })
    // .limit(48);
  // if (error || !data) return MOCK_TOPICS;
  // return (data as any[]).map((t) => ({
    // id: String(t.id),
    // title: t.title,
    // summary: t.summary ?? "",
    // created_at: t.created_at ?? new Date().toISOString(),
    // tier: (t.tier ?? "city") as LocationTier,
    // tags: Array.isArray(t.tags)
      // ? t.tags
      // : typeof t.tags === "string"
        // ? t.tags.split(",").map((s: string) => s.trim()).filter(Boolean)
        // : [],
    // location_label: t.location_label ?? undefined,
  // }));
// }

// /** Preferred: aggregate over canonical topic_region_trends (sum across locations) */
// async function fetchTrendFromRegionTrends(topicId: string): Promise<Trend | null> {
  // const { data, error } = await sb!
    // .from("topic_region_trends")
    // .select("agree,neutral,disagree,total")
    // .eq("topic_id", topicId);
  // if (error || !data || data.length === 0) return null;

  // const agg = data.reduce(
    // (acc, r) => {
      // acc.agree += Number(r.agree) || 0;
      // acc.neutral += Number(r.neutral) || 0;
      // acc.disagree += Number(r.disagree) || 0;
      // acc.total += Number(r.total) || 0;
      // return acc;
    // },
    // { agree: 0, neutral: 0, disagree: 0, total: 0 }
  // );

  // if (agg.total <= 0) return { agree: 0, neutral: 0, disagree: 0, total: 0 };
  // return {
    // agree: Math.round((agg.agree * 100) / agg.total),
    // neutral: Math.round((agg.neutral * 100) / agg.total),
    // disagree: Math.round((agg.disagree * 100) / agg.total),
    // total: agg.total,
  // };
// }

// /** Fallback: compute 7-day trend from canonical stances */
// async function fetchTrendFromStances(topicId: string): Promise<Trend | null> {
  // const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // const { data, error } = await sb!
    // .from("stances")
    // .select("stance,created_at")
    // .eq("topic_id", topicId)
    // .gte("created_at", sevenDaysAgo)
    // .limit(5000);
  // if (error || !data || data.length === 0) return null;

  // let agreeCt = 0, neutralCt = 0, disagreeCt = 0;
  // for (const row of data as any[]) {
    // const s = Number(row.stance);
    // if (s > 0) agreeCt++;
    // else if (s === 0) neutralCt++;
    // else disagreeCt++;
  // }
  // const total = agreeCt + neutralCt + disagreeCt;
  // if (total <= 0) return { agree: 0, neutral: 0, disagree: 0, total: 0 };
  // return {
    // agree: Math.round((agreeCt * 100) / total),
    // neutral: Math.round((neutralCt * 100) / total),
    // disagree: Math.round((disagreeCt * 100) / total),
    // total,
  // };
// }

// /** Unified trend fetcher */
// async function fetchTrend(topicId: string): Promise<Trend | null> {
  // if (!hasSupabase) return { agree: 55, neutral: 25, disagree: 20, total: 500 }; // mock
  // const r1 = await fetchTrendFromRegionTrends(topicId);
  // if (r1) return r1;
  // const r2 = await fetchTrendFromStances(topicId);
  // if (r2) return r2;
  // return null;
// }

// // ---------- UI ----------
// function TrendMini({ agree, neutral }: { agree: number; neutral: number }) {
  // const a = clamp(agree);
  // const an = clamp(agree + neutral);
  // return (
    // <div className="relative h-2 w-full overflow-hidden rounded bg-rose-500/60" aria-hidden>
      // <div className="absolute left-0 top-0 h-2 bg-zinc-400/70" style={{ width: `${an}%` }} />
      // <div className="absolute left-0 top-0 h-2 bg-emerald-500" style={{ width: `${a}%` }} />
    // </div>
  // );
// }

// function NestedComments({ comments, topicId }: { comments: Comment[]; topicId: string }) {
  // const byParent = React.useMemo(() => {
    // const map = new Map<string | null, Comment[]>();
    // for (const c of comments) {
      // const k = c.parent_id as any;
      // if (!map.has(k)) map.set(k, []);
      // map.get(k)!.push(c);
    // }
    // return map;
  // }, [comments]);
  // const roots = byParent.get(null) ?? [];

  // return (
    // <div className="mt-3 rounded-xl border bg-slate-50 p-3">
      // <div className="mb-2 text-xs font-medium text-slate-600">Discussion</div>
      // {roots.length === 0 ? (
        // <div className="text-xs text-slate-500">
          // Be the first to comment. <a href={`/topic/${topicId}`} className="underline">Open thread</a>
        // </div>
      // ) : (
        // <div className="space-y-3">
          // {roots.slice(0, 2).map((c) => (
            // <div key={c.id} className="text-xs">
              // <div className="mb-1 text-slate-700">
                // <span className="font-medium">{c.user_display ?? "User"}</span>{" "}
                // <span className="text-slate-400">·</span>{" "}
                // {new Date(c.created_at).toLocaleDateString()}
              // </div>
              // <div className="rounded bg-white p-2 text-slate-700 shadow-sm">{c.body}</div>
              // {(byParent.get(c.id) ?? []).slice(0, 2).map((r) => (
                // <div key={r.id} className="mt-2 ml-4 border-l pl-3 text-slate-700">
                  // <span className="font-medium">{r.user_display ?? "User"}</span>{" "}
                  // <span className="text-slate-400">·</span>{" "}
                  // {new Date(r.created_at).toLocaleDateString()} — {r.body}
                // </div>
              // ))}
            // </div>
          // ))}
          // <div className="text-right text-xs">
            // <a href={`/topic/${topicId}`} className="underline">View full thread →</a>
          // </div>
        // </div>
      // )}
    // </div>
  // );
// }

// function TopicCard({ topic }: { topic: Topic }) {
  // const [t, setT] = React.useState<Trend | null>(null);
  // const [comments, setComments] = React.useState<Comment[]>([]);
  // React.useEffect(() => {
    // (async () => {
      // setT(await fetchTrend(topic.id));
      // setComments(await fetchComments(topic.id));
    // })();
  // }, [topic.id]);

  // const tt = t ?? { agree: 0, neutral: 0, disagree: 0, total: 0 };

  // return (
    // <div className="rounded-2xl border bg-white p-4 shadow-sm">
      // <div className="flex items-start justify-between gap-3">
        // <div>
          // <h3 className="text-base font-semibold leading-tight">{topic.title}</h3>
          // <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            // <span>📍 {topic.location_label}</span><span>•</span><span className="capitalize">{topic.tier}</span>
          // </div>
        // </div>
        // <button
          // className="rounded p-2 hover:bg-slate-50"
          // aria-label="Open details"
          // onClick={() => (window.location.href = `/topic/${topic.id}`)}
        // >
          // ↗
        // </button>
      // </div>

      // <p className="mt-2 text-sm text-slate-600">{topic.summary}</p>

      // {topic.tags?.length ? (
        // <div className="mt-2 flex flex-wrap gap-2">
          // {topic.tags.map((tag) => (
            // <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              // {tag}
            // </span>
          // ))}
        // </div>
      // ) : null}

      // <div className="mt-3 space-y-1">
        // <div className="text-xs text-slate-500">{t ? "Trending (7d)" : "No trend data yet"}</div>
        // <TrendMini agree={tt.agree} neutral={tt.neutral} />
        // <div className="text-right text-[11px] text-slate-500 tabular-nums">
          // {tt.agree}% · {tt.total.toLocaleString()} votes
        // </div>
      // </div>

      // <NestedComments comments={comments} topicId={topic.id} />
    // </div>
  // );
// }

// function HeroCTA() {
  // return (
    // <section className="mb-6 rounded-2xl border bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
      // <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        // <div>
          // <h1 className="text-2xl font-semibold">See how your community thinks — and make your voice count</h1>
          // <p className="mt-1 text-slate-600">AI-generated, location-aware topics with transparent local trends.</p>
        // </div>
        // <div className="flex gap-2">
          // <a href="/signup" className="rounded-full bg-slate-900 px-4 py-2 text-white">Sign up</a>
          // <a href="/login" className="rounded-full border border-slate-300 px-4 py-2">Log in</a>
        // </div>
      // </div>
    // </section>
  // );
// }

// function RegionThinks() {
  // const rows = [
    // { label: USER_LOC.city, agree: 62, neutral: 22 },
    // { label: USER_LOC.county, agree: 58, neutral: 24 },
    // { label: USER_LOC.state, agree: 51, neutral: 30 },
    // { label: USER_LOC.country, agree: 45, neutral: 27 },
  // ];
  // return (
    // <section className="mb-6" aria-labelledby="region">
      // <h2 id="region" className="mb-2 text-lg font-semibold">See how your region thinks</h2>
      // <div className="space-y-2 rounded-xl border bg-white p-4 shadow-sm">
        // {rows.map((r) => (
          // <div key={r.label} className="flex items-center gap-2 text-xs">
            // <span className="w-40 shrink-0 text-slate-600">{r.label}</span>
            // <div className="relative mx-1 h-2 flex-1 overflow-hidden rounded bg-rose-500/60">
              // <div className="absolute left-0 top-0 h-2 bg-zinc-400/70" style={{ width: `${clamp(r.agree + r.neutral)}%` }} />
              // <div className="absolute left-0 top-0 h-2 bg-emerald-500" style={{ width: `${clamp(r.agree)}%` }} />
            // </div>
            // <span className="w-24 text-right tabular-nums text-slate-500">{r.agree}% agree</span>
          // </div>
        // ))}
      // </div>
    // </section>
  // );
// }

// function HowItWorks() {
  // const items = [
    // { t: "1) We generate topics", d: "AI analyzes local news and proposals to draft concise, unbiased topics." },
    // { t: "2) You weigh in", d: "Take a stance in seconds, with optional context in a comment." },
    // { t: "3) Transparent trends", d: "See rolling 7-day trends for your city, county, state, and beyond." },
  // ];
  // return (
    // <section className="mb-6" aria-labelledby="hiw">
      // <h2 id="hiw" className="mb-2 text-lg font-semibold">How it works</h2>
      // <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        // {items.map((s) => (
          // <div key={s.t} className="rounded-xl border bg-white p-4 shadow-sm">
            // <div className="text-base font-medium">{s.t}</div>
            // <p className="mt-1 text-sm text-slate-600">{s.d}</p>
          // </div>
        // ))}
      // </div>
    // </section>
  // );
// }

// // ---------- Page ----------
// const Index = () => {
  // const [tab, setTab] = React.useState<"foryou" | LocationTier>("foryou");
  // const [q, setQ] = React.useState("");
  // const [topics, setTopics] = React.useState<Topic[]>(MOCK_TOPICS);

  // React.useEffect(() => { (async () => { setTopics(await fetchTopics()); })(); }, []);

  // const filtered = React.useMemo(() => {
    // const items = tab === "foryou" ? topics : topics.filter((t) => t.tier === tab);
    // if (!q.trim()) return items;
    // const needle = q.toLowerCase();
    // return items.filter((t) => t.title.toLowerCase().includes(needle) || t.summary.toLowerCase().includes(needle));
  // }, [tab, q, topics]);

  // const trending = React.useMemo(() => {
    // return [...topics]
      // .sort((a, b) => (b.tags?.length || 0) - (a.tags?.length || 0) || (a.created_at < b.created_at ? 1 : -1))
      // .slice(0, 3);
  // }, [topics]);

  // return (
    // <div className="mx-auto w-full max-w-6xl px-4 py-6">
      // {/* Header */}
      // <header className="mb-4 flex items-center justify-between">
        // <div className="flex items-center gap-2 text-lg font-semibold">🏠 Homepage <span className="text-slate-400 text-sm">V3</span></div>
        // <div className="text-sm text-slate-500">Supabase {hasSupabase ? "ON" : "OFF (mock data)"}</div>
      // </header>

      // <HeroCTA />

      // {/* Trending */}
      // <section className="mb-6">
        // <div className="mb-2 flex items-center justify-between">
          // <h2 className="text-lg font-semibold">Trending Topics</h2>
          // <a href="#topics" className="text-sm text-slate-600 hover:underline">See all</a>
        // </div>
        // <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          // {trending.map((t) => (<TopicCard key={`trend-${t.id}`} topic={t} />))}
        // </div>
      // </section>

      // {/* Filters */}
      // <div id="topics" className="mb-4 rounded-2xl border bg-white p-3 shadow-sm">
        // <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          // <div className="text-sm text-slate-600">📍 <b>{USER_LOC.city}</b> • {USER_LOC.county} • {USER_LOC.state} • {USER_LOC.country}</div>
          // <div className="flex items-center gap-2">
            // <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics…" className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm" />
            // <div className="flex flex-wrap gap-2 text-sm">
              // {(["foryou","city","county","state","country","global"] as const).map((k) => (
                // <button
                  // key={k}
                  // onClick={() => setTab(k)}
                  // className={cx("rounded-full px-3 py-1 border", tab===k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300 hover:bg-slate-50")}
                // >
                  // {k === "foryou" ? "For You" : k[0].toUpperCase()+k.slice(1)}
                // </button>
              // ))}
            // </div>
          // </div>
        // </div>
      // </div>

      // {/* Grid */}
      // {filtered.length === 0 ? (
        // <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">No topics here yet.</div>
      // ) : (
        // <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          // {filtered.map((t) => (<TopicCard key={t.id} topic={t} />))}
        // </div>
      // )}

      // <RegionThinks />
      // <HowItWorks />
    // </div>
  // );
// };

// export default Index;


//New Code - Previous Code is commented by Nikesh on 9/16
// src/pages/Index.tsx
// Homepage V3 (cleaned for Vite/CRA + React Router)
// - Uses Supabase if env vars exist, else falls back to mocks
// - Replaces all <a href> with <Link> and window.location with useNavigate
// - Exports the Homepage page component
										  

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";

// ---------- Supabase (safe, sandbox-friendly loader) ----------
let sb: any = null;
try {
  // dynamic require so this file works without bundler aliases
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("@supabase/supabase-js");
  // Prefer Vite env vars; fallback to NEXT_PUBLIC_* if provided in window/global
  const url =
    (import.meta as any)?.env?.VITE_SUPABASE_URL ||
    (typeof process !== "undefined" ? (process as any).env?.NEXT_PUBLIC_SUPABASE_URL : undefined) ||
    (globalThis as any)?.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    (import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY ||
    (typeof process !== "undefined" ? (process as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined) ||
    (globalThis as any)?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) sb = createClient(url, key);
} catch {
  // leave sb = null → mock mode
}
const hasSupabase = !!sb;

// ---------- Types ----------
type LocationTier = "city" | "county" | "state" | "country" | "global";
>>>>>>> Stashed changes

// --------------------- Types ---------------------
type Session = import("@supabase/supabase-js").Session;
type Topic = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  updated_at?: string | null;  // can be an alias of published_at
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

// --------------------- Per-source select & order maps ---------------------
// Use the *UI label* as the key (before aliasing) so your config stays readable.
const SELECT_BY_SOURCE: Record<string, string> = {
  // trending view (computed fields exist)
  topic_region_trends: "id,title,summary,tags,updated_at,tier,location_label,trending_score,activity_7d",
  topic_region_trends_v: "id,title,summary,tags,updated_at,tier,location_label,trending_score,activity_7d",

  // if you have these views, they can expose updated_at/activity_7d natively
  topics_with_counts: "id,title,summary,tags,updated_at,tier,location_label,activity_7d",
  vw_topics: "id,title,summary,tags,updated_at,tier,location_label",

  // raw table fallback: alias published_at -> updated_at, omit activity_7d
  topics: "id,title,summary,tags,updated_at:published_at,tier,location_label",
};

<<<<<<< Updated upstream
// For `order`, we must use *real* column names available on that source.
// (Don’t rely on aliases for ordering.)
const ORDER_BY_SOURCE: Record<string, string[]> = {
  topic_region_trends: ["trending_score", "activity_7d", "updated_at"],
  topic_region_trends_v: ["trending_score", "activity_7d", "updated_at"],
  topics_with_counts: ["activity_7d", "updated_at"],
  vw_topics: ["updated_at"],
  topics: ["published_at"], // real column on topics
};

// --------------------- Data adapters ---------------------
async function trySelectTopics(
  sb: any,
  options: {
    sourceCandidates: string[];
    defaultSelect: string;            // used if a source has no explicit select mapping
    defaultOrderCandidates?: string[]; // used if a source has no explicit order mapping
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
    const select = SELECT_BY_SOURCE[sourceLabel] ?? SELECT_BY_SOURCE[table] ?? defaultSelect;
    const orderCandidates = ORDER_BY_SOURCE[sourceLabel] ?? ORDER_BY_SOURCE[table] ?? defaultOrderCandidates;

    try {
      let q = sb.from(table).select(select).limit(limit);

      // Optional client-side search fallback if ilike not available on this query builder
      if (search && search.trim()) {
        // safest attempt — if ilike exists, use it, else we'll filter client-side after fetch
        q = (q as any).ilike?.("title", `%${search.trim()}%`) ?? q;
      }

      // Try ordering by candidates in sequence until one works
      let gotData: any[] | null = null;
      for (let i = 0; i <= orderCandidates.length; i++) {
        const orderBy = orderCandidates[i];
        const queryToRun = orderBy ? (q as any).order(orderBy as any, { ascending: false }) : q;
        const { data, error } = await queryToRun;

        if (!error) {
          let rows: Topic[] = (data ?? []) as Topic[];

          // If ilike wasn’t applied server-side, do a client filter
          if (search && search.trim() && !(q as any).ilike) {
            const needle = search.trim().toLowerCase();
            rows = rows.filter((r) => (r.title ?? "").toLowerCase().includes(needle));
          }

          if (rows.length > 0) return rows.slice(0, limit);
          gotData = rows;
          break;
        }
      }

      if (Array.isArray(gotData) && gotData.length > 0) return gotData.slice(0, limit);
    } catch {
      // Try next source candidate
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
    defaultSelect:
      "id,title,summary,tags,updated_at,tier,location_label,trending_score,activity_7d",
    defaultOrderCandidates: ["trending_score", "activity_7d", "updated_at"],
    limit: 12,
  });

  if (rows.length > 0) return rows;

  // Mock fallback (unchanged)
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
    defaultSelect: "id,title,summary,tags,updated_at,tier,location_label,activity_7d",
    defaultOrderCandidates: ["activity_7d", "updated_at"],
    limit: pageSize,
    search,
  });

  if (rows.length > 0) {
    return {
      items: rows.slice(0, pageSize),
      total: rows.length >= pageSize ? from + rows.length + 1 : from + rows.length,
      hasMore: rows.length === pageSize,
    };
  }

  // Mock fallback (unchanged)
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

// --------------------- Page (UI below unchanged) ---------------------
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

  const actions = (
    <button className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => navigate("/topics")}>
      Explore topics
    </button>
  );

=======
// ---------- Mock Data ----------
																		
																				   

							  
const MOCK_TOPICS: Topic[] = [
  { id: "t1", title: "Playground safety upgrade budget", summary: "Proposal to resurface and add inclusive equipment in parks.", created_at: new Date().toISOString(), tier: "city", tags: ["Civic","Budget"], location_label: "Mahwah, NJ" },
  { id: "t2", title: "EV chargers grants for multi-family", summary: "State program to fund charging in apartment complexes.", created_at: new Date().toISOString(), tier: "state", tags: ["Energy"], location_label: "New Jersey" },
  { id: "t3", title: "National broadband expansion", summary: "Federal plan to improve last-mile connectivity.", created_at: new Date().toISOString(), tier: "country", tags: ["Infrastructure"], location_label: "United States" },
  { id: "t4", title: "Single-use plastics pilot ban", summary: "County pilot to reduce litter and boost recycling downtown.", created_at: new Date().toISOString(), tier: "county", tags: ["Environment"], location_label: "Bergen County, NJ" },
  { id: "t5", title: "AI transparency for public services", summary: "Require agencies to publish model transparency reports.", created_at: new Date().toISOString(), tier: "global", tags: ["Technology"], location_label: "Global" }
];

																													

const MOCK_COMMENTS: Record<string, Comment[]> = {
  t1: [
    { id: "c1", parent_id: null, topic_id: "t1", user_display: "MapleDad", body: "Love the inclusive equipment idea.", created_at: new Date().toISOString() },
    { id: "c2", parent_id: "c1", topic_id: "t1", user_display: "SkaterMom", body: "Yes, and softer surfacing please.", created_at: new Date().toISOString() }
  ]
};

const USER_LOC = { city: "Mahwah, NJ", county: "Bergen County, NJ", state: "New Jersey", country: "United States" };

function clamp(n: number) { return Math.max(0, Math.min(100, n)); }

// ---------- Data Adapters ----------
async function fetchComments(topicId: string): Promise<Comment[]> {
  if (!hasSupabase) return MOCK_COMMENTS[topicId] ?? [];
  const { data, error } = await sb
    .from("comments")
    .select("id,parent_id,topic_id,user_display,body,created_at")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error || !data) return MOCK_COMMENTS[topicId] ?? [];
  return (data as any[]).map((c) => ({
    id: String(c.id),
    parent_id: c.parent_id ? String(c.parent_id) : null,
    topic_id: String(c.topic_id ?? topicId),
    user_display: c.user_display ?? "User",
    body: c.body ?? "",
    created_at: c.created_at ?? new Date().toISOString(),
  }));
}

async function fetchTopics(): Promise<Topic[]> {
  if (!hasSupabase) return MOCK_TOPICS;
  const { data, error } = await sb
    .from("topics")
    .select("id,title,summary,created_at,tier,location_label,tags")
    .order("created_at", { ascending: false })
    .limit(96);
  if (error || !data) return MOCK_TOPICS;
  return (data as any[]).map((t) => ({
    id: String(t.id),
    title: t.title,
    summary: t.summary ?? "",
    created_at: t.created_at ?? new Date().toISOString(),
    tier: (t.tier ?? "city") as LocationTier,
    tags: Array.isArray(t.tags)
      ? t.tags
      : typeof t.tags === "string"
      ? t.tags.split(",").map((s:string)=>s.trim()).filter(Boolean)
      : [],
    location_label: t.location_label ?? undefined,
  }));
}

																					 
async function fetchTrendFromRegionTrends(topicId: string): Promise<Trend | null> {
  const { data, error } = await sb!
    .from("topic_region_trends")
    .select("agree,neutral,disagree,total")
    .eq("topic_id", topicId);
  if (error || !data || data.length === 0) return null;

  const agg = data.reduce((acc: Trend, r: any) => {
				 
    acc.agree += Number(r.agree) || 0;
    acc.neutral += Number(r.neutral) || 0;
    acc.disagree += Number(r.disagree) || 0;
    acc.total += Number(r.total) || 0;
    return acc;
	  
  }, { agree:0, neutral:0, disagree:0, total:0 });
	

  if (agg.total <= 0) return { agree:0, neutral:0, disagree:0, total:0 };
  return {
    agree: Math.round((agg.agree * 100) / agg.total),
    neutral: Math.round((agg.neutral * 100) / agg.total),
    disagree: Math.round((agg.disagree * 100) / agg.total),
    total: agg.total,
  };
}

														   
async function fetchTrendFromStances(topicId: string): Promise<Trend | null> {
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString();
  const { data, error } = await sb!
    .from("stances")
    .select("stance,created_at")
    .eq("topic_id", topicId)
    .gte("created_at", sevenDaysAgo)
    .limit(5000);
  if (error || !data || data.length === 0) return null;

  let agreeCt = 0, neutralCt = 0, disagreeCt = 0;
  for (const row of data as any[]) {
    const s = Number(row.stance);
						 
    if (s > 0) agreeCt++; else if (s === 0) neutralCt++; else disagreeCt++;
					  
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

							
async function fetchTrend(topicId: string): Promise<Trend | null> {
  if (!hasSupabase) return { agree: 55, neutral: 25, disagree: 20, total: 500 };
  const r1 = await fetchTrendFromRegionTrends(topicId);
  if (r1) return r1;
  const r2 = await fetchTrendFromStances(topicId);
  if (r2) return r2;
  return null;
}

// ---------- UX Helpers ----------
function useDebouncedValue<T>(value: T, delay = 200) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

// ---------- UI Components ----------
function TrendMini({ agree, neutral }: { agree:number; neutral:number }) {
  const a = clamp(agree);
  const an = clamp(agree + neutral);
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
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
=======
function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 h-4 w-2/3 rounded bg-slate-200" />
      <div className="mb-2 h-3 w-1/2 rounded bg-slate-100" />
      <div className="mb-2 h-16 w-full rounded bg-slate-100" />
      <div className="h-2 w-full rounded bg-slate-200" />
    </div>
  );
}

function NestedComments({ comments, topicId }: { comments: Comment[]; topicId: string }) {
  const byParent = React.useMemo(() => {
    const map = new Map<string | null, Comment[]>();
    for (const c of comments) {
      const k = c.parent_id as any;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return map;
  }, [comments]);
  const roots = byParent.get(null) ?? [];
>>>>>>> Stashed changes

  const items = result?.items ?? [];
  return (
<<<<<<< Updated upstream
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
=======
    <div className="mt-3 rounded-xl border bg-slate-50 p-3">
      <div className="mb-2 text-xs font-medium text-slate-600">Discussion</div>
      {roots.length === 0 ? (
        <div className="text-xs text-slate-500">
          Be the first to comment.{" "}
          <Link to={`/topic/${topicId}`} className="underline">Open thread</Link>
        </div>
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
              </div>
            ))}
=======
              ))}
            </div>
          ))}
          <div className="text-right text-xs">
            <Link to={`/topic/${topicId}`} className="underline">View full thread →</Link>
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
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
=======
function TopicCard({ topic }: { topic: Topic }) {
  const [t, setT] = React.useState<Trend | null>(null);
  const [comments, setComments] = React.useState<Comment[]>([]);
  const navigate = useNavigate();

  React.useEffect(() => {
    (async () => {
      setT(await fetchTrend(topic.id));
      setComments(await fetchComments(topic.id));
    })();
  }, [topic.id]);

  const tt = t ?? { agree: 0, neutral: 0, disagree: 0, total: 0 };

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold leading-tight">{topic.title}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
            <span>📍 {topic.location_label}</span><span>•</span><span className="capitalize">{topic.tier}</span>
          </div>
        </div>
        <button
          className="rounded p-2 hover:bg-slate-50"
          aria-label="Open details"
          onClick={() => navigate(`/topic/${topic.id}`)}
		 
			 
        >↗</button>
      </div>

      <p className="mt-2 text-sm text-slate-600">{topic.summary}</p>

      {topic.tags && topic.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {topic.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{tag}</span>
				   
				   
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1">
        <div className="text-xs text-slate-500">{t ? "Trending (7d)" : "No trend data yet"}</div>
        <TrendMini agree={tt.agree} neutral={tt.neutral} />
        <div className="text-right text-[11px] text-slate-500 tabular-nums">{tt.agree}% · {tt.total.toLocaleString()} votes</div>
														  
			  
      </div>

      <NestedComments comments={comments} topicId={topic.id} />
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
          <Link to="/signup" className="rounded-full bg-slate-900 px-4 py-2 text-white">Sign up</Link>
          <Link to="/login" className="rounded-full border border-slate-300 px-4 py-2">Log in</Link>
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
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
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
=======
// ---------- Page ----------
export default function Homepage() {
  const [tab, setTab] = React.useState<"foryou" | LocationTier>("foryou");
  const [q, setQ] = React.useState("");
  const dq = useDebouncedValue(q, 200);
  const [topics, setTopics] = React.useState<Topic[]>(MOCK_TOPICS);
  const [loading, setLoading] = React.useState<boolean>(hasSupabase);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState<number>(9); // client-side pagination

  React.useEffect(() => {
    if (!hasSupabase) return; // using mocks
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const data = await fetchTopics();
        setTopics(data);
      } catch {
        setErrorMsg("Could not load topics. Showing mocks.");
        setTopics(MOCK_TOPICS);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  React.useEffect(() => { setVisible(9); }, [tab, dq]);

  const filtered = React.useMemo(() => {
    const items = tab === "foryou" ? topics : topics.filter((t) => t.tier === tab);
    if (!dq.trim()) return items;
    const needle = dq.toLowerCase();
    return items.filter((t) => t.title.toLowerCase().includes(needle) || t.summary.toLowerCase().includes(needle));
  }, [tab, dq, topics]);

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
        <div className="text-sm text-slate-500">Supabase {hasSupabase ? "ON" : "OFF (mock data)"}{errorMsg ? ` — ${errorMsg}` : ""}</div>
      </header>

      <HeroCTA />

      {/* Trending */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Trending Topics</h2>
          <a href="#topics" className="text-sm text-slate-600 hover:underline">See all</a>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)
          ) : (
            trending.map((t) => (<TopicCard key={`trend-${t.id}`} topic={t} />))
          )}
        </div>
      </section>

      {/* Filters */}
      <div id="topics" className="mb-4 rounded-2xl border bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-600">📍 <b>{USER_LOC.city}</b> • {USER_LOC.county} • {USER_LOC.state} • {USER_LOC.country}</div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full bg-slate-100 p-1 text-sm">
														  
              {(["foryou","city","county","state","country","global"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`rounded-full px-3 py-1 capitalize ${tab===k ? "bg-white shadow-sm" : "text-slate-600"}`}
				 
                >{k==="foryou" ? "For you" : k}</button>
						 
              ))}
            </div>
            <input
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              placeholder="Search topics…"
              className="w-48 rounded-full border px-3 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Topic Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {filtered.slice(0, visible).map((t) => <TopicCard key={t.id} topic={t} />)}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl border bg-white p-6 text-center text-slate-600">
            No topics found. Try a different filter or search.
          </div>
        )}
      </div>

      {/* Load more */}
      {visible < filtered.length && (
        <div className="mt-4 text-center">
          <button
            className="rounded-full border px-4 py-2 text-sm"
            onClick={() => setVisible((v) => v + 9)}
          >Load more</button>
        </div>
      )}

      <RegionThinks />
      <HowItWorks />
    </div>
  );
}

					 
>>>>>>> Stashed changes
