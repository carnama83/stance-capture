// src/components/insights/StanceEvolutionTimeline.tsx
// S1 — Stance evolution timeline: shows which topics changed, in which
// direction, and when. Uses stance_history + question_stances tables.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getStanceColorHex } from "@/lib/stanceColors";
import { Loader2 } from "lucide-react";

type HistoryRow = {
  id: string;
  question_id: string;
  old_score: number | null;
  new_score: number;
  changed_at: string;
  question_text: string | null;
  topic_title: string | null;
  topic_id: string | null;
};

const STANCE_LABEL: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]:  "Neutral",
  [1]:  "Agree",
  [2]:  "Strongly agree",
};

function directionLabel(oldScore: number | null, newScore: number): {
  text: string;
  color: string;
} {
  if (oldScore === null) {
    return { text: "First answered", color: "#888780" };
  }
  const diff = newScore - oldScore;
  if (diff > 0)  return { text: `Moved toward agreement (+${diff})`, color: "#639922" };
  if (diff < 0)  return { text: `Moved toward disagreement (${diff})`, color: "#D85A30" };
  return         { text: "Re-confirmed stance", color: "#888780" };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days  = Math.floor(diff / 86_400_000);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  if (days < 1)    return "Today";
  if (days < 7)    return `${days}d ago`;
  if (weeks < 8)   return `${weeks}w ago`;
  return           `${months}mo ago`;
}

interface StanceEvolutionTimelineProps {
  limit?: number;
}

export default function StanceEvolutionTimeline({
  limit = 20,
}: StanceEvolutionTimelineProps) {
  const { data, isLoading, isError } = useQuery<HistoryRow[]>({
    queryKey: ["s1-stance-evolution", limit],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch stance_history joined to questions + topics
      const { data: history, error } = await supabase
        .from("stance_history")
        .select(`
          id,
          question_id,
          old_score,
          new_score,
          changed_at,
          questions!inner (
            id,
            question,
            topic_id,
            topics ( id, title )
          )
        `)
        .eq("user_id", user.id)
        .order("changed_at", { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (history ?? []).map((row: any) => ({
        id:           row.id,
        question_id:  row.question_id,
        old_score:    row.old_score,
        new_score:    row.new_score,
        changed_at:   row.changed_at,
        question_text: row.questions?.question ?? null,
        topic_title:  row.questions?.topics?.title ?? null,
        topic_id:     row.questions?.topics?.id ?? null,
      }));
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading your stance history…
      </div>
    );
  }

  if (isError || !data || data.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-4">
        No stance changes recorded yet. As you revisit and update your answers,
        your evolution will appear here.
      </p>
    );
  }

  // Group changes by date bucket (week)
  const grouped = new Map<string, HistoryRow[]>();
  for (const row of data) {
    const date   = new Date(row.changed_at);
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key = monday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  return (
    <div className="space-y-6">
      {[...grouped.entries()].map(([weekLabel, rows]) => (
        <div key={weekLabel}>
          {/* Week label */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Week of {weekLabel}
            </span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          {/* Events in this week */}
          <div className="space-y-2">
            {rows.map((row) => {
              const dir = directionLabel(row.old_score, row.new_score);
              const stanceColor = getStanceColorHex(row.new_score);

              return (
                <div
                  key={row.id}
                  className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5"
                >
                  {/* Stance colour dot */}
                  <div
                    className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ background: stanceColor }}
                  />

                  <div className="flex-1 min-w-0">
                    {/* Topic label */}
                    {row.topic_title && (
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-0.5">
                        {row.topic_title}
                      </p>
                    )}

                    {/* Question text */}
                    {row.question_text ? (
                      <Link
                        to={`/q/${row.question_id}`}
                        className="text-sm font-medium text-slate-900 hover:underline leading-snug line-clamp-2"
                      >
                        {row.question_text}
                      </Link>
                    ) : (
                      <p className="text-sm text-slate-500">[Question unavailable]</p>
                    )}

                    {/* Direction + new stance */}
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-[11px] font-medium"
                        style={{ color: dir.color }}
                      >
                        {dir.text}
                      </span>
                      <span className="text-slate-300 text-[11px]">·</span>
                      <span
                        className="text-[11px] font-medium"
                        style={{ color: stanceColor }}
                      >
                        Now: {STANCE_LABEL[row.new_score]}
                      </span>
                    </div>
                  </div>

                  {/* Time */}
                  <span className="text-[10px] text-slate-400 flex-shrink-0 mt-0.5">
                    {timeAgo(row.changed_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
