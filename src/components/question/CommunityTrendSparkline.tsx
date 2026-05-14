// src/components/question/CommunityTrendSparkline.tsx
// O3 — Inline 7-day trend sparkline on QuestionDetailPage.
// Shows whether community support has been rising, falling, or stable
// over the last 7 days. Rendered below the CommunityStanceBar.
// Data: get_macro_trends RPC (p_days=7, global scope).

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type TrendPoint = {
  snapshot_date: string;
  total_responses: number;
  avg_score: number;
  pct_support: number;
  pct_neutral: number;
  pct_oppose: number;
  is_low_sample: boolean;
};

function trendDirection(points: TrendPoint[]): {
  label: string;
  delta: number;
  icon: "up" | "down" | "flat";
} {
  if (points.length < 2) return { label: "Not enough data", delta: 0, icon: "flat" };
  const first = points[0].pct_support;
  const last  = points[points.length - 1].pct_support;
  const delta = Math.round(last - first);
  if (delta > 2)  return { label: `Support up ${delta}pp this week`, delta, icon: "up" };
  if (delta < -2) return { label: `Support down ${Math.abs(delta)}pp this week`, delta, icon: "down" };
  return { label: "Sentiment steady this week", delta, icon: "flat" };
}

interface CommunityTrendSparklineProps {
  questionId: string;
}

export function CommunityTrendSparkline({ questionId }: CommunityTrendSparklineProps) {
  const { data: points, isLoading, isError, error } = useQuery<TrendPoint[]>({
    queryKey: ["community-trend", questionId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb.rpc("get_macro_trends", {
        p_region_scope: "global",
        p_region_key:   "global",
        p_days:         7,
        p_question_id:  questionId,
      });
      if (error) {
        console.error("[CommunityTrendSparkline] RPC error:", error);
        return [];
      }
      console.log("[CommunityTrendSparkline] points:", data);
      return (data ?? []) as TrendPoint[];
    },
  });

  if (isLoading || !points || points.length < 2) {
    console.log("[CommunityTrendSparkline] returning null —", { isLoading, isError, pointsLength: points?.length });
    return null;
  }

  // Use all points for the sparkline — filtering out low-sample days leaves
  // too few points at early stage. Low-sample days are marked with a dimmed
  // dot on the line instead of being silently dropped.
  const validPoints = points;
  if (validPoints.length < 2) return null;

  const hasLowSample = points.some((p) => p.is_low_sample);
  const trend = trendDirection(validPoints);

  // Build SVG sparkline — shows pct_support as a line
  const W = 80;
  const H = 20;
  const pad = 2;
  const minVal = Math.min(...validPoints.map((p) => p.pct_support));
  const maxVal = Math.max(...validPoints.map((p) => p.pct_support));
  const range  = maxVal - minVal || 1;

  const pts = validPoints.map((p, i) => {
    const x = pad + (i / (validPoints.length - 1)) * (W - pad * 2);
    const y = H - pad - ((p.pct_support - minVal) / range) * (H - pad * 2);
    return { x, y };
  });

  const pathD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const strokeColor =
    trend.icon === "up"   ? "#639922" :
    trend.icon === "down" ? "#D85A30" :
    "#B4B2A9";

  const Icon =
    trend.icon === "up"   ? TrendingUp   :
    trend.icon === "down" ? TrendingDown :
    Minus;

  const iconClass =
    trend.icon === "up"   ? "text-emerald-600" :
    trend.icon === "down" ? "text-red-500"      :
    "text-slate-400";

  return (
    <div className="flex items-center gap-2 pt-2 mt-2 border-t border-slate-100">
      {/* Sparkline */}
      <svg width={W} height={H} aria-hidden className="shrink-0 overflow-visible">
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
        {/* End dot */}
        <circle
          cx={pts[pts.length - 1].x}
          cy={pts[pts.length - 1].y}
          r="2"
          fill={strokeColor}
          opacity={validPoints[validPoints.length - 1].is_low_sample ? 0.4 : 1}
        />
      </svg>

      {/* Label */}
      <div className="flex items-center gap-1">
        <Icon className={`h-3 w-3 shrink-0 ${iconClass}`} />
        <span className={`text-[10px] font-medium ${iconClass}`}>
          {trend.label}
        </span>
        {hasLowSample && (
          <span className="text-[10px] text-slate-400 font-normal ml-0.5">(early data)</span>
        )}
      </div>
    </div>
  );
}
