// src/pages/MyStancesPage.tsx — UPDATED
// Change from previous version:
//   Added TopicHistoryDrawer — when user selects a topic in the topic filter
//   dropdown, a drawer opens above the stance list showing the per-topic
//   stance evolution, sparkline, and change history.
//   This is the E TopicHistoryDrawer integration.
//
// All other functionality unchanged.

import ContributionBanner from "./MyStances/ContributionBanner";
import StanceSnapshotCard from "./MyStances/StanceSnapshotCard";
import YouVsCommunityCard from "./MyStances/YouVsCommunityCard";
import SinceLastVisitCard from "./MyStances/SinceLastVisitCard";
import QuickTakesCard from "./MyStances/QuickTakesCard";
import TrendingAnsweredCard from "./MyStances/TrendingAnsweredCard";
import { ShareStatsCard } from "./MyStances/ShareStatsCard";
import TopicHistoryDrawer from "@/components/insights/TopicHistoryDrawer";

import * as React from "react";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge";
import { StanceSparkline } from "@/components/StanceSparkline";
import { RationaleEditor } from "@/components/RationaleEditor";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";
import { Download, BookOpen, Loader2 } from "lucide-react";
import { buildStanceLabels } from "@/lib/stanceColors";
import { useToast } from "@/components/ui/use-toast";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, getJwt } from "@/lib/env";

type Session = import("@supabase/supabase-js").Session;

type LiveQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
  phase?: string;
  topic_title?: string | null;
  slider_low_label?: string | null;
  slider_high_label?: string | null;
};

type QuestionStanceRow = {
  id: string;
  question_id: string;
  score: number;
  created_at: string | null;
  updated_at: string | null;
};

type MyStanceRow = {
  stance_id: string;
  question_id: string;
  score: number;
  created_at: string | null;
  updated_at: string | null;
  question: LiveQuestion | null;
};


type SortBy = "recent" | "oldest" | "strongest";
type FilterBy = "all" | "sa" | "a" | "n" | "d" | "sd" | "strong";

function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setReady(true);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);
  return { session, ready };
}

async function fetchMyStances(userId: string): Promise<MyStanceRow[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data: stances, error: stanceError } = await sb
    .from("question_stances")
    .select("id, question_id, score, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (stanceError) throw stanceError;
  if (!stances || stances.length === 0) return [];

  const rows = stances as QuestionStanceRow[];
  const questionIds = Array.from(new Set(rows.map((r) => r.question_id).filter(Boolean)));

  if (!questionIds.length) {
    return rows.map((r) => ({ stance_id: r.id, question_id: r.question_id, score: r.score, created_at: r.created_at, updated_at: r.updated_at, question: null }));
  }

  const { data: questions, error: questionError } = await sb
    .from("v_live_questions")
    .select("id, question, summary, tags, location_label, published_at, status, phase, topic_title, slider_low_label, slider_high_label")
    .in("id", questionIds);

  const questionMap = new Map<string, LiveQuestion>();
  if (!questionError) {
    (questions ?? []).forEach((q) => questionMap.set((q as LiveQuestion).id, q as LiveQuestion));
  }

  return rows.map((r) => ({
    stance_id: r.id,
    question_id: r.question_id,
    score: r.score,
    created_at: r.created_at,
    updated_at: r.updated_at,
    question: questionMap.get(r.question_id) ?? null,
  }));
}

// N: Secure export — calls generate-export edge function which writes to
// Supabase Storage and returns a signed URL valid for 60 seconds.
// The browser follows the signed URL to download without raw data
// passing through client-side JS memory.

// M-E04: runExport now accepts toast (for error feedback) and
// setLoading (for spinner on the Export button).
// Wrapped in try/catch — on any failure shows a destructive toast.
async function runExport(
  format: "csv" | "json",
  toast: (opts: { title: string; description: string; variant?: "destructive" }) => void,
  setLoading: (v: boolean) => void,
) {
  setLoading(true);
  try {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase not available");

    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const supabaseUrl = (SUPABASE_URL).replace(/\/+$/, "");
    const anonKey     = SUPABASE_ANON_KEY;

    const res = await fetch(`${supabaseUrl}/functions/v1/generate-export`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey":        anonKey,
      },
      body: JSON.stringify({ format }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(err.error ?? "Export failed");
    }

    const { url, filename } = await res.json();

    // Trigger browser download via signed URL — expires in 60s
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err: any) {
    console.error("Export failed:", err);
    toast({
      title: "Export failed",
      description: "Export failed. Please try again.",
      variant: "destructive",
    });
  } finally {
    setLoading(false);
  }
}


export default function MyStancesPage() {
  const { session, ready } = useSupabaseSession();
  const navigate = useNavigate();
  const isAuthed = !!session;
  const userId = session?.user?.id ?? null;
  const { toast } = useToast();

  const [sortBy, setSortBy] = React.useState<SortBy>("recent");
  const [filterBy, setFilterBy] = React.useState<FilterBy>("all");
  const [topicFilter, setTopicFilter] = React.useState<string>("all");
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportLoading, setExportLoading] = React.useState(false); // M-E04
  const [activeTab, setActiveTab] = React.useState<"overview" | "stances">("overview");

  // ── TopicHistoryDrawer state ─────────────────────────────────────────────
  // When a topic is selected in the topic filter, the drawer opens.
  const [drawerTopic, setDrawerTopic] = React.useState<string | null>(null);

  const { data: rawRows, isLoading, isError, error } = useQuery<MyStanceRow[], Error>({
    enabled: !!userId,
    queryKey: ["my-stances", userId],
    queryFn: () => fetchMyStances(userId!),
    staleTime: 60_000,
  });

  const rows = rawRows ?? [];

  const topics = React.useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach((r) => {
      const t = r.question?.topic_title;
      if (t) seen.set(t, t);
    });
    return Array.from(seen.values()).sort();
  }, [rows]);

  // ── When topic filter changes, open/close the drawer ────────────────────
  function handleTopicFilterChange(value: string) {
    setTopicFilter(value);
    setDrawerTopic(value !== "all" ? value : null);
  }

  const filteredAndSorted = React.useMemo(() => {
    let working = [...rows];

    working = working.filter((row) => {
      const s = row.score;
      switch (filterBy) {
        case "sa":     return s === 2;
        case "a":      return s === 1;
        case "n":      return s === 0;
        case "d":      return s === -1;
        case "sd":     return s === -2;
        case "strong": return Math.abs(s) === 2;
        default:       return true;
      }
    });

    if (topicFilter !== "all") {
      working = working.filter((r) => r.question?.topic_title === topicFilter);
    }

    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      working = working.filter((r) => new Date(r.updated_at ?? r.created_at ?? 0).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400_000;
      working = working.filter((r) => new Date(r.updated_at ?? r.created_at ?? 0).getTime() <= to);
    }

    working.sort((a, b) => {
      const dateA = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      const dateB = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      if (sortBy === "recent")    return dateB - dateA;
      if (sortBy === "oldest")    return dateA - dateB;
      if (sortBy === "strongest") {
        const diff = Math.abs(b.score) - Math.abs(a.score);
        return diff !== 0 ? diff : dateB - dateA;
      }
      return 0;
    });

    return working;
  }, [rows, sortBy, filterBy, topicFilter, dateFrom, dateTo]);

  const totalCount = rows.length;
  const visibleCount = filteredAndSorted.length;

  if (!ready) {
    return (
      <PageLayout>
        <div className="max-w-3xl mx-auto py-4">
          <div className="text-xs text-slate-500">Loading…</div>
        </div>
      </PageLayout>
    );
  }

  if (!isAuthed || !userId) {
    return (
      <PageLayout>
        <div className="max-w-3xl mx-auto py-4">
          <div className="rounded-lg border p-4 text-sm text-slate-700">
            <div className="font-medium mb-1">Sign in required</div>
            <p className="mb-2">You need to be logged in to see and manage your stances.</p>
            <button type="button" className="rounded bg-slate-900 text-white px-3 py-1.5 text-xs" onClick={() => navigate("/login")}>
              Log in
            </button>
          </div>
        </div>
      </PageLayout>
    );
  }

  const displayName = (() => {
    const user = session.user;
    const fullName = (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined);
    if (fullName) return fullName.split(" ")[0];
    const email = user.email ?? "";
    return email ? email.split("@")[0] : "you";
  })();

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-4 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold text-slate-900">My stances</h1>
            <p className="text-xs text-slate-600">
              See where {displayName} stands, and revisit questions you've already answered.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setExportOpen((v) => !v)}
                disabled={exportLoading}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {exportLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />
                }
                {exportLoading ? "Exporting…" : "Export"}
              </button>
              {exportOpen && !exportLoading && (
                <div className="absolute right-0 top-full mt-1 z-20 rounded-md border bg-white shadow-md text-xs overflow-hidden">
                  <button type="button" className="block w-full px-4 py-2 text-left hover:bg-slate-50 text-slate-700" onClick={() => { setExportOpen(false); runExport("csv", toast, setExportLoading); }}>
                    Download CSV
                  </button>
                  <button type="button" className="block w-full px-4 py-2 text-left hover:bg-slate-50 text-slate-700" onClick={() => { setExportOpen(false); runExport("json", toast, setExportLoading); }}>
                    Download JSON
                  </button>
                </div>
              )}
            </div>
            <Link to="/" className="text-xs text-slate-600 hover:underline">← Back</Link>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-100">
          {(["overview", "stances"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors border-b-2 -mb-px capitalize",
                activeTab === tab
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-700",
              ].join(" ")}
            >
              {tab === "overview" ? "Overview" : `My Stances${totalCount > 0 ? ` (${totalCount})` : ""}`}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {activeTab === "overview" && (
          <>
            <QuickTakesCard userId={userId} />
            <TrendingAnsweredCard userId={userId} />
            <ContributionBanner />
            <ShareStatsCard />
            <section className="space-y-3">
              <StanceSnapshotCard />
              <SinceLastVisitCard />
              <YouVsCommunityCard />
            </section>
            {totalCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("stances")}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-xs text-slate-600 hover:bg-slate-50 transition-colors text-center"
              >
                View all {totalCount} stances →
              </button>
            )}
          </>
        )}

        {/* Stances tab */}
        {activeTab === "stances" && (
          <>
            {/* Controls */}
            <section className="rounded-lg border p-3 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs text-slate-700">
                  Showing <span className="font-medium">{visibleCount} of {totalCount}</span> stances
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-slate-600">
                    <span>Sort</span>
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="rounded border px-2 py-1 text-[11px]">
                      <option value="recent">Most recent</option>
                      <option value="oldest">Oldest first</option>
                      <option value="strongest">Strongest opinions</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1 text-[11px] text-slate-600">
                    <span>Stance</span>
                    <select value={filterBy} onChange={(e) => setFilterBy(e.target.value as FilterBy)} className="rounded border px-2 py-1 text-[11px]">
                      <option value="all">All</option>
                      <option value="sa">Strongly agree</option>
                      <option value="a">Agree</option>
                      <option value="n">Neutral</option>
                      <option value="d">Disagree</option>
                      <option value="sd">Strongly disagree</option>
                      <option value="strong">Strong only (±2)</option>
                    </select>
                  </label>

                  {/* Topic filter — now also opens the drawer */}
                  {topics.length > 0 && (
                    <label className="flex items-center gap-1 text-[11px] text-slate-600">
                      <span>Topic</span>
                      <select
                        value={topicFilter}
                        onChange={(e) => handleTopicFilterChange(e.target.value)}
                        className="rounded border px-2 py-1 text-[11px] max-w-[140px]"
                      >
                        <option value="all">All topics</option>
                        {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                  )}

                  {/* Topic history drawer trigger (icon button) */}
                  {topicFilter !== "all" && (
                    <button
                      type="button"
                      onClick={() => setDrawerTopic(drawerTopic ? null : topicFilter)}
                      className={[
                        "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                        drawerTopic
                          ? "bg-blue-50 border-blue-200 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50",
                      ].join(" ")}
                      title={drawerTopic ? "Hide topic history" : "Show topic history"}
                    >
                      <BookOpen className="h-3 w-3" />
                      {drawerTopic ? "Hide history" : "Topic history"}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                <span>Date range</span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border px-2 py-1 text-[11px]" />
                <span>to</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border px-2 py-1 text-[11px]" />
                {(dateFrom || dateTo) && (
                  <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-slate-400 hover:text-slate-600 underline">
                    Clear
                  </button>
                )}
              </div>

              {isLoading && <p className="text-xs text-slate-500">Loading your stances…</p>}
              {isError && !isLoading && <p className="text-xs text-red-600">Failed to load: {(error as Error)?.message}</p>}
              {!isLoading && !isError && totalCount === 0 && (
                <p className="text-xs text-slate-500">You haven't taken a stance on any question yet.</p>
              )}
            </section>

            {/* ── TopicHistoryDrawer ─────────────────────────────────────── */}
            {drawerTopic && userId && (
              <TopicHistoryDrawer
                topicTitle={drawerTopic}
                userId={userId}
                onClose={() => setDrawerTopic(null)}
              />
            )}

            {/* Stance list */}
            {!isLoading && !isError && visibleCount > 0 && (
              <section className="space-y-3">
                {filteredAndSorted.map((row) => (
                  <MyStanceCard key={row.stance_id} row={row} userId={userId} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

const SCORE_OPTIONS: { value: number; label: string; tone: "pos" | "neg" | "neu" }[] = [
  { value:  2, label: "Strongly agree",    tone: "pos" },
  { value:  1, label: "Agree",             tone: "pos" },
  { value:  0, label: "Neutral",           tone: "neu" },
  { value: -1, label: "Disagree",          tone: "neg" },
  { value: -2, label: "Strongly disagree", tone: "neg" },
];

// M-E02: score → hex colour, mirrors StanceSparkline's SCORE_COLOR map.
const SCORE_COLOR: Record<number, string> = {
  [-2]: "#f43f5e", [-1]: "#fb923c", [0]: "#94a3b8", [1]: "#34d399", [2]: "#10b981",
};

// M-E02: Fetches the last 2 stance_history rows for this question.
// Uses the same query key as StanceSparkline so results are shared from cache
// once the sparkline is expanded — no duplicate network calls.
// Returns { arrow, color } or null when fewer than 2 history points exist.
function useTrendBadge(questionId: string) {
  const { data } = useQuery({
    queryKey: ["stance-history", questionId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_my_stance_history", {
        p_question_id: questionId,
      });
      if (error) throw error;
      return (data ?? []) as { id: string; old_score: number | null; new_score: number; changed_at: string }[];
    },
  });

  return React.useMemo(() => {
    if (!data || data.length < 2) return null;
    const delta = data[data.length - 1].new_score - data[data.length - 2].new_score;
    if (delta > 0) return { arrow: "↑", color: SCORE_COLOR[1] };
    if (delta < 0) return { arrow: "↓", color: SCORE_COLOR[-1] };
    return { arrow: "→", color: SCORE_COLOR[0] };
  }, [data]);
}

function MyStanceCard({ row, userId }: { row: MyStanceRow; userId: string }) {
  const q = row.question;
  const updatedAt = row.updated_at ?? row.created_at;
  const dateLabel = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Unknown";

  const [editing, setEditing] = React.useState(false);
  const [selectedScore, setSelectedScore] = React.useState(row.score);
  const [saving, setSaving] = React.useState(false);
  const queryClient = useQueryClient();

  // M-E02: trend badge derived from last two history entries
  const trendBadge = useTrendBadge(row.question_id);

  // Dynamic 5-point labels derived from question's reframe pipeline output —
  // same logic as QDP and homepage. Falls back to generic labels when null.
  const stanceLabels = buildStanceLabels(q?.slider_low_label, q?.slider_high_label);

  const currentLabel = stanceLabels[editing ? selectedScore : row.score] ?? String(row.score);
  const currentTone: "pos" | "neg" | "neu" =
    (editing ? selectedScore : row.score) > 0 ? "pos" :
    (editing ? selectedScore : row.score) < 0 ? "neg" : "neu";
  const stanceToneClass =
    currentTone === "pos" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
    currentTone === "neg" ? "bg-rose-50 border-rose-200 text-rose-800" :
    "bg-slate-50 border-slate-200 text-slate-800";

  // M-E03: onSubmit wired to set_question_stance().
  // Invalidates ['my-stances', userId] (scoped to user) and
  // ['stance-history', questionId] so the trend badge + sparkline
  // reflect the new score immediately without a page reload.
  async function handleSave() {
    if (selectedScore === row.score) { setEditing(false); return; }
    setSaving(true);
    try {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("set_question_stance", {
        p_question_id: row.question_id,
        p_score: selectedScore,
      });
      if (error) throw error;
      // Invalidate the scoped my-stances list (userId key) and the
      // per-question history cache so trend badge + sparkline update.
      queryClient.invalidateQueries({ queryKey: ["my-stances", userId] });
      queryClient.invalidateQueries({ queryKey: ["stance-history", row.question_id] });
      setEditing(false);
    } catch (err: any) {
      alert(err?.message ?? "Failed to save stance");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-lg border px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {q?.phase && q.phase !== "initial" && (
              <QuestionPhaseBadge phase={q.phase} size="sm" />
            )}
            {/* M-E02: trend direction badge from last two history entries */}
            {trendBadge && (
              <span
                className="text-[11px] font-semibold leading-none"
                style={{ color: trendBadge.color }}
                title="Direction of last stance change"
              >
                {trendBadge.arrow}
              </span>
            )}
            {q ? (
              <Link to={`/q/${q.id}`} className="text-sm font-semibold text-slate-900 hover:underline">
                {q.question}
              </Link>
            ) : (
              <div className="text-sm font-semibold text-slate-900">[Question unavailable]</div>
            )}
          </div>

          {q?.topic_title && (
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{q.topic_title}</p>
          )}

          {q?.summary && (
            <p className="text-xs text-slate-600 line-clamp-2">{q.summary}</p>
          )}

          {q?.tags && q.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {q.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <StanceSparkline questionId={row.question_id} currentScore={row.score} />

          <RationaleEditor questionId={row.question_id} />

          {editing && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {SCORE_OPTIONS.map((opt) => {
                  const optLabel = stanceLabels[opt.value] ?? opt.label;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSelectedScore(opt.value)}
                      className={[
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        selectedScore === opt.value
                          ? opt.tone === "pos" ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                            : opt.tone === "neg" ? "bg-rose-100 border-rose-300 text-rose-800"
                            : "bg-slate-200 border-slate-400 text-slate-800"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {optLabel}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-md bg-slate-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setSelectedScore(row.score); }}
                  className="rounded-md border px-3 py-1 text-[11px] text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${stanceToneClass}`}>
            {currentLabel}
          </span>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] text-slate-400 hover:text-slate-700 underline transition-colors"
            >
              Revise
            </button>
          )}
          {q?.location_label && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 bg-slate-50">
              {q.location_label}
            </span>
          )}
          {q?.published_at && (
            <span className="text-[10px] text-slate-500">
              Q: {new Date(q.published_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </span>
          )}
          <span className="text-[10px] text-slate-500">Updated: {dateLabel}</span>
        </div>
      </div>
    </article>
  );
}
