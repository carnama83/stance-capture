// src/pages/MyStances/QuickTakesCard.tsx
// Phase 2a — Q4: Unlimited replacement pool. Always shows 3 tiles.
// Option B post-answer feedback: stacked distribution bar + regional comparison.
// Uses a minimal inline slider — no AI tip, no internal saving state.

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionCoverImage } from "@/components/question/QuestionCoverImage";
import { getStanceColorHex } from "@/lib/stanceColors";
import { Loader2 } from "lucide-react";

const BATCH    = 6;
const VISIBLE  = 3;
const REFILL_AT = 1;

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

type FeedbackStats = {
  support_pct: number;
  neutral_pct: number;
  oppose_pct: number;
  responses: number;
  city_label: string | null;
  city_support_pct: number | null;
  city_oppose_pct: number | null;
  city_neutral_pct: number | null;
};

const STANCE_LABEL: Record<number, string> = {
  [-2]: "Strongly disagreed",
  [-1]: "Disagreed",
  [0]:  "Were neutral",
  [1]:  "Agreed",
  [2]:  "Strongly agreed",
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

// Minimal stance slider — no AI tip, no saving state, just value + commit
const STANCE_LABELS: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]:  "Neutral",
  [1]:  "Agree",
  [2]:  "Strongly agree",
};

function QuickSlider({ onCommit, disabled }: {
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState(0);
  const color = getStanceColorHex(value);
  const fillPct = Math.max(8, ((value + 2) / 4) * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          Your stance
        </span>
        <span className="text-[11px] font-medium" style={{ color }}>
          {STANCE_LABELS[value]}
        </span>
      </div>
      <div className="relative h-5 flex items-center mb-1">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-100" />
        <div
          className="absolute left-0 h-1.5 rounded-full transition-all"
          style={{ width: `${fillPct}%`, background: color }}
        />
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(Number(e.target.value))}
          onMouseUp={() => !disabled && onCommit(value)}
          onTouchEnd={() => !disabled && onCommit(value)}
          className="absolute inset-x-0 w-full appearance-none bg-transparent cursor-pointer disabled:cursor-default"
          style={{ height: "20px" }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-slate-400 px-0.5">
        <span>Strongly disagree</span>
        <span>Disagree</span>
        <span>Neutral</span>
        <span>Agree</span>
        <span>Strongly agree</span>
      </div>
    </div>
  );
}
function FeedbackPanel({ score, stats }: { score: number; stats: FeedbackStats | null }) {
  if (!stats) {
    return (
      <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-3">
        <p className="text-xs text-slate-500">Stance saved. Community data loading…</p>
      </div>
    );
  }

  const agree   = Math.round(stats.support_pct ?? 0);
  const neutral = Math.round(stats.neutral_pct ?? 0);
  const disagree = Math.round(stats.oppose_pct ?? 0);
  const stanceLabel = STANCE_LABEL[score] ?? "Responded";

  // Dominant direction for headline
  const dominant =
    agree >= disagree && agree >= neutral
      ? { pct: agree, label: "lean toward agreement" }
      : disagree >= agree && disagree >= neutral
      ? { pct: disagree, label: "lean toward disagreement" }
      : { pct: neutral, label: "are neutral" };

  // City comparison sentence
  let citySentence: string | null = null;
  if (stats.city_label && stats.city_support_pct !== null) {
    const cityAgree = Math.round(stats.city_support_pct);
    const diff = cityAgree - agree;
    if (Math.abs(diff) <= 5) {
      citySentence = `In ${stats.city_label}, ${cityAgree}% agree — similar to the national picture.`;
    } else if (diff > 0) {
      citySentence = `In ${stats.city_label}, ${cityAgree}% agree — slightly above the national average.`;
    } else {
      citySentence = `In ${stats.city_label}, ${cityAgree}% agree — slightly below the national average.`;
    }
  }

  return (
    <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-3 space-y-2.5">
      {/* Your stance */}
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
          You {stanceLabel}
        </span>
      </div>

      {/* Headline */}
      <p className="text-xs font-medium text-slate-800 leading-snug">
        {dominant.pct}% of respondents {dominant.label}
      </p>

      {/* Stacked distribution bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        <div style={{ width: `${agree}%`, background: "#639922" }} />
        <div style={{ width: `${neutral}%`, background: "#B4B2A9" }} />
        <div style={{ width: `${disagree}%`, background: "#D85A30" }} />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#639922]" />
          Agree {agree}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#B4B2A9]" />
          Neutral {neutral}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#D85A30]" />
          Disagree {disagree}%
        </span>
      </div>

      {/* Regional comparison */}
      {citySentence && (
        <p className="text-[11px] text-slate-500 border-t border-slate-200 pt-2 leading-snug">
          {citySentence}
        </p>
      )}

      {/* Respondent count */}
      {stats.responses > 0 && (
        <p className="text-[10px] text-slate-400">
          Based on {stats.responses.toLocaleString()} respondents.
        </p>
      )}
    </div>
  );
}

interface QuickTileProps {
  q: ForYouQuestion;
  isAnswered: boolean;
  isFading: boolean;
  onAnswered: (id: string) => void;
}

function QuickTile({ q, isAnswered, isFading, onAnswered }: QuickTileProps) {
  const qc = useQueryClient();
  const [savedScore, setSavedScore] = React.useState<number | null>(null);
  const [stats, setStats] = React.useState<FeedbackStats | null>(null);
  const [loadingStats, setLoadingStats] = React.useState(false);

  const fetchStats = React.useCallback(async (questionId: string) => {
    setLoadingStats(true);
    try {
      const sb = getSupabase();
      if (!sb) return;

      // Fetch global distribution
      const { data: distData } = await sb
        .rpc("get_question_distribution", {
          p_question_id: questionId,
          p_region: "Global",
          p_window_hours: 168,
        });

      const dist = Array.isArray(distData) && distData.length > 0 ? distData[0] : null;

      // Fetch regional (city-level) comparison
      const { data: regionData } = await sb
        .rpc("get_regional_comparison", { p_question_id: questionId });

      // Pick best available region (city first)
      const regionRows = (regionData ?? []) as Array<{
        region_scope: string;
        region_label: string;
        pct_support: number | null;
        pct_neutral: number | null;
        pct_oppose: number | null;
      }>;
      const cityRow = regionRows.find((r) => r.region_scope === "city")
        ?? regionRows.find((r) => r.region_scope === "county")
        ?? regionRows.find((r) => r.region_scope === "state")
        ?? null;

      setStats({
        support_pct:      dist?.support_pct  ?? 0,
        neutral_pct:      dist?.neutral_pct  ?? 0,
        oppose_pct:       dist?.oppose_pct   ?? 0,
        responses:        dist?.responses    ?? 0,
        city_label:       cityRow?.region_label ?? null,
        city_support_pct: cityRow?.pct_support  ?? null,
        city_neutral_pct: cityRow?.pct_neutral  ?? null,
        city_oppose_pct:  cityRow?.pct_oppose   ?? null,
      });
    } catch (e) {
      console.error("[QuickTile] fetchStats error:", e);
    } finally {
      setLoadingStats(false);
    }
  }, []);

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
    onSuccess: async (score) => {
      setSavedScore(score);
      qc.invalidateQueries({ queryKey: ["my-stances"] });
      // Fetch community stats immediately after save
      await fetchStats(q.id);
      // Notify parent — tile stays visible (parent manages when it fades)
      onAnswered(q.id);
    },
  });

  return (
    <div
      className={`${card} overflow-hidden flex flex-col transition-opacity duration-300`}
      style={{ opacity: isFading ? 0 : 1 }}
    >
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
          <p className="text-[11px] text-slate-400 mt-1 mb-2">
            Topic: {q.topic_title}
          </p>
        )}

        <div className="mt-auto pt-2">
          {/* Show slider before answer, feedback panel after */}
          {!isAnswered ? (
            <>
              <QuickSlider
                disabled={mutation.isPending}
                onCommit={(v) => { mutation.mutate(v); }}
              />
              <div className="mt-2 flex justify-end">
                <Link
                  to={`/q/${q.id}`}
                  className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
                >
                  Open →
                </Link>
              </div>
            </>
          ) : (
            <>
              {loadingStats ? (
                <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-3 flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading community data…
                </div>
              ) : (
                <FeedbackPanel score={savedScore!} stats={stats} />
              )}
              <div className="mt-2 flex justify-end">
                <Link
                  to={`/q/${q.id}`}
                  className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
                >
                  Open →
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface QuickTakesCardProps {
  userId: string | null;
}

export default function QuickTakesCard({ userId }: QuickTakesCardProps) {
  const [skipped, setSkipped]           = React.useState(false);
  const [pool, setPool]                 = React.useState<ForYouQuestion[]>([]);
  const [answeredIds, setAnsweredIds]   = React.useState<Set<string>>(new Set());
  const [fadingId, setFadingId]         = React.useState<string | null>(null);
  const [offset, setOffset]             = React.useState(0);
  const [loading, setLoading]           = React.useState(false);
  const [exhausted, setExhausted]       = React.useState(false);
  const lastAnsweredRef                 = React.useRef<string | null>(null);

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
        setExhausted(true);
      } else {
        setPool((prev) => {
          const existingIds = new Set(prev.map((q) => q.id));
          const fresh = incoming.filter((q) => !existingIds.has(q.id));
          return [...prev, ...fresh];
        });
        setOffset(fetchOffset + incoming.length);
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

  const unanswered = pool.filter((q) => !answeredIds.has(q.id));

  // Refill when pool runs low
  React.useEffect(() => {
    if (!loading && !exhausted && !skipped && pool.length > 0 && unanswered.length <= REFILL_AT) {
      fetchBatch(offset);
    }
  }, [unanswered.length, loading, exhausted, skipped]);

  // Visible = up to 3 unanswered + the last answered tile (showing feedback)
  const visibleUnanswered = unanswered.slice(0, VISIBLE);
  const lastAnsweredQ = lastAnsweredRef.current
    ? pool.find((q) => q.id === lastAnsweredRef.current) ?? null
    : null;

  // Build the display list: answered tile (with feedback) + up to 2 unanswered
  // After answer: [answered, unanswered1, unanswered2]
  // When next answer comes: answered fades out, new unanswered slides in
  const displayTiles: ForYouQuestion[] = lastAnsweredQ
    ? [lastAnsweredQ, ...unanswered.slice(0, VISIBLE - 1)]
    : visibleUnanswered;

  const handleAnswered = React.useCallback((id: string) => {
    const prev = lastAnsweredRef.current;
    // Fade out the previously answered tile
    if (prev) {
      setFadingId(prev);
      setTimeout(() => {
        setAnsweredIds((s) => new Set([...s, prev]));
        setFadingId(null);
      }, 350);
    }
    lastAnsweredRef.current = id;
    // Force re-render to show feedback on newly answered tile
    setAnsweredIds((s) => new Set(s)); // trigger rerender without adding id yet
  }, []);

  const allDone = !loading && pool.length > 0 && unanswered.length === 0 && exhausted && !lastAnsweredQ;

  if (skipped) return null;
  if (!loading && pool.length === 0 && exhausted) return null;

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Today's quick takes</h2>
          <p className="text-xs text-slate-500 mt-0.5">Optional. Takes less than a minute.</p>
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

      {loading && pool.length === 0 && (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading questions…
        </div>
      )}

      {allDone && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          Thanks. You can come back anytime.
        </div>
      )}

      {!allDone && displayTiles.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayTiles.map((q) => (
            <QuickTile
              key={q.id}
              q={q}
              isAnswered={lastAnsweredRef.current === q.id}
              isFading={fadingId === q.id}
              onAnswered={handleAnswered}
            />
          ))}
          {loading && displayTiles.length < VISIBLE && (
            Array.from({ length: VISIBLE - displayTiles.length }).map((_, i) => (
              <div
                key={`ghost-${i}`}
                className={`${card} min-h-[280px] flex items-center justify-center`}
              >
                <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
