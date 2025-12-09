// src/components/Question/TodayQuestionsFeed.tsx
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

type TodayQuestionRow = {
  date: string;
  question_id: string;
  row_index: number;
  question_text: string | null;
  question_summary: string | null;
  question_tags: string[] | null;
  question_location: string | null;
  question_status: string | null;
  question_published_at: string | null;
};

interface TodayQuestionsFeedProps {
  limit?: number;
  /**
   * Build the URL for a question detail page.
   * Adjust this to match your actual routing, e.g.:
   *   (id) => `/questions/${id}`
   *   (id) => `/q/${id}`
   */
  buildQuestionLink?: (questionId: string) => string;
}

export function TodayQuestionsFeed({
  limit = 7,
  // Default to your actual question detail route
  buildQuestionLink = (id) => `/q/${id}`,
}: TodayQuestionsFeedProps) {
  const supabase = React.useMemo(getSupabase, []);

  const { data, isLoading, isError, error, refetch } =
    useQuery<TodayQuestionRow[]>({
      queryKey: ["today-questions", { limit }],
      queryFn: async () => {
        const { data, error } = await supabase.rpc("get_today_questions", {
          p_limit: limit,
        });

        if (error) {
          console.error("get_today_questions error:", error);
          throw error;
        }
        return (data ?? []) as TodayQuestionRow[];
      },
    });

  const todayLabel = React.useMemo(() => {
    if (!data || data.length === 0) return "Today’s Questions";
    const d = new Date(data[0].date);
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }, [data]);

  return (
    <Card className="border border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base sm:text-lg">
            Today’s {limit} Questions
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            A curated set of high-impact, stance-worthy questions selected by
            our AI + editorial engine.
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
            Error loading Today’s Questions:{" "}
            {(error as any)?.message ?? "Unknown error"}
          </p>
        )}

        {!isLoading && !isError && (!data || data.length === 0) && (
          <p className="text-xs text-muted-foreground">
            No curated questions are available yet for today. The system will
            fall back to high-impact questions as scoring runs.
          </p>
        )}

        {!isLoading && !isError && data && data.length > 0 && (
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
              {todayLabel}
            </div>
            <ol className="space-y-3 list-none pl-0">
              {data.map((q) => {
                const href = buildQuestionLink(q.question_id);
                const indexLabel = q.row_index ?? 0;

                return (
                  <li
                    key={q.question_id}
                    className="flex flex-col gap-1 border border-slate-100 rounded-md px-3 py-2 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-slate-300 text-[10px] font-medium">
                            {indexLabel}
                          </span>
                          <span className="uppercase tracking-wide text-[10px] font-medium text-slate-500">
                            Today’s Question
                          </span>
                          {q.question_location && (
                            <Badge variant="outline" className="text-[10px]">
                              {q.question_location}
                            </Badge>
                          )}
                        </div>
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
                      </div>
                      <div className="hidden sm:flex flex-col items-end gap-1">
                        {q.question_tags && q.question_tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {q.question_tags.slice(0, 3).map((tag) => (
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
                        {q.question_published_at && (
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(
                              q.question_published_at
                            ).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </div>
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
