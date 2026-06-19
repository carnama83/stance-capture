// src/components/question/CommunityStanceBar.tsx
//
// Phase 2 — Shared presentational Community Stance bar component.
//
// Rules:
//   - NO fetching
//   - NO subscriptions
//   - NO mutations
//   - Pure display only
//
// Used by:
//   - Hero (HeroSection / useHeroController)
//   - QuestionDetailPage right-rail community stance card
//
// Props use the normalized CommunityStanceData field names (supportPct / opposePct)
// NOT the raw DB names (pct_agree / pct_disagree).

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { resolvePoleLabels, distinctPoleLabels } from "@/lib/poleLabels";

// ── Props ──────────────────────────────────────────────────────────────────────

export interface CommunityStanceBarProps {
  /** Total number of responses. Shown below the bar. */
  responses: number;
  /** % of responses that are supportive (pct_agree from DB). 0–100 or null. */
  supportPct: number | null;
  /** % of responses that are opposed (pct_disagree from DB). 0–100 or null. */
  opposePct: number | null;
  /** % of responses that are neutral (pct_neutral from DB). 0–100 or null. */
  neutralPct: number | null;
  /** Display label for the scope shown (e.g. "Global"). */
  regionLabel?: string;
  /** Optional average score to display below bar. */
  avgScore?: number | null;
  /** Show skeleton/loading state. */
  isLoading?: boolean;
  /** True when responses === 0 or data is null. */
  isEmpty?: boolean;
  /** Optional manual refresh callback. Shows a Refresh button when provided. */
  onRefresh?: () => void;
  /** Compact mode — tighter spacing, smaller text. Used in hero. */
  compact?: boolean;
  /**
   * Negative-pole label for this question (slider_low_label). When provided
   * (with highLabel), the legend reads in the question's own terms instead of
   * "Oppose". Omit for pre-QF questions to keep the generic frame.
   */
  lowLabel?: string | null;
  /** Positive-pole label for this question (slider_high_label). See lowLabel. */
  highLabel?: string | null;
}

// ── S3: Conviction vs noise indicator ────────────────────────────────────────
// Derived from the distribution itself — no extra data needed.
// "High conviction" = dominant side ≥ 65% and neutral < 20%
// "Strongly polarised" = both sides ≥ 30% and neutral < 25%
// "Mixed views" = everything else
function convictionLabel(
  supportPct: number | null,
  opposePct: number | null,
  neutralPct: number | null,
  responses: number,
): { label: string; color: string } | null {
  if (responses < 10) return null; // not enough data to classify
  const s = supportPct ?? 0;
  const o = opposePct  ?? 0;
  const n = neutralPct ?? 0;
  const dominant = Math.max(s, o);
  if (dominant >= 65 && n < 20) {
    return { label: "Strong conviction", color: "#27500A" };
  }
  if (s >= 30 && o >= 30 && n < 25) {
    return { label: "Strongly polarised", color: "#791F1F" };
  }
  if (n >= 40) {
    return { label: "Genuinely uncertain", color: "#633806" };
  }
  return null; // default — no label needed
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPct(val: number | null | undefined): string {
  if (val == null) return "0%";
  return `${Math.round(val)}%`;
}

function formatNum(val: number): string {
  return val === 1 ? "1 stance recorded" : `${val} stances recorded`;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function BarSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={`space-y-2 animate-pulse ${compact ? "py-1" : "py-2"}`}>
      <div className="h-2.5 w-full rounded-full bg-slate-200" />
      <div className="flex justify-between">
        <div className="h-3 w-16 rounded bg-slate-200" />
        <div className="h-3 w-16 rounded bg-slate-200" />
        <div className="h-3 w-16 rounded bg-slate-200" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CommunityStanceBar({
  responses,
  supportPct,
  opposePct,
  neutralPct,
  regionLabel,
  avgScore,
  isLoading = false,
  isEmpty = false,
  onRefresh,
  compact = false,
  lowLabel,
  highLabel,
}: CommunityStanceBarProps) {

  // Pole-aware labels: use the question's own poles when present, otherwise the
  // generic oppose/support frame. Pure relabel — numbers/percentages unchanged.
  // Negative pole (opposePct / red) → low label; positive pole (supportPct /
  // green) → high label.
  const { negFull, posFull } = resolvePoleLabels(lowLabel, highLabel);
  const { negShort, posShort } = distinctPoleLabels(negFull, posFull);

  // ── Loading state ──
  if (isLoading) {
    return (
      <div>
        <Header compact={compact} onRefresh={onRefresh} isLoading={true} />
        <BarSkeleton compact={compact} />
      </div>
    );
  }

  // ── Empty state — show bar frame so layout is stable, just with no segments ──
  if (isEmpty || responses === 0) {
    return (
      <div className="space-y-2">
        <Header compact={compact} onRefresh={onRefresh} isLoading={false} />
        {/* Empty bar frame — same height as populated bar */}
        <div
          className="w-full rounded-full bg-slate-100"
          style={{ height: compact ? 8 : 10 }}
          role="img"
          aria-label="No stances recorded yet"
        />
        <div className={`flex items-center justify-between ${compact ? "text-[11px]" : "text-xs"} text-slate-400`}>
          <span title={negFull}>
            <span className="inline-block h-2 w-2 rounded-full bg-slate-200 mr-1 align-middle" />
            {negShort} 0%
          </span>
          <span>
            <span className="inline-block h-2 w-2 rounded-full bg-slate-200 mr-1 align-middle" />
            Neutral 0%
          </span>
          <span title={posFull}>
            <span className="inline-block h-2 w-2 rounded-full bg-slate-200 mr-1 align-middle" />
            {posShort} 0%
          </span>
        </div>
        <p className={`${compact ? "text-[11px]" : "text-xs"} text-slate-400`}>
          No stances recorded yet.
        </p>
      </div>
    );
  }

  // ── Segment widths ──
  // Clamp to 0 to handle any floating-point edge cases.
  const opposeW  = Math.max(0, opposePct  ?? 0);
  const neutralW = Math.max(0, neutralPct ?? 0);
  const supportW = Math.max(0, supportPct ?? 0);

  // Normalise so segments always sum to 100 (guards against rounding drift).
  const total = opposeW + neutralW + supportW;
  const norm = total > 0 ? 100 / total : 1;
  const oW = opposeW  * norm;
  const nW = neutralW * norm;
  const sW = supportW * norm;

  // S3: conviction vs noise label
  const conviction = convictionLabel(supportPct, opposePct, neutralPct, responses);

  return (
    <div className="space-y-2">
      {/* Label row */}
      <Header compact={compact} onRefresh={onRefresh} isLoading={false} />

      {/* Segmented bar */}
      <div
        className="flex w-full overflow-hidden rounded-full"
        style={{ height: compact ? 8 : 10 }}
        role="img"
        aria-label={`Community stance: ${formatPct(opposePct)} ${negFull}, ${formatPct(neutralPct)} neutral, ${formatPct(supportPct)} ${posFull}`}
      >
        {oW > 0 && (
          <div
            className="bg-red-400 transition-all duration-500"
            style={{ width: `${oW}%` }}
          />
        )}
        {nW > 0 && (
          <div
            className="bg-slate-300 transition-all duration-500"
            style={{ width: `${nW}%` }}
          />
        )}
        {sW > 0 && (
          <div
            className="bg-emerald-400 transition-all duration-500"
            style={{ width: `${sW}%` }}
          />
        )}
        {/* Full bar fallback if all zero */}
        {oW === 0 && nW === 0 && sW === 0 && (
          <div className="w-full bg-slate-200" />
        )}
      </div>

      {/* Legend row */}
      <div
        className={`flex items-center justify-between ${
          compact ? "text-[11px]" : "text-xs"
        } text-slate-600`}
      >
        <span title={negFull}>
          <span className="inline-block h-2 w-2 rounded-full bg-red-400 mr-1 align-middle" />
          {negShort} {formatPct(opposePct)}
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-slate-300 mr-1 align-middle" />
          Neutral {formatPct(neutralPct)}
        </span>
        <span title={posFull}>
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1 align-middle" />
          {posShort} {formatPct(supportPct)}
        </span>
      </div>

      {/* Response count + optional avg score */}
      <div
        className={`flex items-center justify-between ${
          compact ? "text-[11px]" : "text-xs"
        } text-slate-500`}
      >
        <span>{formatNum(responses)}</span>
        {avgScore != null && (
          <span className="text-[10px] text-slate-400">
            avg {avgScore.toFixed(2)} (−2 to +2)
          </span>
        )}
      </div>

      {/* S3: conviction vs noise indicator */}
      {conviction && !compact && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: conviction.color }}
          />
          <span
            className="text-[10px] font-medium"
            style={{ color: conviction.color }}
          >
            {conviction.label}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Header sub-component ──────────────────────────────────────────────────────

function Header({
  compact,
  onRefresh,
  isLoading,
}: {
  compact?: boolean;
  onRefresh?: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-1">
      <span
        className={`font-semibold tracking-wide uppercase text-slate-500 ${
          compact ? "text-[10px]" : "text-[11px]"
        }`}
      >
        Community Stance
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          aria-label="Refresh community stance"
        >
          <RefreshCw
            className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`}
          />
          <span>Refresh</span>
        </button>
      )}
    </div>
  );
}
