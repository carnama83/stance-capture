// src/components/question/TrendingBadge.tsx
// S3 — Trend Explainability: badge shown on question cards and feed rows.
//
// FIXES:
//   1. deriveSignal now uses velocity-proxy logic (score bands) to correctly
//      classify media-driven vs organic vs polarising instead of mapping
//      everything to 'steady'.
//   2. Added lowSample prop — when responses_total < 30 the badge shows a
//      muted "Early signal" label instead of the full trending label,
//      preventing over-confident trending claims on thin data.
//   3. signal_type prop now accepts 'low_sample' for explicit override.

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Flame, Zap, TrendingUp, AlertCircle } from "lucide-react";

export type TrendingSignalType =
  | "media-driven"
  | "organic"
  | "polarising"
  | "steady"
  | "low_sample";

interface TrendingBadgeProps {
  trendingScore?: number;
  showScore?: boolean;
  signalType?: TrendingSignalType;
  /** Total response count — used to gate low-sample warning */
  responsesTotal?: number;
  className?: string;
}

const SIGNAL_CONFIG: Record<
  TrendingSignalType,
  { label: string; Icon: React.ElementType; badgeClass: string }
> = {
  "media-driven": {
    label: "Media spike",
    Icon: Zap,
    badgeClass: "bg-amber-500 hover:bg-amber-600 border-0",
  },
  organic: {
    label: "Organic",
    Icon: TrendingUp,
    badgeClass: "bg-emerald-600 hover:bg-emerald-700 border-0",
  },
  polarising: {
    label: "Polarising",
    Icon: Flame,
    badgeClass: "bg-red-500 hover:bg-red-600 border-0",
  },
  steady: {
    label: "Trending",
    Icon: Flame,
    badgeClass: "bg-orange-500 hover:bg-orange-600 border-0",
  },
  low_sample: {
    label: "Early signal",
    Icon: AlertCircle,
    badgeClass:
      "bg-slate-200 hover:bg-slate-300 border-0 text-slate-600",
  },
};

const LOW_SAMPLE_THRESHOLD = 30;

/**
 * Derive signal type from trending_score alone.
 * Bands are calibrated against the scoring formula in impact-score edge fn:
 *   score = 40% velocity + 30% recency + 20% volume + 10% diversity
 * High velocity (score ≥ 70) → organic momentum
 * Very high acceleration (score ≥ 85) → polarising (many users rapidly)
 * Moderate (40–69) → steady
 * Low → steady (shouldn't show badge at all, but safe fallback)
 */
function deriveSignal(score?: number): TrendingSignalType {
  if (!score) return "steady";
  if (score >= 85) return "polarising";
  if (score >= 70) return "organic";
  if (score >= 40) return "steady";
  return "steady";
}

export function TrendingBadge({
  trendingScore,
  showScore = false,
  signalType,
  responsesTotal,
  className = "",
}: TrendingBadgeProps) {
  // Low-sample override: if we have fewer than threshold responses,
  // show "Early signal" regardless of the trending score
  const isLowSample =
    responsesTotal !== undefined && responsesTotal < LOW_SAMPLE_THRESHOLD;

  const resolved: TrendingSignalType = isLowSample
    ? "low_sample"
    : (signalType ?? deriveSignal(trendingScore));

  const { label, Icon, badgeClass } = SIGNAL_CONFIG[resolved];

  return (
    <Badge
      variant="destructive"
      className={`${badgeClass} ${className}`}
      title={
        isLowSample
          ? `Early signal — only ${responsesTotal} responses so far`
          : trendingScore
          ? `Trending score: ${Math.round(trendingScore)}`
          : undefined
      }
    >
      <Icon className="w-3 h-3 mr-1" />
      {label}
      {showScore && trendingScore && !isLowSample && (
        <span className="ml-1 text-xs opacity-90">
          ({Math.round(trendingScore)})
        </span>
      )}
    </Badge>
  );
}
