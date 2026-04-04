// src/components/insights/WhyIsTrendingPanel.tsx
// S3 — Trend Explainability: "Why is this trending?" panel on QDP right rail.
//
// ENHANCED (S3 signal provenance):
//   - Added source diversity indicator: how many distinct news outlets
//     contributed to this question's topic cluster
//   - Added confidence/quality label: Low sample / Building / Established /
//     Strong signal — shown on both collapsed and expanded state
//   - Added momentum decomposition: breaks velocity into its contributing
//     components (volume, recency, user diversity)
//   - Added low-sample warning when total_responses < 30
//   - Media-driven signal now correctly scoped to the question's topic cluster
//     rather than fetching the global top surge

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { TrendingUp, ChevronDown, ChevronUp, AlertCircle, Users, Newspaper, Zap } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type TrendingMetrics = {
  responses_total: number;
  responses_24h: number;
  responses_7d: number;
  responses_prev_24h: number;
  unique_users_24h: number;
  velocity_score: number;
  recency_score: number;
  volume_score: number;
  diversity_score: number;
  trending_score: number;
};

type RegionalRow = {
  region_scope: string;
  region_label: string;
  total_responses: number;
  pct_support: number | null;
  pct_oppose: number | null;
  pct_neutral: number | null;
};

type SourceProvenanceRow = {
  source_count: number;
  source_diversity_score: number;
  trend_reason: string | null;
  days_since_published: number;
};

type SignalType = "media-driven" | "organic" | "polarising" | "steady";
type ConfidenceLevel = "low" | "building" | "established" | "strong";

// ── Signal classification ─────────────────────────────────────────────────────

function classifySignal(
  metrics: TrendingMetrics,
  provenance: SourceProvenanceRow | null,
): { type: SignalType; label: string; description: string } {
  const hasMediaDrive =
    provenance && provenance.source_count >= 3 && provenance.source_diversity_score >= 0.6;

  if (hasMediaDrive) {
    return {
      type: "media-driven",
      label: "Media-driven",
      description: `${provenance!.source_count} news sources covering this topic are pushing engagement — not just organic participation.`,
    };
  }

  if (metrics.velocity_score >= 0.7) {
    return {
      type: "organic",
      label: "Organic momentum",
      description: "Growing through direct participation — not driven by a news spike. People are finding and sharing this independently.",
    };
  }

  const accel = metrics.responses_24h / Math.max(metrics.responses_7d / 7, 1);
  if (accel >= 2.5) {
    return {
      type: "polarising",
      label: "Polarising",
      description: "People on both sides are responding rapidly — the question is actively dividing opinion.",
    };
  }

  return {
    type: "steady",
    label: "Steady engagement",
    description: "Consistent participation over time with no unusual spike. A reliable long-term discussion.",
  };
}

// ── Signal quality / confidence ───────────────────────────────────────────────

function getConfidenceLevel(responses_total: number): {
  level: ConfidenceLevel;
  label: string;
  description: string;
  color: string;
} {
  if (responses_total < 30) return {
    level: "low",
    label: "Low sample",
    description: "Fewer than 30 responses — trends shown are early signals only.",
    color: "#9CA3AF",
  };
  if (responses_total < 100) return {
    level: "building",
    label: "Building signal",
    description: `${responses_total} responses — trend is forming. Check back as more people weigh in.`,
    color: "#F59E0B",
  };
  if (responses_total < 500) return {
    level: "established",
    label: "Established signal",
    description: `${responses_total} responses — a reliable picture of community sentiment.`,
    color: "#3B82F6",
  };
  return {
    level: "strong",
    label: "Strong signal",
    description: `${responses_total.toLocaleString()} responses — high-confidence community data.`,
    color: "#10B981",
  };
}

// ── Momentum component bar ────────────────────────────────────────────────────

function MomentumBar({
  label,
  value,
  max = 1,
  color,
}: {
  label: string;
  value: number;
  max?: number;
  color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex justify-between items-center mb-0.5">
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className="text-[10px] font-medium text-slate-600">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ── Colours ───────────────────────────────────────────────────────────────────

const SIGNAL_STYLES: Record<SignalType, { bg: string; text: string; border: string }> = {
  "media-driven": { bg: "#FAEEDA", text: "#633806", border: "#EF9F27" },
  "organic":      { bg: "#EAF3DE", text: "#27500A", border: "#97C459" },
  "polarising":   { bg: "#FCEBEB", text: "#791F1F", border: "#F09595" },
  "steady":       { bg: "#F1EFE8", text: "#5F5E5A", border: "#D3D1C7" },
};

// ── Main component ────────────────────────────────────────────────────────────

interface WhyIsTrendingPanelProps {
  questionId: string;
  topicId: string | null | undefined;
}

export default function WhyIsTrendingPanel({
  questionId,
  topicId,
}: WhyIsTrendingPanelProps) {
  const [expanded, setExpanded] = React.useState(false);

  // ── Core trending metrics ───────────────────────────────────────────────────
  const { data: metrics } = useQuery<TrendingMetrics | null>({
    queryKey: ["s3-trending-metrics", questionId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data, error } = await sb
        .from("question_trending_metrics")
        .select(
          "responses_total,responses_24h,responses_7d,responses_prev_24h," +
          "unique_users_24h,velocity_score,recency_score,volume_score," +
          "diversity_score,trending_score"
        )
        .eq("question_id", questionId)
        .maybeSingle();
      if (error) return null;
      return data as TrendingMetrics | null;
    },
  });

  // ── Source provenance — from get_trending_questions_v3 ─────────────────────
  // Uses the existing RPC which already returns source_count and
  // source_diversity_score per question. Much more accurate than fetching
  // the global media surge and guessing which cluster is relevant.
  const { data: provenance } = useQuery<SourceProvenanceRow | null>({
    queryKey: ["s3-provenance", questionId],
    staleTime: 10 * 60_000,
    enabled: !!questionId,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      // get_trending_questions_v3 returns source_count + source_diversity_score
      // per question. We filter to this specific question.
      const { data, error } = await sb.rpc("get_trending_questions_v3", {
        p_user_id: null,
        p_location_tier: "global",
        p_limit: 100,
      });
      if (error) return null;
      const rows = (data ?? []) as Array<{
        question_id: string;
        source_count: number;
        source_diversity_score: number;
        trend_reason: string | null;
        days_since_published: number;
      }>;
      const match = rows.find((r) => r.question_id === questionId);
      return match
        ? {
            source_count: match.source_count,
            source_diversity_score: match.source_diversity_score,
            trend_reason: match.trend_reason,
            days_since_published: match.days_since_published,
          }
        : null;
    },
  });

  // ── Regional breakdown (expanded only) ─────────────────────────────────────
  const { data: regions } = useQuery<RegionalRow[]>({
    queryKey: ["s3-regional", questionId],
    staleTime: 5 * 60_000,
    enabled: expanded,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb.rpc("get_regional_comparison", {
        p_question_id: questionId,
      });
      if (error) return [];
      return (data ?? []) as RegionalRow[];
    },
  });

  // ── Gate on meaningful trending ────────────────────────────────────────────
  if (!metrics || metrics.trending_score < 10) return null;

  const signal = classifySignal(metrics, provenance ?? null);
  const confidence = getConfidenceLevel(metrics.responses_total);
  const styles = SIGNAL_STYLES[signal.type];
  const isLowSample = metrics.responses_total < 30;

  // Momentum change: today vs yesterday
  const momentumDelta = metrics.responses_24h - (metrics.responses_prev_24h ?? 0);
  const momentumDirection = momentumDelta > 0 ? "↑" : momentumDelta < 0 ? "↓" : "→";
  const momentumColor = momentumDelta > 0 ? "#10B981" : momentumDelta < 0 ? "#EF4444" : "#6B7280";

  // Top non-global region by response count
  const topRegion = regions
    ? [...regions]
        .filter((r) => r.region_scope !== "global")
        .sort((a, b) => b.total_responses - a.total_responses)[0]
    : null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">

      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
          <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
            Why is this trending?
          </h3>
        </div>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          : <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}
      </button>

      {/* ── Collapsed summary ── */}
      {!expanded && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Signal type badge */}
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: styles.bg, color: styles.text }}
            >
              {signal.label}
            </span>

            {/* 24h response count with delta */}
            <span className="text-xs text-slate-500">
              {metrics.responses_24h} responses today
              {momentumDelta !== 0 && (
                <span style={{ color: momentumColor }} className="ml-1 font-medium">
                  {momentumDirection}{Math.abs(momentumDelta)} vs yesterday
                </span>
              )}
            </span>
          </div>

          {/* Low sample warning */}
          {isLowSample && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Early signal — only {metrics.responses_total} responses so far</span>
            </div>
          )}

          {/* Signal quality indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: confidence.color }}
              aria-hidden="true"
            />
            <span className="text-[10px] text-slate-400">{confidence.label}</span>
          </div>
        </div>
      )}

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="mt-3 space-y-3">

          {/* Low sample warning banner */}
          {isLowSample && (
            <div className="flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-[11px] text-slate-500">{confidence.description}</p>
            </div>
          )}

          {/* Signal type */}
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ background: styles.bg, borderLeft: `3px solid ${styles.border}` }}
          >
            <p className="text-xs font-medium mb-0.5" style={{ color: styles.text }}>
              {signal.label}
            </p>
            <p className="text-[11px]" style={{ color: styles.text, opacity: 0.85 }}>
              {signal.description}
            </p>
            {provenance?.trend_reason && (
              <p className="text-[10px] mt-1 italic" style={{ color: styles.text, opacity: 0.7 }}>
                {provenance.trend_reason}
              </p>
            )}
          </div>

          {/* Momentum comparison — today vs yesterday */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-slate-400 mb-0.5">Today</p>
              <p className="text-sm font-medium text-slate-900">{metrics.responses_24h}</p>
              <p className="text-[10px] text-slate-400">responses</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-slate-400 mb-0.5">Yesterday</p>
              <p className="text-sm font-medium text-slate-900">
                {metrics.responses_prev_24h ?? Math.round(metrics.responses_7d / 7)}
              </p>
              <p className="text-[10px] text-slate-400">responses</p>
            </div>
          </div>

          {/* Signal quality */}
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: confidence.color }}
              aria-hidden="true"
            />
            <span className="text-[11px] text-slate-600 font-medium">{confidence.label}</span>
            <span className="text-[11px] text-slate-400">— {confidence.description}</span>
          </div>

          {/* ── Signal provenance ─────────────────────────────────────────── */}
          <div className="border-t border-slate-100 pt-2.5 space-y-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              Signal provenance
            </p>

            {/* Source diversity */}
            {provenance && (
              <div className="flex items-center gap-2">
                <Newspaper className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-600">
                    {provenance.source_count === 0 && "No news coverage detected — organic discussion only"}
                    {provenance.source_count === 1 && "1 news source — limited coverage"}
                    {provenance.source_count >= 2 && provenance.source_count <= 4 && `${provenance.source_count} news sources — moderate coverage`}
                    {provenance.source_count >= 5 && `${provenance.source_count} news sources — broad coverage`}
                  </p>
                  {provenance.source_count > 0 && (
                    <div className="mt-1 h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, provenance.source_diversity_score * 100)}%`,
                          backgroundColor: "#3B82F6",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* User diversity */}
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              <p className="text-[11px] text-slate-600">
                {metrics.unique_users_24h} unique participants today
                {metrics.responses_24h > 0 && (
                  <span className="text-slate-400">
                    {" "}({Math.round((metrics.unique_users_24h / metrics.responses_24h) * 100)}% unique)
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* ── Momentum decomposition ────────────────────────────────────── */}
          <div className="border-t border-slate-100 pt-2.5 space-y-2">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              Momentum breakdown
            </p>
            <div className="space-y-1.5">
              <MomentumBar
                label="Volume"
                value={metrics.volume_score}
                color="#3B82F6"
              />
              <MomentumBar
                label="Recency"
                value={metrics.recency_score}
                color="#8B5CF6"
              />
              <MomentumBar
                label="User diversity"
                value={metrics.diversity_score}
                color="#10B981"
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>Overall trending score</span>
              <span className="font-medium text-slate-600">
                {Math.round(metrics.trending_score)}/100
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, metrics.trending_score)}%`,
                  background: styles.border,
                }}
              />
            </div>
          </div>

          {/* Top region */}
          {topRegion && (
            <div className="border-t border-slate-100 pt-2.5">
              <p className="text-[10px] text-slate-400 mb-1">Strongest regional engagement</p>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">
                  {topRegion.region_label}
                </span>
                <span className="text-[11px] text-slate-500">
                  {topRegion.total_responses} responses
                </span>
              </div>
              {topRegion.pct_support !== null && (
                <div className="flex h-1.5 w-full rounded-full overflow-hidden mt-1.5 bg-slate-100">
                  <div style={{ width: `${topRegion.pct_support}%`, background: "#639922" }} />
                  <div style={{ width: `${topRegion.pct_neutral ?? 0}%`, background: "#B4B2A9" }} />
                  <div style={{ width: `${topRegion.pct_oppose ?? 0}%`, background: "#D85A30" }} />
                </div>
              )}
            </div>
          )}

          {/* Age of question */}
          {provenance?.days_since_published !== undefined && (
            <p className="text-[10px] text-slate-400">
              Question published {provenance.days_since_published} day{provenance.days_since_published !== 1 ? "s" : ""} ago ·{" "}
              {metrics.responses_total.toLocaleString()} total responses.
            </p>
          )}
          {!provenance && (
            <p className="text-[10px] text-slate-400">
              {metrics.responses_total.toLocaleString()} total responses on this question.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
