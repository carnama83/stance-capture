// src/pages/MyStances/StanceSnapshotCard.tsx
// Phase 3 — Q1: Natural-language category sentences using topic tags.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "react-i18next";

type SnapshotTopic = {
  topic_title: string;
  tags: string[] | null;
  n: number;
  avg_score: number | null;
};

type SnapshotRegion = {
  scope: "city" | "county" | "state" | "country" | "global";
  label: string;
  mean_abs_diff: number | null;
  alignment_label: string;
};

type StanceSnapshot = {
  total_answered: number;
  topics: SnapshotTopic[];
  region: SnapshotRegion;
};

function topicSentence(tag: string | null | undefined, avgScore: number | null): string {
  const score = avgScore ?? 0;
  const agreeStrong    = score >= 1.25;
  const agreeLean      = score >= 0.35;
  const disagreeStrong = score <= -1.25;
  const disagreeLean   = score <= -0.35;
  const t = (tag ?? "").toLowerCase();

  if (!tag) {
    if (agreeStrong)    return "snapshotSentence.genericStrongSupport";
    if (agreeLean)      return "snapshotSentence.genericLeanSupport";
    if (disagreeStrong) return "snapshotSentence.genericStrongOppose";
    if (disagreeLean)   return "snapshotSentence.genericLeanOppose";
    return "snapshotSentence.genericMixed";
  }
  if (t.match(/environ|climate|energy|carbon|green/)) {
    if (agreeStrong)    return "snapshotSentence.envStrongSupport";
    if (agreeLean)      return "snapshotSentence.envLeanSupport";
    if (disagreeStrong) return "snapshotSentence.envStrongOppose";
    if (disagreeLean)   return "snapshotSentence.envLeanOppose";
    return "snapshotSentence.envMixed";
  }
  if (t.match(/hous|property|rent|zoning/)) {
    if (agreeStrong)    return "snapshotSentence.housingStrongSupport";
    if (agreeLean)      return "snapshotSentence.housingLeanSupport";
    if (disagreeStrong) return "snapshotSentence.housingStrongOppose";
    if (disagreeLean)   return "snapshotSentence.housingLeanOppose";
    return "snapshotSentence.housingMixed";
  }
  if (t.match(/econom|tax|fiscal|budget|trade/)) {
    if (agreeStrong)    return "snapshotSentence.econStrongSupport";
    if (agreeLean)      return "snapshotSentence.econLeanSupport";
    if (disagreeStrong) return "snapshotSentence.econStrongOppose";
    if (disagreeLean)   return "snapshotSentence.econLeanOppose";
    return "snapshotSentence.econMixed";
  }
  if (t.match(/tech|ai|digital|data|cyber/)) {
    if (agreeStrong)    return "snapshotSentence.techStrongSupport";
    if (agreeLean)      return "snapshotSentence.techLeanSupport";
    if (disagreeStrong) return "snapshotSentence.techStrongOppose";
    if (disagreeLean)   return "snapshotSentence.techLeanOppose";
    return "snapshotSentence.techMixed";
  }
  if (t.match(/health|medical|nhs|pharma/)) {
    if (agreeStrong)    return "snapshotSentence.healthStrongSupport";
    if (agreeLean)      return "snapshotSentence.healthLeanSupport";
    if (disagreeStrong) return "snapshotSentence.healthStrongOppose";
    if (disagreeLean)   return "snapshotSentence.healthLeanOppose";
    return "snapshotSentence.healthMixed";
  }
  if (t.match(/educat|school|universit|student/)) {
    if (agreeStrong)    return "snapshotSentence.eduStrongSupport";
    if (agreeLean)      return "snapshotSentence.eduLeanSupport";
    if (disagreeStrong) return "snapshotSentence.eduStrongOppose";
    if (disagreeLean)   return "snapshotSentence.eduLeanOppose";
    return "snapshotSentence.eduMixed";
  }
  if (t.match(/immigra|border|asylum|migrant/)) {
    if (agreeStrong)    return "snapshotSentence.immStrongSupport";
    if (agreeLean)      return "snapshotSentence.immLeanSupport";
    if (disagreeStrong) return "snapshotSentence.immStrongOppose";
    if (disagreeLean)   return "snapshotSentence.immLeanOppose";
    return "snapshotSentence.immMixed";
  }
  if (t.match(/crime|justice|police|prison/)) {
    if (agreeStrong)    return "snapshotSentence.justiceStrongSupport";
    if (agreeLean)      return "snapshotSentence.justiceLeanSupport";
    if (disagreeStrong) return "snapshotSentence.justiceStrongOppose";
    if (disagreeLean)   return "snapshotSentence.justiceLeanOppose";
    return "snapshotSentence.justiceMixed";
  }
  const tagLabel = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
  if (agreeStrong)    return `tend to strongly support the direction on ${tagLabel} issues.`;
  if (agreeLean)      return `generally lean toward agreement on ${tagLabel} questions.`;
  if (disagreeStrong) return `tend to strongly oppose the current ${tagLabel} direction.`;
  if (disagreeLean)   return `tend to lean against current ${tagLabel} policy.`;
  return `have a mixed view on ${tagLabel} issues.`;
}

function categoryLabel(tag: string | null | undefined, topicTitle: string): string {
  if (!tag) return topicTitle;
  const t = tag.toLowerCase();
  if (t.match(/environ|climate/)) return "Environment & climate";
  if (t.match(/hous/))            return "Housing";
  if (t.match(/econom|tax/))      return "Economy";
  if (t.match(/tech|ai|digital/)) return "Technology";
  if (t.match(/health/))          return "Health";
  if (t.match(/educat/))          return "Education";
  if (t.match(/immigra/))         return "Immigration";
  if (t.match(/crime|justice/))   return "Justice & law";
  return tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
}

export default function StanceSnapshotCard() {
  const { t: tr } = useTranslation();
  const sb = React.useMemo(getSupabase, []);

  const { data, isLoading, isError } = useQuery<StanceSnapshot>({
    queryKey: ["epic-q", "q1", "stance-snapshot"],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("Supabase client not available");
      const { data, error } = await supabase
        .rpc("get_my_stance_snapshot", { p_limit_topics: 3 })
        .single();
      if (error) throw error;
      return data as StanceSnapshot;
    },
    enabled: !!sb,
    staleTime: 60_000,
    retry: false,
  });

  return (
    <Card className="mb-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-900">
          {tr("stanceSnapshot.yourStanceSnapshot")}
        </CardTitle>
        <CardDescription className="text-xs text-slate-500 mt-0.5">
          {tr("stanceSnapshot.thisIsAReflectionOf")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && <div className="text-xs text-slate-500">{tr("stanceSnapshot.loadingYourSnapshot")}</div>}
        {isError && <div className="text-xs text-slate-500">{tr("stanceSnapshot.couldNotLoadSnapshotRight")}</div>}
        {!isLoading && !isError && (!data || data.total_answered === 0) && (
          <div className="text-xs text-slate-500">
            {tr("stanceSnapshot.asYouAnswerMoreQuestions")}
          </div>
        )}
        {!isLoading && !isError && data && data.total_answered > 0 && (
          <div className="space-y-3">
            <div className="text-xs text-slate-700">{data.region.alignment_label}</div>
            {(data.topics ?? []).length > 0 && (
              <div className="space-y-2">
                {(data.topics ?? []).map((t) => {
                  const firstTag = t.tags?.[0] ?? null;
                  const label = categoryLabel(firstTag, t.topic_title);
                  const sentence = topicSentence(firstTag, t.avg_score);
                  return (
                    <div key={t.topic_title} className="rounded-md border border-slate-100 px-3 py-2.5">
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-0.5">
                        {label}
                      </div>
                      <div className="text-sm text-slate-800">
                        {tr("stanceSnapshot.onTheseQuestionsYou", { sentence: tr(sentence) })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
