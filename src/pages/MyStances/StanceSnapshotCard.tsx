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

type SnapshotTopic = {
  topic_title: string;
  n: number; // returned by RPC but we intentionally don't display counts
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

function stancePhrase(avgScore: number | null): string {
  if (avgScore === null || Number.isNaN(avgScore)) return "are mixed";
  if (avgScore >= 1.25) return "tend to strongly agree";
  if (avgScore >= 0.35) return "tend to agree";
  if (avgScore <= -1.25) return "tend to strongly disagree";
  if (avgScore <= -0.35) return "tend to disagree";
  return "are mixed";
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
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Your Stance Snapshot</CardTitle>
        <CardDescription>
          This is a reflection of how you’ve responded so far. It’s not a score — just a snapshot in time.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="text-sm text-slate-600">Loading your snapshot…</div>
        ) : isError || !data || data.total_answered === 0 ? (
          <div className="text-sm text-slate-600">
            As you answer more questions, patterns will begin to appear here.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-slate-800">
              <span className="font-medium">In context:</span>{" "}
              {data.region.alignment_label}
            </div>

            <div>
              <div className="text-xs font-medium text-slate-600 mb-2">
                Patterns by topic
              </div>

              <div className="space-y-2">
                {(data.topics ?? []).map((t) => (
                  <div key={t.topic_title} className="rounded-md border p-3">
                    <div className="text-sm font-medium text-slate-900">
                      {t.topic_title}
                    </div>
                    <div className="text-sm text-slate-700 mt-0.5">
                      On this topic, you {stancePhrase(t.avg_score)}.
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Based on the questions you’ve answered so far.
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
