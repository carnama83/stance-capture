// src/components/notifications/WeeklyDigestCard.tsx
// Renders the latest weekly digest inline when a digest notification is clicked.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, MessageSquare, ArrowRight, X, Loader2 } from "lucide-react";
import { useMyLatestWeeklyDigest } from "@/hooks/useMyLatestWeeklyDigest";

interface WeeklyDigestCardProps {
  onClose: () => void;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`;
}

export function WeeklyDigestCard({ onClose }: WeeklyDigestCardProps) {
  const { data: digest, isLoading } = useMyLatestWeeklyDigest();
  const navigate = useNavigate();

  const handleLink = (href: string) => {
    onClose();
    navigate(href);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="px-4 py-8 text-center text-sm text-slate-500">
        No digest available yet.
      </div>
    );
  }

  const { summary, weekStart, weekEnd } = digest;
  const hasTopics = summary.followedTopicUpdates.length > 0;
  const hasQuestions = summary.answeredQuestionShifts.length > 0;
  const hasRecommended = summary.recommendedQuestions.length > 0;

  return (
    <div className="space-y-4 px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Weekly Digest</p>
          <p className="text-xs text-slate-500">{formatDateRange(weekStart, weekEnd)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          aria-label="Close digest"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Followed topic updates */}
      {hasTopics && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Topics you follow
          </p>
          <div className="space-y-1">
            {summary.followedTopicUpdates.map((t) => (
              <button
                key={t.topicId}
                type="button"
                onClick={() => handleLink(t.href)}
                className="w-full text-left flex items-start justify-between gap-2 rounded-md px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{t.topicTitle}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t.summary}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 shrink-0 mt-0.5 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Answered question shifts */}
      {hasQuestions && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Questions you answered
          </p>
          <div className="space-y-1">
            {summary.answeredQuestionShifts.map((q) => (
              <button
                key={q.questionId}
                type="button"
                onClick={() => handleLink(q.href)}
                className="w-full text-left flex items-start justify-between gap-2 rounded-md px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 line-clamp-2">{q.questionTitle}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{q.summary}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 shrink-0 mt-0.5 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recommended questions */}
      {hasRecommended && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Recommended for you
          </p>
          <div className="space-y-1">
            {summary.recommendedQuestions.map((q) => (
              <button
                key={q.questionId}
                type="button"
                onClick={() => handleLink(q.href)}
                className="w-full text-left flex items-start justify-between gap-2 rounded-md px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors group"
              >
                <p className="text-sm text-slate-800 line-clamp-2">{q.questionTitle}</p>
                <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 shrink-0 mt-0.5 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Alignment note */}
      {summary.alignmentNote && (
        <div className="rounded-md bg-violet-50 border border-violet-100 px-3 py-2.5">
          <p className="text-xs font-semibold text-violet-700">{summary.alignmentNote.title}</p>
          <p className="text-xs text-violet-600 mt-0.5">{summary.alignmentNote.body}</p>
        </div>
      )}
    </div>
  );
}
