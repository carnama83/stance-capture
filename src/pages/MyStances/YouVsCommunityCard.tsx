// src/pages/MyStances/YouVsCommunityCard.tsx
// Phase 3 — Q3: Descriptive natural-language comparison with community direction %.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "react-i18next";

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
    return "youVsCommunityPhrase.answerMore";
  }
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  if (pct >= 65) {
    return "youVsCommunityPhrase.overallAgree";
  }
  if (pct <= 35) {
    return "youVsCommunityPhrase.overallDisagree";
  }
  return "youVsCommunityPhrase.overallInLine";
}

function topicDeltaPhrase(your: number | null, community: number | null): string {
  if (your === null || community === null) return "";
  const d = your - community;
  if (d >= 0.6)  return "youVsCommunityPhrase.deltaStrongAgree";
  if (d >= 0.35) return "youVsCommunityPhrase.deltaLeanAgree";
  if (d <= -0.6) return "youVsCommunityPhrase.deltaStrongDisagree";
  if (d <= -0.35) return "youVsCommunityPhrase.deltaLeanDisagree";
  return "youVsCommunityPhrase.deltaClose";
}

// Derives an approximate community direction % from community_avg (-2..+2).
// avg=±2 → ~95%, avg=±1 → ~70%, avg=0 → split.
function communityDirectionLabel(communityAvg: number | null): { key: string; pct?: number } | null {
  if (communityAvg === null || communityAvg === undefined) return null;
  const avg = Math.max(-2, Math.min(2, communityAvg));
  const absPct = Math.round(50 + (Math.abs(avg) / 2) * 45);
  if (avg > 0.35)  return { key: "youVsCommunityPhrase.leanAgreePct", pct: absPct };
  if (avg < -0.35) return { key: "youVsCommunityPhrase.leanDisagreePct", pct: absPct };
  return { key: "youVsCommunityPhrase.fairlySplit" };
}

export default function YouVsCommunityCard() {
  const { t: tr } = useTranslation();
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
          {tr("youVsCommunity.yourPerspectiveInContext")}
        </CardTitle>
        <CardDescription className="text-xs text-slate-500 mt-0.5">
          {tr("youVsCommunity.howYourViewsCompareAcross")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && (
          <div className="text-xs text-slate-500">{tr("youVsCommunity.loadingYourComparison")}</div>
        )}
        {!isLoading && (isError || !data || (data.overall?.topics_compared ?? 0) === 0) && (
          <div className="text-xs text-slate-500">
            {tr("youVsCommunity.answerAFewQuestionsTo")}
          </div>
        )}
        {!isLoading && !isError && data && (data.overall?.topics_compared ?? 0) > 0 && (
          <div className="space-y-3">
            <div className="text-sm text-slate-800">{tr(overallPhrase(data))}</div>

            {(data.topics ?? []).length > 0 && (
              <div className="space-y-2">
                {(data.topics ?? []).map((t) => {
                  const directionLabel = communityDirectionLabel(t.community_avg);
                  return (
                    <div key={t.topic_id} className="rounded-md border border-slate-100 px-3 py-2.5">
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                        {t.title}
                      </div>
                      {directionLabel && (
                        <div className="text-sm font-medium text-slate-800 mb-0.5">
                          {tr(directionLabel.key, { pct: directionLabel.pct })}
                        </div>
                      )}
                      <div className="text-xs text-slate-500">
                        {(() => {
                          const k = topicDeltaPhrase(t.your_avg, t.community_avg);
                          return k ? tr(k) : null;
                        })()}
                      </div>
                      {t.respondents && (
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {tr("youVsCommunity.basedOnRespondents", { count: t.respondents })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[11px] text-slate-400">
              {tr("youVsCommunity.thisReflectsAggregatePatternsNot")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
