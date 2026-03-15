// src/pages/QuestionDetailPage.tsx — Question detail with stance capture + regional comparison + related questions
// EPIC C INTEGRATION: Added view tracking and interaction tracking
// UI REFRESH: Phase 1-6 typography + rhythm + editorial hero image (Plan B)
// DESIGN PASS 2: Editorial polish — removed admin header, tightened widths, larger hero,
//   stance framing prompt, bg-slate-50 page surface, shared rail styling, section rhythm
// DESIGN PASS 3: Justified summary (Point 13), mobile layout reorder (Point 14),
//   stats + pulseThumb wired to QuestionStanceSlider (Points 16–18)
// FIX: channelReady ref gates handleSetStance until SUBSCRIBED fires, preventing
//   the first save after navigation from firing before the WS handshake completes.
// NOTE: sb.realtime.disconnect() intentionally NOT called on unmount — it breaks
//   the singleton client's WebSocket for subsequent subscriptions on the same instance.

import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { QuestionCommentsPanel } from "@/components/question/QuestionCommentsPanel";
import { useQuestionView } from "@/hooks/useQuestionView";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { QuestionPhaseBadge } from "@/components/question/QuestionPhaseBadge";
import { useToast } from "@/components/ui/use-toast";

import { FollowTopicButton } from "@/components/FollowTopicButton";
import { fetchCommunityStats, communityStatsKey } from "@/lib/fetchCommunityStats";
import { CommunityStanceBar } from "@/components/question/CommunityStanceBar";
import {

} from "@/types/communityStance";

type Session = import("@supabase/supabase-js").Session;

type LiveQuestion = {
  id: string;
  topic_id?: string;
  question: string;
  summary?: string | null;
  tags?: string[] | null;
  location_label?: string | null;
  published_at?: string | null;
  status?: string | null;
  phase?: string;
  cover_image_url?: string | null;
};

type TopicLite = {
  id: string;
  title: string;
};

type QuestionStance = {
  id: string;
  question_id: string;
  score: number;
};

type RegionalStat = {
  region_scope: "city" | "county" | "state" | "country" | "global" | string;
  region_label: string;
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
};

type QuestionStats = {
  my_stance: number | null;
  location: {
    city: string | null;
    county: string | null;
    state: string | null;
    country: string | null;
  } | null;
  regions: {
    global?: RegionalStat | null;
    city?: RegionalStat | null;
    county?: RegionalStat | null;
    state?: RegionalStat | null;
    country?: RegionalStat | null;
    [key: string]: RegionalStat | null | undefined;
  } | null;
};

type RegionRow = {
  user_id: string;
  city_label: string | null;
  county_label: string | null;
  state_label: string | null;
  country_label: string | null;
};

type ThreadSentimentRow = {
  question_id: string;
  avg_sentiment: number | null;
  sentiment_variance: number | null;
  comment_count: number;
  summary_text: string | null;
};

const STANCE_SCALE = [
  { value: -2, labelShort: "Strongly disagree", label: "Strongly disagree" },
  { value: -1, labelShort: "Disagree", label: "Disagree" },
  { value: 0, labelShort: "Neutral", label: "Neutral" },
  { value: 1, labelShort: "Agree", label: "Agree" },
  { value: 2, labelShort: "Strongly agree", label: "Strongly agree" },
];

// ---------- Session hook ----------
// Initialises from the SDK's synchronous in-memory cache so the component
// never flashes isAuthed=false on remount for an already-signed-in user.
// getSession() is still called to hydrate from storage on a cold start.
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);

  // Seed from the synchronous cache so there is no null flash on remount.
  const [session, setSession] = React.useState<Session | null>(() => {
    // supabase-js exposes the cached session via auth.session() (v2 internal).
    // We access it safely; if the method doesn't exist we fall back to null
    // and let getSession()/onAuthStateChange fill it in asynchronously.
    try {
      // @ts-expect-error — internal API, not in public types
      return sb?.auth?.currentSession ?? null;
    } catch {
      return null;
    }
  });

  React.useEffect(() => {
    if (!sb) return;
    // Still call getSession() to cover cold-start / storage hydration.
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

// ---------- Data fetchers ----------
async function fetchQuestionById(id: string): Promise<LiveQuestion | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("questions")
    .select(
      "id, topic_id, question, summary, tags, location_label, published_at, status, phase, cover_image_url"
    )
    .eq("id", id)
    .eq("status", "active")
    .limit(1);

  if (error) {
    console.error("Failed to load question detail", error);
    throw error;
  }

  const row = (data ?? [])[0] as LiveQuestion | undefined;
  if (!row) return null;
  if (row.status && row.status !== "active") return null;
  return row;
}

async function fetchTopicLite(topicId: string): Promise<TopicLite | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("topics")
    .select("id, title")
    .eq("id", topicId)
    .maybeSingle<TopicLite>();

  if (error) { console.error("Failed to load topic title", error); return null; }
  return data ?? null;
}

async function fetchMyStance(questionId: string): Promise<number | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("question_stances")
    .select("id, question_id, score")
    .eq("question_id", questionId)
    .maybeSingle<QuestionStance>();

  if (error) {
    if ((error as any).code === "PGRST116") return null;
    console.error("Failed to load stance", error);
    throw error;
  }
  return data ? data.score : null;
}

async function setMyStance(questionId: string, score: number | null) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  // Pre-flight: confirm we have an active session before hitting the network.
  // If auth.uid() is null PostgREST raises "Not authenticated" immediately, but
  // a missing JWT causes a different, harder-to-diagnose hang in some pool states.
  const { data: { session: activeSession } } = await sb.auth.getSession();
  if (!activeSession) {
    console.error("[setMyStance] aborting — no active session");
    throw new Error("Not authenticated. Please sign in and try again.");
  }

  console.log("[setMyStance] calling rpc", { questionId, score, uid: activeSession.user.id.slice(0, 8) });

  const TIMEOUT_MS = 8_000;

  // Promise.race: the timeout path rejects (throws), which is the correct path
  // for React Query to catch and route to onError.
  // If the rpcPromise wins the race, we destructure its { data, error } result.
  let timeoutFired = false;
  const result = await Promise.race([
    sb.rpc("set_question_stance", {
      p_question_id: questionId,
      p_score: score,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        timeoutFired = true;
        console.error(
          `[setMyStance] ⏱ TIMEOUT after ${TIMEOUT_MS}ms — PostgREST pool is likely stale.`,
          "Run: NOTIFY pgrst, 'reload schema'; in the Supabase SQL editor."
        );
        reject(new Error(`set_question_stance timed out after ${TIMEOUT_MS}ms — PostgREST pool needs reload`));
      }, TIMEOUT_MS)
    ),
  ]);

  if (timeoutFired) return null; // unreachable — timeout rejects — but satisfies TS
  const { data, error } = result;
  console.log("[setMyStance] rpc returned", { data, error });

  if (error) {
    console.error("[setMyStance] PostgREST error", {
      code: (error as any).code,
      message: (error as any).message,
      details: (error as any).details,
      hint: (error as any).hint,
    });
    throw new Error((error as any).message ?? "set_question_stance failed");
  }
  if (score === null) return null;
  const row = data as QuestionStance | null;
  return row ? row.score : null;
}

async function fetchQuestionStats(questionId: string): Promise<QuestionStats | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb.rpc("get_question_stats_for_user", {
    p_question_id: questionId,
  });

  if (error) { console.error("Failed to load question stats (RPC)", error); return null; }
  if (!data) return null;

  const raw = data as any;
  return {
    my_stance: typeof raw.my_stance === "number" ? raw.my_stance : null,
    location: raw.location ?? null,
    regions: (raw.regions ?? {}) as QuestionStats["regions"],
  };
}

async function fetchMyRegion(userId: string): Promise<RegionRow | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("user_region_dimensions")
    .select("user_id, city_label, county_label, state_label, country_label")
    .eq("user_id", userId)
    .maybeSingle<RegionRow>();

  if (error) { console.error("Failed to load user region dimensions", error); return null; }
  return data ?? null;
}

async function fetchRelatedQuestions(
  questionId: string,
  tags: string[],
  locationLabel: string | null,
  limit = 4
): Promise<LiveQuestion[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");
  if (!tags.length) return [];

  let q = sb
    .from("v_live_questions")
    .select("id, question, summary, tags, location_label, published_at, status")
    .neq("id", questionId)
    .eq("status", "active")
    .overlaps("tags", tags);

  if (locationLabel && locationLabel.trim()) {
    q = q.eq("location_label", locationLabel.trim());
  }

  const { data, error } = await q.order("published_at", { ascending: false }).limit(limit);
  if (error) { console.error("Failed to load related questions", error); return []; }
  return (data ?? []) as LiveQuestion[];
}

async function fetchThreadSentiment(questionId: string): Promise<ThreadSentimentRow | null> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client not available");

  const { data, error } = await sb
    .from("question_comment_sentiment")
    .select("question_id, avg_sentiment, sentiment_variance, comment_count, summary_text")
    .eq("question_id", questionId)
    .maybeSingle<ThreadSentimentRow>();

  if (error) { console.error("Failed to load thread sentiment", error); return null; }
  return data ?? null;
}

// ---------- EPIC C: Track answered questions ----------
async function trackQuestionInteraction(
  userId: string,
  questionId: string,
  topicId: string | undefined,
  answered: boolean
): Promise<void> {
  const sb = getSupabase();
  if (!sb || !topicId) return;

  try {
    if (answered) {
      const { error: rpcError } = await sb.rpc("record_question_answer", {
        p_user_id: userId,
        p_question_id: questionId,
      });
      if (rpcError) console.error("Failed to record question answer (phase tracking):", rpcError);
    }

    await sb.from("user_topic_interactions").upsert(
      {
        user_id: userId,
        topic_id: topicId,
        last_interacted_at: new Date().toISOString(),
        answered,
      },
      { onConflict: "user_id,topic_id" }
    );
  } catch (error) {
    console.error("Failed to track question interaction:", error);
  }
}

// ---------- Editorial hero image ----------
import { getHeroImageUrl } from "@/lib/imageUtils";

function EditorialHeroImage({
  imageUrl,
  alt,
  height = 420,
}: {
  imageUrl: string;
  alt: string;
  height?: number;
}) {
  const isSignedGuardian = React.useMemo(() => {
    try {
      const u = new URL(
        imageUrl,
        typeof window !== "undefined" ? window.location.href : "https://example.com"
      );
      return u.hostname.includes("i.guim.co.uk") && !!u.searchParams.get("s");
    } catch { return false; }
  }, [imageUrl]);

  const upgradedUrl = (isSignedGuardian ? imageUrl : getHeroImageUrl(imageUrl)) ?? imageUrl;
  const [src, setSrc] = React.useState(upgradedUrl);
  const [broken, setBroken] = React.useState(false);

  React.useEffect(() => { setBroken(false); setSrc(upgradedUrl); }, [upgradedUrl]);

  const handleError = React.useCallback(() => {
    if (!isSignedGuardian && src === upgradedUrl && upgradedUrl !== imageUrl) {
      setSrc(imageUrl);
    } else {
      setBroken(true);
    }
  }, [src, upgradedUrl, imageUrl, isSignedGuardian]);

  if (broken) {
    return (
      <div className="w-full rounded-xl bg-slate-100 flex items-center justify-center" style={{ height }}>
        <span className="text-[11px] text-slate-400">Image unavailable</span>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-slate-200 shadow-sm" style={{ height }}>
      <img src={src} alt="" aria-hidden
        className="absolute inset-0 h-full w-full object-cover scale-110 blur-xl opacity-30"
        loading="lazy" decoding="async" onError={handleError} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent" />
      <div className="relative flex w-full items-center justify-center" style={{ height }}>
        <img src={src} alt={alt}
          className="w-full object-contain drop-shadow-sm"
          style={{ height }} loading="lazy" decoding="async" onError={handleError} />
      </div>
    </div>
  );
}

// ---------- RegionComparison ----------
function RegionComparison({ stats }: { stats: QuestionStats | null }) {
  if (!stats?.regions) return null;
  const { regions, location } = stats;
  if (!regions) return null;

  const scopeLabels: Array<{ scope: "city" | "county" | "state" | "country" | "global"; label: string }> = [];
  if (location?.city && regions.city) scopeLabels.push({ scope: "city", label: location.city });
  if (location?.county && regions.county) scopeLabels.push({ scope: "county", label: location.county });
  if (location?.state && regions.state) scopeLabels.push({ scope: "state", label: location.state });
  if (location?.country && regions.country) scopeLabels.push({ scope: "country", label: location.country });
  if (regions.global) scopeLabels.push({ scope: "global", label: "Global" });
  if (scopeLabels.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
        Compare by region
      </div>
      <div className="space-y-1.5">
        {scopeLabels.map(({ scope, label }) => {
          const r = regions[scope];
          if (!r) return null;
          return (
            <div key={scope} className="flex items-center justify-between text-xs border border-slate-200 rounded-lg p-2 bg-white">
              <span className="text-slate-700 font-medium">{label}</span>
              <div className="text-slate-600 space-x-2">
                {r.pct_agree != null && <span className="text-slate-700 font-medium">{Math.round(r.pct_agree)}% agree</span>}
                {r.pct_disagree != null && <span>· {Math.round(r.pct_disagree)}% disagree</span>}
                <span className="text-[10px] text-slate-500">({r.total_responses})</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- StanceCard — extracted for dual mobile/desktop render (Point 14) ----------
function StanceCard({
  isAuthed,
  questionId,
  question,
  myStance,
  stanceLoading,
  stanceMutation,
  stats,
  handleSetStance,
  handleRequireLogin,
}: {
  isAuthed: boolean;
  questionId: string;
  question: LiveQuestion;
  myStance: number | null;
  stanceLoading: boolean;
  stanceMutation: any;
  stats: QuestionStats | null;
  handleSetStance: (val: number | null) => void;
  handleRequireLogin: () => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 md:p-5 shadow-sm">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-1">
        Your stance
      </h3>

      {!isAuthed && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">
            Where do you stand on this issue?
          </p>
          <p className="text-xs text-slate-500">
            Log in to record your stance and compare with your city, state,
            country, and globally.
          </p>
          <button
            type="button"
            onClick={handleRequireLogin}
            className="w-full rounded-xl bg-slate-900 text-white px-3 py-2 text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            Log in to take stance
          </button>
        </div>
      )}

      {isAuthed && (
        <>
          <p className="text-sm font-medium text-slate-700 mb-3">
            Where do you stand on this issue?
          </p>

          <div className="mb-2">
            {/*
             * Points 16–18: stats passed so slider can show personalized
             * alignment after the user commits.
             * Point 17: pulseThumb=true when no prior stance recorded.
             *
             * KEY: include myStance in the key so the slider fully remounts
             * when the stance changes (save or clear). This ensures:
             *  - `initialValue` and `committed` state are always in sync
             *  - Clearing resets the slider to neutral/uncommitted immediately
             *  - "Saved as X" label always matches the actual saved value
             */}
            <QuestionStanceSlider
              key={`stance-${questionId}-${myStance ?? "null"}`}
              questionId={questionId}
              questionText={question.question}
              summary={question.summary ?? null}
              initialValue={myStance ?? null}
              disabled={stanceMutation.isPending || stanceLoading}
              mutationPending={stanceMutation.isPending}
              onSubmit={handleSetStance}
              stats={stats}
              pulseThumb={!stanceLoading && myStance == null}
            />
          </div>

          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-1">
            {stanceLoading ? (
              <span>Loading your stance…</span>
            ) : stanceMutation.isPending ? (
              <span>Saving…</span>
            ) : myStance === null || myStance === undefined ? (
              <span>No stance recorded yet.</span>
            ) : (
              <span>
                Saved as {STANCE_SCALE.find((s) => s.value === myStance)?.label}.
              </span>
            )}

            {isAuthed && myStance != null && !stanceMutation.isPending && (
              <button type="button" className="underline" onClick={() => handleSetStance(null)}>
                Clear
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- Main component ----------
export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const questionId = id ?? "";

  const session = useSupabaseSession();
  const userId = session?.user?.id ?? null;
  const isAuthed = !!session;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useQuestionView(questionId);

  const { data: question, isLoading, isError, error } = useQuery({
    enabled: !!questionId,
    queryKey: ["question-detail", questionId],
    queryFn: () => fetchQuestionById(questionId),
    staleTime: 60_000,
  });

  const { data: topicLite } = useQuery({
    enabled: !!question?.topic_id,
    queryKey: ["question-topic-lite", question?.topic_id ?? ""],
    queryFn: () => fetchTopicLite(question?.topic_id as string),
    staleTime: 5 * 60_000,
  });

  const debugQid = questionId.slice(0, 8);

  const { data: myStance, isLoading: stanceLoading } = useQuery({
    enabled: !!questionId && isAuthed,
    queryKey: ["my-stance", questionId],
    queryFn: () => fetchMyStance(questionId),
    staleTime: 60_000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    enabled: !!questionId,
    queryKey: ["question-stats", questionId],
    queryFn: () => fetchQuestionStats(questionId),
    staleTime: 60_000,
  });

  const { data: myRegion } = useQuery({
    enabled: !!userId,
    queryKey: ["my-region", userId],
    queryFn: () => fetchMyRegion(userId!),
    staleTime: 60_000,
  });

  const { data: relatedQuestions, isLoading: relatedLoading } = useQuery({
    enabled: !!questionId && !!question && !!question.tags && question.tags.length > 0,
    queryKey: ["related-questions", questionId, question?.tags ?? [], question?.location_label ?? null],
    queryFn: () =>
      fetchRelatedQuestions(
        questionId,
        (question?.tags as string[]) ?? [],
        (question?.location_label as string | null) ?? null
      ),
    staleTime: 60_000,
  });

  const { data: threadSentiment, isLoading: threadSentimentLoading } = useQuery({
    enabled: !!questionId,
    queryKey: ["question-thread-sentiment", questionId],
    queryFn: () => fetchThreadSentiment(questionId),
    staleTime: 60_000,
  });

  // ── Community stance aggregate query ──
  const { data: communityStats, isLoading: communityStatsLoading } = useQuery({
    enabled: !!questionId,
    queryKey: communityStatsKey(questionId),
    queryFn: () => fetchCommunityStats(questionId),
    staleTime: 30_000,
  });

  // ── Realtime: question_stance_stats_region → refresh community bar ──
  // channelReady ref: set true when SUBSCRIBED, false on unmount.
  // handleSetStance waits for this before firing the RPC to prevent the
  // PostgREST connection from hanging during the subscription handshake
  // on first save after page navigation.
  const channelReady = React.useRef(false);
  const sb = React.useMemo(getSupabase, []);

  React.useEffect(() => {
    if (!sb || !questionId) return;

    channelReady.current = false;
    console.log(`[qdp:realtime] subscribing to question_stance_stats_region qId=${questionId.slice(0,8)}`);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const channel = sb
      .channel(`qdp-stats-${questionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "question_stance_stats_region",
          filter: `question_id=eq.${questionId}`,
        },
        (payload) => {
          const isDelete = payload.eventType === "DELETE";
          console.log(`[qdp:realtime] ✓ aggregate row ${isDelete ? "DELETED" : "changed"} for qId=${questionId.slice(0,8)} — debouncing 500ms`);
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            console.log(`[qdp:realtime] ✓ invalidating community-stats + question-stats`);
            queryClient.invalidateQueries({ queryKey: communityStatsKey(questionId) });
            queryClient.invalidateQueries({ queryKey: ["question-stats", questionId] });
          }, 500);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channelReady.current = true;
          console.log(`[qdp:realtime] ✅ SUBSCRIBED qId=${questionId.slice(0,8)}`);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          channelReady.current = false;
          console.error(`[qdp:realtime] ❌ channel ${status} qId=${questionId.slice(0,8)}`);
        }
      });

    return () => {
      console.log(`[qdp:realtime] unsubscribing qId=${questionId.slice(0,8)}`);
      if (debounceTimer) clearTimeout(debounceTimer);
      channelReady.current = false;
      // removeChannel only — do NOT call sb.realtime.disconnect() here.
      // disconnect() destroys the singleton client's WebSocket transport,
      // breaking subsequent subscriptions on the same client instance and
      // causing "WebSocket closed before connection established" errors.
      sb.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, questionId]);

  React.useEffect(() => {
    console.log("[qdp:state] my-stance query", {
      qid: debugQid,
      myStance,
      stanceLoading,
      isAuthed,
      mutationPending: stanceMutation?.isPending ?? false,
    });
  }, [debugQid, myStance, stanceLoading, isAuthed]);

  React.useEffect(() => {
    console.log("[qdp:state] question-stats query", {
      qid: debugQid,
      statsMyStance: stats?.my_stance ?? null,
      effectiveStatsMyStance: (typeof myStance === "number" || myStance === null) ? (myStance ?? null) : null,
      statsLoading,
    });
  }, [debugQid, stats?.my_stance, myStance, statsLoading]);

  React.useEffect(() => {
    console.log("[qdp:state] community-stats query", {
      qid: debugQid,
      responses: communityStats?.responses ?? null,
      supportPct: communityStats?.supportPct ?? null,
      opposePct: communityStats?.opposePct ?? null,
      neutralPct: communityStats?.neutralPct ?? null,
      communityStatsLoading,
    });
  }, [debugQid, communityStats?.responses, communityStats?.supportPct, communityStats?.opposePct, communityStats?.neutralPct, communityStatsLoading]);

  // Ref-based in-flight guard — set synchronously at the top of handleSetStance
  // (before any async work in mutationFn) so no second slider commit can slip
  // through between the guard check and the actual mutate() call.
  const mutationInFlight = React.useRef(false);

  const stanceMutation = useMutation({
    mutationKey: ["set-stance", questionId],
    mutationFn: async (score: number | null) => {
      mutationInFlight.current = true;
      console.log("[qdp:mutation] start", { qid: debugQid, requestedScore: score, queryMyStanceBefore: queryClient.getQueryData(["my-stance", questionId]) });
      const result = await setMyStance(questionId, score);
      console.log("[qdp:mutation] result", { qid: debugQid, requestedScore: score, returnedScore: result });
      return result;
    },
    onSuccess: (newScore, vars) => {
      mutationInFlight.current = false;
      console.log("[qdp:mutation] onSuccess", { qid: debugQid, newScore, vars, cacheBefore: queryClient.getQueryData(["my-stance", questionId]), statsBefore: queryClient.getQueryData(["question-stats", questionId]) });

      const resolvedScore =
        typeof vars === "number" || vars === null ? vars : newScore;

      queryClient.setQueryData(["my-stance", questionId], resolvedScore);
      console.log("[qdp:mutation] cache set my-stance", { qid: debugQid, resolvedScore });

      queryClient.setQueryData(
        ["question-stats", questionId],
        (old: QuestionStats | null | undefined) =>
          old
            ? { ...old, my_stance: resolvedScore ?? null }
            : old ?? null
      );

      console.log("[qdp:mutation] cache set question-stats.my_stance", { qid: debugQid, resolvedScore, statsAfter: queryClient.getQueryData(["question-stats", questionId]) });

      queryClient.invalidateQueries({ queryKey: ["question-stats", questionId] });
      queryClient.invalidateQueries({ queryKey: communityStatsKey(questionId) });

      const savedScore = resolvedScore;
      console.log("[qdp:mutation] post-invalidate", { qid: debugQid, savedScore, myStanceCacheNow: queryClient.getQueryData(["my-stance", questionId]), statsCacheNow: queryClient.getQueryData(["question-stats", questionId]) });

      const broadcastStats = async (attempt = 1) => {
        const fresh = await fetchCommunityStats(questionId);
        if (fresh) {
          console.log(`[qdp:stance] broadcasting stance-saved with stats attempt=${attempt} responses=${fresh.responses}`);
          window.dispatchEvent(new CustomEvent("stance-saved", {
            detail: { questionId, value: savedScore, communityStats: fresh }
          }));
        } else if (attempt < 3) {
          console.log(`[qdp:stance] stats not ready attempt=${attempt} — retrying in ${attempt * 600}ms`);
          setTimeout(() => broadcastStats(attempt + 1), attempt * 600);
        } else {
          console.warn(`[qdp:stance] stats unavailable after ${attempt} attempts — broadcasting without stats`);
          window.dispatchEvent(new CustomEvent("stance-saved", {
            detail: { questionId, value: savedScore, communityStats: null }
          }));
        }
      };
      setTimeout(() => broadcastStats(), 300);

      if (userId && question?.topic_id) {
        const answered = resolvedScore !== null;
        trackQuestionInteraction(userId, questionId, question.topic_id, answered)
          .then(() => {
            if (answered) queryClient.invalidateQueries({ queryKey: ["personalized-feed"] });
          })
          .catch((err) => console.error("[qdp:tracking] interaction tracking failed", err));
      }

      const label =
        resolvedScore == null
          ? null
          : STANCE_SCALE.find((s) => s.value === resolvedScore)?.labelShort ?? `Score ${resolvedScore}`;

      toast({
        title: resolvedScore == null ? "Stance cleared" : "Stance saved",
        description:
          resolvedScore == null
            ? "Your stance was removed from this question."
            : `Your stance is now: ${label}.`,
        duration: 2200,
      });
    },
    onError: (err: any) => {
      mutationInFlight.current = false;
      // Log message and code at the top level so they're visible without expanding
      // the object — critical for diagnosing PostgREST pool vs auth vs network errors.
      console.error(
        "[qdp:mutation] onError",
        err?.message ?? err,
        { qid: debugQid, code: err?.code ?? null, details: err?.details ?? null, err }
      );
      toast({
        title: "Error saving stance",
        description: err?.message ?? "Failed to save your stance. Please try again.",
        variant: "destructive",
      });
    },
  });

  // handleSetStance: synchronous trigger — no awaits here.
  // The PostgREST pool hang that previously required channelReady/session guards
  // is resolved by NOTIFY pgrst, 'reload schema' at the DB level.
  // Keeping this synchronous closes the race window where a second slider commit
  // could slip past the mutationInFlight guard while async guards were awaited.
  const handleSetStance = React.useCallback(
    (newVal: number | null) => {
      if (mutationInFlight.current) {
        console.log("[qdp:handleSetStance] dropped — mutation in flight (ref)", { newVal });
        return;
      }
      // Set the guard synchronously before mutate() so no second commit can
      // slip through between now and when mutationFn sets it in the async path.
      mutationInFlight.current = true;

      console.log("[qdp:handleSetStance]", {
        qid: debugQid,
        newVal,
        queryMyStanceBefore: queryClient.getQueryData(["my-stance", questionId]),
        mutationPending: stanceMutation.isPending,
        channelReady: channelReady.current,
      });
      stanceMutation.mutate(newVal);
    },
    [stanceMutation, debugQid, queryClient, questionId]
  );

  const handleRequireLogin = React.useCallback(() => {
    const returnTo = window.location.hash || "#/";
    sessionStorage.setItem("return_to", returnTo);
    navigate("/login");
  }, [navigate]);

  const handleBack = React.useCallback(() => navigate(-1), [navigate]);

  const hasRelated = !!relatedQuestions && relatedQuestions.length > 0;

  const effectiveStats = React.useMemo<QuestionStats | null>(() => {
    if (!stats) return null;
    return {
      ...stats,
      my_stance: myStance ?? null,
    };
  }, [stats, myStance]);

  React.useEffect(() => {
    console.log("[qdp:effective-stats]", {
      qid: debugQid,
      myStance,
      statsMyStance: stats?.my_stance ?? null,
      effectiveStatsMyStance: effectiveStats?.my_stance ?? null,
    });
  }, [debugQid, myStance, stats?.my_stance, effectiveStats?.my_stance]);

  const stanceCardProps = {
    isAuthed,
    questionId,
    myStance: myStance ?? null,
    stanceLoading,
    stanceMutation,
    stats: effectiveStats,
    handleSetStance,
    handleRequireLogin,
  };

  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-sm">
        <p className="text-sm text-slate-500">Loading question...</p>
      </div>
    );
  } else if (isError) {
    content = (
      <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8">
        <p className="text-sm text-red-900">
          Failed to load question:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  } else if (!question) {
    content = (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-sm">
        <p className="text-sm text-slate-500">Question not found or no longer active.</p>
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-6 md:grid md:gap-8 md:grid-cols-[1fr_320px]">

        {/* ===================== MAIN COLUMN ===================== */}
        <main className="rounded-xl border border-slate-200 bg-white p-5 md:p-8 shadow-sm">

          <div className="max-w-[44rem] space-y-3">

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">
                Question
              </span>
              <span aria-hidden className="text-slate-300">·</span>
              {question.published_at ? (
                <time dateTime={question.published_at} className="text-[12px] text-slate-500">
                  {new Date(question.published_at).toLocaleDateString(undefined, { dateStyle: "long" })}
                </time>
              ) : (
                <span className="text-[12px] text-slate-500">—</span>
              )}
              <span aria-hidden className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1 text-[12px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {question.location_label ?? "Global"}
              </span>
            </div>

            {/* Tag ribbon */}
            {question.tags && question.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold tracking-wide text-white">
                  {question.tags[0]}
                </span>
                {question.tags.slice(1, 6).map((tag) => (
                  <span key={tag} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700">
                    {tag}
                  </span>
                ))}
                {question.tags.length > 6 && (
                  <span className="text-[11px] text-slate-400">+{question.tags.length - 6} more</span>
                )}
              </div>
            )}

            {/* Headline */}
            <h1 className="text-3xl md:text-4xl font-semibold leading-[1.1] md:leading-[1.08] tracking-[-0.02em] text-slate-900">
              {question.question}
            </h1>

            {/* Phase badge */}
            {question.phase && question.phase !== "initial" && (
              <div><QuestionPhaseBadge phase={question.phase} size="md" /></div>
            )}

            {question.summary && (
              <p className="max-w-[44rem] font-normal text-base md:text-lg text-slate-600 leading-relaxed md:leading-[1.6] text-left md:text-justify md:hyphens-auto">
                {question.summary}
              </p>
            )}
          </div>

          {question.cover_image_url && (
            <div className="mt-6">
              <EditorialHeroImage
                imageUrl={question.cover_image_url}
                alt={question.question}
                height={420}
              />
              <p className="mt-2 text-xs text-slate-500 leading-snug">
                Image source: news article
              </p>
            </div>
          )}

          <div className="mt-6 md:hidden">
            <StanceCard question={question} {...stanceCardProps} />
          </div>

          <div className="mt-10 border-t border-slate-200 pt-8">
            <QuestionCommentsPanel questionId={questionId} />
          </div>

          <section className="mt-10 border-t border-slate-200 pt-8">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">
              {question.location_label
                ? `Related questions in ${question.location_label}`
                : "Related questions"}
            </h2>

            {relatedLoading && <p className="text-xs text-slate-500">Loading related questions…</p>}
            {!relatedLoading && !hasRelated && <p className="text-xs text-slate-500">No related questions yet.</p>}

            {hasRelated && relatedQuestions && (
              <div className="space-y-3">
                {relatedQuestions.map((rq) => (
                  <div key={rq.id} className="flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <Link to={`/q/${rq.id}`} className="font-medium text-slate-900 hover:underline">
                        {rq.question}
                      </Link>
                      {rq.summary && <p className="text-slate-600 line-clamp-2 mt-0.5">{rq.summary}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {rq.location_label && (
                        <span className="inline-flex items-center rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                          {rq.location_label}
                        </span>
                      )}
                      {rq.published_at && (
                        <span className="text-[10px] text-slate-500">
                          {new Date(rq.published_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <footer className="mt-8 pt-6 border-t border-slate-100">
            <button type="button" onClick={handleBack} className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
              ← Back
            </button>
          </footer>
        </main>

        {/* ===================== RIGHT RAIL ===================== */}
        <aside className="md:pt-1">
          <div className="md:sticky md:top-24 space-y-4">

            {question.topic_id && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold tracking-wide uppercase text-slate-500">Topic</div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {topicLite?.title ?? "View topic"}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <FollowTopicButton topicId={question.topic_id} />
                  </div>
                </div>
                <div className="mt-3">
                  <Link to={`/topics/${question.topic_id}`} className="text-xs text-slate-600 hover:underline">
                    View topic →
                  </Link>
                </div>
              </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
              <CommunityStanceBar
                responses={communityStats?.responses ?? 0}
                supportPct={communityStats?.supportPct ?? null}
                opposePct={communityStats?.opposePct ?? null}
                neutralPct={communityStats?.neutralPct ?? null}
                regionLabel={communityStats?.regionLabel ?? "Global"}
                avgScore={communityStats?.avgScore ?? null}
                isLoading={communityStatsLoading}
                isEmpty={!communityStatsLoading && !communityStats}
              />

              {isAuthed && stats?.regions && (
                <>
                  <div className="border-t border-slate-200 my-3" />
                  <RegionComparison stats={stats ?? null} />
                </>
              )}
            </section>

            {threadSentimentLoading && !threadSentiment && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
                <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-3">
                  Discussion mood
                </h3>
                <p className="text-xs text-slate-500">Analyzing discussion sentiment…</p>
              </section>
            )}

            {threadSentiment && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
                <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-3">
                  Discussion mood
                </h3>
                <p className="text-xs text-slate-600">
                  <span className="text-xs text-slate-700 font-medium">
                    {threadSentiment.comment_count ?? 0}
                  </span>{" "}
                  comment{threadSentiment.comment_count === 1 ? "" : "s"}
                  {typeof threadSentiment.avg_sentiment === "number" &&
                    ` · avg sentiment ${threadSentiment.avg_sentiment.toFixed(2)} (−1 to +1)`}
                </p>
                {threadSentiment.summary_text && (
                  <p className="text-sm text-slate-700 mt-2">{threadSentiment.summary_text}</p>
                )}
              </section>
            )}

            <div className="hidden md:block">
              <StanceCard question={question} {...stanceCardProps} />
            </div>

          </div>
        </aside>
      </div>
    );
  }

  return (
    <PageLayout>
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-5xl mx-auto py-6 space-y-4 px-4">
          <div>
            <button
              type="button"
              onClick={handleBack}
              className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              ← Back
            </button>
          </div>
          {content}
        </div>
      </div>
    </PageLayout>
  );
}
