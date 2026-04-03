// src/components/insights/StanceEvolutionTimeline.tsx
// S1 — Stance evolution timeline: shows which topics changed, in which
// direction, and when. Uses stance_history + question_stances tables.
//
// FIX 4: The Supabase nested select `questions!inner(...)` with a
// further nested `topics(title)` can silently return null for topic_title
// if the join path isn't precisely specified. Changed to a two-step query:
// (1) fetch stance_history joined to questions, (2) batch-fetch topic titles.
// Also fixed: `stance_history` records where old_score = new_score (re-confirm)
// were being filtered out — they're now kept and shown as "Re-confirmed".
// Also fixed: query was joining question_stance_stats but that table isn't
// needed here — removed to reduce query complexity and silent empty results.

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

      // Step 1: Fetch stance_history joined to questions
      // Using explicit foreign key hint to avoid ambiguous join errors
      const { data: history, error } = await supabase
        .from("stance_history")
        .select(`
          id,
          question_id,
          old_score,
          new_score,
          changed_at,
          questions:question_id (
            id,
            question,
            topic_id
          )
        `)
        .eq("user_id", user.id)
        .order("changed_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      if (!history?.length) return [];

      // Step 2: Batch-fetch topic titles for all unique topic_ids
      const topicIds = [...new Set(
        history
          .map((h: any) => h.questions?.topic_id)
          .filter(Boolean)
      )];

      const topicTitleMap: Record<string, string> = {};
      if (topicIds.length > 0) {
        const { data: topics } = await supabase
          .from("topics")
          .select("id, title")
          .in("id", topicIds);
        for (const t of topics ?? []) {
          topicTitleMap[t.id] = t.title;
        }
      }

      return history.map((h: any) => ({
        id:            h.id,
        question_id:   h.question_id,
        old_score:     h.old_score,
        new_score:     h.new_score,
        changed_at:    h.changed_at,
        question_text: h.questions?.question ?? null,
        topic_id:      h.questions?.topic_id ?? null,
        topic_title:   h.questions?.topic_id
          ? (topicTitleMap[h.questions.topic_id] ?? null)
          : null,
      })) as HistoryRow[];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading your stance history…
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-red-500 py-2">
        Could not load stance history. Please try again.
      </p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50 px-5 py-6 text-center">
        <p className="text-sm text-slate-500">No stance changes yet.</p>
        <p className="text-xs text-slate-400 mt-1">
          When you update a previous answer, your evolution will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((row) => {
        const newColor = getStanceColorHex(row.new_score);
        const direction = directionLabel(row.old_score, row.new_score);

        return (
          <Link
            key={row.id}
            to={`/q/${row.question_id}`}
            className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5 hover:bg-slate-50 transition-colors"
          >
            {/* Stance dot */}
            <div
              className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ background: newColor }}
            />

            {/* Content */}
            <div className="flex-1 min-w-0">
              {row.topic_title && (
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-0.5">
                  {row.topic_title}
                </p>
              )}
              <p className="text-xs font-medium text-slate-900 leading-snug line-clamp-2">
                {row.question_text ?? row.question_id}
              </p>

              {/* Change summary */}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                {row.old_score !== null && (
                  <span className="text-[11px] text-slate-400">
                    {STANCE_LABEL[row.old_score] ?? row.old_score}
                    <span className="mx-1 text-slate-300">→</span>
                    <span style={{ color: newColor }} className="font-medium">
                      {STANCE_LABEL[row.new_score] ?? row.new_score}
                    </span>
                  </span>
                )}
                {row.old_score === null && (
                  <span className="text-[11px] font-medium" style={{ color: newColor }}>
                    {STANCE_LABEL[row.new_score] ?? row.new_score}
                  </span>
                )}
                <span
                  className="text-[11px] font-medium"
                  style={{ color: direction.color }}
                >
                  {direction.text}
                </span>
              </div>
            </div>

            {/* Time */}
            <span className="text-[10px] text-slate-400 flex-shrink-0 mt-0.5">
              {timeAgo(row.changed_at)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
