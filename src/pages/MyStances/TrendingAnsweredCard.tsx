// src/pages/MyStances/TrendingAnsweredCard.tsx
// Phase 2b — Shows questions the user has already answered that are now
// trending, gaining traction, or have had a meaningful community stance shift.
// Data comes from joining question_stances (user's answers) with
// question_trending_metrics (trending_score, responses_24h) and
// question_stance_stats (avg_score shift vs user's own score).

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { TrendingUp, Activity, ArrowLeftRight, Loader2 } from "lucide-react";

type TrendingAnsweredRow = {
  question_id: string;
  question_text: string;
  topic_title: string | null;
  user_score: number;
  trending_score: number;
  responses_24h: number;
  community_avg_score: number | null;
  signal: "trending" | "gaining" | "shifted";
  signal_label: string;
};

// Fetch questions user answered that are now trending/shifting.
// Uses a direct Supabase join since no dedicated RPC exists yet.
async function fetchTrendingAnswered(userId: string): Promise<TrendingAnsweredRow[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not available");

  // Step 1: Get user's answered question_ids with their scores
  const { data: stances, error: stanceErr } = await sb
    .from("question_stances")
    .select("question_id, score")
    .eq("user_id", userId);
  if (stanceErr) throw stanceErr;
  if (!stances || stances.length === 0) return [];

  const questionIds = stances.map((s: { question_id: string }) => s.question_id);
  const scoreByQuestion = Object.fromEntries(
    stances.map((s: { question_id: string; score: number }) => [s.question_id, s.score])
  );

  // Step 2: Get trending metrics for those questions
  const { data: metrics, error: metricsErr } = await sb
    .from("question_trending_metrics")
    .select("question_id, trending_score, responses_24h")
    .in("question_id", questionIds)
    .or("trending_score.gte.0.4,responses_24h.gte.10")
    .order("trending_score", { ascending: false })
    .limit(20);
  if (metricsErr) throw metricsErr;
  if (!metrics || metrics.length === 0) return [];

  const trendingIds = metrics.map((m: { question_id: string }) => m.question_id);

  // Step 3: Get question text + topic + community avg_score
  const { data: questions, error: questionsErr } = await sb
    .from("questions")
    .select("id, question, topic_id, topics(title)")
    .in("id", trendingIds);
  if (questionsErr) throw questionsErr;

  const { data: stats, error: statsErr } = await sb
    .from("question_stance_stats")
    .select("question_id, avg_score")
    .in("question_id", trendingIds);
  if (statsErr) throw statsErr;

  const statsByQuestion = Object.fromEntries(
    (stats ?? []).map((s: { question_id: string; avg_score: number | null }) => [
      s.question_id,
      s.avg_score,
    ])
  );

  const questionMap = Object.fromEntries(
    (questions ?? []).map((q: any) => [q.id, q])
  );

  const metricsMap = Object.fromEntries(
    (metrics ?? []).map((m: any) => [m.question_id, m])
  );

  const results: TrendingAnsweredRow[] = [];

  for (const qId of trendingIds) {
    const q = questionMap[qId];
    if (!q) continue;

    const m = metricsMap[qId];
    const userScore = scoreByQuestion[qId];
    const communityAvg = statsByQuestion[qId] ?? null;
    const trendingScore = m?.trending_score ?? 0;
    const responses24h = m?.responses_24h ?? 0;

    // Determine signal type
    let signal: TrendingAnsweredRow["signal"];
    let signal_label: string;

    const shift =
      communityAvg !== null && userScore !== undefined
        ? Math.abs(communityAvg - userScore)
        : 0;

    if (trendingScore >= 0.6) {
      signal = "trending";
      signal_label = "Trending now";
    } else if (shift >= 0.75) {
      signal = "shifted";
      signal_label = "Community shifted";
    } else if (responses24h >= 15) {
      signal = "gaining";
      signal_label = "Gaining traction";
    } else if (trendingScore >= 0.4) {
      signal = "gaining";
      signal_label = "Gaining traction";
    } else {
      continue; // not interesting enough
    }

    results.push({
      question_id: qId,
      question_text: q.question,
      topic_title: (q.topics as any)?.title ?? null,
      user_score: userScore,
      trending_score: trendingScore,
      responses_24h: responses24h,
      community_avg_score: communityAvg,
      signal,
      signal_label,
    });
  }

  // Sort: shifted first (most personally relevant), then trending, then gaining
  const signalOrder: Record<string, number> = { shifted: 0, trending: 1, gaining: 2 };
  results.sort((a, b) => (signalOrder[a.signal] ?? 3) - (signalOrder[b.signal] ?? 3));

  return results.slice(0, 5);
}

function SignalBadge({ signal, label }: { signal: TrendingAnsweredRow["signal"]; label: string }) {
  if (signal === "trending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-200 px-2 py-0.5 text-[10px] font-medium text-orange-700">
        <TrendingUp className="h-3 w-3" />
        {label}
      </span>
    );
  }
  if (signal === "gaining") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-medium text-blue-700">
        <Activity className="h-3 w-3" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      <ArrowLeftRight className="h-3 w-3" />
      {label}
    </span>
  );
}

const STANCE_SHORT: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]: "Neutral",
  [1]: "Agree",
  [2]: "Strongly agree",
};

interface TrendingAnsweredCardProps {
  userId: string;
}

export default function TrendingAnsweredCard({ userId }: TrendingAnsweredCardProps) {
  const { data, isLoading } = useQuery<TrendingAnsweredRow[]>({
    queryKey: ["trending-answered", userId],
    queryFn: () => fetchTrendingAnswered(userId),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <Card className="mb-3">
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking your answered questions…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) return null;

  return (
    <Card className="mb-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-900">
          Questions you answered — with updates
        </CardTitle>
        <CardDescription className="text-xs text-slate-500 mt-0.5">
          These questions you've weighed in on are now trending or shifting.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {data.map((row) => (
          <div
            key={row.question_id}
            className="rounded-md border border-slate-100 p-3 space-y-1.5"
          >
            {row.topic_title && (
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {row.topic_title}
              </p>
            )}

            <div className="flex items-start justify-between gap-2">
              <Link
                to={`/q/${row.question_id}`}
                className="text-sm font-medium text-slate-900 hover:underline leading-snug flex-1"
              >
                {row.question_text}
              </Link>
              <SignalBadge signal={row.signal} label={row.signal_label} />
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span>
                Your stance:{" "}
                <span className="font-medium text-slate-700">
                  {STANCE_SHORT[row.user_score] ?? row.user_score}
                </span>
              </span>
              {row.signal === "shifted" && row.community_avg_score !== null && (
                <span>
                  Community now:{" "}
                  <span className="font-medium text-slate-700">
                    {row.community_avg_score > 0.35
                      ? "leaning agree"
                      : row.community_avg_score < -0.35
                      ? "leaning disagree"
                      : "mixed"}
                  </span>
                </span>
              )}
              {row.signal === "trending" && row.responses_24h > 0 && (
                <span>{row.responses_24h} new responses today</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
