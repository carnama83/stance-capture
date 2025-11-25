// src/pages/QuestionDetailPage.tsx — Question detail with stance capture + stats + related questions
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
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

type QuestionStance = {
  id: string;
  question_id: string;
  score: number;
};

type QuestionStats = {
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
};

const STANCE_SCALE = [
  { value: -2, labelShort: "Strongly disagree", label: "Strongly disagree" },
  { value: -1, labelShort: "Disagree", label: "Disagree" },
  { value: 0, labelShort: "Neutral", label: "Neutral" },
  { value: 1, labelShort: "Agree", label: "Agree" },
  { value: 2, labelShort: "Strongly agree", label: "Strongly agree" },
];

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

// ---------- Data fetchers ----------
async function fetchQuestionById(id: string): Promise<LiveQuestion | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("v_live_questions")
    .select(
      "id, question, summary, tags, location_label, published_at, status"
    )
    .eq("id", id)
    .limit(1);

  if (error) {
    console.error("Failed to load question detail", error);
    throw error;
  }

  const row = (data ?? [])[0] as LiveQuestion | undefined;
  if (!row) return null;

  if (row.status && row.status !== "active") {
    return null;
  }

  return row;
}

async function fetchMyStance(questionId: string): Promise<number | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("question_stances")
    .select("id, question_id, score")
    .eq("question_id", questionId)
    .maybeSingle<QuestionStance>();

  if (error) {
    if ((error as any).code === "PGRST116") {
      // no row
      return null;
    }
    console.error("Failed to load stance", error);
    throw error;
  }

  return data ? data.score : null;
}

async function setMyStance(
  questionId: string,
  score: number | null
): Promise<number | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb.rpc("set_question_stance", {
    p_question_id: questionId,
    p_score: score,
  });

  if (error) {
    console.error("Failed to set stance", error);
    throw error;
  }

  const row = data as QuestionStance | null;
  return row ? row.score : null;
}

async function fetchQuestionStats(
  questionId: string
): Promise<QuestionStats | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("question_stance_stats")
    .select(
      "total_responses, pct_agree, pct_disagree, pct_neutral, avg_score"
    )
    .eq("question_id", questionId)
    .maybeSingle<QuestionStats>();

  if (error) {
    if ((error as any).code === "PGRST116") {
      return null;
    }
    console.error("Failed to load question stats", error);
    throw error;
  }

  if (!data) return null;
  return {
    total_responses: data.total_responses ?? 0,
    pct_agree: data.pct_agree,
    pct_disagree: data.pct_disagree,
    pct_neutral: data.pct_neutral,
    avg_score: data.avg_score,
  };
}

// NEW: fetch related questions by shared tags, biased to same location
async function fetchRelatedQuestions(
  questionId: string,
  tags: string[],
  locationLabel: string | null,
  limit = 4
): Promise<LiveQuestion[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  if (!tags.length) return [];

  let q = sb
    .from("v_live_questions")
    .select(
      "id, question, summary, tags, location_label, published_at, status"
    )
    .neq("id", questionId)
    .eq("status", "active")
    .overlaps("tags", tags);

  // Prefer questions in the same location when we have a label
  if (locationLabel && locationLabel.trim()) {
    q = q.eq("location_label", locationLabel.trim());
  }

  const { data, error } = await q
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to load related questions", error);
    return [];
  }

  return (data ?? []) as LiveQuestion[];
}

// ---------- Page ----------
export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const queryClient = useQueryClient();
  const isAuthed = !!session;
  const questionId = id as string;

  const {
    data: question,
    isLoading,
    isError,
    error,
  } = useQuery({
    enabled: !!questionId,
    queryKey: ["question-detail", questionId],
    queryFn: () => fetchQuestionById(questionId),
    staleTime: 60_000,
  });

  const {
    data: myStance,
    isLoading: stanceLoading,
  } = useQuery({
    enabled: !!questionId && isAuthed,
    queryKey: ["my-stance", questionId],
    queryFn: () => fetchMyStance(questionId),
    staleTime: 60_000,
  });

  const {
    data: stats,
    isLoading: statsLoading,
  } = useQuery({
    enabled: !!questionId,
    queryKey: ["question-stats", questionId],
    queryFn: () => fetchQuestionStats(questionId),
    staleTime: 60_000,
  });

  // NEW: related questions query (depends on question + tags + location_label)
  const {
    data: relatedQuestions,
    isLoading: relatedLoading,
  } = useQuery({
    enabled:
      !!questionId &&
      !!question &&
      !!question.tags &&
      question.tags.length > 0,
    queryKey: [
      "related-questions",
      questionId,
      question?.tags ?? [],
      question?.location_label ?? null,
    ],
    queryFn: () =>
      fetchRelatedQuestions(
        questionId,
        (question?.tags as string[]) ?? [],
        (question?.location_label as string | null) ?? null
      ),
    staleTime: 60_000,
  });

  const stanceMutation = useMutation({
    mutationKey: ["set-stance", questionId],
    mutationFn: (score: number | null) => setMyStance(questionId, score),
    onSuccess: (newScore) => {
      queryClient.setQueryData(["my-stance", questionId], newScore);
      queryClient.invalidateQueries({
        queryKey: ["question-stats", questionId],
      });
    },
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const handleRequireLogin = () => {
    const returnTo = window.location.hash || `#/q/${questionId}`;
    sessionStorage.setItem("return_to", returnTo);
    navigate("/login");
  };

  const handleSetStance = (value: number) => {
    if (!isAuthed) {
      handleRequireLogin();
      return;
    }
    const current = myStance ?? null;
    const next = current === value ? null : value; // click again to clear
    stanceMutation.mutate(next);
  };

  // ---------- Render ----------
  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <div className="rounded-lg border p-4 animate-pulse space-y-3">
        <div className="h-5 w-3/4 bg-slate-200 rounded" />
        <div className="h-4 w-full bg-slate-200 rounded" />
        <div className="h-4 w-2/3 bg-slate-200 rounded" />
        <div className="flex gap-2 mt-2">
          <div className="h-5 w-16 bg-slate-200 rounded-full" />
          <div className="h-5 w-20 bg-slate-200 rounded-full" />
        </div>
      </div>
    );
  } else if (isError) {
    content = (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <div className="font-medium mb-1">Something went wrong</div>
        <div>
          {(error as Error)?.message ??
            "We couldn’t load this question. Please try again."}
        </div>
      </div>
    );
  } else if (!question) {
    content = (
      <div className="rounded-lg border p-4 text-sm text-slate-700">
        <div className="font-medium mb-1">Question not found</div>
        <p className="mb-2">
          This question may have been removed or is no longer live.
        </p>
        <Link to="/" className="text-slate-900 underline text-sm">
          ← Back to homepage
        </Link>
      </div>
    );
  } else {
    const hasStats =
      stats &&
      stats.total_responses > 0 &&
      (stats.pct_agree != null || stats.pct_disagree != null);

    const hasRelated =
      relatedQuestions && relatedQuestions.length > 0;

    content = (
      <article className="rounded-lg border p-4 space-y-4">
        {/* Header: question + meta */}
        <header className="space-y-2">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
            {question.question}
          </h1>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {question.location_label && (
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 bg-slate-50">
                {question.location_label}
              </span>
            )}
            {question.published_at && (
              <span>
                Published{" "}
                {new Date(question.published_at).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            )}
            {question.status && (
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 bg-emerald-50 text-emerald-700">
                {question.status === "active" ? "Live" : question.status}
              </span>
            )}
          </div>
        </header>

        {/* Summary */}
        {question.summary && (
          <section>
            <h2 className="text-sm font-medium text-slate-900 mb-1">
              Why this matters
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              {question.summary}
            </p>
          </section>
        )}

        {/* Tags */}
        {question.tags && question.tags.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Tags
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {question.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Community stance */}
        <section className="border-t pt-4 mt-2">
          <h2 className="text-sm font-medium text-slate-900 mb-2">
            Community stance
          </h2>
          {statsLoading && (
            <p className="text-xs text-slate-500">Loading community stats…</p>
          )}
          {!statsLoading && !hasStats && (
            <p className="text-xs text-slate-500">
              No responses yet. Be the first to take a stance.
            </p>
          )}
          {hasStats && stats && (
            <div className="space-y-2 text-xs text-slate-700">
              <div>
                <span className="font-medium">
                  {stats.total_responses} responses
                </span>
                {stats.pct_agree != null && (
                  <> · {Math.round(stats.pct_agree)}% agree</>
                )}
                {stats.pct_disagree != null && (
                  <> · {Math.round(stats.pct_disagree)}% disagree</>
                )}
                {stats.pct_neutral != null && (
                  <> · {Math.round(stats.pct_neutral)}% neutral</>
                )}
              </div>
              {stats.avg_score != null && (
                <div className="text-[11px] text-slate-500">
                  Average stance: {stats.avg_score.toFixed(2)} (scale -2 to +2)
                </div>
              )}
            </div>
          )}
        </section>

        {/* Your stance */}
        <section className="border-t pt-4 mt-2">
          <h2 className="text-sm font-medium text-slate-900 mb-2">
            Your stance
          </h2>

          {!isAuthed && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600">
                Log in to record your stance and compare with your city, state,
                country, and globally.
              </p>
              <button
                type="button"
                onClick={handleRequireLogin}
                className="rounded bg-slate-900 text-white px-3 py-1.5 text-xs"
              >
                Log in to take stance
              </button>
            </div>
          )}

          {isAuthed && (
            <>
              <div className="flex flex-wrap gap-2 mb-2">
                {STANCE_SCALE.map((s) => {
                  const selected = myStance === s.value;
                  const busy = stanceMutation.isPending;
                  const base =
                    "rounded-full border px-3 py-1.5 text-xs transition";
                  const selectedClasses =
                    "bg-slate-900 border-slate-900 text-white";
                  const unselectedClasses =
                    "bg-white border-slate-300 text-slate-700 hover:bg-slate-50";
                  return (
                    <button
                      key={s.value}
                      type="button"
                      disabled={busy}
                      onClick={() => handleSetStance(s.value)}
                      className={`${base} ${
                        selected ? selectedClasses : unselectedClasses
                      }`}
                    >
                      {s.labelShort}
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-2">
                {stanceLoading ? (
                  <span>Loading your stance…</span>
                ) : stanceMutation.isPending ? (
                  <span>Saving…</span>
                ) : myStance === null || myStance === undefined ? (
                  <span>No stance recorded yet.</span>
                ) : (
                  <span>
                    Saved as{" "}
                    {
                      STANCE_SCALE.find((s) => s.value === myStance)
                        ?.label
                    }
                    .
                  </span>
                )}
                {isAuthed && myStance != null && !stanceMutation.isPending && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => handleSetStance(myStance)}
                  >
                    Clear
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        {/* Related questions */}
        <section className="border-t pt-4 mt-2">
          <h2 className="text-sm font-medium text-slate-900 mb-2">
            {question.location_label
              ? `Related questions in ${question.location_label}`
              : "Related questions"}
          </h2>
          {relatedLoading && (
            <p className="text-xs text-slate-500">
              Loading related questions…
            </p>
          )}
          {!relatedLoading && !hasRelated && (
            <p className="text-xs text-slate-500">
              No related questions yet.
            </p>
          )}
          {hasRelated && relatedQuestions && (
            <div className="space-y-2">
              {relatedQuestions.map((rq) => (
                <div
                  key={rq.id}
                  className="flex items-start justify-between gap-3 text-xs"
                >
                  <div>
                    <Link
                      to={`/q/${rq.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {rq.question}
                    </Link>
                    {rq.summary && (
                      <p className="text-slate-600 line-clamp-2">
                        {rq.summary}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {rq.location_label && (
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                        {rq.location_label}
                      </span>
                    )}
                    {rq.published_at && (
                      <span className="text-[10px] text-slate-500">
                        {new Date(rq.published_at).toLocaleDateString(
                          undefined,
                          { dateStyle: "medium" }
                        )}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Back link */}
        <footer className="pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="text-sm text-slate-900 underline"
          >
            ← Back
          </button>
        </footer>
      </article>
    );
  }

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto py-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold text-slate-900">
            Question detail
          </h1>
          <Link to="/" className="text-xs text-slate-600 hover:underline">
            ← Back to homepage
          </Link>
        </div>
        {content}
      </div>
    </PageLayout>
  );
}
