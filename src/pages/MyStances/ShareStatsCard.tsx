// src/pages/MyStances/ShareStatsCard.tsx
// Epic W — Social Sharing (W6)
//
// Shows the user how their shared questions are performing.
// "Your share of [question] got X views" — closes the contribution loop.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Share2, ExternalLink, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

interface ShareStat {
  question_id: string;
  question_text: string;
  total_shares: number;
  total_clicks: number;
  last_shared_at: string;
}

function useMyShareStats() {
  return useQuery<ShareStat[]>({
    queryKey: ["my-share-stats"],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_share_stats");
      if (error) throw error;
      return (data ?? []) as ShareStat[];
    },
  });
}

export function ShareStatsCard() {
  const { data: stats, isLoading } = useMyShareStats();

  // Only show if user has shared something
  if (isLoading || !stats || stats.length === 0) return null;

  const totalClicks = stats.reduce((sum, s) => sum + (s.total_clicks ?? 0), 0);
  const totalShares = stats.reduce((sum, s) => sum + (s.total_shares ?? 0), 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Share2 className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-800">Your shares</h3>
        <span className="ml-auto text-xs text-slate-400">{totalShares} share{totalShares !== 1 ? "s" : ""} · {totalClicks} view{totalClicks !== 1 ? "s" : ""}</span>
      </div>

      {/* Stats rows */}
      <div className="divide-y divide-slate-50">
        {stats.slice(0, 5).map((stat) => (
          <div key={stat.question_id} className="px-4 py-3 flex items-start gap-3">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-700 line-clamp-2 leading-relaxed">
                {stat.question_text}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {stat.total_clicks > 0 ? (
                  <span className="text-emerald-600 font-medium">{stat.total_clicks} view{stat.total_clicks !== 1 ? "s" : ""}</span>
                ) : (
                  <span>No clicks yet</span>
                )}
                {" · "}
                {stat.total_shares} share{stat.total_shares !== 1 ? "s" : ""}
              </p>
            </div>
            <Link
              to={`/q/${stat.question_id}`}
              className="shrink-0 p-1 text-slate-300 hover:text-slate-500 transition-colors"
              title="View question"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        ))}
      </div>

      {stats.length > 5 && (
        <div className="px-4 py-2 border-t border-slate-100">
          <p className="text-xs text-slate-400 text-center">+{stats.length - 5} more shared questions</p>
        </div>
      )}
    </div>
  );
}
