// src/pages/MyStancesPage.tsx
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
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
type FilterBy =
  | "all"
  | "sa"
  | "a"
  | "n"
  | "d"
  | "sd"
  | "strong"; // strong = ±2

const STANCE_LABELS: Record<
  number,
  { label: string; short: string; tone: "pos" | "neg" | "neu" }
> = {
  [-2]: { label: "Strongly disagree", short: "Strongly disagree", tone: "neg" },
  [-1]: { label: "Disagree", short: "Disagree", tone: "neg" },
  [0]: { label: "Neutral", short: "Neutral", tone: "neu" },
  [1]: { label: "Agree", short: "Agree", tone: "pos" },
  [2]: { label: "Strongly agree", short: "Strongly agree", tone: "pos" },
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

// ---------- Data fetcher ----------
async function fetchMyStances(userId: string): Promise<MyStanceRow[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  // 1) Fetch stances for this user
  const { data: stances, error: stanceError } = await sb
    .from("question_stances")
    .select("id, question_id, score, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (stanceError) {
    console.error("Failed to load question_stances", stanceError);
    throw stanceError;
  }

  if (!stances || stances.length === 0) return [];

  const rows = stances as QuestionStanceRow[];

  // 2) Fetch questions for those stances from v_live_questions
  const questionIds = Array.from(
    new Set(rows.map((r) => r.question_id).filter(Boolean))
  );

  if (questionIds.length === 0) {
    return rows.map((r) => ({
      stance_id: r.id,
      question_id: r.question_id,
      score: r.score,
      created_at: r.created_at,
      updated_at: r.updated_at,
      question: null,
    }));
  }

  const { data: questions, error: questionError } = await sb
    .from("v_live_questions")
    .select(
      "id, question, summary, tags, location_label, published_at, status"
    )
    .in("id", questionIds);

  if (questionError) {
    console.error("Failed to load questions for stances", questionError);
    // Still return stances, just without question details
    return rows.map((r) => ({
      stance_id: r.id,
      question_id: r.question_id,
      score: r.score,
      created_at: r.created_at,
      updated_at: r.updated_at,
      question: null,
    }));
  }

  const questionMap = new Map<string, LiveQuestion>();
  (questions ?? []).forEach((q) => {
    questionMap.set((q as LiveQuestion).id, q as LiveQuestion);
  });

  return rows.map((r) => ({
    stance_id: r.id,
    question_id: r.question_id,
    score: r.score,
    created_at: r.created_at,
    updated_at: r.updated_at,
    question: questionMap.get(r.question_id) ?? null,
  }));
}

// ---------- Page ----------
export default function MyStancesPage() {
  const session = useSupabaseSession();
  const navigate = useNavigate();
  const isAuthed = !!session;
  const userId = session?.user?.id ?? null;

  const [sortBy, setSortBy] = React.useState<SortBy>("recent");
  const [filterBy, setFilterBy] = React.useState<FilterBy>("all");

  const {
    data: rawRows,
    isLoading,
    isError,
    error,
  } = useQuery<MyStanceRow[], Error>({
    enabled: !!userId,
    queryKey: ["my-stances", userId],
    queryFn: () => fetchMyStances(userId!),
    staleTime: 60_000,
  });

  const rows = rawRows ?? [];

  const filteredAndSorted = React.useMemo(() => {
    let working = [...rows];

    // Filter
    working = working.filter((row) => {
      const s = row.score;
      switch (filterBy) {
        case "all":
          return true;
        case "sa":
          return s === 2;
        case "a":
          return s === 1;
        case "n":
          return s === 0;
        case "d":
          return s === -1;
        case "sd":
          return s === -2;
        case "strong":
          return Math.abs(s) === 2;
        default:
          return true;
      }
    });

    // Sort
    working.sort((a, b) => {
      const dateA = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      const dateB = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      if (sortBy === "recent") {
        return dateB - dateA;
      } else if (sortBy === "oldest") {
        return dateA - dateB;
      } else if (sortBy === "strongest") {
        const magA = Math.abs(a.score);
        const magB = Math.abs(b.score);
        if (magB !== magA) {
          return magB - magA;
        }
        // tie-breaker: most recent
        return dateB - dateA;
      }
      return 0;
    });

    return working;
  }, [rows, sortBy, filterBy]);

  const totalCount = rows.length;
  const visibleCount = filteredAndSorted.length;

  if (!isAuthed || !userId) {
    // /me/stances should already be behind <Protected>, but just in case
    return (
      <PageLayout>
        <div className="max-w-3xl mx-auto py-4">
          <div className="rounded-lg border p-4 text-sm text-slate-700">
            <div className="font-medium mb-1">Sign in required</div>
            <p className="mb-2">
              You need to be logged in to see and manage your stances.
            </p>
            <button
              type="button"
              className="rounded bg-slate-900 text-white px-3 py-1.5 text-xs"
              onClick={() => navigate("/login")}
            >
              Log in
            </button>
          </div>
        </div>
      </PageLayout>
    );
  }

  const displayName = (() => {
    const user = session.user;
    const fullName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined);
    if (fullName) return fullName.split(" ")[0];
    const email = user.email ?? "";
    if (!email) return "you";
    return email.split("@")[0];
  })();

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              My stances
            </h1>
            <p className="text-xs text-slate-600">
              See where {displayName} stands, and revisit questions you&apos;ve
              already answered.
            </p>
          </div>
          <Link
            to="/"
            className="text-xs text-slate-600 hover:underline"
          >
            ← Back to homepage
          </Link>
        </div>

        {/* Controls */}
        <section className="rounded-lg border p-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs text-slate-700">
              Showing{" "}
              <span className="font-medium">
                {visibleCount} of {totalCount}
              </span>{" "}
              stances
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Sort */}
              <label className="flex items-center gap-1 text-[11px] text-slate-600">
                <span>Sort by</span>
                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(e.target.value as SortBy)
                  }
                  className="rounded border px-2 py-1 text-[11px]"
                >
                  <option value="recent">Most recent</option>
                  <option value="oldest">Oldest first</option>
                  <option value="strongest">Strongest opinions</option>
                </select>
              </label>

              {/* Filter */}
              <label className="flex items-center gap-1 text-[11px] text-slate-600">
                <span>Filter</span>
                <select
                  value={filterBy}
                  onChange={(e) =>
                    setFilterBy(e.target.value as FilterBy)
                  }
                  className="rounded border px-2 py-1 text-[11px]"
                >
                  <option value="all">All stances</option>
                  <option value="sa">Strongly agree</option>
                  <option value="a">Agree</option>
                  <option value="n">Neutral</option>
                  <option value="d">Disagree</option>
                  <option value="sd">Strongly disagree</option>
                  <option value="strong">Strong only (±2)</option>
                </select>
              </label>
            </div>
          </div>

          {isLoading && (
            <p className="text-xs text-slate-500">
              Loading your stances…
            </p>
          )}
          {isError && !isLoading && (
            <p className="text-xs text-red-600">
              Failed to load your stances:{" "}
              {(error as Error)?.message ?? "Unknown error"}
            </p>
          )}
          {!isLoading && !isError && totalCount === 0 && (
            <p className="text-xs text-slate-500">
              You haven&apos;t taken a stance on any question yet. Visit the
              homepage to get started.
            </p>
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

// ---------- Card component ----------
function MyStanceCard({ row }: { row: MyStanceRow }) {
  const q = row.question;
  const updatedAt = row.updated_at ?? row.created_at;
  const dateLabel = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unknown";

  const stanceDef = STANCE_LABELS[row.score] ?? {
    label: "Unknown",
    short: String(row.score),
    tone: "neu" as const,
  };

  const stanceToneClass =
    stanceDef.tone === "pos"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : stanceDef.tone === "neg"
      ? "bg-rose-50 border-rose-200 text-rose-800"
      : "bg-slate-50 border-slate-200 text-slate-800";

  return (
    <article className="rounded-lg border px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {q ? (
              <Link
                to={`/q/${q.id}`}
                className="text-sm font-semibold text-slate-900 hover:underline"
              >
                {q.question}
              </Link>
            ) : (
              <div className="text-sm font-semibold text-slate-900">
                [Question unavailable]
              </div>
            )}
          </div>
          {q?.summary && (
            <p className="text-xs text-slate-600 line-clamp-2">
              {q.summary}
            </p>
          )}
          {q?.tags && q.tags.length > 0 && (
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
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${stanceToneClass}`}
          >
            {stanceDef.label}
          </span>
          {q?.location_label && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 bg-slate-50">
              {q.location_label}
            </span>
          )}
          {q?.published_at && (
            <span className="text-[10px] text-slate-500">
              Question:{" "}
              {new Date(q.published_at).toLocaleDateString(undefined, {
                dateStyle: "medium",
              })}
            </span>
          )}
          <span className="text-[10px] text-slate-500">
            Updated: {dateLabel}
          </span>
        </div>
      </div>
    </article>
  );
}
