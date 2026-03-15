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
  // Every intentional refresh increments this counter and captures the new value.
  // A fetch result only commits if its captured token still matches current — meaning
  // no newer fetch was started while this one was in flight.
  // Eliminates the race where a slow poll tick resolves AFTER a faster realtime fetch
  // and overwrites the correct new data with stale values.
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

  // Convenience: bump token, run a fetch, commit only if still current.
  // On null result (INSERT/UPDATE propagation gap — row not readable yet),
  // retries once after 800ms. If retry also null, keeps existing distribution.
  // DELETE events are handled directly in the realtime callback without fetching.
  const fetchDistributionFresh = React.useCallback(
    async (questionId: string): Promise<void> => {
      const token = ++fetchToken.current;
      const result = await fetchDistributionRef.current(questionId);

      if (result !== null) {
        setDistributionGuarded(result, token);
      } else {
        // INSERT/UPDATE propagation gap — row not readable yet, retry once after 800ms
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
  // Thin wrapper around the shared fetchCommunityStats fetcher (Phase 3).
  // Reads directly from question_stance_stats_region — no RPC, no RLS issues.
  // Stored in a ref so the polling chain always calls the latest version
  // without needing to be recreated (avoids stale closure in setTimeout chain).

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
    [] // fetchCommunityStats is a stable module-level function, no deps needed
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
  // Requires: ALTER TABLE question_stance_stats_region REPLICA IDENTITY FULL
  // (see migration_replica_identity_full.sql)
  //
  // With REPLICA IDENTITY FULL, payload.new contains the full aggregate row on
  // INSERT/UPDATE — so we can build CommunityStanceData directly from the event
  // without a follow-up fetch. This eliminates the event/read propagation race.
  //
  // Flow for INSERT/UPDATE (stance saved or changed):
  //   1. question_stance_stats_region INSERT/UPDATE fires
  //   2. Filter for region_scope='global' AND region_key='global'
  //   3a. If payload.new has full row → build distribution directly, no fetch
  //   3b. If payload.new is incomplete (REPLICA IDENTITY not yet active) →
  //       fall back to a single guarded fetch after 800ms
  //
  // Flow for DELETE (last stance cleared — DB trigger deletes all aggregate rows):
  //   1. question_stance_stats_region DELETE fires
  //   2. Debounce 400ms waiting for a paired INSERT (in case it's a replace, not a clear)
  //   3. If no INSERT arrives → set distribution = null directly
  // ── Realtime: subscribe to question_stance_stats_region (aggregate table) ──
  //
  // REPLICA IDENTITY FULL removed from question_stance_stats_region to fix a
  // deadlock where the WAL sender lock from the realtime connection blocked the
  // AFTER UPDATE trigger on question_stances from writing to this table.
  //
  // Without REPLICA IDENTITY FULL, payload.new only contains PK columns, so we
  // always fetch rather than reading from the payload. The fetch is token-guarded
  // so stale responses from concurrent events are discarded.
  //
  // Flow for INSERT/UPDATE (stance saved or changed):
  //   1. question_stance_stats_region INSERT/UPDATE fires
  //   2. Filter ensures it's for the current question
  //   3. Always fetch fresh data — no payload shortcut
  //
  // Flow for DELETE (last stance cleared):
  //   1. DELETE fires
  //   2. Debounce 400ms waiting for a paired INSERT (replace vs clear)
  //   3. If no INSERT arrives → set distribution = null directly
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

          // Always fetch — payload.new only has PK columns without REPLICA IDENTITY FULL
          console.log(`[hero:realtime] ✓ aggregate row changed — fetching fresh stats`);
          setTimeout(async () => {
            const token = ++fetchToken.current;
            const result = await fetchDistributionRef.current(questionId);
            if (result !== null) {
              console.log(`[hero:realtime] ✓ fetch succeeded responses=${result.responses}`);
              setDistributionGuarded(result, token);
            } else {
              // Row not propagated yet — retry once after 800ms
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
        // Cleared stance with no stats — clear directly
        console.log(`[hero:window-event] ✓ stance cleared`);
        ++fetchToken.current;
        setDistribution(null);
      }
    };
    window.addEventListener("stance-saved", handler);
    return () => window.removeEventListener("stance-saved", handler);
  }, [currentQuestionId, setDistributionGuarded]);

  // ── Recovery poll (low-frequency) ──
  // Realtime is the primary sync mechanism. This poll exists only as a recovery
  // fallback if realtime missed an event (e.g. connection gap, tab backgrounded).
  // Fires every 30s — low enough to not interfere with realtime fetches.
  // Does NOT use the token guard — poll is purely additive and low-priority.
  // If distribution is already correct, setDistribution with same data is a no-op.
  React.useEffect(() => {
    if ((status !== "hero_ready" && status !== "hero_answered_result") || !currentQuestionId) return;

    let cancelled = false;
    const qId = currentQuestionId;

    const tick = async () => {
      if (cancelled) return;
      console.log(`[hero:poll] ⏱ recovery tick qId=${qId.slice(0,8)}`);
      const fresh = await fetchDistributionRef.current(qId);
      if (!cancelled && fresh) {
        // Only apply if no higher-priority fetch is in flight
        // (token will be freshly incremented if one is)
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
    fetchDistributionFresh(first.question_id);
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

        // Fetch distribution for result display — token-guarded so realtime can't be overwritten
        await fetchDistributionFresh(questionId);

        // Enter result mode
        setStatus("hero_answered_result");
        fireAnalytics("hero_stance_submitted", { questionId, value });
        fireAnalytics("hero_alignment_viewed", { questionId });

        // Polling continues via the unified useEffect chain above
        // (covers both hero_ready and hero_answered_result — no manual setInterval needed here)
        console.log(`[hero:submit] ✓ stance saved qId=${questionId.slice(0,8)} — poll chain will continue in hero_answered_result`);
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
      fetchDistributionFresh,
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
