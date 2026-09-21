import * as React from "react";
import i18n from "@/lib/i18n";
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
import { useTranslation } from "react-i18next";

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
  const topic = change.topic_title;

  switch (change.change_type) {
    case "shifted_positive":
      return i18n.t("sinceLastVisit.shiftedPositive", { topic });
    case "shifted_negative":
      return i18n.t("sinceLastVisit.shiftedNegative", { topic });
    case "gaining_attention":
      return i18n.t("sinceLastVisit.gainingAttention", { topic, count: change.new_responses });
    default:
      return i18n.t("sinceLastVisit.relativelyStable", { topic });
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
  const { t } = useTranslation();
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
        <CardTitle>{t("sinceLastVisit.sinceYouLastVisited")}</CardTitle>
        <CardDescription>
          {t("sinceLastVisit.whatSChangedInThe")}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="text-sm text-slate-600">{t("sinceLastVisit.loadingUpdates")}</div>
        ) : isError ? (
          <div className="text-sm text-slate-600">
            {t("sinceLastVisit.unableToLoadUpdatesPlease")}
          </div>
        ) : !data ? (
          <div className="text-sm text-slate-600">{t("sinceLastVisit.noDataAvailable")}</div>
        ) : (
          <div className="space-y-4">
            {/* Time away context */}
            {data.days_away > 0 && (
              <div className="text-xs text-slate-500">
                {t("sinceLastVisit.awayFor", { duration: formatDaysAway(data.days_away) })}
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
                          {t("sinceLastVisit.shiftOnAverage", {
                            delta: `${change.delta > 0 ? "+" : ""}${change.delta.toFixed(2)}`,
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-600">
                {t("sinceLastVisit.thingsHaveBeenRelativelySteady")}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
