// src/pages/MyStances/QuickTakesCard.tsx
// Phase 2a — Q4: Unlimited replacement pool. Always 3 unanswered tiles.
// Option 2 feedback: header area transforms into community stats after each answer.

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionCoverImage } from "@/components/question/QuestionCoverImage";
import { getStanceColorHex } from "@/lib/stanceColors";
import { Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const BATCH     = 6;
const VISIBLE   = 3;
const REFILL_AT = 1;

type ForYouQuestion = {
  id: string;
  question: string;
  summary?: string | null;
  topic_title?: string | null;
  topic_id?: string | null;
  tags?: string[] | null;
  cover_image_url?: string | null;
  // PR 2a: rendition that produced `question` above. get_for_you_feed now
  // includes it in each row of its jsonb payload.
  rendition_id?: string | null;
};

type ForYouFeed = {
  questions: ForYouQuestion[];
  count: number;
};

type FeedbackStats = {
  questionText: string;
  score: number;
  support_pct: number;
  neutral_pct: number;
  oppose_pct: number;
  responses: number;
  city_label: string | null;
  city_support_pct: number | null;
};

// ── Small UI atoms ────────────────────────────────────────────────────────────

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

// ── Minimal stance slider — no AI tip, no internal saving state ───────────────

const STANCE_LABELS: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]:  "Neutral",
  [1]:  "Agree",
  [2]:  "Strongly agree",
};

const STANCE_LABELS_PAST_KEYS: Record<number, string> = {
  [-2]: "quickTakes.pastStronglyDisagreed",
  [-1]: "quickTakes.pastDisagreed",
  [0]:  "quickTakes.pastNeutral",
  [1]:  "quickTakes.pastAgreed",
  [2]:  "quickTakes.pastStronglyAgreed",
};

function QuickSlider({ onCommit, disabled }: {
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState(0);
  const color = getStanceColorHex(value);
  const fillPct = Math.max(8, ((value + 2) / 4) * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {t("stance.yourStance")}
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
        <span>{t("stance.stronglyDisagree")}</span>
        <span>{t("stance.disagree")}</span>
        <span>{t("stance.neutral")}</span>
        <span>{t("stance.agree")}</span>
        <span>{t("stance.stronglyAgree")}</span>
      </div>
    </div>
  );
}

// ── Header: either description or community feedback ──────────────────────────

function HeaderArea({
  feedback,
  loadingFeedback,
  onDismiss,
  onSkip,
  allDone,
}: {
  feedback: FeedbackStats | null;
  loadingFeedback: boolean;
  onDismiss: () => void;
  onSkip: () => void;
  allDone: boolean;
}) {
  const { t } = useTranslation();

  if (!feedback && !loadingFeedback) {
    // Default header
    return (
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{t("quickTakes.title")}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{t("quickTakes.subtitle")}</p>
        </div>
        {!allDone && (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            {t("quickTakes.skip")}
          </button>
        )}
      </div>
    );
  }

  if (loadingFeedback) {
    return (
      <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />
        <span className="text-xs text-slate-500">{t("quickTakes.loadingCommunity")}</span>
      </div>
    );
  }

  if (!feedback) return null;

  const agree    = Math.round(feedback.support_pct ?? 0);
  const neutral  = Math.round(feedback.neutral_pct ?? 0);
  const disagree = Math.round(feedback.oppose_pct ?? 0);

  const dominant =
    agree >= disagree && agree >= neutral
      ? { pct: agree, labelKey: "quickTakes.leanAgree" }
      : disagree > agree && disagree >= neutral
      ? { pct: disagree, labelKey: "quickTakes.leanDisagree" }
      : { pct: neutral, labelKey: "quickTakes.areNeutral" };

  let citySentence: string | null = null;
  if (feedback.city_label && feedback.city_support_pct !== null) {
    const cityAgree = Math.round(feedback.city_support_pct);
    const diff = cityAgree - agree;
    if (Math.abs(diff) <= 5) {
      citySentence = `In ${feedback.city_label}, ${cityAgree}% agree — similar to the national picture.`;
    } else if (diff > 0) {
      citySentence = `In ${feedback.city_label}, ${cityAgree}% agree — above the national average.`;
    } else {
      citySentence = `In ${feedback.city_label}, ${cityAgree}% agree — below the national average.`;
    }
  }

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          {/* Question snippet + your stance */}
          <p className="text-[11px] text-slate-500 line-clamp-1 mb-0.5">
            "{feedback.questionText.slice(0, 70)}{feedback.questionText.length > 70 ? "…" : ""}"
          </p>
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-medium"
              style={{ color: getStanceColorHex(feedback.score) }}
            >
              {t("quickTakes.youResponded", { what: STANCE_LABELS_PAST_KEYS[feedback.score] ? t(STANCE_LABELS_PAST_KEYS[feedback.score]) : t("quickTakes.responded") })}
            </span>
            <span className="text-slate-300 text-xs">·</span>
            <span className="text-xs text-slate-600">
              {t("quickTakes.respondentsPct", { pct: dominant.pct, what: t(dominant.labelKey) })}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors mt-0.5"
          aria-label={t("common.dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Stacked distribution bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full mb-1.5">
        <div style={{ width: `${agree}%`, background: "#639922" }} />
        <div style={{ width: `${neutral}%`, background: "#B4B2A9" }} />
        <div style={{ width: `${disagree}%`, background: "#D85A30" }} />
      </div>

      {/* Legend + city note in one row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#639922]" />
          {t("stance.agree")} {agree}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#B4B2A9]" />
          {t("stance.neutral")} {neutral}%
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#D85A30]" />
          {t("stance.disagree")} {disagree}%
        </span>
        {citySentence && (
          <>
            <span className="text-slate-200">·</span>
            <span className="text-slate-400">{citySentence}</span>
          </>
        )}
        {feedback.responses > 0 && (
          <>
            <span className="text-slate-200">·</span>
            <span>{t("quickTakes.respondents", { count: feedback.responses })}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── QuickTile — purely a question display + slider, no feedback state ─────────

interface QuickTileProps {
  q: ForYouQuestion;
  onAnswered: (id: string, score: number) => void;
}

function QuickTile({ q, onAnswered }: QuickTileProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [submitted, setSubmitted] = React.useState(false);

  const mutation = useMutation({
    mutationFn: async (score: number) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      // PR 2a: record the rendition this tile actually rendered. If the feed
      // row carried none the server rejects with RENDITION_REQUIRED, which is
      // the correct outcome — the alternative is attributing the answer to
      // wording the respondent never saw.
      const { error } = await sb.rpc("set_question_stance", {
        p_question_id: q.id,
        p_score: score,
        p_rendition_id: q.rendition_id ?? null,
      });
      if (error) throw error;
      return score;
    },
    onSuccess: (score) => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ["my-stances"] });
      onAnswered(q.id, score);
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
          <p className="text-[11px] text-slate-400 mt-1 mb-2">
            {t("quickTakes.topicLabel", { topic: q.topic_title })}
          </p>
        )}

        <div className="mt-auto pt-2">
          {submitted ? (
            <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("common.saved")}
            </div>
          ) : (
            <QuickSlider
              disabled={mutation.isPending}
              onCommit={(v) => mutation.mutate(v)}
            />
          )}
          <div className="mt-2 flex justify-end">
            <Link
              to={`/q/${q.id}`}
              className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
            >
              {t("common.open")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── QuickTakesCard — orchestrates pool, header transformation, grid ───────────

interface QuickTakesCardProps {
  userId: string | null;
}

export default function QuickTakesCard({ userId }: QuickTakesCardProps) {
  const { t } = useTranslation();
  const [skipped, setSkipped]               = React.useState(false);
  const [pool, setPool]                     = React.useState<ForYouQuestion[]>([]);
  const [answeredIds, setAnsweredIds]       = React.useState<Set<string>>(new Set());
  const [offset, setOffset]                 = React.useState(0);
  const [loading, setLoading]               = React.useState(false);
  const [exhausted, setExhausted]           = React.useState(false);
  const [feedback, setFeedback]             = React.useState<FeedbackStats | null>(null);
  const [loadingFeedback, setLoadingFeedback] = React.useState(false);

  // ── Pool fetching ─────────────────────────────────────────────────────────

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

  React.useEffect(() => {
    if (userId && !skipped && pool.length === 0 && !exhausted) fetchBatch(0);
  }, [userId, skipped]);

  const unanswered = pool.filter((q) => !answeredIds.has(q.id));

  React.useEffect(() => {
    if (!loading && !exhausted && !skipped && pool.length > 0 && unanswered.length <= REFILL_AT) {
      fetchBatch(offset);
    }
  }, [unanswered.length, loading, exhausted, skipped]);

  // ── Stats fetch (fires after each answer, populates header feedback) ──────

  const fetchFeedback = React.useCallback(async (
    questionText: string,
    score: number,
    questionId: string,
  ) => {
    setLoadingFeedback(true);
    try {
      const sb = getSupabase();
      if (!sb) return;

      const [distRes, regionRes] = await Promise.all([
        sb.rpc("get_question_distribution", {
          p_question_id: questionId,
          p_region: "Global",
          p_window_hours: 168,
        }),
        sb.rpc("get_regional_comparison", { p_question_id: questionId }),
      ]);

      const dist = Array.isArray(distRes.data) && distRes.data.length > 0
        ? distRes.data[0]
        : null;

      const regionRows = (regionRes.data ?? []) as Array<{
        region_scope: string;
        region_label: string;
        pct_support: number | null;
      }>;
      const cityRow =
        regionRows.find((r) => r.region_scope === "city") ??
        regionRows.find((r) => r.region_scope === "county") ??
        regionRows.find((r) => r.region_scope === "state") ??
        null;

      setFeedback({
        questionText,
        score,
        support_pct:      dist?.support_pct ?? 0,
        neutral_pct:      dist?.neutral_pct ?? 0,
        oppose_pct:       dist?.oppose_pct  ?? 0,
        responses:        dist?.responses   ?? 0,
        city_label:       cityRow?.region_label    ?? null,
        city_support_pct: cityRow?.pct_support     ?? null,
      });
    } catch (e) {
      console.error("[QuickTakes] fetchFeedback error:", e);
      setFeedback(null);
    } finally {
      setLoadingFeedback(false);
    }
  }, []);

  // ── Answer handler ────────────────────────────────────────────────────────

  const handleAnswered = React.useCallback((id: string, score: number) => {
    const q = pool.find((q) => q.id === id);
    setAnsweredIds((prev) => new Set([...prev, id]));
    if (q) fetchFeedback(q.question, score, id);
  }, [pool, fetchFeedback]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const visible   = unanswered.slice(0, VISIBLE);
  const allDone   = !loading && pool.length > 0 && unanswered.length === 0 && exhausted;

  if (skipped) return null;
  if (!loading && pool.length === 0 && exhausted) return null;

  return (
    <div className="mb-4">

      {/* Header — transforms into feedback panel after each answer */}
      <HeaderArea
        feedback={feedback}
        loadingFeedback={loadingFeedback}
        onDismiss={() => setFeedback(null)}
        onSkip={() => setSkipped(true)}
        allDone={allDone}
      />

      {/* Initial loading */}
      {loading && pool.length === 0 && (
        <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("quickTakes.loadingQuestions")}
        </div>
      )}

      {/* All done */}
      {allDone && (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {t("quickTakes.thanks")}
        </div>
      )}

      {/* Always 3 unanswered tiles */}
      {!allDone && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((q) => (
            <QuickTile
              key={q.id}
              q={q}
              onAnswered={handleAnswered}
            />
          ))}
          {loading && visible.length < VISIBLE &&
            Array.from({ length: VISIBLE - visible.length }).map((_, i) => (
              <div
                key={`ghost-${i}`}
                className={`${card} min-h-[280px] flex items-center justify-center`}
              >
                <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}
