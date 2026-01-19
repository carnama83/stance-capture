// src/pages/QuestionDetailPage.tsx — Question detail with stance capture + regional comparison + related questions
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { QuestionCommentsPanel } from "@/components/question/QuestionCommentsPanel";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";

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

type RegionalStat = {
  region_scope: "city" | "county" | "state" | "country" | "global" | string;
  region_label: string;
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
};

type QuestionStats = {
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

type ThreadSentimentRow = {
  question_id: string;
  avg_sentiment: number | null;
  sentiment_variance: number | null;
  comment_count: number;
  summary_text: string | null;
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

  const { data, error } = await sb.rpc("get_question_stats_for_user", {
    p_question_id: questionId,
  });

  if (error) {
    console.error("Failed to load question stats (RPC)", error);
    return null;
  }

  if (!data) return null;

  const raw = data as any;
  const regions = (raw.regions ?? {}) as QuestionStats["regions"];

  return {
    my_stance: typeof raw.my_stance === "number" ? raw.my_stance : null,
    location: raw.location ?? null,
    regions,
  };
}

async function fetchMyRegion(userId: string): Promise<RegionRow | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("user_region_dimensions")
    .select("user_id, city_label, county_label, state_label, country_label")
    .eq("user_id", userId)
    .maybeSingle<RegionRow>();

  if (error) {
    console.error("Failed to load user region dimensions", error);
    return null;
  }

  return data ?? null;
}

// fetch related questions by shared tags, biased to same location
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

async function fetchThreadSentiment(
  questionId: string
): Promise<ThreadSentimentRow | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("question_comment_sentiment")
    .select(
      "question_id, avg_sentiment, sentiment_variance, comment_count, summary_text"
    )
    .eq("question_id", questionId)
    .maybeSingle<ThreadSentimentRow>();

  if (error) {
    console.error("Failed to load thread sentiment", error);
    return null;
  }

  return data ?? null;
}

// ---------- Region comparison widget ----------
function RegionComparison({ stats }: { stats: QuestionStats | null }) {
  if (!stats || !stats.regions) return null;

  const tiers: Array<"city" | "county" | "state" | "country" | "global"> = [
    "city",
    "county",
    "state",
    "country",
    "global",
  ];

  const hasAny = tiers.some(
    (scope) => (stats.regions && stats.regions[scope]) != null
  );
  if (!hasAny) {
    return (
      <div className="mt-3 border-t pt-3">
        <h3 className="text-xs font-medium text-slate-900 mb-1">
          In your region
        </h3>
        <p className="text-[11px] text-slate-500">
          We don&apos;t have enough responses in your region yet.
        </p>
      </div>
    );
  }

  const loc = stats.location;

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-medium text-slate-900">
          In your region
        </h3>
        <span className="text-[10px] text-slate-500">
          Bar shows % disagree · neutral · agree
        </span>
      </div>
      <div className="space-y-1.5">
        {tiers.map((scope) => {
          const row = stats.regions?.[scope] ?? null;
          if (!row || row.total_responses === 0) return null;

          const label = scope === "global" ? "Global" : row.region_label;

          const isMine =
            (scope === "city" && loc?.city === row.region_label) ||
            (scope === "county" && loc?.county === row.region_label) ||
            (scope === "state" && loc?.state === row.region_label) ||
            (scope === "country" && loc?.country === row.region_label) ||
            scope === "global";

          const agree = Math.max(0, row.pct_agree ?? 0);
          const disagree = Math.max(0, row.pct_disagree ?? 0);
          const neutral = Math.max(0, row.pct_neutral ?? 0);

          const totalPct = agree + disagree + neutral || 1;
          const agreePct = (agree / totalPct) * 100;
          const disagreePct = (disagree / totalPct) * 100;
          const neutralPct = (neutral / totalPct) * 100;

          return (
            <div
              key={scope}
              className={`flex items-center justify-between gap-2 text-[11px] ${
                isMine ? "font-medium text-slate-900" : "text-slate-700"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate max-w-[120px]">
                  {label}
                  {isMine && scope !== "global" && (
                    <span className="ml-1 text-[10px] text-emerald-600">
                      (you)
                    </span>
                  )}
                </span>
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
              <div className="flex items-center gap-1 shrink-0">
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
export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const queryClient = useQueryClient();
  const isAuthed = !!session;
  const userId = session?.user?.id ?? null;
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

  const {
    data: myRegion,
    isLoading: myRegionLoading,
  } = useQuery({
    enabled: !!userId,
    queryKey: ["my-region", userId],
    queryFn: () => fetchMyRegion(userId!),
    staleTime: 60_000,
  });

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

  const {
    data: threadSentiment,
    isLoading: threadSentimentLoading,
  } = useQuery({
    enabled: !!questionId,
    queryKey: ["question-thread-sentiment", questionId],
    queryFn: () => fetchThreadSentiment(questionId),
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

  // For slider: always set stance to chosen value (no toggle). Use separate "Clear" button to remove stance.
  const handleSetStance = (value: number) => {
    if (!isAuthed) {
      handleRequireLogin();
      return;
    }
    stanceMutation.mutate(value);
  };

  const showLocationNudge =
    isAuthed &&
    !myRegionLoading &&
    myRegion &&
    !myRegion.city_label &&
    !myRegion.state_label &&
    !myRegion.country_label &&
    !myRegion.county_label;

  const globalStats: RegionalStat | null = stats?.regions?.global ?? null;

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
      !!globalStats &&
      globalStats.total_responses > 0 &&
      (globalStats.pct_agree != null || globalStats.pct_disagree != null);

    const hasRelated = relatedQuestions && relatedQuestions.length > 0;

    content = (
      <article className="rounded-lg border p-4 space-y-4">
        {/* Header */}
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
                {new Date(question.published_at).toLocaleString(
                  undefined,
                  {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }
                )}
              </span>
            )}
            {question.status && (
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 bg-emerald-50 text-emerald-700">
                {question.status === "active"
                  ? "Live"
                  : question.status}
              </span>
            )}
          </div>
        </header>

        {/* Location nudge */}
        {showLocationNudge && (
          <section className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-700">
              Set your location to see how people in your region think
              about this question.
            </span>
            <Link
              to="/settings/location"
              className="inline-flex items-center rounded bg-slate-900 text-white px-2 py-1 text-[11px]"
            >
              Set location
            </Link>
          </section>
        )}

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
            <p className="text-xs text-slate-500">
              Loading community stats…
            </p>
          )}
          {!statsLoading && !hasStats && (
            <p className="text-xs text-slate-500">
              No responses yet. Be the first to take a stance.
            </p>
          )}
          {hasStats && globalStats && (
            <div className="space-y-2 text-xs text-slate-700">
              <div>
                <span className="font-medium">
                  {globalStats.total_responses} responses
                </span>
                {globalStats.pct_agree != null && (
                  <> · {Math.round(globalStats.pct_agree)}% agree</>
                )}
                {globalStats.pct_disagree != null && (
                  <> · {Math.round(globalStats.pct_disagree)}% disagree</>
                )}
                {globalStats.pct_neutral != null && (
                  <> · {Math.round(globalStats.pct_neutral)}% neutral</>
                )}
              </div>
              {globalStats.avg_score != null && (
                <div className="text-[11px] text-slate-500">
                  Average stance: {globalStats.avg_score.toFixed(2)} (scale
                  -2 to +2)
                </div>
              )}
            </div>
          )}

          {/* Regional comparison (mini-heatmap) for logged-in user */}
          {isAuthed && <RegionComparison stats={stats ?? null} />}
        </section>

        {/* Discussion mood / AI summary */}
        {threadSentimentLoading && !threadSentiment && (
          <section className="border-t pt-4 mt-2">
            <p className="text-xs text-slate-500">
              Analyzing discussion sentiment…
            </p>
          </section>
        )}
        {threadSentiment && (
          <section className="border-t pt-4 mt-2">
            <h2 className="text-sm font-medium text-slate-900 mb-1">
              Discussion mood
            </h2>
            <p className="text-xs text-slate-600">
              {threadSentiment.comment_count ?? 0} comment
              {threadSentiment.comment_count === 1 ? "" : "s"}
              {typeof threadSentiment.avg_sentiment === "number" &&
                ` · avg sentiment ${threadSentiment.avg_sentiment.toFixed(
                  2
                )} (−1 to +1)`}
            </p>
            {threadSentiment.summary_text && (
              <p className="text-sm text-slate-700 mt-1">
                {threadSentiment.summary_text}
              </p>
            )}
          </section>
        )}

        {/* Your stance */}
        <section className="border-t pt-4 mt-2">
          <h2 className="text-sm font-medium text-slate-900 mb-2">
            Your stance
          </h2>

          {!isAuthed && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600">
                Log in to record your stance and compare with your city,
                state, country, and globally.
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
              {/* Slider-based stance control */}
              <div className="mb-2">
                <QuestionStanceSlider
                  questionId={questionId}
                  questionText={question.question}
                  summary={question.summary ?? null}
                  initialValue={myStance ?? 0}
                  disabled={stanceMutation.isPending}
                  onSubmit={handleSetStance}
                />
              </div>

              {/* Status text + clear button */}
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
                      STANCE_SCALE.find(
                        (s) => s.value === myStance
                      )?.label
                    }
                    .
                  </span>
                )}
                {isAuthed &&
                  myStance != null &&
                  !stanceMutation.isPending && (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => stanceMutation.mutate(null)}
                    >
                      Clear
                    </button>
                  )}
              </div>
            </>
          )}
        </section>

        {/* Discussion / comments */}
        <QuestionCommentsPanel questionId={questionId} />

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
                        {new Date(
                          rq.published_at
                        ).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                        })}
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
