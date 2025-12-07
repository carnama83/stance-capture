// src/pages/AdminStanceMetricsPage.tsx
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";

type Session = import("@supabase/supabase-js").Session;

type LiveQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
};

type QuestionStanceStatsRow = {
  question_id: string;
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
  updated_at: string;
};

type StanceOverviewRow = {
  question_id: string;
  question: string;
  location_label: string | null;
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
  published_at: string | null;
  status: string | null;
  updated_at: string;
};

type RegionRow = {
  region_scope: "city" | "county" | "state" | "country" | "global";
  region_label: string;
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
  updated_at: string;
};

type SortBy = "responses" | "most_positive" | "most_negative" | "recent";

// ---------- Shared session hook (same pattern as MyStancesPage) ----------
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

// ---------- Data fetchers ----------

async function fetchStanceOverview(): Promise<StanceOverviewRow[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  // 1) Base stats
  const { data: stats, error: statsError } = await sb
    .from("question_stance_stats")
    .select(
      "question_id, total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at"
    )
    .order("total_responses", { ascending: false })
    .limit(200);

  if (statsError) {
    console.error("[admin-stance-metrics] stats error", statsError);
    throw statsError;
  }

  const rows = (stats ?? []) as QuestionStanceStatsRow[];
  if (rows.length === 0) return [];

  // 2) Join with question details from v_live_questions
  const questionIds = Array.from(
    new Set(rows.map((r) => r.question_id).filter(Boolean))
  );

  const { data: questions, error: qError } = await sb
    .from("v_live_questions")
    .select(
      "id, question, summary, tags, location_label, published_at, status"
    )
    .in("id", questionIds);

  if (qError) {
    console.error("[admin-stance-metrics] questions error", qError);
    // still return rows, just with minimal question info
  }

  const questionMap = new Map<string, LiveQuestion>();
  (questions ?? []).forEach((q) => {
    questionMap.set((q as LiveQuestion).id, q as LiveQuestion);
  });

  return rows.map((s) => {
    const q = questionMap.get(s.question_id);
    return {
      question_id: s.question_id,
      question: q?.question ?? "(missing question)",
      location_label: (q?.location_label as string | null) ?? null,
      total_responses: s.total_responses,
      pct_agree: s.pct_agree,
      pct_disagree: s.pct_disagree,
      pct_neutral: s.pct_neutral,
      avg_score: s.avg_score,
      published_at: (q?.published_at as string | null) ?? null,
      status: (q?.status as string | null) ?? null,
      updated_at: s.updated_at,
    };
  });
}

async function fetchQuestionRegions(
  questionId: string
): Promise<RegionRow[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("question_stance_stats_region")
    .select(
      "region_scope, region_label, total_responses, pct_agree, pct_disagree, pct_neutral, avg_score, updated_at"
    )
    .eq("question_id", questionId);

  if (error) {
    console.error("[admin-stance-metrics] region error", error);
    throw error;
  }

  const rows = (data ?? []) as RegionRow[];

  // Sort by our preferred tier order and then responses
  const order: RegionRow["region_scope"][] = [
    "global",
    "country",
    "state",
    "county",
    "city",
  ];
  const orderIndex = new Map(order.map((s, i) => [s, i]));

  return rows
    .slice()
    .sort((a, b) => {
      const ai = orderIndex.get(a.region_scope) ?? 99;
      const bi = orderIndex.get(b.region_scope) ?? 99;
      if (ai !== bi) return ai - bi;
      return (b.total_responses ?? 0) - (a.total_responses ?? 0);
    });
}

// ---------- Helper UI bits ----------

function tinyStanceBar(row: StanceOverviewRow) {
  const agree = Math.max(0, row.pct_agree ?? 0);
  const disagree = Math.max(0, row.pct_disagree ?? 0);
  const neutral = Math.max(0, row.pct_neutral ?? 0);

  const totalPct = agree + disagree + neutral || 1;
  const agreePct = (agree / totalPct) * 100;
  const disagreePct = (disagree / totalPct) * 100;
  const neutralPct = (neutral / totalPct) * 100;

  return (
    <div className="flex h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
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
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

// ---------- Region panel ----------

function RegionsPanel(props: {
  questionId: string | null;
  questionText: string | null;
}) {
  const { questionId, questionText } = props;

  const {
    data: regions,
    isLoading,
    isError,
    error,
  } = useQuery<RegionRow[], Error>({
    enabled: !!questionId,
    queryKey: ["admin-stance-regions", questionId],
    queryFn: () => fetchQuestionRegions(questionId!),
    staleTime: 60_000,
  });

  if (!questionId) {
    return (
      <div className="text-sm text-slate-500">
        Select a question to see region breakdown.
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-sm text-slate-500">Loading regions…</div>;
  }

  if (isError) {
    return (
      <div className="text-sm text-red-600">
        Failed to load region stats: {error?.message}
      </div>
    );
  }

  if (!regions || regions.length === 0) {
    return (
      <div className="text-sm text-slate-500">
        No regional stats available yet for this question.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-medium text-slate-900">
            Region breakdown
          </h3>
          {questionText && (
            <p className="text-xs text-slate-500 line-clamp-2">
              {questionText}
            </p>
          )}
        </div>
        <span className="text-[10px] text-slate-500">
          Bar shows % disagree · neutral · agree
        </span>
      </div>
      <div className="space-y-1.5">
        {regions.map((row) => {
          const label =
            row.region_scope === "global"
              ? "Global"
              : row.region_label ?? row.region_scope;

          const agree = Math.max(0, row.pct_agree ?? 0);
          const disagree = Math.max(0, row.pct_disagree ?? 0);
          const neutral = Math.max(0, row.pct_neutral ?? 0);
          const totalPct = agree + disagree + neutral || 1;
          const agreePct = (agree / totalPct) * 100;
          const disagreePct = (disagree / totalPct) * 100;
          const neutralPct = (neutral / totalPct) * 100;

          return (
            <div
              key={`${row.region_scope}:${label}`}
              className="flex items-center justify-between gap-2 text-[11px] text-slate-700"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate max-w-[140px]">{label}</span>
                <div className="flex h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
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
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-slate-500">
                  {row.total_responses} resp
                </span>
                <span className="text-slate-700">
                  {Math.round(row.pct_agree ?? 0)}% agree
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Page ----------

export default function AdminStanceMetricsPage() {
  const session = useSupabaseSession();
  const isAuthed = !!session;

  const [search, setSearch] = React.useState("");
  const [minResponses, setMinResponses] = React.useState(5);
  const [sortBy, setSortBy] = React.useState<SortBy>("responses");
  const [selectedQuestionId, setSelectedQuestionId] = React.useState<
    string | null
  >(null);
  const [selectedQuestionText, setSelectedQuestionText] = React.useState<
    string | null
  >(null);

  const {
    data: overview,
    isLoading,
    isError,
    error,
  } = useQuery<StanceOverviewRow[], Error>({
    queryKey: ["admin-stance-overview"],
    queryFn: fetchStanceOverview,
    staleTime: 60_000,
  });

  const filteredAndSorted: StanceOverviewRow[] = React.useMemo(() => {
    let rows = (overview ?? []).slice();

    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.question.toLowerCase().includes(needle)
      );
    }

    if (minResponses > 0) {
      rows = rows.filter((r) => r.total_responses >= minResponses);
    }

    rows.sort((a, b) => {
      switch (sortBy) {
        case "responses":
          return b.total_responses - a.total_responses;
        case "most_positive":
          return (b.avg_score ?? -999) - (a.avg_score ?? -999);
        case "most_negative":
          return (a.avg_score ?? 999) - (b.avg_score ?? 999);
        case "recent":
          return (
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime()
          );
        default:
          return 0;
      }
    });

    return rows;
  }, [overview, search, minResponses, sortBy]);

  return (
    <PageLayout>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Admin · Stance Metrics
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Overview of how questions are being answered across the
              community. Click a row to see regional breakdown.
            </p>
          </div>
          {!isAuthed && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              Admin view — please log in
            </span>
          )}
        </header>

        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)]">
          {/* Left: table */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search questions…"
                className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600">
                  Min responses
                </label>
                <input
                  type="number"
                  min={0}
                  value={minResponses}
                  onChange={(e) =>
                    setMinResponses(
                      Number.isNaN(Number(e.target.value))
                        ? 0
                        : Number(e.target.value)
                    )
                  }
                  className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-600">Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  <option value="responses">Most responses</option>
                  <option value="most_positive">Most positive</option>
                  <option value="most_negative">Most negative</option>
                  <option value="recent">Recently updated</option>
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[540px] overflow-auto">
              {isLoading && (
                <div className="px-4 py-8 text-sm text-slate-500">
                  Loading stance metrics…
                </div>
              )}
              {isError && (
                <div className="px-4 py-8 text-sm text-red-600">
                  Failed to load stance metrics: {error?.message}
                </div>
              )}
              {!isLoading && !isError && filteredAndSorted.length === 0 && (
                <div className="px-4 py-8 text-sm text-slate-500">
                  No stance stats found yet. Once users start responding to
                  questions, aggregates will appear here.
                </div>
              )}
              {!isLoading &&
                !isError &&
                filteredAndSorted.map((row) => {
                  const isSelected = row.question_id === selectedQuestionId;
                  const avg =
                    typeof row.avg_score === "number"
                      ? row.avg_score.toFixed(2)
                      : "–";
                  const loc = row.location_label ?? "Global / mixed";
                  const statusLabel = row.status ?? "unknown";

                  return (
                    <button
                      key={row.question_id}
                      type="button"
                      onClick={() => {
                        setSelectedQuestionId(row.question_id);
                        setSelectedQuestionText(row.question);
                      }}
                      className={`w-full text-left px-4 py-3 flex flex-col gap-1 hover:bg-emerald-50/40 ${
                        isSelected ? "bg-emerald-50/60" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              to={`/q/${row.question_id}`}
                              className="text-sm font-semibold text-slate-900 hover:underline truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.question}
                            </Link>
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-[2px] text-[10px] text-slate-600 shrink-0">
                              {loc}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-[2px] text-[10px] text-slate-500 shrink-0">
                              {statusLabel}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs text-slate-600">
                            <span>
                              {row.total_responses} response
                              {row.total_responses === 1 ? "" : "s"}
                            </span>
                            <span>avg stance {avg}</span>
                            <span>
                              updated {formatDateTime(row.updated_at)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {tinyStanceBar(row)}
                          <div className="text-[10px] text-slate-600">
                            {Math.round(row.pct_agree ?? 0)}% agree ·{" "}
                            {Math.round(row.pct_disagree ?? 0)}% disagree
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Right: regions panel */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-4">
            <RegionsPanel
              questionId={selectedQuestionId}
              questionText={selectedQuestionText}
            />
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
