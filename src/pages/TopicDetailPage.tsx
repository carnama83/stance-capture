// src/pages/TopicDetailPage.tsx
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import PageLayout from "../components/PageLayout";

type Session = import("@supabase/supabase-js").Session;

type Topic = {
  id: string;
  title: string;
  summary?: string | null;
  tags?: string[] | null;
  updated_at?: string | null;
  tier?: "city" | "county" | "state" | "country" | "global" | null;
  location_label?: string | null;
  trending_score?: number | null;
  activity_7d?: number | null;
};

type LiveQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
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

type QuestionStatsCard = {
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

// ----- shared helpers -----
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

function stanceLabelShort(score: number | null | undefined): string {
  if (score === 2) return "Strongly agree";
  if (score === 1) return "Agree";
  if (score === 0) return "Neutral";
  if (score === -1) return "Disagree";
  if (score === -2) return "Strongly disagree";
  return "No stance";
}

async function fetchQuestionStatsForCard(
  questionId: string
): Promise<QuestionStatsCard | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb.rpc("get_question_stats_for_user", {
    p_question_id: questionId,
  });

  if (error) {
    console.error("Failed to load question stats for card", error);
    return null;
  }

  if (!data) return null;
  const raw = data as any;

  return {
    my_stance: typeof raw.my_stance === "number" ? raw.my_stance : null,
    location: raw.location ?? null,
    regions: raw.regions ?? {},
  } as QuestionStatsCard;
}

function QuestionStancePill({
  questionId,
  isAuthed,
}: {
  questionId: string;
  isAuthed: boolean;
}) {
  const { data, isLoading } = useQuery<QuestionStatsCard | null, Error>({
    enabled: !!questionId,
    queryKey: ["question-stats-card", questionId],
    queryFn: () => fetchQuestionStatsForCard(questionId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-slate-500 bg-slate-50">
        Loading…
      </span>
    );
  }

  if (!data) return null;

  const my = data.my_stance;
  const regions = data.regions ?? {};
  const loc = data.location ?? null;

  let regionRow: RegionalStat | null = null;
  let regionLabel: string | null = null;

  if (loc?.city && regions.city) {
    regionRow = regions.city ?? null;
    regionLabel = loc.city;
  } else if (loc?.county && regions.county) {
    regionRow = regions.county ?? null;
    regionLabel = loc.county;
  } else if (loc?.state && regions.state) {
    regionRow = regions.state ?? null;
    regionLabel = loc.state;
  } else if (loc?.country && regions.country) {
    regionRow = regions.country ?? null;
    regionLabel = loc.country;
  } else if (regions.global) {
    regionRow = regions.global ?? null;
    regionLabel = "Global";
  }

  if (!isAuthed && !regionRow) return null;

  const youPart = isAuthed ? `You: ${stanceLabelShort(my)}` : null;

  let regionPart: string | null = null;
  if (regionRow && regionRow.pct_agree != null && regionLabel) {
    const pct = Math.round(regionRow.pct_agree);
    const shortLabel =
      regionLabel.length > 18
        ? regionLabel.replace(/ county/i, "").trim()
        : regionLabel;
    regionPart = `${shortLabel}: ${pct}% agree`;
  }

  const text = [youPart, regionPart].filter(Boolean).join(" · ");
  if (!text) return null;

  let disagreePct = 0;
  let neutralPct = 0;
  let agreePct = 0;

  if (regionRow) {
    const agree = Math.max(0, regionRow.pct_agree ?? 0);
    const disagree = Math.max(0, regionRow.pct_disagree ?? 0);
    const neutral = Math.max(0, regionRow.pct_neutral ?? 0);
    const totalPct = agree + disagree + neutral || 1;
    agreePct = (agree / totalPct) * 100;
    disagreePct = (disagree / totalPct) * 100;
    neutralPct = (neutral / totalPct) * 100;
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5 rounded-full border px-2 py-1 text-[11px] bg-slate-50">
      <span className="text-slate-700 whitespace-nowrap">{text}</span>
      {regionRow && (
        <div className="flex items-center gap-1 text-[10px] text-slate-600">
          <div className="flex h-1 w-16 overflow-hidden rounded-full bg-slate-100">
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
          <span>{Math.round(regionRow.pct_agree ?? 0)}% agree</span>
        </div>
      )}
    </div>
  );
}

// ----- data fetchers -----
async function fetchTopicById(id: string): Promise<Topic | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("topic_region_trends_v")
    .select(
      "id, title, summary, tags, location_label, tier, updated_at, trending_score, activity_7d"
    )
    .eq("id", id)
    .maybeSingle<Topic>();

  if (error) {
    console.error("Failed to load topic", error);
    throw error;
  }

  return data ?? null;
}

async function fetchQuestionsForTopic(
  topic: Topic | null
): Promise<LiveQuestion[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");
  if (!topic) return [];

  // 1) Prefer explicit linkage via questions.topic_draft_id -> topics.draft_id
  const { data, error } = await sb.rpc("get_questions_for_topic", {
    p_topic_id: topic.id,
  });

  if (error) {
    console.error("Failed to load questions for topic via RPC", error);
    throw error;
  }

  const linked = (data ?? []) as LiveQuestion[];

  // 2) Fallback: tag-based match for older questions that may not have topic_draft_id set
  if (linked.length === 0 && topic.tags && topic.tags.length > 0) {
    const { data: tagData, error: tagError } = await sb
      .from("v_live_questions")
      .select(
        "id, question, summary, tags, location_label, published_at, status"
      )
      .eq("status", "active")
      .overlaps("tags", topic.tags as string[])
      .order("published_at", { ascending: false });

    if (tagError) {
      console.error("Failed to load questions for topic via tags", tagError);
      throw tagError;
    }

    return (tagData ?? []) as LiveQuestion[];
  }

  return linked;
}

// Small helper to classify trending heat from score + activity
function getTrendLabel(score: number | null | undefined, activity: number | null | undefined) {
  const s = score ?? 0;
  const a = activity ?? 0;

  if (a >= 20 || s >= 80) return "Very hot";
  if (a >= 10 || s >= 50) return "Heating up";
  if (a >= 3 || s >= 20) return "Some activity";
  return "Quiet right now";
}

// ----- Page -----
export default function TopicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;

  const {
    data: topic,
    isLoading: topicLoading,
    isError: topicError,
    error: topicErrorObj,
  } = useQuery({
    enabled: !!id,
    queryKey: ["topic-detail", id],
    queryFn: () => fetchTopicById(id as string),
    staleTime: 60_000,
  });

  const {
    data: questions,
    isLoading: questionsLoading,
    isError: questionsError,
  } = useQuery({
    enabled: !!topic,
    queryKey: ["topic-questions", topic?.id],
    queryFn: () => fetchQuestionsForTopic(topic ?? null),
    staleTime: 60_000,
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/topics");
    }
  };

  let content: React.ReactNode;

  if (topicLoading) {
    content = (
      <div className="rounded-lg border p-4 animate-pulse space-y-3">
        <div className="h-5 w-2/3 bg-slate-200 rounded" />
        <div className="h-4 w-full bg-slate-200 rounded" />
        <div className="h-4 w-3/4 bg-slate-200 rounded" />
      </div>
    );
  } else if (topicError) {
    content = (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <div className="font-medium mb-1">Couldn&apos;t load topic</div>
        <div>
          {(topicErrorObj as Error)?.message ??
            "Please try again or go back to topics."}
        </div>
        <button
          type="button"
          onClick={handleBack}
          className="mt-2 text-xs underline"
        >
          ← Back
        </button>
      </div>
    );
  } else if (!topic) {
    content = (
      <div className="rounded-lg border p-4 text-sm text-slate-700">
        <div className="font-medium mb-1">Topic not found</div>
        <p className="mb-2">
          This topic may have been removed or is not yet available.
        </p>
        <button
          type="button"
          onClick={handleBack}
          className="text-xs text-slate-900 underline"
        >
          ← Back to topics
        </button>
      </div>
    );
  } else {
    const hasQuestions = !!questions && questions.length > 0;
    const trendLabel = getTrendLabel(topic.trending_score, topic.activity_7d);
    const score = topic.trending_score ?? 0;
    const activity = topic.activity_7d ?? 0;

    content = (
      <div className="space-y-4">
        {/* Header + Topic Trends widget */}
        <section className="rounded-lg border p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
                {topic.title}
              </h1>

              {topic.location_label && (
                <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-1.5 items-center">
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5 bg-slate-50">
                    {topic.location_label}
                  </span>
                  {topic.tier && (
                    <span className="text-[10px] uppercase tracking-wide">
                      {topic.tier === "city"
                        ? "City"
                        : topic.tier === "county"
                        ? "County"
                        : topic.tier === "state"
                        ? "State"
                        : topic.tier === "country"
                        ? "Country"
                        : topic.tier === "global"
                        ? "Global"
                        : topic.tier}
                    </span>
                  )}
                </div>
              )}

              {topic.summary && (
                <p className="mt-2 text-sm text-slate-700 leading-relaxed">
                  {topic.summary}
                </p>
              )}

              {topic.updated_at && (
                <div className="mt-1 text-[11px] text-slate-500">
                  Updated{" "}
                  {new Date(topic.updated_at).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
              )}

              {topic.tags && topic.tags.length > 0 && (
                <div className="pt-2 border-t mt-2">
                  <div className="text-[11px] font-medium text-slate-700 mb-1">
                    Tags
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {topic.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Topic Trends widget */}
            <div className="w-44 shrink-0 rounded-lg border bg-slate-50 px-3 py-2 text-[11px] text-slate-700 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-slate-900">
                  Topic trends
                </span>
                <button
                  type="button"
                  onClick={handleBack}
                  className="text-[10px] text-slate-500 hover:underline"
                >
                  ← Back
                </button>
              </div>
              <div className="text-[11px]">
                <span className="font-medium">{trendLabel}</span>
                {topic.location_label && (
                  <>
                    {" "}
                    in{" "}
                    <span className="font-medium">
                      {topic.location_label}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500">
                    Trend index
                  </span>
                  <span className="text-xs font-semibold">
                    {score.toFixed(0)}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-slate-500">
                    7-day activity
                  </span>
                  <span className="text-xs font-semibold">
                    {activity} response{activity === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: `${Math.max(
                      8,
                      Math.min(100, score)
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Questions under this topic */}
        <section className="rounded-lg border p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-slate-900">
              Questions in this topic
            </h2>
            {isAuthed && (
              <Link
                to="/me/stances"
                className="text-xs text-slate-600 hover:underline"
              >
                View your stances
              </Link>
            )}
          </div>

          {questionsLoading && (
            <p className="text-xs text-slate-500">
              Loading questions for this topic…
            </p>
          )}

          {!questionsLoading && !hasQuestions && (
            <p className="text-xs text-slate-500">
              No live questions yet for this topic. Once questions are
              published from the admin area, they&apos;ll appear here.
            </p>
          )}

          {hasQuestions && questions && (
            <div className="space-y-3 mt-2">
              {questions.map((q) => (
                <div
                  key={q.id}
                  className="rounded-lg border px-3 py-2 hover:border-slate-900/70 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        <Link to={`/q/${q.id}`} className="hover:underline">
                          {q.question}
                        </Link>
                      </div>
                      {q.summary && (
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                          {q.summary}
                        </p>
                      )}
                      {q.tags && q.tags.length > 0 && (
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
                      {q.location_label && (
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                          {q.location_label}
                        </span>
                      )}
                      {q.published_at && (
                        <span className="text-[10px] text-slate-500">
                          {new Date(q.published_at).toLocaleDateString(
                            undefined,
                            { dateStyle: "medium" }
                          )}
                        </span>
                      )}
                      <QuestionStancePill
                        questionId={q.id}
                        isAuthed={isAuthed}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto py-4 space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-1">
            <Link to="/" className="hover:underline">
              Home
            </Link>
            <span>/</span>
            <Link to="/topics" className="hover:underline">
              Topics
            </Link>
            <span>/</span>
            <span className="text-slate-900 font-medium">Topic detail</span>
          </div>
        </div>
        {content}
      </div>
    </PageLayout>
  );
}
