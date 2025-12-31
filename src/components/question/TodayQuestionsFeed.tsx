// src/components/question/TodayQuestionsFeed.tsx
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";

// UPDATED: New type to match get_daily_curated_questions() response
type TodayQuestionRow = {
  question_id: string;
  question_text: string | null;
  question_summary: string | null;
  tags: string[] | null;
  composite_score: number | null;
  source: 'curated' | 'fallback';
};

interface TodayQuestionsFeedProps {
  limit?: number;
  /**
   * Build the URL for a question detail page.
   * Default matches your /q/:id QuestionDetailPage route.
   */
  buildQuestionLink?: (questionId: string) => string;
}

export function TodayQuestionsFeed({
  limit = 7,
  buildQuestionLink = (id) => `/q/${id}`,
}: TodayQuestionsFeedProps) {
  const sb = React.useMemo(getSupabase, []);

  // UPDATED: Use new get_daily_curated_questions function
  const { data, isLoading, isError, error, refetch } =
    useQuery<TodayQuestionRow[]>({
      queryKey: ["daily-curated-questions"],
      queryFn: async () => {
        if (!sb) return [];
        
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        
        // Call NEW function
        const { data, error } = await sb.rpc("get_daily_curated_questions", {
          p_date: today,
        });

        if (error) {
          console.error("get_daily_curated_questions error:", error);
          throw error;
        }
        return (data ?? []) as TodayQuestionRow[];
      },
      staleTime: 60_000, // 1 minute
    });

  // Check if we have curated or fallback questions
  const isCurated = data?.[0]?.source === 'curated';
  const isFallback = data?.[0]?.source === 'fallback';

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
            {!data && "A curated set of stance-worthy questions"}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
        >
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
              {data.map((q, idx) => {
                const href = buildQuestionLink(q.question_id);

                return (
                  <li
                    key={q.question_id}
                    className="flex flex-col gap-1 border border-slate-100 rounded-md px-3 py-2 hover:bg-slate-50 transition-colors"
                  >
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
                        
                        {/* Tags */}
                        {q.tags && q.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {q.tags.slice(0, 3).map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-[10px]"
                              >
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      {/* Composite score badge */}
                      {q.composite_score && (
                        <div className="hidden sm:flex flex-col items-end gap-1">
                          <Badge
                            variant={
                              q.composite_score >= 8
                                ? "default"
                                : q.composite_score >= 6
                                ? "secondary"
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
