// src/pages/QuestionDetailPage.tsx — Question detail with stance capture + regional comparison + related questions
// EPIC C INTEGRATION: Added view tracking and interaction tracking
// UI REFRESH: Phase 1-6 typography + rhythm + editorial hero image (Plan B)

import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { QuestionCommentsPanel } from "@/components/question/QuestionCommentsPanel";
import { useQuestionView } from "@/hooks/useQuestionView";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge";
import { useToast } from "@/components/ui/use-toast";

// ✅ Inline Topic follow affordance
import { FollowTopicButton } from "@/components/FollowTopicButton";

type Session = import("@supabase/supabase-js").Session;

type LiveQuestion = {
  id: string;
  topic_id?: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
  phase?: string;
  cover_image_url?: string | null;
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
async function fetchQuestionById(id: string): Promise<LiveQuestion | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("questions")
    .select(
      "id, topic_id, question, summary, tags, location_label, published_at, status, phase, cover_image_url"
    )
    .eq("id", id)
    .eq("status", "active")
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

// ---------- EPIC C: Track answered questions ----------
async function trackQuestionInteraction(
  userId: string,
  questionId: string,
  topicId: string | undefined,
  answered: boolean
): Promise<void> {
  const sb = getSupabase();
  if (!sb || !topicId) return;

  try {
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
      }
    }

    await sb.from("user_topic_interactions").upsert(
      {
        user_id: userId,
        topic_id: topicId,
        last_interacted_at: new Date().toISOString(),
        answered: answered,
      },
      {
        onConflict: "user_id,topic_id",
      }
    );
  } catch (error) {
    console.error("Failed to track question interaction:", error);
  }
}

// ---------- Plan B: Editorial hero image (detail page only) ----------
// Two-layer pattern: blurred background fill + sharp object-contain foreground.
// Handles portrait, landscape, square, panoramic, and broken images gracefully.
function EditorialHeroImage({
  imageUrl,
  alt,
  height = 320,
}: {
  imageUrl: string;
  alt: string;
  height?: number;
}) {
  const [broken, setBroken] = React.useState(false);

  if (broken) {
    // Graceful fallback: neutral placeholder
    return (
      <div
        className="w-full rounded-2xl bg-slate-100 flex items-center justify-center"
        style={{ height }}
      >
        <span className="text-[11px] text-slate-400">Image unavailable</span>
      </div>
    );
  }

  return (
    // Container: fixed height, clips the scale-110 blur bleed, preserves border-radius
    <div
      className="relative w-full overflow-hidden rounded-2xl bg-slate-200"
      style={{ height }}
    >
      {/* Layer 1 — blurred background fill.
          Fully opaque so there are zero grey gaps at the sides (letterbox areas).
          scale-110 prevents blur from showing soft edges at the container boundary.
          brightness-75 darkens it slightly so the sharp foreground reads clearly. */}
      <img
        src={imageUrl}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover scale-110 blur-xl brightness-75"
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />

      {/* Subtle gradient overlay — stabilises contrast at bottom edge.
          Kept very light so it doesn't muddy the blurred layer. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent" />

      {/* Layer 2 — sharp foreground.
          object-contain: no cropping, always shows the full image.
          drop-shadow-sm: slight separation from blurred bg, especially for light images.
          NOTE: h-full doesn't resolve from inline style on parent, so we pass
          explicit style height to both the wrapper div and the img. */}
      <div
        className="relative flex w-full items-center justify-center"
        style={{ height }}
      >
        <img
          src={imageUrl}
          alt={alt}
          className="w-full object-contain drop-shadow-sm"
          style={{ height }}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      </div>
    </div>
  );
}

// ---------- RegionComparison ----------
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
  if (regions.global) scopeLabels.push({ scope: "global", label: "Global" });

  if (scopeLabels.length === 0) return null;

  return (
    // Phase 5A: consistent rail heading
    <div className="space-y-2">
      <div className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
        Compare by region
      </div>
      <div className="space-y-1.5">
        {scopeLabels.map(({ scope, label }) => {
          const r = regions[scope];
          if (!r) return null;

          return (
            <div
              key={scope}
              className="flex items-center justify-between text-xs border rounded-lg p-2 bg-slate-50"
            >
              {/* Phase 5B: region label medium, counts slightly darker */}
              <span className="text-slate-700 font-medium">{label}</span>
              <div className="text-slate-600 space-x-2">
                {r.pct_agree != null && (
                  <span className="text-slate-700 font-medium">
                    {Math.round(r.pct_agree)}% agree
                  </span>
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

  const { data: myStance, isLoading: stanceLoading } = useQuery({
    enabled: !!questionId && isAuthed,
    queryKey: ["my-stance", questionId],
    queryFn: () => fetchMyStance(questionId),
    staleTime: 60_000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    enabled: !!questionId,
    queryKey: ["question-stats", questionId],
    queryFn: () => fetchQuestionStats(questionId),
    staleTime: 60_000,
  });

  // myRegion fetched for future use / region dimension availability
  const { data: myRegion } = useQuery({
    enabled: !!userId,
    queryKey: ["my-region", userId],
    queryFn: () => fetchMyRegion(userId!),
    staleTime: 60_000,
  });

  const { data: relatedQuestions, isLoading: relatedLoading } = useQuery({
    enabled:
      !!questionId && !!question && !!question.tags && question.tags.length > 0,
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

  const { data: threadSentiment, isLoading: threadSentimentLoading } = useQuery({
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
      <div className="rounded-2xl border bg-white px-6 py-8">
        <p className="text-sm text-slate-500">Loading question...</p>
      </div>
    );
  } else if (isError) {
    content = (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8">
        <p className="text-sm text-red-900">
          Failed to load question:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  } else if (!question) {
    content = (
      <div className="rounded-2xl border bg-white px-6 py-8">
        <p className="text-sm text-slate-500">
          Question not found or no longer active.
        </p>
      </div>
    );
  } else {
    content = (
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">

        {/* ===================== MAIN COLUMN ===================== */}
        <main className="rounded-2xl border bg-white p-5 md:p-8">

          {/*
           * Phase 6: Editorial container — wraps meta + ribbon + headline + summary only.
           * max-w-[52rem] prevents text from becoming a wall on wide screens.
           * space-y-3 provides the deliberate rhythm between editorial elements.
           * NOT applied to comments/related to avoid component style bleed.
           */}
          <div className="max-w-[52rem] space-y-3">

            {/* Phase 3A: Meta row — small, editorial, non-competing */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
                Question
              </span>
              <span aria-hidden className="text-slate-300">·</span>
              {question.published_at ? (
                <time
                  dateTime={question.published_at}
                  className="text-[12px] text-slate-500"
                >
                  {new Date(question.published_at).toLocaleDateString(
                    undefined,
                    { dateStyle: "long" }
                  )}
                </time>
              ) : (
                <span className="text-[12px] text-slate-500">—</span>
              )}
              <span aria-hidden className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1 text-[12px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {question.location_label ?? "Global"}
              </span>
            </div>

            {/* Phase 3B: Topic ribbon — tight to meta, gap before headline */}
            {question.tags && question.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {/* Primary tag — bold editorial pill */}
                <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold tracking-wide text-white">
                  {question.tags[0]}
                </span>
                {/* Secondary tags */}
                {question.tags.slice(1, 6).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border bg-white px-3 py-1 text-[11px] font-medium text-slate-700"
                  >
                    {tag}
                  </span>
                ))}
                {question.tags.length > 6 && (
                  <span className="text-[11px] text-slate-400">
                    +{question.tags.length - 6} more
                  </span>
                )}
              </div>
            )}

            {/*
             * Phase 1A + 1B: Headline
             * - Negative tracking (-0.02em) tightens news-style display type
             * - leading-[1.1] / leading-[1.08] is tighter than Tailwind's leading-tight (1.25)
             * - max-w-[52rem] inherited from editorial container wrapper
             */}
            <h1 className="text-3xl md:text-4xl font-semibold leading-[1.1] md:leading-[1.08] tracking-[-0.02em] text-slate-900">
              {question.question}
            </h1>

            {/* Phase badge — sits between headline and summary */}
            {question.phase && question.phase !== "initial" && (
              <div>
                <QuestionPhaseBadge phase={question.phase} size="md" />
              </div>
            )}

            {/*
             * Phase 2A + 2B: Summary / dek
             * - max-w-[46rem] prevents full-column stretch on wide layouts
             * - leading-relaxed md:leading-[1.6] for comfortable scanning
             * - font-normal explicit to prevent weight inheritance
             * - text-slate-600 softer than headline, matches editorial dek convention
             */}
            {question.summary && (
              <p className="max-w-[46rem] font-normal text-base md:text-lg text-slate-600 leading-relaxed md:leading-[1.6]">
                {question.summary}
              </p>
            )}
          </div>
          {/* End editorial container */}

          {/*
           * Phase 4: Hero image — mt-5 after summary (summary → image rhythm)
           * Plan B: EditorialHeroImage with two-layer blurred bg + sharp contain foreground.
           * Replaces QuestionCoverImage on this page only; no regressions elsewhere.
           */}
          {question.cover_image_url && (
            <div className="mt-5">
              <EditorialHeroImage
                imageUrl={question.cover_image_url}
                alt={question.question}
                height={320}
              />
              {/*
               * Caption: italic, muted, smaller than body.
               * ring-1 ring-black/5 on the container provides subtle separation
               * for light images that might bleed into the white card bg.
               */}
              <p className="mt-2 text-[11px] italic text-slate-400">
                Source image from the linked article
              </p>
            </div>
          )}

          {/* Phase 4: Comments — mt-7 (image → comments rhythm, larger gap signals section change) */}
          <div className="mt-7 border-t pt-7">
            <QuestionCommentsPanel questionId={questionId} />
          </div>

          {/* Phase 4: Related questions — mt-7 (comments → related rhythm) */}
          <section className="mt-7 border-t pt-7">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
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
              <p className="text-xs text-slate-500">No related questions yet.</p>
            )}

            {hasRelated && relatedQuestions && (
              <div className="space-y-3">
                {relatedQuestions.map((rq) => (
                  <div
                    key={rq.id}
                    className="flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/q/${rq.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {rq.question}
                      </Link>
                      {rq.summary && (
                        <p className="text-slate-600 line-clamp-2 mt-0.5">
                          {rq.summary}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
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
          <footer className="mt-6">
            <button
              type="button"
              onClick={handleBack}
              className="text-sm text-slate-900 underline"
            >
              ← Back
            </button>
          </footer>
        </main>

        {/* ===================== RIGHT RAIL ===================== */}
        <aside className="md:pt-1">
          <div className="md:sticky md:top-24 space-y-5">

            {/* Topic card + follow */}
            {question.topic_id && (
              <section className="rounded-2xl border bg-white p-4 md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* Phase 5A: consistent rail heading */}
                    <div className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
                      Topic
                    </div>
                    {/* Phase 5B: body text */}
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {topicLite?.title ?? "View topic"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <FollowTopicButton topicId={question.topic_id} />
                  </div>
                </div>
                <div className="mt-3">
                  <Link
                    to={`/topics/${question.topic_id}`}
                    className="text-xs text-slate-600 hover:underline"
                  >
                    View topic →
                  </Link>
                </div>
              </section>
            )}

            {/* Community stance */}
            <section className="rounded-2xl border bg-white p-4 md:p-5">
              {/* Phase 5A: rail heading */}
              <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-3">
                Community stance
              </h3>

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
                <>
                  <div className="space-y-2 text-xs text-slate-600">
                    <div>
                      {/* Phase 5B: counts slightly darker + medium weight */}
                      <span className="text-xs text-slate-700 font-medium">
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
                        Average stance: {globalStats.avg_score.toFixed(2)}{" "}
                        (scale -2 to +2)
                      </div>
                    )}
                  </div>

                  {/* Divider before region compare */}
                  {isAuthed && (
                    <>
                      <div className="border-t my-3" />
                      <RegionComparison stats={stats ?? null} />
                    </>
                  )}
                </>
              )}

              {/* Edge case: regions present but no global stat */}
              {hasStats && !globalStats && isAuthed && (
                <RegionComparison stats={stats ?? null} />
              )}
            </section>

            {/* Discussion mood */}
            {threadSentimentLoading && !threadSentiment && (
              <section className="rounded-2xl border bg-white p-4 md:p-5">
                <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-3">
                  Discussion mood
                </h3>
                <p className="text-xs text-slate-500">
                  Analyzing discussion sentiment…
                </p>
              </section>
            )}

            {threadSentiment && (
              <section className="rounded-2xl border bg-white p-4 md:p-5">
                <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-3">
                  Discussion mood
                </h3>
                {/* Phase 5B: body text */}
                <p className="text-xs text-slate-600">
                  {/* Phase 5B: count slightly darker */}
                  <span className="text-xs text-slate-700 font-medium">
                    {threadSentiment.comment_count ?? 0}
                  </span>{" "}
                  comment{threadSentiment.comment_count === 1 ? "" : "s"}
                  {typeof threadSentiment.avg_sentiment === "number" &&
                    ` · avg sentiment ${threadSentiment.avg_sentiment.toFixed(
                      2
                    )} (−1 to +1)`}
                </p>
                {threadSentiment.summary_text && (
                  <p className="text-sm text-slate-700 mt-2">
                    {threadSentiment.summary_text}
                  </p>
                )}
              </section>
            )}

            {/*
             * Phase 5C: "Your stance" — CTA block.
             * bg-slate-50 + border-slate-200 makes it feel like a distinct module.
             * Stance slider and clear button are unchanged.
             */}
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:p-5">
              <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-3">
                Your stance
              </h3>

              {!isAuthed && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-600">
                    Log in to record your stance and compare with your city,
                    state, country, and globally.
                  </p>
                  <button
                    type="button"
                    onClick={handleRequireLogin}
                    className="w-full rounded-xl bg-slate-900 text-white px-3 py-2 text-xs font-medium"
                  >
                    Log in to take stance
                  </button>
                </div>
              )}

              {isAuthed && (
                <>
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

          </div>
        </aside>
      </div>
    );
  }

  return (
    <PageLayout>
      <div className="max-w-6xl mx-auto py-6 space-y-4 px-4">
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
