// src/pages/QuestionDetailPage.tsx — Question detail with stance capture + regional comparison + related questions
// EPIC C INTEGRATION: Added view tracking and interaction tracking

import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { QuestionCommentsPanel } from "@/components/question/QuestionCommentsPanel";
import { useQuestionView } from "@/hooks/useQuestionView";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge"; // ✨ NEW IMPORT
import { useToast } from "@/components/ui/use-toast";

// ✅ Inline Topic follow affordance
import { FollowTopicButton } from "@/components/FollowTopicButton";

type Session = import("@supabase/supabase-js").Session;

type LiveQuestion = {
  id: string;
  topic_id?: string; // Added for interaction tracking
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
  phase?: string; // ✨ NEW: Phase field for question lifecycle
};

type TopicLite = {
  id: string;
  title: string;
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
// NEW (CORRECT - get topic_id from questions table instead):
async function fetchQuestionById(id: string): Promise<LiveQuestion | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  // Get from questions table directly to get topic_id
  const { data, error } = await sb
    .from("questions") // ✅ Changed from v_live_questions to questions
    .select(
      "id, topic_id, question, summary, tags, location_label, published_at, status, phase"
    )
    .eq("id", id)
    .eq("status", "active") // ✅ Add status filter to match v_live_questions behavior
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

async function fetchTopicLite(topicId: string): Promise<TopicLite | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("topics")
    .select("id, title")
    .eq("id", topicId)
    .maybeSingle<TopicLite>();

  if (error) {
    console.error("Failed to load topic title", error);
    return null;
  }

  return data ?? null;
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
    .select("id, question, summary, tags, location_label, published_at, status")
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

// ---------- EPIC C: Track answered questions (CORRECTED) ----------
async function trackQuestionInteraction(
  userId: string,
  questionId: string, // ✨ ADDED for phase tracking
  topicId: string | undefined,
  answered: boolean
): Promise<void> {
  const sb = getSupabase();
  if (!sb || !topicId) return;

  try {
    // ✨ EPIC C PHASE-AWARE: Call RPC to track phase when user answers
    if (answered) {
      const { error: rpcError } = await sb.rpc("record_question_answer", {
        p_user_id: userId,
        p_question_id: questionId,
      });

      if (rpcError) {
        console.error(
          "Failed to record question answer (phase tracking):",
          rpcError
        );
        // Don't throw - continue with fallback
      }
    }

    // Fallback: Also update user_topic_interactions directly
    await sb.from("user_topic_interactions").upsert(
      {
        user_id: userId,
        topic_id: topicId,
        last_interacted_at: new Date().toISOString(),
        answered: answered,
      },
      {
        onConflict: "user_id,topic_id", // Unique constraint on these two columns
      }
    );
  } catch (error) {
    console.error("Failed to track question interaction:", error);
  }
}

// ---------- Component helpers ----------
function RegionComparison({ stats }: { stats: QuestionStats | null }) {
  if (!stats?.regions) return null;

  const { regions, location } = stats;
  if (!regions) return null;

  const scopeLabels: Array<{
    scope: "city" | "county" | "state" | "country" | "global";
    label: string;
  }> = [];

  if (location?.city && regions.city)
    scopeLabels.push({ scope: "city", label: location.city });
  if (location?.county && regions.county)
    scopeLabels.push({ scope: "county", label: location.county });
  if (location?.state && regions.state)
    scopeLabels.push({ scope: "state", label: location.state });
  if (location?.country && regions.country)
    scopeLabels.push({ scope: "country", label: location.country });
  if (regions.global)
    scopeLabels.push({ scope: "global", label: "Global" });

  if (scopeLabels.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      <h3 className="text-xs font-medium text-slate-700">
        Compare by region
      </h3>
      <div className="space-y-1.5">
        {scopeLabels.map(({ scope, label }) => {
          const r = regions[scope];
          if (!r) return null;

          return (
            <div
              key={scope}
              className="flex items-center justify-between text-xs border rounded p-2 bg-slate-50"
            >
              <span className="text-slate-700 font-medium">{label}</span>
              <div className="text-slate-600 space-x-2">
                {r.pct_agree != null && (
                  <span>{Math.round(r.pct_agree)}% agree</span>
                )}
                {r.pct_disagree != null && (
                  <span>· {Math.round(r.pct_disagree)}% disagree</span>
                )}
                <span className="text-[10px] text-slate-500">
                  ({r.total_responses})
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Main component ----------
export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const questionId = id ?? "";

  const session = useSupabaseSession();
  const userId = session?.user?.id ?? null;
  const isAuthed = !!session;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // EPIC C: Track question view
  useQuestionView(questionId);

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

  const { data: topicLite } = useQuery({
    enabled: !!question?.topic_id,
    queryKey: ["question-topic-lite", question?.topic_id ?? ""],
    queryFn: () => fetchTopicLite(question?.topic_id as string),
    staleTime: 5 * 60_000,
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
    onSuccess: async (newScore, vars) => {
      // Keep local cache fresh
      queryClient.setQueryData(["my-stance", questionId], newScore);
      queryClient.invalidateQueries({
        queryKey: ["question-stats", questionId],
      });

      // EPIC C: Track interaction when user answers
      if (userId && question?.topic_id) {
        const answered = newScore !== null;
        await trackQuestionInteraction(
          userId,
          questionId,
          question.topic_id,
          answered
        );

        // Invalidate personalized feed so this question doesn't reappear
        if (answered) {
          queryClient.invalidateQueries({ queryKey: ["personalized-feed"] });
        }
      }

      const score = typeof vars === "number" || vars === null ? vars : newScore;
      const label =
        score == null
          ? null
          : STANCE_SCALE.find((s) => s.value === score)?.labelShort ??
            `Score ${score}`;

      toast({
        title: score == null ? "Stance cleared" : "Stance saved",
        description:
          score == null
            ? "Your stance was removed from this question."
            : `Your stance is now: ${label}.`,
        duration: 2200,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description:
          err?.message ?? "Failed to save your stance. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSetStance = React.useCallback(
    (newVal: number) => {
      stanceMutation.mutate(newVal);
    },
    [stanceMutation]
  );

  const handleRequireLogin = React.useCallback(() => {
    const returnTo = window.location.hash || "#/";
    sessionStorage.setItem("return_to", returnTo);
    navigate("/login");
  }, [navigate]);

  const handleBack = React.useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const hasStats = !!stats?.regions;
  const globalStats = stats?.regions?.global ?? null;
  const hasRelated = !!relatedQuestions && relatedQuestions.length > 0;

  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <div className="rounded border bg-white px-4 py-6">
        <p className="text-sm text-slate-500">Loading question...</p>
      </div>
    );
  } else if (isError) {
    content = (
      <div className="rounded border border-red-200 bg-red-50 px-4 py-6">
        <p className="text-sm text-red-900">
          Failed to load question:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  } else if (!question) {
    content = (
      <div className="rounded border bg-white px-4 py-6">
        <p className="text-sm text-slate-500">
          Question not found or no longer active.
        </p>
      </div>
    );
  } else {
    content = (
      <article className="rounded border bg-white px-4 py-6 space-y-3">
        {/* Meta info */}
        <header className="space-y-1">
          {question.published_at && (
            <time
              className="block text-[11px] text-slate-500 uppercase tracking-wide"
              dateTime={question.published_at}
            >
              {new Date(question.published_at).toLocaleDateString(undefined, {
                dateStyle: "long",
              })}
            </time>
          )}
          {question.location_label && (
            <div className="text-[11px] text-slate-600">
              📍 {question.location_label}
            </div>
          )}

          {/* Topic link + small inline Follow affordance */}
          {question.topic_id && (
            <div className="flex items-center gap-2 pt-1">
              <Link
                to={`/topics/${question.topic_id}`}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-slate-50 text-slate-700 hover:border-slate-900/60 hover:bg-white transition"
                title="View topic"
              >
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  Topic
                </span>
                <span className="font-medium">
                  {topicLite?.title ?? "View topic"}
                </span>
              </Link>

              <div className="scale-90 origin-left">
                <FollowTopicButton topicId={question.topic_id} />
              </div>
            </div>
          )}
        </header>

        {/* Question text */}
        <section className="space-y-3">
          {/* ✨ NEW: Phase Badge */}
          {question.phase && question.phase !== "initial" && (
            <div>
              <QuestionPhaseBadge phase={question.phase} size="md" />
            </div>
          )}

          <h1 className="text-xl font-bold text-slate-900">
            {question.question}
          </h1>
          {question.summary && (
            <p className="mt-2 text-sm text-slate-700">{question.summary}</p>
          )}
        </section>

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
                  Average stance: {globalStats.avg_score.toFixed(2)} (scale -2
                  to +2)
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
                    {STANCE_SCALE.find((s) => s.value === myStance)?.label}.
                  </span>
                )}
                {isAuthed && myStance != null && !stanceMutation.isPending && (
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
