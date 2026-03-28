// src/pages/MyStances/QuickTakesCard.tsx
// Phase 2a — Q4: Unlimited replacement pool — always shows 3 tiles, fetching
// more when the pool runs low. Stops when there are genuinely no more unanswered
// questions for this user.

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionCoverImage } from "@/components/question/QuestionCoverImage";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { Loader2 } from "lucide-react";

const BATCH = 6;    // questions fetched per request
const VISIBLE = 3;  // tiles shown at once
const REFILL_AT = 1; // fetch next batch when pool drops to this many unanswered

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
  const [savedScore, setSavedScore] = React.useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: async (score: number) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("set_question_stance", {
        p_question_id: q.id,
        p_score: score,
      });
      if (error) throw error;
      return score;
    },
    onSuccess: (score) => {
      setSavedScore(score);
      qc.invalidateQueries({ queryKey: ["my-stances"] });
      // Brief delay so user sees the saved confirmation before tile swaps out
      setTimeout(() => onAnswered(q.id), 800);
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
        {q.tags && q.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <Tag primary>{q.tags[0]}</Tag>
            {q.tags.slice(1, 2).map((t) => <Tag key={t}>{t}</Tag>)}
          </div>
        )}

        <Link
          to={`/q/${q.id}`}
          className="text-sm font-semibold text-slate-900 leading-snug hover:underline line-clamp-3 mb-1 flex-1"
        >
          {q.question}
        </Link>

        {q.topic_title && (
          <p className="text-[11px] text-slate-400 mt-1 mb-3">
            Topic: {q.topic_title}
          </p>
        )}

        <div className="mt-auto pt-2">
          <QuestionStanceSlider
            questionId={q.id}
            questionText={q.question}
            summary={q.summary ?? null}
            initialValue={savedScore}
            disabled={mutation.isPending}
            mutationPending={mutation.isPending}
            onSubmit={async (v) => { await mutation.mutateAsync(v); }}
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
  const [skipped, setSkipped]         = React.useState(false);
  const [pool, setPool]               = React.useState<ForYouQuestion[]>([]);
  const [answeredIds, setAnsweredIds] = React.useState<Set<string>>(new Set());
  const [offset, setOffset]           = React.useState(0);
  const [loading, setLoading]         = React.useState(false);
  const [exhausted, setExhausted]     = React.useState(false); // no more questions in DB

  // Fetch a batch starting at `fetchOffset` and append to pool
  const fetchBatch = React.useCallback(async (fetchOffset: number) => {
    if (!userId || skipped) return;
    setLoading(true);
    try {
      const sb = getSupabase();
      if (!sb) return;
      const { data, error } = await sb
        .rpc("get_for_you_feed", { p_limit: BATCH, p_offset: fetchOffset })
        .single();
      if (error) throw error;
      const feed = data as ForYouFeed;
      const incoming = feed.questions ?? [];
      if (incoming.length === 0) {
        setExhausted(true); // RPC returned nothing — truly no more questions
      } else {
        setPool((prev) => {
          // Deduplicate by id before appending
          const existingIds = new Set(prev.map((q) => q.id));
          const fresh = incoming.filter((q) => !existingIds.has(q.id));
          return [...prev, ...fresh];
        });
        setOffset(fetchOffset + incoming.length);
        // If the batch was smaller than BATCH, no point fetching again
        if (incoming.length < BATCH) setExhausted(true);
      }
    } catch (e) {
      console.error("[QuickTakes] fetchBatch error:", e);
    } finally {
      setLoading(false);
    }
  }, [userId, skipped]);

  // Initial load
  React.useEffect(() => {
    if (userId && !skipped && pool.length === 0 && !exhausted) {
      fetchBatch(0);
    }
  }, [userId, skipped]);

  // Refill when pool of unanswered drops to REFILL_AT and we're not exhausted
  const unanswered = pool.filter((q) => !answeredIds.has(q.id));
  React.useEffect(() => {
    if (
      !loading &&
      !exhausted &&
      !skipped &&
      pool.length > 0 &&
      unanswered.length <= REFILL_AT
    ) {
      fetchBatch(offset);
    }
  }, [unanswered.length, loading, exhausted, skipped]);

  const visible = unanswered.slice(0, VISIBLE);
  const allDone = !loading && pool.length > 0 && unanswered.length === 0 && exhausted;

  const handleAnswered = React.useCallback((id: string) => {
    setAnsweredIds((prev) => new Set([...prev, id]));
  }, []);

  if (skipped) return null;
  if (!loading && pool.length === 0 && exhausted) return null; // no questions at all

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Today's quick takes</h2>
          <p className="text-xs text-slate-500 mt-0.5">Optional. Takes less than a minute.</p>
        </div>
        {!allDone && (visible.length > 0 || loading) && (
          <button
            type="button"
            onClick={() => setSkipped(true)}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Skip for now
          </button>
        )}
      </div>

      {/* Initial loading */}
      {loading && pool.length === 0 && (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading questions…
        </div>
      )}

      {/* All done */}
      {allDone && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Thanks. You can come back anytime.
        </div>
      )}

      {/* Tile grid — always 3, replaced as each is answered */}
      {!allDone && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((q) => (
            <QuickTile
              key={q.id}
              q={q}
              onAnswered={handleAnswered}
            />
          ))}
          {/* Ghost tiles while fetching replacements */}
          {loading && visible.length < VISIBLE && Array.from({ length: VISIBLE - visible.length }).map((_, i) => (
            <div
              key={`ghost-${i}`}
              className={`${card} overflow-hidden flex flex-col min-h-[280px] items-center justify-center`}
            >
              <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
