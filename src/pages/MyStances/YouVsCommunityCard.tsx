import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { getSupabase } from "@/lib/supabaseClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type YouVsCommunityTopic = {
  topic_id: string;
  title: string;
  your_avg: number | null;
  community_avg: number | null;
  percentile: number | null; // 0..1
  respondents: number | null;
  answers_count: number | null;
};

type YouVsCommunitySummary = {
  overall: {
    percentile: number | null; // 0..1
    topics_compared: number;
  };
  topics: YouVsCommunityTopic[];
};

function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "–";
  const v = Math.max(0, Math.min(1, p));
  return `${Math.round(v * 100)}%`;
}

function fmtAvg(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const n = Math.max(-2, Math.min(2, v));
  return n.toFixed(2);
}

function overallPhrase(summary: YouVsCommunitySummary): string {
  const p = summary?.overall?.percentile;
  const topics = summary?.overall?.topics_compared ?? 0;
  if (p === null || p === undefined || Number.isNaN(p) || topics <= 0) {
    return "Answer a few more questions to see a comparison.";
  }

  // Neutral, non-gamified language.
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  if (pct >= 65) {
    return `On the topics you’ve answered, your views tend to be more agreement-leaning than about ${pct}% of respondents.`;
  }
  if (pct <= 35) {
    return `On the topics you’ve answered, your views tend to be more disagreement-leaning than about ${100 - pct}% of respondents.`;
  }
  return `On the topics you’ve answered, your views are fairly close to the overall community.`;
}

function topicDeltaLabel(yourAvg: number | null, communityAvg: number | null): string {
  if (yourAvg === null || communityAvg === null) return "";
  const d = yourAvg - communityAvg;
  if (d >= 0.35) return "You lean more toward agreement here.";
  if (d <= -0.35) return "You lean more toward disagreement here.";
  return "You’re close to the community average here.";
}

export default function YouVsCommunityCard() {
  const sb = React.useMemo(getSupabase, []);

  const { data, isLoading, isError } = useQuery<YouVsCommunitySummary>({
    queryKey: ["epic-q", "q3", "you-vs-community"],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("Supabase client not available");

      const { data, error } = await supabase
        .rpc("get_you_vs_community_summary", { p_limit: 3 })
        .single();

      if (error) throw error;
      return data as YouVsCommunitySummary;
    },
    enabled: !!sb,
    staleTime: 60_000,
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>You vs community</CardTitle>
        <CardDescription>
          Context for the topics you’ve answered. This isn’t a score — it’s a comparison snapshot.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="text-sm text-slate-600">Loading your comparison…</div>
        ) : isError || !data || (data.overall?.topics_compared ?? 0) === 0 ? (
          <div className="text-sm text-slate-600">
            Answer a few questions to see how your views compare to others.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-slate-800">
              <span className="font-medium">In context:</span> {overallPhrase(data)}
            </div>

            <div>
              <div className="text-xs font-medium text-slate-600 mb-2">
                Top topics you’ve answered
              </div>

              <div className="space-y-2">
                {(data.topics ?? []).map((t) => (
                  <div key={t.topic_id} className="rounded-md border p-3">
                    <div className="text-sm font-medium text-slate-900">{t.title}</div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700">
                      <span>
                        <span className="text-slate-500">You:</span> {fmtAvg(t.your_avg)}
                      </span>
                      <span>
                        <span className="text-slate-500">Community:</span> {fmtAvg(t.community_avg)}
                      </span>
                      <span>
                        <span className="text-slate-500">Percentile:</span> {fmtPct(t.percentile)}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 mt-1">
                      {topicDeltaLabel(t.your_avg, t.community_avg)}
                      {t.respondents ? ` Based on ${t.respondents} respondents.` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
