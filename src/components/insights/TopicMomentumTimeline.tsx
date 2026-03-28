// src/components/insights/TopicMomentumTimeline.tsx
// S3 — Momentum attribution timeline for TopicDetailPage.
// Shows daily response volume over the last 14 days for a topic,
// with an annotation when a media surge is detected.
// Data: question_stance_stats_history aggregated by topic questions.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

type DayRow = {
  snapshot_date: string;
  total_responses: number;
};

type MediaSurgeRow = {
  cluster_title: string;
  articles_24h: number;
  outlets_24h: number;
  surge_ratio: number;
};

interface TopicMomentumTimelineProps {
  topicId: string;
}

export default function TopicMomentumTimeline({ topicId }: TopicMomentumTimelineProps) {
  // Fetch question IDs for this topic
  const { data: questionIds } = useQuery<string[]>({
    queryKey: ["s3-topic-questions", topicId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from("questions")
        .select("id")
        .eq("topic_id", topicId)
        .eq("status", "active")
        .limit(50);
      if (error) return [];
      return (data ?? []).map((r: any) => r.id as string);
    },
  });

  // Fetch daily stance history aggregated across all questions in topic
  const { data: days, isLoading } = useQuery<DayRow[]>({
    queryKey: ["s3-topic-momentum", topicId, questionIds?.length],
    staleTime: 10 * 60_000,
    enabled: !!questionIds && questionIds.length > 0,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb || !questionIds || questionIds.length === 0) return [];

      const cutoff = new Date(Date.now() - 14 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const { data, error } = await sb
        .from("question_stance_stats_history")
        .select("snapshot_date, total_responses")
        .in("question_id", questionIds)
        .eq("region_scope", "global")
        .gte("snapshot_date", cutoff)
        .order("snapshot_date", { ascending: true });

      if (error) return [];

      // Aggregate by date
      const byDate = new Map<string, number>();
      for (const row of data ?? []) {
        const existing = byDate.get(row.snapshot_date) ?? 0;
        byDate.set(row.snapshot_date, existing + (row.total_responses ?? 0));
      }

      return Array.from(byDate.entries())
        .map(([snapshot_date, total_responses]) => ({ snapshot_date, total_responses }))
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    },
  });

  // Fetch media surge to annotate spike days
  const { data: mediaSurge } = useQuery<MediaSurgeRow | null>({
    queryKey: ["s3-media-surge-topic", topicId],
    staleTime: 15 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data, error } = await sb.rpc("get_media_surge_homepage", {
        p_region: "Global",
        p_window_hours: 24,
        p_baseline_days: 7,
        p_limit: 10,
      });
      if (error) return null;
      return ((data ?? []) as MediaSurgeRow[])[0] ?? null;
    },
  });

  if (isLoading || !days || days.length === 0) return null;

  const maxVal = Math.max(...days.map((d) => d.total_responses), 1);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  // Find the spike day (max responses) for annotation
  const peakDay = days.reduce(
    (best, d) => (d.total_responses > best.total_responses ? d : best),
    days[0],
  );
  const isMediaSpike =
    mediaSurge &&
    mediaSurge.surge_ratio >= 1.5 &&
    (peakDay.snapshot_date === today || peakDay.snapshot_date === yesterday);

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-slate-500">
          14-day response activity
        </span>
        {isMediaSpike && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
            Media spike · {mediaSurge!.articles_24h} articles
          </span>
        )}
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-0.5 h-10">
        {days.map((d) => {
          const heightPct = Math.max(4, (d.total_responses / maxVal) * 100);
          const isToday = d.snapshot_date === today || d.snapshot_date === yesterday;
          const isPeak = d.snapshot_date === peakDay.snapshot_date;
          return (
            <div
              key={d.snapshot_date}
              className="flex-1 flex flex-col items-center justify-end group relative"
              title={`${d.snapshot_date}: ${d.total_responses} responses`}
            >
              <div
                className="w-full rounded-sm transition-colors"
                style={{
                  height: `${heightPct}%`,
                  background: isPeak && isMediaSpike
                    ? "#EF9F27"
                    : isToday
                    ? "#1D9E75"
                    : "#C0DD97",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Date labels — just first and last */}
      <div className="flex justify-between text-[9px] text-slate-400 mt-1">
        <span>{days[0]?.snapshot_date.slice(5)}</span>
        <span>{days[days.length - 1]?.snapshot_date.slice(5)}</span>
      </div>

      {/* Peak annotation */}
      {isMediaSpike && (
        <p className="text-[10px] text-amber-700 mt-1.5">
          Peak driven by {mediaSurge!.outlets_24h} news outlets — {mediaSurge!.cluster_title.slice(0, 60)}.
        </p>
      )}
    </div>
  );
}
