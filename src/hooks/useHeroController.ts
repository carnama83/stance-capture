// src/hooks/useHeroController.ts
//
// Hero section state machine for the Stance Capture homepage.
//
// Manages:
//   - Question queue (currentHeroQuestion + queuedQuestions[])
//   - Hero status transitions (loading → ready → submitting → answered_result
//                              → transitioning → waiting_next → error)
//   - Auto-advance timer (2200ms dwell in answered_result)
//   - Transition animation (350ms fade)
//   - Queue replenishment trigger (when queue.length <= 2)
//   - Distribution fetch after successful submission
//   - Analytics event firing per state entry
//
// Rules from final spec:
//   - Timer stored in useRef, cleared on unmount / manual advance / question swap
//   - key={currentHeroQuestion.id} belongs on the SLIDER, not the Section A container
//   - Queue card click from hero_ready → silent promotion (no warning)
//   - Already-answered initial hero → static hero_answered_result, NO auto-timer
//   - hero_transitioning → check queue length → hero_ready OR hero_waiting_next
//   - Replenishment triggered when queuedQuestions.length <= 2

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";

// ─── Types (re-exported for use in hero components) ───────────────────────────

export type HeroStatus =
  | "hero_loading"
  | "hero_ready"
  | "hero_submitting"
  | "hero_answered_result"
  | "hero_transitioning"
  | "hero_waiting_next"
  | "hero_error";

export type HeroQuestion = {
  question_id: string;
  question_text: string;
  summary: string | null;
  tags: string[] | null;
  topic_id: string | null;
  topic_title: string | null;
  tier: string | null;
  location_label: string | null;
  origin_location_label?: string | null;
  audience_location_label?: string | null;
  user_has_answered: boolean | null;
  trend_micro_signal: string | null;
  trend_score: number | null;
  stance_momentum: number | null;
  topic_momentum: number | null;
  cover_image_url?: string | null;
  impact_normalized?: number | null;
};

export type HeroDistribution = {
  question_id: string;
  region: string;
  responses: number;
  oppose_pct: number | null;
  neutral_pct: number | null;
  support_pct: number | null;
  avg_score: number | null;
  generated_at: string;
};

// ─── Analytics helper ─────────────────────────────────────────────────────────
// Fire-and-forget — never blocks state transitions.

type AnalyticsEvent =
  | "hero_question_impression"
  | "hero_stance_submitted"
  | "hero_alignment_viewed"
  | "hero_auto_advance"
  | "hero_queue_click"
  | "hero_question_promoted";

function fireAnalytics(event: AnalyticsEvent, meta?: Record<string, unknown>) {
  try {
    // Replace with your actual analytics integration (e.g. posthog, segment, etc.)
    if (typeof window !== "undefined" && (window as any).__analytics) {
      (window as any).__analytics.track(event, meta);
    }
    // Fallback: console in dev
    if (process.env.NODE_ENV === "development") {
      console.debug(`[hero:analytics] ${event}`, meta);
    }
  } catch {
    // never throw from analytics
  }
}

// ─── Teaser label derivation ──────────────────────────────────────────────────
// Client-side only — no extra API calls.
// Priority: trend_micro_signal → score-based → location-based → default

export function deriveTeaserLabel(q: HeroQuestion): string | null {
  // Use existing trend_micro_signal if available
  if (q.trend_micro_signal) {
    const sig = q.trend_micro_signal.toLowerCase();
    if (sig.includes("trend") || sig.includes("surge")) return "Trending now";
    if (sig.includes("polar") || sig.includes("split")) return "Split issue";
    if (sig.includes("local") || sig.includes("region")) return "Local debate";
    // Return capitalised raw signal if it's short and readable
    if (q.trend_micro_signal.length <= 20) {
      return q.trend_micro_signal.charAt(0).toUpperCase() + q.trend_micro_signal.slice(1);
    }
  }

  // Derive from trend_score: high score = trending
  if (q.trend_score != null && q.trend_score > 0.7) return "Trending now";

  // Location-scoped questions get a local label
  if (
    q.audience_location_label &&
    q.audience_location_label !== "Global" &&
    q.audience_location_label.split(",").length <= 2
  ) {
    return "Local debate";
  }

  return null;
}

// ─── Hook interface ───────────────────────────────────────────────────────────

export interface UseHeroControllerOptions {
  allQuestions: HeroQuestion[];
  isLoading: boolean;
  isAuthed: boolean;
  regionLabel: string;
  onRequestReplenish: () => void;
  onSubmitSuccess: (questionId: string, value: number) => Promise<void>;
  onLoginRedirect: () => void;
}

export interface UseHeroControllerReturn {
  // ── State ──
  status: HeroStatus;
  currentHeroQuestion: HeroQuestion | null;
  queuedQuestions: HeroQuestion[];
  submittedStance: number | null;
  distribution: HeroDistribution | null;
  errorMessage: string | null;

  // ── Actions ──
  /** Submit a stance value for the current hero question */
  submitHeroStance: (value: number) => Promise<void>;
  /** Promote a queued question to hero (from Section C card click) */
  promoteQuestion: (questionId: string) => void;
  /** Manually advance to next question (skip dwell timer) */
  advanceNow: () => void;
  /** Retry after error */
  retry: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRANSITION_MS = 350;
const REPLENISH_THRESHOLD = 2;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHeroController({
  allQuestions,
  isLoading,
  isAuthed,
  regionLabel,
  onRequestReplenish,
  onSubmitSuccess,
  onLoginRedirect,
}: UseHeroControllerOptions): UseHeroControllerReturn {
  const sb = React.useMemo(getSupabase, []);

  // ── Core state ──
  const [status, setStatus] = React.useState<HeroStatus>("hero_loading");
  const [currentHeroQuestion, setCurrentHeroQuestion] = React.useState<HeroQuestion | null>(null);
  const [queuedQuestions, setQueuedQuestions] = React.useState<HeroQuestion[]>([]);
  const [submittedStance, setSubmittedStance] = React.useState<number | null>(null);
  const [distribution, setDistribution] = React.useState<HeroDistribution | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Track which question IDs have already been used as hero (to avoid re-promotion)
  const usedQuestionIds = React.useRef<Set<string>>(new Set());

  // Auto-advance timer ref — stored outside component tree to survive key remounts
  const autoAdvanceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Transition completion timer
  const transitionTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Timer helpers ──

  const clearAutoAdvance = React.useCallback(() => {
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
    }
  }, []);

  const clearTransition = React.useCallback(() => {
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
  }, []);

  const clearAllTimers = React.useCallback(() => {
    clearAutoAdvance();
    clearTransition();
  }, [clearAutoAdvance, clearTransition]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => clearAllTimers();
  }, [clearAllTimers]);

  // ── Distribution fetch ──

  const fetchDistribution = React.useCallback(
    async (questionId: string): Promise<HeroDistribution | null> => {
      if (!sb) return null;
      try {
        const { data, error } = await sb.rpc("get_question_distribution", {
          p_question_id: questionId,
          p_region: regionLabel,
          p_window_hours: 168,
        });
        if (error) throw error;
        return Array.isArray(data) && data.length > 0
          ? (data[0] as HeroDistribution)
          : null;
      } catch (e) {
        console.warn("[hero] fetchDistribution failed", e);
        return null;
      }
    },
    [sb, regionLabel]
  );

  // ── Transition to next question ──
  // This is the core queue advancement logic.
  // Called from: auto-advance timer, manual advance, promoteQuestion.

  const doTransition = React.useCallback(
    (nextQuestion: HeroQuestion, updatedQueue: HeroQuestion[]) => {
      clearAllTimers();
      setStatus("hero_transitioning");
      setDistribution(null);
      setSubmittedStance(null);

      transitionTimer.current = setTimeout(() => {
        usedQuestionIds.current.add(nextQuestion.question_id);
        setCurrentHeroQuestion(nextQuestion);
        setQueuedQuestions(updatedQueue);
        setErrorMessage(null);

        // Always enter hero_ready — doTransition only called with unanswered questions
        // (already-answered questions only surface via explicit promoteQuestion click)
        setStatus("hero_ready");
        fireAnalytics("hero_question_impression", { questionId: nextQuestion.question_id });
      }, TRANSITION_MS);
    },
    [clearAllTimers, fetchDistribution]
  );

  // ── Queue replenishment check ──

  const checkReplenish = React.useCallback(
    (queue: HeroQuestion[]) => {
      if (queue.length <= REPLENISH_THRESHOLD) {
        onRequestReplenish();
      }
    },
    [onRequestReplenish]
  );

  // ── Initialise hero from allQuestions ──
  // Runs when questions first load, and when allQuestions changes
  // (e.g. after replenishment or query invalidation).
  // Does NOT re-initialise if hero is already running (status !== hero_loading).

  React.useEffect(() => {
    // Only initialise from loading state
    if (status !== "hero_loading") {
      // If we're in waiting_next and new questions arrived, advance
      if (status === "hero_waiting_next" && allQuestions.length > 0) {
        const eligible = allQuestions.filter(
          (q) => !usedQuestionIds.current.has(q.question_id) && !q.user_has_answered
        );
        if (eligible.length > 0) {
          const [next, ...rest] = eligible;
          doTransition(next, rest);
        }
      }
      return;
    }

    if (isLoading) return;

    if (allQuestions.length === 0) {
      setStatus("hero_error");
      setErrorMessage("No questions available right now.");
      return;
    }

    // Exclude already-answered questions entirely — users go to My Stances to revisit
    const eligible = allQuestions.filter(
      (q) => !usedQuestionIds.current.has(q.question_id) && !q.user_has_answered
    );

    if (eligible.length === 0) {
      setStatus("hero_waiting_next");
      onRequestReplenish();
      return;
    }

    const [first, ...rest] = eligible;
    usedQuestionIds.current.add(first.question_id);
    setCurrentHeroQuestion(first);
    setQueuedQuestions(rest);
    checkReplenish(rest);

    setStatus("hero_ready");
    fireAnalytics("hero_question_impression", { questionId: first.question_id });
  }, [allQuestions, isLoading, status, doTransition, checkReplenish, fetchDistribution]);

  // ── Sync queue when allQuestions grows (replenishment) ──
  // When the parent fetches more questions, inject new ones into the queue
  // without disrupting the current hero.

  React.useEffect(() => {
    if (
      status === "hero_loading" ||
      status === "hero_waiting_next" ||
      !currentHeroQuestion
    ) {
      return;
    }

    // Only inject unanswered questions into queue
    const newUnused = allQuestions.filter(
      (q) => !usedQuestionIds.current.has(q.question_id) && !q.user_has_answered
    );

    const currentQueueIds = new Set(queuedQuestions.map((q) => q.question_id));
    const brandNew = newUnused.filter((q) => !currentQueueIds.has(q.question_id));

    if (brandNew.length > 0) {
      setQueuedQuestions((prev) => [...prev, ...brandNew]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allQuestions]);

  // ── submitHeroStance ──

  const submitHeroStance = React.useCallback(
    async (value: number) => {
      if (!currentHeroQuestion) return;

      // Block re-submission in result/transitioning state (guards against disabled slider firing)
      if (status === 'hero_answered_result' || status === 'hero_transitioning' || status === 'hero_submitting') return;

      // Anon users → redirect
      if (!isAuthed) {
        onLoginRedirect();
        return;
      }

      const questionId = currentHeroQuestion.question_id;

      setStatus("hero_submitting");
      setSubmittedStance(value);
      setErrorMessage(null);

      try {
        // Parent handles the actual RPC + query invalidations
        await onSubmitSuccess(questionId, value);

        // Fetch distribution for result display
        const dist = await fetchDistribution(questionId);
        setDistribution(dist);

        // Enter result mode
        setStatus("hero_answered_result");
        fireAnalytics("hero_stance_submitted", { questionId, value });
        fireAnalytics("hero_alignment_viewed", { questionId });

        // No auto-advance — user clicks "Next question" manually.
      } catch (err) {
        console.error("[hero] submitHeroStance failed", err);
        setStatus("hero_error");
        setErrorMessage("Failed to submit stance. Please try again.");
        setSubmittedStance(null);
      }
    },
    [
      status,
      currentHeroQuestion,
      isAuthed,
      onLoginRedirect,
      onSubmitSuccess,
      fetchDistribution,
      queuedQuestions,
      onRequestReplenish,
      checkReplenish,
      doTransition,
    ]
  );

  // ── promoteQuestion ──
  // Handles Section C card clicks.
  // Works from both hero_ready (silent swap) and hero_answered_result (cancel timer).

  const promoteQuestion = React.useCallback(
    (questionId: string) => {
      // Find question in queue
      const targetIndex = queuedQuestions.findIndex(
        (q) => q.question_id === questionId
      );

      if (targetIndex === -1) return; // not in queue, ignore

      const target = queuedQuestions[targetIndex];
      // Remove target from queue, keep others in order
      const updatedQueue = [
        ...queuedQuestions.slice(0, targetIndex),
        ...queuedQuestions.slice(targetIndex + 1),
      ];

      // If current hero is unanswered and being replaced, add it back to front of queue
      // so the user can return to it
      if (
        currentHeroQuestion &&
        !currentHeroQuestion.user_has_answered &&
        status === "hero_ready"
      ) {
        updatedQueue.unshift(currentHeroQuestion);
        // Remove from usedIds so it can be re-promoted
        usedQuestionIds.current.delete(currentHeroQuestion.question_id);
      }

      fireAnalytics("hero_queue_click", { questionId });
      fireAnalytics("hero_question_promoted", { questionId });

      checkReplenish(updatedQueue);
      doTransition(target, updatedQueue);
    },
    [queuedQuestions, currentHeroQuestion, status, checkReplenish, doTransition]
  );

  // ── advanceNow ──
  // Manual skip — cancel timer and advance immediately.

  const advanceNow = React.useCallback(() => {
    clearAutoAdvance();

    // Skip to next unanswered question
    const nextIdx = queuedQuestions.findIndex((q) => !q.user_has_answered);

    if (nextIdx === -1) {
      setStatus("hero_waiting_next");
      onRequestReplenish();
      return;
    }

    const nextQuestion = queuedQuestions[nextIdx];
    const updatedQueue = [
      ...queuedQuestions.slice(0, nextIdx),
      ...queuedQuestions.slice(nextIdx + 1),
    ];
    checkReplenish(updatedQueue);
    doTransition(nextQuestion, updatedQueue);
  }, [clearAutoAdvance, queuedQuestions, onRequestReplenish, checkReplenish, doTransition]);

  // ── retry ──

  const retry = React.useCallback(() => {
    setErrorMessage(null);
    setStatus("hero_loading");
  }, []);

  // ── Return ──

  return {
    status,
    currentHeroQuestion,
    queuedQuestions,
    submittedStance,
    distribution,
    errorMessage,
    submitHeroStance,
    promoteQuestion,
    advanceNow,
    retry,
  };
}
