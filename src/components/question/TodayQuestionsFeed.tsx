// src/components/question/TodayQuestionsFeed.tsx
// UPDATED (Epic C — lifecycle ribbon consistency):
//   Added secondary batch fetch of phase, state, is_trending, trending_score
//   from questions table. The get_daily_curated_questions RPC does not return
//   these fields. Pattern mirrors ThreeTierQuestionsFeed.
//   Now shows QuestionPhaseBadge, QuestionStateBadge, and TrendingBadge
//   consistently with all other feed surfaces.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Link } from "react-router-dom";

import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge";
import { QuestionStateBadge } from "@/components/question/QuestionStateBadge";
import { TrendingBadge } from "@/components/question/TrendingBadge";
import type { QuestionState } from "@/types/questionLifecycleTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

type TodayQuestionRow = {
  question_id: string;
  question_text: string | null;
  question_summary: string | null;
  tags: string[] | null;
  composite_score: number | null;
  source: "curated" | "fallback";
  // Lifecycle fields — populated by secondary fetch
  phase?: string | null;
  state?: QuestionState | null;
  is_trending?: boolean;
  trending_score?: number | null;
};

type LifecycleRow = {
  id: string;
  phase: string | null;
  state: QuestionState;
  is_trending: boolean;
  trending_score: number | null;
};

interface TodayQuestionsFeedProps {
  limit?: number;
  buildQuestionLink?: (questionId: string) => string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TodayQuestionsFeed({
  limit = 7,
  buildQuestionLink = (id) => `/q/${id}`,
}: TodayQuestionsFeedProps) {
  const sb = React.useMemo(getSupabase, []);

  // Step 1: fetch curated question list
  const { data: rawData, isLoading, isError, error, refetch } =
    useQuery<TodayQuestionRow[]>({
      queryKey: ["daily-curated-questions"],
      queryFn: async () => {
        if (!sb) return [];
        const today = new Date().toISOString().split("T")[0];
        const { data, error } = await sb.rpc("get_daily_curated_questions", {
          p_date: today,
        });
        if (error) throw error;
        return (data ?? []) as TodayQuestionRow[];
      },
      staleTime: 60_000,
    });

  // Step 2: batch fetch lifecycle fields for these question IDs
  const questionIds = React.useMemo(
    () => (rawData ?? []).map((q) => q.question_id),
    [rawData]
  );

  const { data: lifecycleData } = useQuery<LifecycleRow[]>({
    queryKey: ["today-feed-lifecycle", questionIds.join(",")],
    enabled: questionIds.length > 0,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      if (!sb || questionIds.length === 0) return [];
      const { data } = await sb
        .from("questions")
        .select("id, phase, state, is_trending, trending_score")
        .in("id", questionIds);
      return (data ?? []) as LifecycleRow[];
    },
  });

  // Merge lifecycle into question rows
  const data = React.useMemo((): TodayQuestionRow[] => {
    if (!rawData) return [];
    if (!lifecycleData) return rawData;
    const lcMap = new Map(lifecycleData.map((r) => [r.id, r]));
    return rawData.map((q) => {
      const lc = lcMap.get(q.question_id);
      return lc
        ? { ...q, phase: lc.phase, state: lc.state, is_trending: lc.is_trending, trending_score: lc.trending_score }
        : q;
    });
  }, [rawData, lifecycleData]);

  const isCurated = data?.[0]?.source === "curated";
  const isFallback = data?.[0]?.source === "fallback";

  return (
    <Card className="border border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base sm:text-lg">
            Today's {data?.length || limit} Questions
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            {isCurated && "Curated by our editorial team"}
            {isFallback && "High-impact questions selected by AI"}
            {!data?.length && "A curated set of stance-worthy questions"}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: limit }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <p className="text-xs text-destructive">
            Error loading Today's Questions:{" "}
            {(error as any)?.message ?? "Unknown error"}
          </p>
        )}

        {!isLoading && !isError && (!data || data.length === 0) && (
          <p className="text-xs text-muted-foreground">
            No curated questions are available yet for today. Run the Bootstrap
            function in the Impact Dashboard to generate today's questions.
          </p>
        )}

        {!isLoading && !isError && data && data.length > 0 && (
          <div className="space-y-3">
            {/* Source indicator */}
            <div className="flex items-center gap-2">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                {isCurated && "📰 Curated Set"}
                {isFallback && "⚡ Auto-Selected"}
              </div>
              {data[0]?.composite_score && (
                <Badge variant="outline" className="text-[10px]">
                  Impact Score: {data[0].composite_score.toFixed(1)}
                </Badge>
              )}
            </div>

            {/* Questions list */}
            <ol className="space-y-3 list-decimal list-inside">
              {data.map((q) => {
                const href = buildQuestionLink(q.question_id);

                return (
                  <li
                    key={q.question_id}
                    className="flex flex-col gap-1.5 border border-slate-100 rounded-md px-3 py-2.5 hover:bg-slate-50 transition-colors"
                  >
                    {/* Lifecycle badges — consistent with all other card surfaces */}
                    {(q.phase && q.phase !== "initial") || q.state || q.is_trending ? (
                      <div className="flex flex-wrap gap-1.5">
                        {q.phase && q.phase !== "initial" && (
                          <QuestionPhaseBadge phase={q.phase} size="sm" />
                        )}
                        {q.state && (
                          <QuestionStateBadge state={q.state} size="sm" />
                        )}
                        {q.is_trending && (
                          <TrendingBadge
                            trendingScore={q.trending_score ?? undefined}
                            responsesTotal={undefined}
                          />
                        )}
                      </div>
                    ) : null}

                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-1 flex-1">
                        <Link
                          to={href}
                          className="text-sm font-medium leading-snug line-clamp-2 hover:underline"
                        >
                          {q.question_text ?? "(Untitled question)"}
                        </Link>
                        {q.question_summary && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {q.question_summary}
                          </p>
                        )}

                        {q.tags && q.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {q.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="text-[10px]">
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      {q.composite_score && (
                        <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                          <Badge
                            variant={
                              q.composite_score >= 8 ? "default"
                              : q.composite_score >= 6 ? "secondary"
                              : "outline"
                            }
                            className="text-[10px]"
                          >
                            {q.composite_score.toFixed(1)}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
