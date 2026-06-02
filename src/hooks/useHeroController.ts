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
//
// FIX: Realtime cleanup uses sb.removeChannel() only — sb.realtime.disconnect()
//   intentionally NOT called as it destroys the singleton WebSocket transport
//   and breaks subsequent subscriptions on the same client instance.

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { fetchCommunityStats } from "@/lib/fetchCommunityStats";
import {
  CommunityStanceData,
  RawStanceStatsRegionRow,
  mapToCommunityStanceData,
  COMMUNITY_STANCE_GLOBAL_SCOPE,
  COMMUNITY_STANCE_GLOBAL_KEY,
} from "@/types/communityStance";

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
  slider_low_label?: string | null;
  slider_high_label?: string | null;
};

// HeroDistribution replaced by CommunityStanceData from @/types/communityStance
// Field mapping: oppose_pct → opposePct, support_pct → supportPct, neutral_pct → neutralPct
export type { CommunityStanceData as HeroDistribution };

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
  // Instance tracking — if you see more than one MOUNT log, the component is rendering twice
  const instanceId = React.useRef(`ctrl-${Math.random().toString(36).slice(2,6)}`);
  React.useEffect(() => {
    console.log(`[hero:instance] ▲ MOUNT id=${instanceId.current}`);
    return () => console.log(`[hero:instance] ▼ UNMOUNT id=${instanceId.current}`);
  }, []);
  const sb = React.useMemo(getSupabase, []);

  // ── Core state ──
  const [status, setStatus] = React.useState<HeroStatus>("hero_loading");
  const [currentHeroQuestion, setCurrentHeroQuestion] = React.useState<HeroQuestion | null>(null);
  const [queuedQuestions, setQueuedQuestions] = React.useState<HeroQuestion[]>([]);
  const [submittedStance, setSubmittedStance] = React.useState<number | null>(null);
  const [distribution, setDistribution] = React.useState<CommunityStanceData | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // ── Fetch token guard ──
  // Prevents stale fetch responses from overwriting newer results.
  const fetchToken = React.useRef(0);

  const setDistributionGuarded = React.useCallback(
    (data: CommunityStanceData | null, token: number) => {
      if (token !== fetchToken.current) {
        console.log(`[hero:dist] ⚑ stale response discarded token=${token} current=${fetchToken.current}`);
        return;
      }
      setDistribution(data);
    },
    []
  );

  const fetchDistributionFresh = React.useCallback(
    async (questionId: string): Promise<void> => {
      const token = ++fetchToken.current;
      const result = await fetchDistributionRef.current(questionId);

      if (result !== null) {
        setDistributionGuarded(result, token);
      } else {
        console.log(`[hero:dist] ⚑ null on first attempt — retrying in 800ms (token=${token})`);
        setTimeout(async () => {
          if (token !== fetchToken.current) {
            console.log(`[hero:dist] ⚑ retry skipped — newer fetch in flight (token=${token} current=${fetchToken.current})`);
            return;
          }
          const retry = await fetchDistributionRef.current(questionId);
          if (retry !== null) {
            console.log(`[hero:dist] ✓ retry succeeded — responses=${retry.responses}`);
            setDistributionGuarded(retry, token);
          } else {
            console.warn(`[hero:dist] ✗ retry also null — keeping existing distribution`);
          }
        }, 800);
      }
    },
    [setDistributionGuarded]
  );

  // Track which question IDs have already been used as hero (to avoid re-promotion)
  const usedQuestionIds = React.useRef<Set<string>>(new Set());

  // Auto-advance timer ref — stored outside component tree to survive key remounts
  const autoAdvanceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Transition completion timer
  const transitionTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distribution poll timeout ref (self-scheduling setTimeout chain)
  const distributionPollInterval = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
      clearTimeout(distributionPollInterval.current);
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

  // ── Distribution fetch ──

  const fetchDistributionFn = React.useCallback(
    async (questionId: string): Promise<CommunityStanceData | null> => {
      if (!questionId) return null;
      const callId = Date.now();
      console.log(`[hero:dist] ► fetch START qId=${questionId.slice(0,8)} callId=${callId}`);
      try {
        const result = await fetchCommunityStats(questionId);
        if (result) {
          console.log(`[hero:dist] ✓ responses=${result.responses} opposePct=${result.opposePct}% neutralPct=${result.neutralPct}% supportPct=${result.supportPct}%`);
        } else {
          console.warn(`[hero:dist] ✗ empty result for qId=${questionId.slice(0,8)} — no aggregate row yet`);
        }
        return result;
      } catch (e) {
        console.error(`[hero:dist] ✗ exception callId=${callId}:`, e);
        return null;
      }
    },
    []
  );

  const fetchDistributionRef = React.useRef(fetchDistributionFn);
  React.useEffect(() => {
    fetchDistributionRef.current = fetchDistributionFn;
  }, [fetchDistributionFn]);

  const fetchDistribution = React.useCallback(
    (questionId: string) => fetchDistributionRef.current(questionId),
    []
  );

  const currentQuestionId = React.useMemo(() => currentHeroQuestion?.question_id ?? null, [currentHeroQuestion?.question_id]);

  // ── Realtime: subscribe to question_stance_stats_region (aggregate table) ──
  //
  // REPLICA IDENTITY FULL removed — payload.new only has PK columns so we
  // always fetch on any event rather than reading from the payload.
  //
  // IMPORTANT: cleanup calls sb.realtime.disconnect() when no channels remain.
  // Without this, the server-side WAL sender slot stays open after the question
  // changes, accumulating stale replication connections (visible as multiple
  // START_REPLICATION entries in pg_stat_activity) that cause the next RPC
  // call to hang during the new subscription handshake.
  React.useEffect(() => {
    if (!sb || !currentQuestionId) return;
    const questionId = currentQuestionId;

    console.log(`[hero:realtime] subscribing to question_stance_stats_region qId=${questionId.slice(0,8)}`);

    let deleteDebounce: ReturnType<typeof setTimeout> | null = null;
    let insertPending = false;

    const channel = sb
      .channel(`hero-aggregate-${questionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "question_stance_stats_region",
          filter: `question_id=eq.${questionId}`,
        },
        (payload) => {
          console.log(`[hero:realtime] event=${payload.eventType}`);

          if (payload.eventType === "DELETE") {
            // Debounce: DB may DELETE then INSERT when replacing a row.
            // Wait 400ms — if a paired INSERT/UPDATE arrives, cancel the clear.
            console.log(`[hero:realtime] DELETE — waiting 400ms for paired INSERT`);
            insertPending = false;
            if (deleteDebounce) clearTimeout(deleteDebounce);
            deleteDebounce = setTimeout(() => {
              if (!insertPending) {
                console.log(`[hero:realtime] ✓ no paired INSERT — clearing distribution`);
                ++fetchToken.current;
                setDistribution(null);
              }
            }, 400);
            return;
          }

          // INSERT or UPDATE — cancel any pending DELETE clear
          insertPending = true;
          if (deleteDebounce) {
            clearTimeout(deleteDebounce);
            deleteDebounce = null;
          }

          // Always fetch — payload.new only has PK columns without REPLICA IDENTITY FULL.
          // Small delay to let the deferred trigger commit propagate before reading.
          console.log(`[hero:realtime] ✓ aggregate row changed — fetching fresh stats`);
          setTimeout(async () => {
            const token = ++fetchToken.current;
            const result = await fetchDistributionRef.current(questionId);
            if (result !== null) {
              console.log(`[hero:realtime] ✓ fetch succeeded responses=${result.responses}`);
              setDistributionGuarded(result, token);
            } else {
              console.warn(`[hero:realtime] ✗ fetch null — retrying in 800ms`);
              setTimeout(async () => {
                if (token !== fetchToken.current) return;
                const retry = await fetchDistributionRef.current(questionId);
                if (retry !== null) {
                  console.log(`[hero:realtime] ✓ retry succeeded responses=${retry.responses}`);
                  setDistributionGuarded(retry, token);
                } else {
                  console.warn(`[hero:realtime] ✗ retry also null — keeping existing`);
                }
              }, 800);
            }
          }, 100);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log(`[hero:realtime] ✅ SUBSCRIBED to question_stance_stats_region qId=${questionId.slice(0,8)}`);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`[hero:realtime] ❌ ${status} qId=${questionId.slice(0,8)}`);
        }
      });

    return () => {
      if (deleteDebounce) clearTimeout(deleteDebounce);
      // removeChannel only — do NOT call sb.realtime.disconnect() here.
      // disconnect() destroys the singleton client's WebSocket transport,
      // breaking subsequent subscriptions on the same client instance.
      sb.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, currentQuestionId]);

  // ── Same-tab fast path ──
  // QDP dispatches stance-saved with pre-fetched stats when saving on the same tab.
  // This avoids any fetch/propagation race for the same-tab case.
  // Cross-tab updates are handled by the realtime subscription above.
  React.useEffect(() => {
    if (!currentQuestionId) return;
    const handler = (e: Event) => {
      const { questionId, communityStats } = (e as CustomEvent).detail ?? {};
      if (questionId !== currentQuestionId) return;
      if (communityStats) {
        console.log(`[hero:window-event] ✓ applying bundled stats responses=${communityStats.responses}`);
        const token = ++fetchToken.current;
        setDistributionGuarded(communityStats, token);
      } else {
        // communityStats is null — fetch fresh after a short delay to let
        // the DB trigger write the updated aggregates first.
        console.log(`[hero:window-event] ✓ fetching fresh stats after save`);
        const token = ++fetchToken.current;
        setTimeout(async () => {
          if (token !== fetchToken.current) return;
          const fresh = await fetchCommunityStats(questionId);
          if (fresh) setDistributionGuarded(fresh, token);
        }, 700);
      }
    };
    window.addEventListener("stance-saved", handler);
    return () => window.removeEventListener("stance-saved", handler);
  }, [currentQuestionId, setDistributionGuarded]);

  // ── Recovery poll (low-frequency) ──
  // Realtime is the primary sync mechanism. This poll exists only as a recovery
  // fallback if realtime missed an event (e.g. connection gap, tab backgrounded).
  React.useEffect(() => {
    if ((status !== "hero_ready" && status !== "hero_answered_result") || !currentQuestionId) return;

    let cancelled = false;
    const qId = currentQuestionId;

    const tick = async () => {
      if (cancelled) return;
      console.log(`[hero:poll] ⏱ recovery tick qId=${qId.slice(0,8)}`);
      const fresh = await fetchDistributionRef.current(qId);
      if (!cancelled && fresh) {
        const tokenNow = fetchToken.current;
        setDistributionGuarded(fresh, tokenNow);
      }
      if (!cancelled) {
        distributionPollInterval.current = setTimeout(tick, 30_000);
      }
    };

    distributionPollInterval.current = setTimeout(tick, 30_000);

    return () => {
      cancelled = true;
      if (distributionPollInterval.current) {
        clearTimeout(distributionPollInterval.current);
        distributionPollInterval.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, currentQuestionId]);

  // ── Transition to next question ──

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

        setStatus("hero_ready");
        fireAnalytics("hero_question_impression", { questionId: nextQuestion.question_id });
        fetchDistributionFresh(nextQuestion.question_id);
      }, TRANSITION_MS);
    },
    [clearAllTimers, fetchDistributionFresh]
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

  // Ref so init effect can read current status synchronously without
  // needing status as a reactive dependency (which would cause infinite loops).
  const statusRef = React.useRef(status);
  React.useEffect(() => { statusRef.current = status; }, [status]);

  React.useEffect(() => {
    if (statusRef.current !== "hero_loading") {
      if (statusRef.current === "hero_waiting_next" && allQuestions.length > 0) {
        // First pass: unanswered questions not yet shown this session
        let eligible = allQuestions.filter(
          (q) => !usedQuestionIds.current.has(q.question_id) && !q.user_has_answered
        );
        // Second pass: if nothing new, reset session history and try unanswered again
        if (eligible.length === 0) {
          const unanswered = allQuestions.filter((q) => !q.user_has_answered);
          if (unanswered.length > 0) {
            console.log("[hero:waiting] resetting session history — recycling unanswered questions");
            usedQuestionIds.current.clear();
            eligible = unanswered;
          }
        }
        if (eligible.length > 0) {
          const [next, ...rest] = eligible;
          doTransition(next, rest);
        }
        // If still nothing: truly no unanswered questions — stay in waiting state
        // and let onRequestReplenish eventually bring new ones.
      }
      return;
    }

    if (isLoading) return;

    if (allQuestions.length === 0) {
      setStatus("hero_error");
      setErrorMessage("No questions available right now.");
      return;
    }

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
    fetchDistributionFresh(first.question_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // FIX: `status` removed from deps. Having it here caused the effect to re-run
  // every time status changed (including after it set status='hero_ready'), which
  // re-invoked checkReplenish → onRequestReplenish → fetchNextPage on every cycle.
  // The statusRef below gives the effect synchronous access to current status
  // without making it a reactive dependency.
  }, [allQuestions, isLoading, doTransition, checkReplenish, fetchDistributionFresh]);

  // ── Sync queue when allQuestions grows (replenishment) ──

  React.useEffect(() => {
    if (
      status === "hero_loading" ||
      status === "hero_waiting_next" ||
      !currentHeroQuestion
    ) {
      return;
    }

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

      // Block during transition or already-submitting, but allow re-submission
      // when in hero_answered_result so the user can change their stance.
      if (status === 'hero_transitioning' || status === 'hero_submitting') return;

      if (!isAuthed) {
        onLoginRedirect();
        return;
      }

      const questionId = currentHeroQuestion.question_id;
      const isResubmit = status === 'hero_answered_result';

      if (!isResubmit) setStatus("hero_submitting");
      setSubmittedStance(value);
      setErrorMessage(null);

      try {
        await onSubmitSuccess(questionId, value);
        // Refresh community bar after a short delay to let DB trigger complete
        setTimeout(() => fetchDistributionFresh(questionId), 700);

        if (!isResubmit) {
          setStatus("hero_answered_result");
          fireAnalytics("hero_stance_submitted", { questionId, value });
          fireAnalytics("hero_alignment_viewed", { questionId });
        } else {
          console.log(`[hero:submit] ✓ stance updated qId=${questionId.slice(0,8)}`);
        }
      } catch (err) {
        console.error("[hero] submitHeroStance failed", err);
        if (!isResubmit) {
          setStatus("hero_error");
          setErrorMessage("Failed to submit stance. Please try again.");
          setSubmittedStance(null);
        }
      }
    },
    [
      status,
      currentHeroQuestion,
      isAuthed,
      onLoginRedirect,
      onSubmitSuccess,
      fetchDistributionFresh,
      queuedQuestions,
      onRequestReplenish,
      checkReplenish,
      doTransition,
    ]
  );

  // ── promoteQuestion ──

  const promoteQuestion = React.useCallback(
    (questionId: string) => {
      const targetIndex = queuedQuestions.findIndex(
        (q) => q.question_id === questionId
      );

      if (targetIndex === -1) return;

      const target = queuedQuestions[targetIndex];
      const updatedQueue = [
        ...queuedQuestions.slice(0, targetIndex),
        ...queuedQuestions.slice(targetIndex + 1),
      ];

      if (
        currentHeroQuestion &&
        !currentHeroQuestion.user_has_answered &&
        status === "hero_ready"
      ) {
        updatedQueue.unshift(currentHeroQuestion);
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

  const advanceNow = React.useCallback(() => {
    clearAutoAdvance();

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
    fetchDistributionFresh(currentHeroQuestion.question_id);
  }, [currentHeroQuestion, fetchDistributionFresh]);

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
