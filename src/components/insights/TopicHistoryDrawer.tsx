// src/components/insights/TopicHistoryDrawer.tsx
// Epic E — Personal Analytics & History
// TopicHistoryDrawer: per-topic stance evolution view.
//
// Shows:
//   - Sparkline of stance scores over time across all questions in a topic
//   - Chronological list of questions answered in this topic with their
//     score history and timestamps
//   - Community avg comparison per question
//   - First answered date, last updated date, change count per question
//
// Used in:
//   MyStancesPage — clicking a topic row in the stances list expands this drawer
//   PersonalInsightsPage — TopicBeliefProfile rows can open this drawer
//
// Data sources:
//   question_stances — user's scores and timestamps
//   stance_history   — per-question change log (via get_my_stance_history RPC)
//   question_stance_stats — community avg_score per question
//   questions + topics — question text and topic title

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getStanceColorHex } from "@/lib/stanceColors";
import { X, Loader2, TrendingUp, TrendingDown, Minus, RotateCcw } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type StanceHistoryPoint = {
  id: string;
  old_score: number | null;
  new_score: number;
  changed_at: string;
};

type TopicQuestion = {
  question_id: string;
  question_text: string;
  user_score: number;
  community_avg: number | null;
  first_answered: string;
  last_updated: string;
  change_count: number;
  history: StanceHistoryPoint[];
};

// ── Labels ────────────────────────────────────────────────────────────────────

const STANCE_LABEL: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]:  "Neutral",
  [1]:  "Agree",
  [2]:  "Strongly agree",
};

const STANCE_SHORT: Record<number, string> = {
  [-2]: "SD", [-1]: "D", [0]: "N", [1]: "A", [2]: "SA",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
// Renders a mini SVG sparkline of stance scores over time.
// Used both for the per-question history and for the topic overview.

function Sparkline({
  points,
  width = 80,
  height = 24,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const pad = 3;
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (width - pad * 2));
  const ys = points.map((v) => height - pad - ((v + 2) / 4) * (height - pad * 2));
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  const lastScore = points[points.length - 1];
  const color = getStanceColorHex(lastScore);
  const lastX = xs[xs.length - 1];
  const lastY = ys[ys.length - 1];

  return (
    <svg width={width} height={height} className="overflow-visible shrink-0" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// ── Topic-level overview sparkline ────────────────────────────────────────────
// Takes all questions in the topic, sorted by first_answered, and plots
// the user's score trajectory across the topic.

function TopicSparkline({ questions }: { questions: TopicQuestion[] }) {
  const sorted = [...questions].sort(
    (a, b) => new Date(a.first_answered).getTime() - new Date(b.first_answered).getTime()
  );
  const scores = sorted.map((q) => q.user_score);
  if (scores.length < 2) return null;
  return <Sparkline points={scores} width={120} height={28} />;
}

// ── Direction indicator ───────────────────────────────────────────────────────

function DirectionIcon({ oldScore, newScore }: { oldScore: number | null; newScore: number }) {
  if (oldScore === null) return null;
  const diff = newScore - oldScore;
  if (diff > 0) return <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden="true" />;
  if (diff < 0) return <TrendingDown className="h-3 w-3 text-rose-500" aria-hidden="true" />;
  return <Minus className="h-3 w-3 text-slate-400" aria-hidden="true" />;
}

// ── Question row ──────────────────────────────────────────────────────────────

function QuestionRow({ question }: { question: TopicQuestion }) {
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const userColor = getStanceColorHex(question.user_score);
  const communityColor = question.community_avg !== null
    ? getStanceColorHex(Math.round(question.community_avg))
    : null;
  const drift = question.community_avg !== null
    ? question.user_score - question.community_avg
    : null;

  const historyScores = question.history.map((h) => h.new_score);

  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-3 space-y-2">
      {/* Question header */}
      <div className="flex items-start gap-2">
        <div
          className="mt-1 h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: userColor }}
          aria-hidden="true"
        />
        <Link
          to={`/q/${question.question_id}`}
          className="flex-1 text-xs font-medium text-slate-900 leading-snug hover:underline line-clamp-2"
        >
          {question.question_text}
        </Link>
      </div>

      {/* Stance + community comparison */}
      <div className="flex items-center gap-3 flex-wrap pl-4">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-400">Your stance:</span>
          <span
            className="text-[10px] font-semibold"
            style={{ color: userColor }}
          >
            {STANCE_LABEL[question.user_score] ?? question.user_score}
          </span>
        </div>

        {question.community_avg !== null && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400">Community:</span>
            <span
              className="text-[10px] font-medium"
              style={{ color: communityColor ?? "#888" }}
            >
              {STANCE_LABEL[Math.round(question.community_avg)] ?? question.community_avg.toFixed(1)}
            </span>
            {drift !== null && Math.abs(drift) >= 0.5 && (
              <span className="text-[10px] text-slate-400">
                ({drift > 0 ? "+" : ""}{drift.toFixed(1)} from avg)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 pl-4 flex-wrap">
        {question.change_count > 1 && (
          <div className="flex items-center gap-1">
            <RotateCcw className="h-3 w-3 text-slate-400" aria-hidden="true" />
            <span className="text-[10px] text-slate-500">
              Changed {question.change_count - 1} time{question.change_count - 1 !== 1 ? "s" : ""}
            </span>
          </div>
        )}
        <span className="text-[10px] text-slate-400">
          First answered {timeAgo(question.first_answered)}
        </span>
        {question.last_updated !== question.first_answered && (
          <span className="text-[10px] text-slate-400">
            · Updated {timeAgo(question.last_updated)}
          </span>
        )}
      </div>

      {/* History toggle */}
      {question.history.length > 1 && (
        <div className="pl-4">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
          >
            <span>{historyOpen ? "▲" : "▼"}</span>
            <span>{historyOpen ? "Hide" : "Show"} change history</span>
          </button>

          {historyOpen && (
            <div className="mt-2 space-y-2">
              {/* Mini sparkline */}
              <div className="flex items-center gap-3">
                <Sparkline points={historyScores} width={100} height={24} />
                {historyScores.length >= 2 && (
                  <div className="flex items-center gap-1.5">
                    <DirectionIcon
                      oldScore={historyScores[0]}
                      newScore={historyScores[historyScores.length - 1]}
                    />
                    <span className="text-[10px] text-slate-500">
                      {STANCE_SHORT[historyScores[0]]} → {STANCE_SHORT[historyScores[historyScores.length - 1]]}
                    </span>
                  </div>
                )}
              </div>

              {/* Timeline */}
              <ol className="space-y-0.5">
                {question.history.map((point, i) => (
                  <li key={point.id} className="flex items-center gap-2 text-[10px] text-slate-600">
                    <span className="text-slate-400 w-20 shrink-0 tabular-nums">
                      {formatDate(point.changed_at)}
                    </span>
                    {i === 0 ? (
                      <span>
                        First answered:{" "}
                        <span
                          className="font-medium"
                          style={{ color: getStanceColorHex(point.new_score) }}
                        >
                          {STANCE_LABEL[point.new_score]}
                        </span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span style={{ color: getStanceColorHex(point.old_score ?? 0) }}>
                          {STANCE_LABEL[point.old_score ?? 0]}
                        </span>
                        <span className="text-slate-300">→</span>
                        <span
                          className="font-medium"
                          style={{ color: getStanceColorHex(point.new_score) }}
                        >
                          {STANCE_LABEL[point.new_score]}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Data hook ─────────────────────────────────────────────────────────────────

function useTopicHistory(topicTitle: string, userId: string) {
  return useQuery<TopicQuestion[]>({
    queryKey: ["topic-history-drawer", topicTitle, userId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // Step 1: Get all question_stances for this user
      const { data: stances, error: stErr } = await supabase
        .from("question_stances")
        .select(`
          question_id,
          score,
          created_at,
          updated_at,
          questions!inner (
            id,
            question,
            topic_id,
            topics ( id, title, parent_topic_id )
          )
        `)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (stErr) throw stErr;

      // Step 2: Filter to questions in this topic (by title match, including parent topics)
      const topicStances = (stances ?? []).filter((s: any) => {
        const t = s.questions?.topics;
        if (!t) return false;
        return t.title === topicTitle;
      });

      if (topicStances.length === 0) return [];

      const questionIds = topicStances.map((s: any) => s.question_id);

      // Step 3: Batch fetch community avg for these questions
      const { data: statsRows } = await supabase
        .from("question_stance_stats")
        .select("question_id, avg_score")
        .in("question_id", questionIds);

      const communityMap: Record<string, number | null> = {};
      (statsRows ?? []).forEach((r: any) => {
        communityMap[r.question_id] = r.avg_score;
      });

      // Step 4: Fetch stance_history for each question
      const historyMap: Record<string, StanceHistoryPoint[]> = {};
      await Promise.all(
        questionIds.map(async (qid: string) => {
          try {
            const { data: hist } = await supabase.rpc("get_my_stance_history", {
              p_question_id: qid,
            });
            historyMap[qid] = (hist ?? []) as StanceHistoryPoint[];
          } catch {
            historyMap[qid] = [];
          }
        })
      );

      // Step 5: Assemble result
      return topicStances.map((s: any): TopicQuestion => ({
        question_id: s.question_id,
        question_text: s.questions?.question ?? "",
        user_score: s.score,
        community_avg: communityMap[s.question_id] ?? null,
        first_answered: s.created_at ?? s.updated_at,
        last_updated: s.updated_at ?? s.created_at,
        change_count: historyMap[s.question_id]?.length ?? 1,
        history: historyMap[s.question_id] ?? [],
      }));
    },
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export interface TopicHistoryDrawerProps {
  topicTitle: string;
  userId: string;
  /** Called when user clicks the close button */
  onClose: () => void;
}

export default function TopicHistoryDrawer({
  topicTitle,
  userId,
  onClose,
}: TopicHistoryDrawerProps) {
  const { data: questions, isLoading, isError } = useTopicHistory(topicTitle, userId);

  // Summary stats
  const totalQuestions = questions?.length ?? 0;
  const changedCount = questions?.filter((q) => q.change_count > 1).length ?? 0;
  const avgUserScore = questions && questions.length > 0
    ? questions.reduce((sum, q) => sum + q.user_score, 0) / questions.length
    : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-slate-200">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{topicTitle}</h3>
          {!isLoading && totalQuestions > 0 && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              {totalQuestions} question{totalQuestions !== 1 ? "s" : ""} answered
              {changedCount > 0 && ` · ${changedCount} stance${changedCount !== 1 ? "s" : ""} revised`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label="Close topic history"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="p-3 space-y-3">

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Loading your stance history for this topic…
          </div>
        )}

        {/* Error */}
        {isError && (
          <p className="text-xs text-red-500 py-2">
            Could not load topic history. Please try again.
          </p>
        )}

        {/* Empty */}
        {!isLoading && !isError && totalQuestions === 0 && (
          <p className="text-xs text-slate-500 py-4 text-center">
            No stance history found for this topic.
          </p>
        )}

        {/* Topic overview sparkline */}
        {!isLoading && questions && questions.length >= 2 && avgUserScore !== null && (
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex items-center gap-4">
            <div>
              <p className="text-[10px] text-slate-400 mb-1">Your stance trajectory</p>
              <TopicSparkline questions={questions} />
            </div>
            <div className="text-right ml-auto">
              <p className="text-[10px] text-slate-400">Average lean</p>
              <p
                className="text-sm font-semibold"
                style={{ color: getStanceColorHex(Math.round(avgUserScore)) }}
              >
                {STANCE_LABEL[Math.round(avgUserScore)] ?? avgUserScore.toFixed(1)}
              </p>
            </div>
          </div>
        )}

        {/* Question list */}
        {!isLoading && questions && questions.length > 0 && (
          <div className="space-y-2">
            {questions.map((q) => (
              <QuestionRow key={q.question_id} question={q} />
            ))}
          </div>
        )}

        {/* Footer CTA */}
        {!isLoading && totalQuestions > 0 && (
          <Link
            to={`/me/insights`}
            className="block text-center text-[11px] text-blue-600 hover:underline py-1"
          >
            View full opinion profile →
          </Link>
        )}
      </div>
    </div>
  );
}
