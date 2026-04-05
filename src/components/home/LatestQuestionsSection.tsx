// src/components/home/LatestQuestionsSection.tsx
// UPDATED (Epic C — lifecycle ribbon consistency):
//   Added phase, state, is_trending, trending_score to the feed query so
//   lifecycle badges render consistently with all other card surfaces.
//   useTailoredFeed's LiveQuestion type doesn't include these fields, so we
//   extend the anonymous query to include them.

import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/useAuth";
import { formatDistanceToNow } from "date-fns";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge";
import { QuestionStateBadge } from "@/components/question/QuestionStateBadge";
import { TrendingBadge } from "@/components/question/TrendingBadge";
import type { QuestionState } from "@/types/questionLifecycleTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LiveQuestion {
  id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  published_at: string;
  status: string;
  phase: string | null;
  state: QuestionState | null;
  is_trending: boolean;
  trending_score: number | null;
}

interface UseFeedOptions {
  limit?: number;
  userId?: string | null;
}

// ── Data hook — replaces useTailoredFeed to include lifecycle fields ──────────

function useLatestQuestions({ limit = 20, userId }: UseFeedOptions) {
  return useQuery<LiveQuestion[], Error>({
    queryKey: ["latest-questions-with-lifecycle", limit, userId ?? null],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      if (userId) {
        // Logged-in user: RPC-sourced feed — merge lifecycle in separate query
        const { data: feedData, error: feedErr } = await supabase.rpc(
          "get_tailored_feed",
          { p_user_id: userId, p_limit: limit }
        );
        if (feedErr) throw feedErr;
        const rows = (feedData ?? []) as LiveQuestion[];
        if (!rows.length) return [];

        const ids = rows.map((r) => r.id);
        const { data: lcData } = await supabase
          .from("questions")
          .select("id, phase, state, is_trending, trending_score")
          .in("id", ids);

        const lcMap = new Map((lcData ?? []).map((r: any) => [r.id, r]));
        return rows.map((r) => {
          const lc = lcMap.get(r.id) as any;
          return lc
            ? { ...r, phase: lc.phase ?? null, state: lc.state ?? null, is_trending: lc.is_trending ?? false, trending_score: lc.trending_score ?? null }
            : { ...r, phase: null, state: null, is_trending: false, trending_score: null };
        });
      }

      // Anonymous user: query questions table directly for full lifecycle fields
      const { data, error } = await supabase
        .from("questions")
        .select("id, question, summary, tags, location_label, published_at, status, phase, state, is_trending, trending_score")
        .eq("status", "active")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as LiveQuestion[];
    },
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LatestQuestionsSection() {
  const { user } = useAuth() ?? { user: null };
  const { data: questions = [], isLoading, isError, error } =
    useLatestQuestions({ userId: user?.id ?? null, limit: 20 });

  if (isLoading) {
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Latest Questions</h2>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-2">Latest Questions</h2>
        <p className="text-sm text-red-600">
          Something went wrong loading questions: {error?.message}
        </p>
      </section>
    );
  }

  if (!questions.length) {
    return (
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-2">Latest Questions</h2>
        <p className="text-sm text-muted-foreground">
          No questions are live yet. Once you publish questions from the
          admin area, they'll appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Latest Questions</h2>
      </div>

      <div className="space-y-4">
        {questions.map((q) => (
          <Card key={q.id} className="hover:border-primary/60 transition">
            <CardHeader className="pb-2">
              {/* Lifecycle badges — consistent with all other card surfaces */}
              {((q.phase && q.phase !== "initial") || q.state || q.is_trending) && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
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
              )}

              <CardTitle className="text-base font-semibold">
                <Link to={`/q/${q.id}`} className="hover:underline">
                  {q.question}
                </Link>
              </CardTitle>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {q.location_label && (
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                    {q.location_label}
                  </span>
                )}
                {q.published_at && (
                  <span>
                    {formatDistanceToNow(new Date(q.published_at), { addSuffix: true })}
                  </span>
                )}
              </div>
            </CardHeader>

            {q.summary && (
              <CardContent className="pt-0 text-sm text-muted-foreground">
                <p className="line-clamp-3">{q.summary}</p>
              </CardContent>
            )}

            {q.tags && q.tags.length > 0 && (
              <CardContent className="pt-2 pb-3">
                <div className="flex flex-wrap gap-2">
                  {q.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-wide"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
