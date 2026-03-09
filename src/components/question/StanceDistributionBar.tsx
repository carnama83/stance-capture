// src/components/question/StanceDistributionBar.tsx
//
// Shared distribution visualization component.
// Used by:
//   - Hero Result Mode (post-answer state in HeroSection)
//   - QuestionDetailPage (regional breakdown)
//
// Design decisions:
//   - Segmented bar: oppose | neutral | support, left-to-right
//   - User stance bucket highlighted with a marker
//   - Alignment text rendered below bar when showAlignment=true
//   - Gracefully handles null/zero data (shows empty bar with placeholder)
//   - No external dependencies beyond React + Tailwind

import * as React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StanceDistribution {
  support_pct: number | null;
  neutral_pct: number | null;
  oppose_pct: number | null;
  responses?: number | null;
}

export interface StanceDistributionBarProps {
  distribution: StanceDistribution;
  /** Raw slider value in -1..1 range. Used to determine which bucket the user is in. */
  userStance?: number | null;
  /** Whether to render the alignment insight line below the bar. */
  showAlignment?: boolean;
  /** Override the alignment text. If omitted, derived automatically from userStance + distribution. */
  alignmentText?: string;
  /** Visual size variant */
  size?: "sm" | "md";
  /** Show response count */
  showCount?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)}%`;
}

function formatNum(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return `${Math.round(v)}`;
}

/**
 * Determine which bucket the user's stance falls into.
 * Mirrors the existing bucket logic used in InstantFeedbackCard.
 * Slider scale: -1 (strongly oppose) → 0 (neutral) → +1 (strongly support)
 */
function getUserBucket(
  userStance: number | null | undefined
): "support" | "neutral" | "oppose" | null {
  if (userStance == null) return null;
  if (userStance > 0.15) return "support";
  if (userStance < -0.15) return "oppose";
  return "neutral";
}

function getAlignedPct(
  bucket: "support" | "neutral" | "oppose" | null,
  distribution: StanceDistribution
): number | null {
  if (!bucket) return null;
  if (bucket === "support") return distribution.support_pct ?? null;
  if (bucket === "oppose") return distribution.oppose_pct ?? null;
  return distribution.neutral_pct ?? null;
}

function deriveAlignmentText(
  bucket: "support" | "neutral" | "oppose" | null,
  alignedPct: number | null
): string | null {
  if (!bucket || alignedPct == null) return null;
  const bucketLabel =
    bucket === "support" ? "supportive"
    : bucket === "oppose" ? "opposed"
    : "neutral";
  return `You align with ${Math.round(alignedPct)}% of respondents — the ${bucketLabel} group`;
}

// ─── Segmented bar segment ────────────────────────────────────────────────────

function BarSegment({
  pct,
  color,
  label,
  isUserBucket,
  size,
  position,
}: {
  pct: number;
  color: string;
  label: string;
  isUserBucket: boolean;
  size: "sm" | "md";
  position: "left" | "middle" | "right";
}) {
  if (pct <= 0) return null;

  const radius =
    position === "left"
      ? "rounded-l-full"
      : position === "right"
      ? "rounded-r-full"
      : "";

  const height = size === "sm" ? "h-2" : "h-3";

  return (
    <div
      className="relative flex-shrink-0 transition-all duration-500"
      style={{ width: `${pct}%` }}
      title={`${label}: ${Math.round(pct)}%`}
    >
      <div
        className={`${height} ${color} ${radius} ${
          isUserBucket ? "ring-2 ring-offset-1 ring-slate-700" : ""
        } transition-all duration-300`}
      />
      {/* User marker dot on top of bucket */}
      {isUserBucket && (
        <div
          className="absolute -top-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-slate-900 ring-2 ring-white shadow-sm"
          aria-label={`Your stance: ${label}`}
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StanceDistributionBar({
  distribution,
  userStance,
  showAlignment = false,
  alignmentText,
  size = "md",
  showCount = false,
}: StanceDistributionBarProps) {
  const { support_pct, neutral_pct, oppose_pct, responses } = distribution;

  // Normalise: if all null/zero, show placeholder
  const total =
    (support_pct ?? 0) + (neutral_pct ?? 0) + (oppose_pct ?? 0);
  const hasData = total > 0;

  const bucket = getUserBucket(userStance);
  const alignedPct = getAlignedPct(bucket, distribution);

  // Resolve alignment text
  const resolvedAlignmentText =
    alignmentText ??
    (showAlignment && hasData
      ? deriveAlignmentText(bucket, alignedPct)
      : null);

  // Label sizes
  const labelSize = size === "sm" ? "text-[10px]" : "text-[11px]";
  const textGap = size === "sm" ? "mt-1.5" : "mt-2";

  return (
    <div className="w-full">
      {/* ── Bar track ── */}
      {hasData ? (
        <div className="flex w-full overflow-hidden rounded-full bg-slate-100">
          <BarSegment
            pct={oppose_pct ?? 0}
            color="bg-rose-400"
            label="Oppose"
            isUserBucket={bucket === "oppose"}
            size={size}
            position="left"
          />
          <BarSegment
            pct={neutral_pct ?? 0}
            color="bg-slate-300"
            label="Neutral"
            isUserBucket={bucket === "neutral"}
            size={size}
            position={
              (oppose_pct ?? 0) === 0
                ? "left"
                : (support_pct ?? 0) === 0
                ? "right"
                : "middle"
            }
          />
          <BarSegment
            pct={support_pct ?? 0}
            color="bg-emerald-400"
            label="Support"
            isUserBucket={bucket === "support"}
            size={size}
            position="right"
          />
        </div>
      ) : (
        /* Empty state */
        <div
          className={`w-full rounded-full bg-slate-100 ${
            size === "sm" ? "h-2" : "h-3"
          }`}
        />
      )}

      {/* ── Labels row ── */}
      <div className={`${textGap} flex justify-between ${labelSize} text-slate-500`}>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400" />
          Oppose {hasData ? formatPct(oppose_pct) : "—"}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
          Neutral {hasData ? formatPct(neutral_pct) : "—"}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Support {hasData ? formatPct(support_pct) : "—"}
        </span>
      </div>

      {/* ── Response count ── */}
      {showCount && responses != null && responses > 0 && (
        <p className={`mt-1 ${labelSize} text-slate-400`}>
          {formatNum(responses)} response{responses === 1 ? "" : "s"}
        </p>
      )}

      {/* ── Alignment insight ── */}
      {resolvedAlignmentText && (
        <div className="mt-2.5 flex items-start gap-1.5">
          <span className="mt-px text-emerald-500 text-xs">✓</span>
          <p className="text-xs text-slate-600 leading-snug">
            {resolvedAlignmentText}
          </p>
        </div>
      )}
    </div>
  );
}

export default StanceDistributionBar;
