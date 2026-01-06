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
import { TrendingUp, TrendingDown, Activity, Minus } from "lucide-react";

type TopicChange = {
  topic_id: string;
  topic_title: string;
  change_type: "shifted_positive" | "shifted_negative" | "gaining_attention" | "stable";
  delta: number;
  new_responses: number;
};

type SinceLastVisited = {
  last_seen_at: string;
  days_away: number;
  region: {
    scope: string;
    label: string;
  };
  changes: TopicChange[];
  has_changes: boolean;
};

function getChangeIcon(changeType: string) {
  switch (changeType) {
    case "shifted_positive":
      return <TrendingUp className="h-4 w-4 text-emerald-600" />;
    case "shifted_negative":
      return <TrendingDown className="h-4 w-4 text-rose-600" />;
    case "gaining_attention":
      return <Activity className="h-4 w-4 text-blue-600" />;
    default:
      return <Minus className="h-4 w-4 text-slate-400" />;
  }
}

function getChangeText(change: TopicChange, regionLabel: string): string {
  const topicName = change.topic_title;
  
  switch (change.change_type) {
    case "shifted_positive":
      return `${topicName} sentiment has shifted more positive.`;
    case "shifted_negative":
      return `${topicName} sentiment has shifted more negative.`;
    case "gaining_attention":
      return `${topicName} is gaining attention (${change.new_responses} new responses).`;
    default:
      return `${topicName} is relatively stable.`;
  }
}

function formatDaysAway(days: number): string {
  if (days === 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

export default function SinceLastVisitCard() {
  const sb = React.useMemo(getSupabase, []);

  const { data, isLoading, isError, error } = useQuery<SinceLastVisited>({
    queryKey: ["epic-q", "q2", "since-last-visited"],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("Supabase client not available");

      console.log("[Q2] Calling get_since_last_visited RPC...");

      const { data, error } = await supabase
        .rpc("get_since_last_visited")
        .single();

      if (error) {
        console.error("[Q2] RPC Error:", error);
        throw error;
      }

      console.log("[Q2] RPC Success:", data);
      return data as SinceLastVisited;
    },
    enabled: !!sb,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  // Update last_seen_at when component mounts
  React.useEffect(() => {
    const updateLastSeen = async () => {
      const supabase = getSupabase();
      if (!supabase) return;

      try {
        await supabase.rpc("update_last_seen");
        console.log("[Q2] Updated last_seen_at");
      } catch (err) {
        console.error("[Q2] Failed to update last_seen_at:", err);
      }
    };

    // Update after a short delay so we capture the visit
    const timer = setTimeout(updateLastSeen, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Since You Last Visited</CardTitle>
        <CardDescription>
          What's changed in the community while you were away.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="text-sm text-slate-600">Loading updates…</div>
        ) : isError ? (
          <div className="text-sm text-slate-600">
            Unable to load updates. Please try again.
          </div>
        ) : !data ? (
          <div className="text-sm text-slate-600">No data available.</div>
        ) : (
          <div className="space-y-4">
            {/* Time away context */}
            {data.days_away > 0 && (
              <div className="text-xs text-slate-500">
                You were away for {formatDaysAway(data.days_away)}.
              </div>
            )}

            {/* Changes */}
            {data.has_changes && data.changes.length > 0 ? (
              <div className="space-y-3">
                {data.changes.map((change) => (
                  <div
                    key={change.topic_id}
                    className="flex items-start gap-3 rounded-md border p-3"
                  >
                    <div className="mt-0.5">
                      {getChangeIcon(change.change_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-800">
                        {getChangeText(change, data.region.label)}
                      </div>
                      {change.delta !== 0 && (
                        <div className="text-xs text-slate-500 mt-1">
                          Shift: {change.delta > 0 ? "+" : ""}
                          {change.delta.toFixed(2)} on average
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-600">
                Things have been relatively steady while you were away.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
