// src/pages/MyStances/StanceSnapshotCard.tsx
// Phase 3 — Q1: Natural-language category sentences using topic tags.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";

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
    if (agreeStrong)    return "tend to strongly support this area.";
    if (agreeLean)      return "tend to lean in favour of this area.";
    if (disagreeStrong) return "tend to strongly oppose this area.";
    if (disagreeLean)   return "tend to lean against this area.";
    return "have mixed views in this area.";
  }
  if (t.match(/environ|climate|energy|carbon|green/)) {
    if (agreeStrong)    return "tend to strongly support stronger environmental regulation.";
    if (agreeLean)      return "tend to support action on environmental issues.";
    if (disagreeStrong) return "tend to strongly oppose current environmental policy direction.";
    if (disagreeLean)   return "tend to be cautious about environmental regulation.";
    return "have a mixed view on environmental policy.";
  }
  if (t.match(/hous|property|rent|zoning/)) {
    if (agreeStrong)    return "tend to strongly support housing reform.";
    if (agreeLean)      return "tend to lean toward more housing intervention.";
    if (disagreeStrong) return "tend to strongly oppose current housing policy direction.";
    if (disagreeLean)   return "are generally cautious about housing policy changes.";
    return "have mixed views on housing policy.";
  }
  if (t.match(/econom|tax|fiscal|budget|trade/)) {
    if (agreeStrong)    return "tend to strongly support economic intervention.";
    if (agreeLean)      return "generally lean toward economic reform.";
    if (disagreeStrong) return "tend to strongly oppose the current economic direction.";
    if (disagreeLean)   return "tend to favour a more conservative economic approach.";
    return "have a balanced view on economic policy.";
  }
  if (t.match(/tech|ai|digital|data|cyber/)) {
    if (agreeStrong)    return "tend to strongly support technology regulation and oversight.";
    if (agreeLean)      return "are generally in favour of more technology oversight.";
    if (disagreeStrong) return "tend to strongly oppose increased tech regulation.";
    if (disagreeLean)   return "tend to be cautious about technology regulation.";
    return "have nuanced views on technology policy.";
  }
  if (t.match(/health|medical|nhs|pharma/)) {
    if (agreeStrong)    return "tend to strongly support investment in public health.";
    if (agreeLean)      return "generally lean toward stronger healthcare provision.";
    if (disagreeStrong) return "tend to strongly oppose the current healthcare direction.";
    if (disagreeLean)   return "tend to favour market-led approaches to healthcare.";
    return "have mixed views on healthcare policy.";
  }
  if (t.match(/educat|school|universit|student/)) {
    if (agreeStrong)    return "tend to strongly support increased education investment.";
    if (agreeLean)      return "generally lean toward more investment in education.";
    if (disagreeStrong) return "tend to strongly oppose the current education direction.";
    if (disagreeLean)   return "tend to favour more choice and autonomy in education.";
    return "have mixed views on education policy.";
  }
  if (t.match(/immigra|border|asylum|migrant/)) {
    if (agreeStrong)    return "tend to strongly support more open immigration policy.";
    if (agreeLean)      return "generally lean toward more welcoming immigration policy.";
    if (disagreeStrong) return "tend to strongly support stricter immigration controls.";
    if (disagreeLean)   return "tend to favour tighter immigration policy.";
    return "have a nuanced view on immigration.";
  }
  if (t.match(/crime|justice|police|prison/)) {
    if (agreeStrong)    return "tend to strongly support reform of the justice system.";
    if (agreeLean)      return "generally lean toward criminal justice reform.";
    if (disagreeStrong) return "tend to strongly support tougher law enforcement.";
    if (disagreeLean)   return "tend to favour a more traditional approach to law and order.";
    return "have mixed views on criminal justice.";
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
          Your stance snapshot
        </CardTitle>
        <CardDescription className="text-xs text-slate-500 mt-0.5">
          This is a reflection of how you've responded so far. It's not a score — just a snapshot in time.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && <div className="text-xs text-slate-500">Loading your snapshot…</div>}
        {isError && <div className="text-xs text-slate-500">Could not load snapshot right now.</div>}
        {!isLoading && !isError && (!data || data.total_answered === 0) && (
          <div className="text-xs text-slate-500">
            As you answer more questions, patterns will begin to appear here.
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
                        On these questions, you {sentence}
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
