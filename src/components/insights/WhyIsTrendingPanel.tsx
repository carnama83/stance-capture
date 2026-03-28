// src/components/insights/WhyIsTrendingPanel.tsx
// S3 — Trend Explainability: "Why is this trending?" panel for the
// QuestionDetailPage right rail. Shows signal type (organic vs media-driven),
// 24h vs 7d momentum, polarization, and which region is driving the trend.
// Only renders when the question has a meaningful trending score.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { TrendingUp, ChevronDown, ChevronUp } from "lucide-react";

type TrendingMetrics = {
  responses_total: number;
  responses_24h: number;
  responses_7d: number;
  velocity_score: number;
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

type MediaSurgeRow = {
  cluster_title: string;
  articles_24h: number;
  outlets_24h: number;
  surge_ratio: number;
};

type SignalType = "media-driven" | "organic" | "polarising" | "steady";

function classifySignal(
  metrics: TrendingMetrics,
  mediaSurge: MediaSurgeRow | null,
): { type: SignalType; label: string; description: string } {
  if (mediaSurge && mediaSurge.surge_ratio >= 2.0) {
    return {
      type: "media-driven",
      label: "Media-driven",
      description: `${mediaSurge.articles_24h} articles from ${mediaSurge.outlets_24h} outlets in the last 24h — news coverage is pushing this question.`,
    };
  }
  if (metrics.velocity_score >= 0.7) {
    return {
      type: "organic",
      label: "Organic momentum",
      description: "Engagement is growing through direct participation — not driven by a news spike.",
    };
  }
  // Check for high polarization via 24h acceleration
  const accel = metrics.responses_24h / Math.max(metrics.responses_7d / 7, 1);
  if (accel >= 2.5) {
    return {
      type: "polarising",
      label: "Polarising",
      description: "People on both sides are responding rapidly — the question is dividing opinion.",
    };
  }
  return {
    type: "steady",
    label: "Steady engagement",
    description: "Consistent participation over time with no unusual spike.",
  };
}

const SIGNAL_STYLES: Record<SignalType, { bg: string; text: string; border: string }> = {
  "media-driven": { bg: "#FAEEDA", text: "#633806", border: "#EF9F27" },
  "organic":      { bg: "#EAF3DE", text: "#27500A", border: "#97C459"  },
  "polarising":   { bg: "#FCEBEB", text: "#791F1F", border: "#F09595"  },
  "steady":       { bg: "#F1EFE8", text: "#5F5E5A", border: "#D3D1C7"  },
};

interface WhyIsTrendingPanelProps {
  questionId: string;
  topicId: string | null | undefined;
}

export default function WhyIsTrendingPanel({
  questionId,
  topicId,
}: WhyIsTrendingPanelProps) {
  const [expanded, setExpanded] = React.useState(false);

  // Fetch question_trending_metrics
  const { data: metrics } = useQuery<TrendingMetrics | null>({
    queryKey: ["s3-trending-metrics", questionId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data, error } = await sb
        .from("question_trending_metrics")
        .select("responses_total,responses_24h,responses_7d,velocity_score,trending_score")
        .eq("question_id", questionId)
        .maybeSingle();
      if (error) return null;
      return data as TrendingMetrics | null;
    },
  });

  // Fetch regional breakdown for "which region is driving this"
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

  // Fetch media surge for topic (only when expanded)
  const { data: mediaSurge } = useQuery<MediaSurgeRow | null>({
    queryKey: ["s3-media-surge", topicId],
    staleTime: 10 * 60_000,
    enabled: expanded && !!topicId,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data, error } = await sb.rpc("get_media_surge_homepage", {
        p_region: "Global",
        p_window_hours: 24,
        p_baseline_days: 7,
        p_limit: 20,
      });
      if (error) return null;
      // Find a surge row related to this topic's cluster
      const rows = (data ?? []) as MediaSurgeRow[];
      return rows[0] ?? null;
    },
  });

  // Only show if there's meaningful trending activity
  if (!metrics || metrics.trending_score < 10) return null;

  const signal = classifySignal(metrics, expanded ? mediaSurge ?? null : null);
  const styles = SIGNAL_STYLES[signal.type];

  // Top region by responses (excluding global)
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
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
            Why is this trending?
          </h3>
        </div>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
          : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>

      {/* Collapsed summary */}
      {!expanded && (
        <div className="mt-2 flex items-center gap-2">
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: styles.bg, color: styles.text }}
          >
            {signal.label}
          </span>
          <span className="text-xs text-slate-500">
            {metrics.responses_24h} responses in the last 24h
          </span>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 space-y-3">
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
          </div>

          {/* Momentum comparison */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-slate-400 mb-0.5">Today</p>
              <p className="text-sm font-medium text-slate-900">{metrics.responses_24h}</p>
              <p className="text-[10px] text-slate-400">responses</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-slate-400 mb-0.5">7-day avg</p>
              <p className="text-sm font-medium text-slate-900">
                {(metrics.responses_7d / 7).toFixed(1)}
              </p>
              <p className="text-[10px] text-slate-400">per day</p>
            </div>
          </div>

          {/* Momentum bar */}
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>Engagement velocity</span>
              <span>{Math.round(metrics.trending_score)}/100</span>
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
              <p className="text-[10px] text-slate-400 mb-1">Strongest engagement</p>
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

          {/* Total responses */}
          <p className="text-[10px] text-slate-400">
            {metrics.responses_total.toLocaleString()} total responses on this question.
          </p>
        </div>
      )}
    </section>
  );
}
