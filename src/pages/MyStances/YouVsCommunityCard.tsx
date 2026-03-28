// src/pages/MyStances/YouVsCommunityCard.tsx
// Phase 3 — Q3: Descriptive natural-language comparison.
// Shows community direction percentage alongside the delta sentence.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";

type YouVsCommunityTopic = {
  topic_id: string;
  title: string;
  your_avg: number | null;
  community_avg: number | null;
  percentile: number | null;
  respondents: number | null;
  answers_count: number | null;
};

type YouVsCommunitySummary = {
  overall: {
    percentile: number | null;
    topics_compared: number;
  };
  topics: YouVsCommunityTopic[];
};

function overallPhrase(summary: YouVsCommunitySummary): string {
  const p = summary?.overall?.percentile;
  const topics = summary?.overall?.topics_compared ?? 0;
  if (p === null || p === undefined || Number.isNaN(p) || topics <= 0) {
    return "Answer a few more questions to see how your views compare.";
  }
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  if (pct >= 65) {
    return `On the topics you've answered, your views tend to lean more toward agreement than most respondents.`;
  }
  if (pct <= 35) {
    return `On the topics you've answered, your views tend to lean more toward disagreement than most respondents.`;
  }
  return `On the topics you've answered, your views are broadly in line with the overall community.`;
}

function topicDeltaPhrase(your: number | null, community: number | null): string {
  if (your === null || community === null) return "";
  const d = your - community;
  if (d >= 0.6)  return "You lean noticeably more toward agreement here than others.";
  if (d >= 0.35) return "You lean somewhat more toward agreement here.";
  if (d <= -0.6) return "You lean noticeably more toward disagreement here than others.";
  if (d <= -0.35) return "You lean somewhat more toward disagreement here.";
  return "Your view is close to the community average here.";
}

// Converts community_avg (-2..+2) into a human-readable community direction
// percentage label. E.g. avg=0.8 → "~65% lean toward agreement"
function communityDirectionLabel(communityAvg: number | null): string | null {
  if (communityAvg === null || communityAvg === undefined) return null;
  const avg = Math.max(-2, Math.min(2, communityAvg));

  // Map avg score to approximate % trending in the dominant direction.
  // avg=2 → ~95% agree, avg=1 → ~70% agree, avg=0 → ~50/50,
  // avg=-1 → ~70% disagree, avg=-2 → ~95% disagree.
  // Linear interpolation between anchor points.
  const absPct = Math.round(50 + (Math.abs(avg) / 2) * 45);

  if (avg > 0.35) {
    return `~${absPct}% lean toward agreement`;
  }
  if (avg < -0.35) {
    return `~${absPct}% lean toward disagreement`;
  }
  return "Community is fairly split";
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
    <Card className="mb-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-900">
          Your perspective in context
        </CardTitle>
        <CardDescription className="text-xs text-slate-500 mt-0.5">
          How your views compare across the topics you've answered.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="text-xs text-slate-500">Loading your comparison…</div>
        )}
        {!isLoading && (isError || !data || (data.overall?.topics_compared ?? 0) === 0) && (
          <div className="text-xs text-slate-500">
            Answer a few questions to see how your views compare to others.
          </div>
        )}
        {!isLoading && !isError && data && (data.overall?.topics_compared ?? 0) > 0 && (
          <div className="space-y-3">
            {/* Overall summary sentence */}
            <div className="text-sm text-slate-800">{overallPhrase(data)}</div>

            {/* Per-topic rows */}
            {(data.topics ?? []).length > 0 && (
              <div className="space-y-2">
                {(data.topics ?? []).map((t) => {
                  const directionLabel = communityDirectionLabel(t.community_avg);
                  return (
                    <div key={t.topic_id} className="rounded-md border border-slate-100 px-3 py-2.5">
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                        {t.title}
                      </div>

                      {/* Community direction percentage — the headline signal */}
                      {directionLabel && (
                        <div className="text-sm font-medium text-slate-800 mb-0.5">
                          {directionLabel}
                        </div>
                      )}

                      {/* How user compares to that direction */}
                      <div className="text-xs text-slate-500">
                        {topicDeltaPhrase(t.your_avg, t.community_avg)}
                      </div>

                      {/* Respondent count */}
                      {t.respondents && (
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Based on {t.respondents.toLocaleString()} respondents.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footnote */}
            <p className="text-[11px] text-slate-400">
              This reflects aggregate patterns, not right or wrong answers.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";

type YouVsCommunityTopic = {
  topic_id: string;
  title: string;
  your_avg: number | null;
  community_avg: number | null;
  percentile: number | null;
  respondents: number | null;
  answers_count: number | null;
};

type YouVsCommunitySummary = {
  overall: {
    percentile: number | null;
    topics_compared: number;
  };
  topics: YouVsCommunityTopic[];
};

function overallPhrase(summary: YouVsCommunitySummary): string {
  const p = summary?.overall?.percentile;
  const topics = summary?.overall?.topics_compared ?? 0;
  if (p === null || p === undefined || Number.isNaN(p) || topics <= 0) {
    return "Answer a few more questions to see how your views compare.";
  }
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  if (pct >= 65) {
    return `On the topics you've answered, your views tend to lean more toward agreement than most respondents.`;
  }
  if (pct <= 35) {
    return `On the topics you've answered, your views tend to lean more toward disagreement than most respondents.`;
  }
  return `On the topics you've answered, your views are broadly in line with the overall community.`;
}

function topicDeltaPhrase(your: number | null, community: number | null): string {
  if (your === null || community === null) return "";
  const d = your - community;
  if (d >= 0.6)  return "You lean noticeably more toward agreement here than others.";
  if (d >= 0.35) return "You lean somewhat more toward agreement here.";
  if (d <= -0.6) return "You lean noticeably more toward disagreement here than others.";
  if (d <= -0.35) return "You lean somewhat more toward disagreement here.";
  return "Your view is close to the community average here.";
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
    <Card className="mb-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-900">
          Your perspective in context
        </CardTitle>
        <CardDescription className="text-xs text-slate-500 mt-0.5">
          How your views compare across the topics you've answered.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="text-xs text-slate-500">Loading your comparison…</div>
        )}
        {!isLoading && (isError || !data || (data.overall?.topics_compared ?? 0) === 0) && (
          <div className="text-xs text-slate-500">
            Answer a few questions to see how your views compare to others.
          </div>
        )}
        {!isLoading && !isError && data && (data.overall?.topics_compared ?? 0) > 0 && (
          <div className="space-y-3">
            {/* Overall summary sentence */}
            <div className="text-sm text-slate-800">{overallPhrase(data)}</div>

            {/* Per-topic rows */}
            {(data.topics ?? []).length > 0 && (
              <div className="space-y-2">
                {(data.topics ?? []).map((t) => (
                  <div key={t.topic_id} className="rounded-md border border-slate-100 px-3 py-2.5">
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-0.5">
                      {t.title}
                    </div>
                    <div className="text-sm text-slate-700">
                      {topicDeltaPhrase(t.your_avg, t.community_avg)}
                    </div>
                    {t.respondents && (
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Based on {t.respondents.toLocaleString()} respondents.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Footnote */}
            <p className="text-[11px] text-slate-400">
              This reflects aggregate patterns, not right or wrong answers.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
