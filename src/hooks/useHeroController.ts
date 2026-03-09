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
  /** Manually refresh the community distribution bar */
  refreshDistribution: () => void;
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
  // Live distribution polling interval (active while in hero_answered_result)
  const distributionPollInterval = React.useRef<ReturnType<typeof setInterval> | null>(null);

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

  const clearDistributionPoll = React.useCallback(() => {
    if (distributionPollInterval.current) {
      clearInterval(distributionPollInterval.current);
      distributionPollInterval.current = null;
    }
  }, []);

  const clearAllTimers = React.useCallback(() => {
    clearAutoAdvance();
    clearTransition();
    clearDistributionPoll();
  }, [clearAutoAdvance, clearTransition, clearDistributionPoll]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => clearAllTimers();
  }, [clearAllTimers]);

  // ── Cross-page stance change listener ──
  // Fires when any page (e.g. QuestionDetailPage) saves a stance via submitStance.
  // Immediately re-fetches distribution so homepage bar updates without waiting for poll tick.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const { questionId, value } = (e as CustomEvent).detail ?? {};
      console.log(`[hero:event] stance-saved event received qId=${questionId?.slice(0,8)} value=${value}`);
      if (currentHeroQuestion && questionId === currentHeroQuestion.question_id) {
        console.log(`[hero:event] ✓ matches current hero question — refreshing distribution immediately`);
        fetchDistribution(currentHeroQuestion.question_id).then((fresh) => {
          if (fresh) {
            console.log(`[hero:event] ✓ distribution refreshed — responses=${fresh.responses} oppose=${fresh.oppose_pct}% support=${fresh.support_pct}%`);
            setDistribution(fresh);
          } else {
            console.warn(`[hero:event] ✗ distribution refresh returned null`);
          }
        });
      } else {
        console.log(`[hero:event] ✗ different question (hero=${currentHeroQuestion?.question_id?.slice(0,8)}) — ignoring`);
      }
    };
    window.addEventListener("stance-saved", handler);
    return () => window.removeEventListener("stance-saved", handler);
  }, [currentHeroQuestion, fetchDistribution]);

  // ── Distribution fetch ──
  // Stored in a ref so the polling interval always calls the latest version
  // without needing to be recreated (avoids stale closure in setInterval).

  const fetchDistributionFn = React.useCallback(
    async (questionId: string): Promise<HeroDistribution | null> => {
      if (!sb) return null;
      const callId = Date.now();
      console.log(`[hero:dist] ► fetch START qId=${questionId.slice(0,8)} callId=${callId}`);
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

        if (!supabaseUrl || !supabaseKey) {
          console.error("[hero:dist] ✗ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
          return null;
        }

        const session = await sb.auth.getSession();
        const accessToken = session.data.session?.access_token;
        console.log(`[hero:dist]   auth=${accessToken ? "bearer" : "anon-key"}`);

        const url = `${supabaseUrl}/rest/v1/rpc/get_question_distribution`;
        const body = {
          p_question_id: questionId,
          p_region: regionLabel,
          p_window_hours: 168,
        };
        console.log(`[hero:dist]   POST ${url}`, body);

        const res = await fetch(url, {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabaseKey,
            "Authorization": `Bearer ${accessToken ?? supabaseKey}`,
            "Cache-Control": "no-cache, no-store",
            "x-cache-bust": callId.toString(),
          },
          body: JSON.stringify(body),
        });

        console.log(`[hero:dist]   response status=${res.status} ok=${res.ok}`);

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[hero:dist] ✗ HTTP ${res.status}:`, errText);
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        console.log(`[hero:dist]   raw response:`, data);

        const result = Array.isArray(data) && data.length > 0
          ? (data[0] as HeroDistribution)
          : null;

        if (result) {
          console.log(`[hero:dist] ✓ responses=${result.responses} oppose=${result.oppose_pct}% neutral=${result.neutral_pct}% support=${result.support_pct}%`);
        } else {
          console.warn(`[hero:dist] ✗ empty result — data was:`, data);
        }
        return result;
      } catch (e) {
        console.error(`[hero:dist] ✗ exception callId=${callId}:`, e);
        return null;
      }
    },
    [sb, regionLabel]
  );

  const fetchDistributionRef = React.useRef(fetchDistributionFn);
  React.useEffect(() => {
    fetchDistributionRef.current = fetchDistributionFn;
  }, [fetchDistributionFn]);

  const fetchDistribution = React.useCallback(
    (questionId: string) => fetchDistributionRef.current(questionId),
    []
  );

  // ── Live community distribution polling ──
  // Starts when hero_ready (so bar is live before user answers).
  // submitHeroStance also restarts it after submission.
  // Stops automatically on transition, unmount, or error.
  React.useEffect(() => {
    if (status !== "hero_ready" || !currentHeroQuestion) return;
    const questionId = currentHeroQuestion.question_id;
    clearDistributionPoll();
    console.log(`[hero:poll] ▶ polling started for qId=${questionId.slice(0,8)} every 10s`);
    distributionPollInterval.current = setInterval(async () => {
      console.log(`[hero:poll] ⏱ tick for qId=${questionId.slice(0,8)}`);
      const fresh = await fetchDistribution(questionId);
      if (fresh) {
        console.log(`[hero:poll] ✓ updated distribution — responses=${fresh.responses}`);
        setDistribution(fresh);
      } else {
        console.warn(`[hero:poll] ✗ poll returned null, distribution unchanged`);
      }
    }, 10_000);
    return () => {
      console.log(`[hero:poll] ■ polling stopped for qId=${questionId.slice(0,8)}`);
      clearDistributionPoll();
    };
  }, [status, currentHeroQuestion, fetchDistribution, clearDistributionPoll]);

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
        setStatus("hero_ready");
        fireAnalytics("hero_question_impression", { questionId: nextQuestion.question_id });
        // Pre-fetch community distribution so the bar shows immediately
        fetchDistribution(nextQuestion.question_id).then((dist) => {
          if (dist) setDistribution(dist);
        });
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

    console.log(`[hero:init] entering hero_ready qId=${first.question_id.slice(0,8)}`);
    setStatus("hero_ready");
    fireAnalytics("hero_question_impression", { questionId: first.question_id });
    // Pre-fetch community distribution so the bar shows immediately
    fetchDistribution(first.question_id).then((dist) => {
      if (dist) {
        console.log(`[hero:init] initial distribution loaded — responses=${dist.responses}`);
        setDistribution(dist);
      } else {
        console.warn(`[hero:init] initial distribution returned null`);
      }
    });
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

        // Poll distribution every 10s — keeps community bar live before and after answering
        clearDistributionPoll();
        console.log(`[hero:poll] ▶ post-submit polling started for qId=${questionId.slice(0,8)}`);
        distributionPollInterval.current = setInterval(async () => {
          console.log(`[hero:poll] ⏱ post-submit tick for qId=${questionId.slice(0,8)}`);
          const fresh = await fetchDistribution(questionId);
          if (fresh) {
            console.log(`[hero:poll] ✓ post-submit distribution updated — responses=${fresh.responses}`);
            setDistribution(fresh);
          } else {
            console.warn(`[hero:poll] ✗ post-submit poll returned null`);
          }
        }, 10_000);
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
      clearDistributionPoll,
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

  const refreshDistribution = React.useCallback(() => {
    if (!currentHeroQuestion) return;
    console.log(`[hero:refresh] manual refresh triggered for qId=${currentHeroQuestion.question_id.slice(0,8)}`);
    fetchDistribution(currentHeroQuestion.question_id).then((fresh) => {
      if (fresh) {
        console.log(`[hero:refresh] ✓ manual refresh succeeded — responses=${fresh.responses}`);
        setDistribution(fresh);
      } else {
        console.warn(`[hero:refresh] ✗ manual refresh returned null`);
      }
    });
  }, [currentHeroQuestion, fetchDistribution]);

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
    refreshDistribution,
  };
}
