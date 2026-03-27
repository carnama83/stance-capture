// src/pages/MyStancesPage.tsx
// Updated for Epic E: stance history sparkline, rationale editor,
// topic filter, date range filter, CSV/JSON export.

import ContributionBanner from "./MyStances/ContributionBanner";
import StanceSnapshotCard from "./MyStances/StanceSnapshotCard";
import YouVsCommunityCard from "./MyStances/YouVsCommunityCard";
import SinceLastVisitCard from "./MyStances/SinceLastVisitCard";

import * as React from "react";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge";
import { StanceSparkline } from "@/components/StanceSparkline";
import { RationaleEditor } from "@/components/RationaleEditor";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";
import { Download } from "lucide-react";

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

type ExportRow = {
  question_id: string;
  question_text: string;
  current_score: number;
  first_answered: string;
  last_updated: string;
  change_count: number;
  rationale: string | null;
  links: string[];
  score_history: Array<{ old_score: number | null; new_score: number; changed_at: string }>;
};

type SortBy = "recent" | "oldest" | "strongest";
type FilterBy = "all" | "sa" | "a" | "n" | "d" | "sd" | "strong";

const STANCE_LABELS: Record<number, { label: string; short: string; tone: "pos" | "neg" | "neu" }> = {
  [-2]: { label: "Strongly disagree", short: "Strongly disagree", tone: "neg" },
  [-1]: { label: "Disagree",          short: "Disagree",          tone: "neg" },
  [0]:  { label: "Neutral",           short: "Neutral",           tone: "neu" },
  [1]:  { label: "Agree",             short: "Agree",             tone: "pos" },
  [2]:  { label: "Strongly agree",    short: "Strongly agree",    tone: "pos" },
};

// ---------- Session hook ----------
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

// ---------- Data fetcher ----------
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
    .select("id, question, summary, tags, location_label, published_at, status, phase, topic_title")
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

// ---------- Export helpers ----------
function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function runExport(format: "csv" | "json") {
  const sb = getSupabase();
  if (!sb) return;
  const { data, error } = await sb.rpc("get_my_stance_export");
  if (error || !data) { console.error("Export failed", error); return; }

  const rows = data as ExportRow[];
  const date = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    downloadFile(JSON.stringify(rows, null, 2), `stance-export-${date}.json`, "application/json");
    return;
  }

  // CSV
  const headers = ["question_id", "question_text", "current_score", "first_answered", "last_updated", "change_count", "rationale", "links"];
  const escape = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csvRows = rows.map((r) =>
    [r.question_id, r.question_text, r.current_score, r.first_answered, r.last_updated, r.change_count, r.rationale ?? "", (r.links ?? []).join("; ")]
      .map((v) => escape(String(v)))
      .join(",")
  );
  downloadFile([headers.join(","), ...csvRows].join("\n"), `stance-export-${date}.csv`, "text/csv");
}

// ---------- Page ----------
export default function MyStancesPage() {
  const session = useSupabaseSession();
  const navigate = useNavigate();
  const isAuthed = !!session;
  const userId = session?.user?.id ?? null;

  const [sortBy, setSortBy] = React.useState<SortBy>("recent");
  const [filterBy, setFilterBy] = React.useState<FilterBy>("all");
  const [topicFilter, setTopicFilter] = React.useState<string>("all");
  const [dateFrom, setDateFrom] = React.useState<string>("");
  const [dateTo, setDateTo] = React.useState<string>("");
  const [exportOpen, setExportOpen] = React.useState(false);

  const { data: rawRows, isLoading, isError, error } = useQuery<MyStanceRow[], Error>({
    enabled: !!userId,
    queryKey: ["my-stances", userId],
    queryFn: () => fetchMyStances(userId!),
    staleTime: 60_000,
  });

  const rows = rawRows ?? [];

  // Derive unique topics for filter dropdown
  const topics = React.useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach((r) => {
      const t = r.question?.topic_title;
      if (t) seen.set(t, t);
    });
    return Array.from(seen.values()).sort();
  }, [rows]);

  const filteredAndSorted = React.useMemo(() => {
    let working = [...rows];

    // Stance filter
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

    // Topic filter
    if (topicFilter !== "all") {
      working = working.filter((r) => r.question?.topic_title === topicFilter);
    }

    // Date range filter
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      working = working.filter((r) => new Date(r.updated_at ?? r.created_at ?? 0).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400_000; // inclusive end
      working = working.filter((r) => new Date(r.updated_at ?? r.created_at ?? 0).getTime() <= to);
    }

    // Sort
    working.sort((a, b) => {
      const dateA = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      const dateB = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      if (sortBy === "recent")   return dateB - dateA;
      if (sortBy === "oldest")   return dateA - dateB;
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
            {/* Export dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setExportOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 rounded-md border bg-white shadow-md text-xs overflow-hidden">
                  <button
                    type="button"
                    className="block w-full px-4 py-2 text-left hover:bg-slate-50 text-slate-700"
                    onClick={() => { runExport("csv"); setExportOpen(false); }}
                  >
                    Download CSV
                  </button>
                  <button
                    type="button"
                    className="block w-full px-4 py-2 text-left hover:bg-slate-50 text-slate-700"
                    onClick={() => { runExport("json"); setExportOpen(false); }}
                  >
                    Download JSON
                  </button>
                </div>
              )}
            </div>
            <Link to="/" className="text-xs text-slate-600 hover:underline">← Back</Link>
          </div>
        </div>

        {/* Contribution acknowledgement */}
        <ContributionBanner />

        {/* Summary cards */}
        <section className="space-y-3">
          <StanceSnapshotCard />
          <SinceLastVisitCard />
          <YouVsCommunityCard />
        </section>

        {/* Controls */}
        <section className="rounded-lg border p-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs text-slate-700">
              Showing <span className="font-medium">{visibleCount} of {totalCount}</span> stances
            </div>
            <div className="flex flex-wrap items-center gap-2">

              {/* Sort */}
              <label className="flex items-center gap-1 text-[11px] text-slate-600">
                <span>Sort</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="rounded border px-2 py-1 text-[11px]">
                  <option value="recent">Most recent</option>
                  <option value="oldest">Oldest first</option>
                  <option value="strongest">Strongest opinions</option>
                </select>
              </label>

              {/* Stance filter */}
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

              {/* Topic filter */}
              {topics.length > 0 && (
                <label className="flex items-center gap-1 text-[11px] text-slate-600">
                  <span>Topic</span>
                  <select value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)} className="rounded border px-2 py-1 text-[11px] max-w-[140px]">
                    <option value="all">All topics</option>
                    {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>

          {/* Date range */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
            <span>Date range</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="rounded border px-2 py-1 text-[11px]" />
            <span>to</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="rounded border px-2 py-1 text-[11px]" />
            {(dateFrom || dateTo) && (
              <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-slate-400 hover:text-slate-600 underline">
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

        {/* List */}
        {!isLoading && !isError && visibleCount > 0 && (
          <section className="space-y-3">
            {filteredAndSorted.map((row) => (
              <MyStanceCard key={row.stance_id} row={row} />
            ))}
          </section>
        )}
      </div>
    </PageLayout>
  );
}

// ---------- Card ----------
function MyStanceCard({ row }: { row: MyStanceRow }) {
  const q = row.question;
  const updatedAt = row.updated_at ?? row.created_at;
  const dateLabel = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Unknown";

  const stanceDef = STANCE_LABELS[row.score] ?? { label: "Unknown", short: String(row.score), tone: "neu" as const };
  const stanceToneClass =
    stanceDef.tone === "pos" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
    stanceDef.tone === "neg" ? "bg-rose-50 border-rose-200 text-rose-800" :
    "bg-slate-50 border-slate-200 text-slate-800";

  return (
    <article className="rounded-lg border px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {q?.phase && q.phase !== "initial" && (
              <QuestionPhaseBadge phase={q.phase} size="sm" />
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

          {/* E2: Rationale editor */}
          <RationaleEditor questionId={row.question_id} />

          {/* E1: Stance history sparkline */}
          <StanceSparkline questionId={row.question_id} currentScore={row.score} />
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${stanceToneClass}`}>
            {stanceDef.label}
          </span>
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
