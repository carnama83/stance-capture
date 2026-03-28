// src/pages/MyStances/QuickTakesCard.tsx
// Phase 2a — Q4: Three personalized unanswered questions rendered as tiles,
// matching the homepage GridQuestionCard format exactly.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionCoverImage } from "@/components/question/QuestionCoverImage";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { Loader2 } from "lucide-react";

type ForYouQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  topic_title?: string | null;
  topic_id?: string | null;
  tags?: string[] | null;
  cover_image_url?: string | null;
};

type ForYouFeed = {
  questions: ForYouQuestion[];
  count: number;
};

// Matches homepage card + tag styles exactly
const card = "bg-white rounded-xl shadow-sm ring-1 ring-slate-900/5";

function Tag({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  if (primary) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-medium text-white">
        {children}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-slate-600">
      {children}
    </span>
  );
}

interface QuickTileProps {
  q: ForYouQuestion;
  onAnswered: (id: string) => void;
}

function QuickTile({ q, onAnswered }: QuickTileProps) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (score: number) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb
        .from("question_stances")
        .upsert(
          { question_id: q.id, score, updated_at: new Date().toISOString() },
          { onConflict: "user_id,question_id" }
        );
      if (error) throw error;
      return score;
    },
    onSuccess: () => {
      onAnswered(q.id);
      qc.invalidateQueries({ queryKey: ["quick-takes"] });
      qc.invalidateQueries({ queryKey: ["my-stances"] });
    },
  });

  return (
    <div className={`${card} overflow-hidden flex flex-col`}>
      <QuestionCoverImage
        imageUrl={q.cover_image_url ?? null}
        tags={q.tags ?? []}
        variant="banner"
        bannerHeight={130}
      />
      <div className="p-4 flex flex-col flex-1">
        {/* Tags */}
        {q.tags && q.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <Tag primary>{q.tags[0]}</Tag>
            {q.tags.slice(1, 2).map((t) => <Tag key={t}>{t}</Tag>)}
          </div>
        )}

        {/* Question text */}
        <Link
          to={`/q/${q.id}`}
          className="text-sm font-semibold text-slate-900 leading-snug hover:underline line-clamp-3 mb-1 flex-1"
        >
          {q.question}
        </Link>

        {/* Topic label */}
        {q.topic_title && (
          <p className="text-[11px] text-slate-400 mt-1 mb-3">
            Topic: {q.topic_title}
          </p>
        )}

        {/* Stance slider */}
        <div className="mt-auto pt-2">
          <QuestionStanceSlider
            questionId={q.id}
            questionText={q.question}
            summary={q.summary ?? null}
            initialValue={null}
            disabled={mutation.isPending}
            mutationPending={mutation.isPending}
            onSubmit={(v) => mutation.mutateAsync(v)}
          />
          <div className="mt-2 flex justify-end">
            <Link
              to={`/q/${q.id}`}
              className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
            >
              Open →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

interface QuickTakesCardProps {
  userId: string | null;
}

export default function QuickTakesCard({ userId }: QuickTakesCardProps) {
  const [skipped, setSkipped] = React.useState(false);
  const [answeredIds, setAnsweredIds] = React.useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<ForYouFeed>({
    queryKey: ["quick-takes", userId],
    enabled: !!userId && !skipped,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("Supabase not available");
      const { data, error } = await supabase
        .rpc("get_for_you_feed", { p_limit: 3 })
        .single();
      if (error) throw error;
      return data as ForYouFeed;
    },
  });

  const questions = (data?.questions ?? []).slice(0, 3);
  const unanswered = questions.filter((q) => !answeredIds.has(q.id));
  const allDone = questions.length > 0 && unanswered.length === 0;

  if (skipped) return null;
  if (!isLoading && questions.length === 0) return null;

  return (
    <div className="mb-4">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Today's 3 quick takes
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Optional. Takes less than a minute.
          </p>
        </div>
        {!allDone && (
          <button
            type="button"
            onClick={() => setSkipped(true)}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Skip for now
          </button>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading questions…
        </div>
      )}

      {/* Done state */}
      {allDone && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Thanks. You can come back anytime.
        </div>
      )}

      {/* Tile grid — matches homepage 2-col grid */}
      {!isLoading && !allDone && unanswered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {unanswered.map((q) => (
            <QuickTile
              key={q.id}
              q={q}
              onAnswered={(id) =>
                setAnsweredIds((prev) => new Set([...prev, id]))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
