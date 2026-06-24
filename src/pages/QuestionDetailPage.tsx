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
import { ManifestoProvenance } from "@/components/question/ManifestoProvenance";
import { useToast } from "@/components/ui/use-toast";

import { FollowTopicButton } from "@/components/FollowTopicButton";
import { ShareButton } from "@/components/share/ShareButton";
import { PostStanceSharePrompt } from "@/components/share/PostStanceSharePrompt";
import { useOgMeta } from "@/hooks/useOgMeta";
import { fetchCommunityStats, communityStatsKey } from "@/lib/fetchCommunityStats";
import { CommunityStanceBar } from "@/components/question/CommunityStanceBar";
import { CommunityTrendSparkline } from "@/components/question/CommunityTrendSparkline";
import WhyIsTrendingPanel from "@/components/insights/WhyIsTrendingPanel";
import TradeoffExplorer from "@/components/insights/TradeoffExplorer";
import { RationaleEditor } from "@/components/RationaleEditor";
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
  state?: string | null;
  archive_reason?: string | null;
  archived_at?: string | null;
  context_version?: number | null;
  slider_low_label?: string | null;
  slider_high_label?: string | null;
  source?: string | null;
  source_meta?: unknown;
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
  { value: -2, labelShort: "Strongly oppose", label: "Strongly oppose" },
  { value: -1, labelShort: "Lean oppose", label: "Lean oppose" },
  { value: 0, labelShort: "Neutral", label: "Neutral" },
  { value: 1, labelShort: "Lean support", label: "Lean support" },
  { value: 2, labelShort: "Strongly support", label: "Strongly support" },
];

// ---------- Session hook ----------
// Uses onAuthStateChange exclusively — avoids calling getSession() which can
// block if a background token refresh is in flight in supabase-js v2.
// INITIAL_SESSION fires synchronously on subscribe with the cached session,
// so there is no null flash for already-signed-in users on remount.
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    // onAuthStateChange fires INITIAL_SESSION immediately (synchronously within
    // this effect) with the current cached session — no HTTP request needed.
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
      "id, topic_id, question, summary, tags, location_label, published_at, status, phase, cover_image_url, state, archive_reason, archived_at, context_version, slider_low_label, slider_high_label, source, source_meta"
    )
    .eq("id", id)
    .limit(1);

  if (error) {
    console.error("Failed to load question detail", error);
    throw error;
  }

  const row = (data ?? [])[0] as LiveQuestion | undefined;
  if (!row) return null;
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

// ─── Stance save diagnostics ─────────────────────────────────────────────────
let _saveAttempt = 0;

// Uses raw fetch with a pre-resolved JWT instead of sb.rpc().
// sb.rpc() internally calls sb.auth.getSession() on every invocation.
// In supabase-js v2, getSession() acquires an async lock — if a background
// token refresh is in flight (triggered by navigation/focus events), ALL rpc()
// calls block until the refresh HTTP request completes, producing 8s hangs.
// By passing the JWT directly we skip that lock entirely.
async function setMyStance(
  questionId: string,
  score: number | null,
  jwt: string,
  supabaseUrl: string,
  anonKey: string,
) {
  const attempt = ++_saveAttempt;
  const t0 = performance.now();

  console.log(`[setMyStance #${attempt}] ▶ score=${score} qid=${questionId.slice(0,8)}`);

  const TIMEOUT_MS = 8_000;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const fetchPromise = fetch(`${supabaseUrl}/rest/v1/rpc/set_question_stance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": anonKey,
      "Authorization": `Bearer ${jwt}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({ p_question_id: questionId, p_score: score }),
  }).then(async (res) => {
    const elapsed = Math.round(performance.now() - t0);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.error(`[setMyStance #${attempt}] ✗ HTTP ${res.status} in ${elapsed}ms`, body);
      throw new Error(body?.message ?? `HTTP ${res.status}`);
    }
    console.log(`[setMyStance #${attempt}] ✓ success in ${elapsed}ms`);
    if (score === null) return null;
    const row = Array.isArray(body) ? body[0] : body;
    return (row?.score ?? null) as number | null;
  });

  try {
    const result = await Promise.race([
      fetchPromise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const elapsed = Math.round(performance.now() - t0);
          console.error(`[setMyStance #${attempt}] ⏱ TIMED OUT at ${elapsed}ms`);
          reject(new Error(`set_question_stance timed out after ${TIMEOUT_MS}ms`));
        }, TIMEOUT_MS);
      }),
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result;
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    throw err;
  }
}

// M-D01: Persist confidence rating for a committed stance.
// Uses the same direct-fetch pattern as setMyStance (avoids SDK .rpc() mutex).
// Fire-and-forget from the UI — errors are logged but never surfaced to the user
// since confidence is a secondary, non-blocking signal.
async function upsertStanceConfidence(
  questionId: string,
  confidence: number,
  jwt: string,
  supabaseUrl: string,
  anonKey: string,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/upsert_stance_confidence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": anonKey,
      "Authorization": `Bearer ${jwt}`,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      p_question_id: questionId,
      p_confidence: confidence,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `HTTP ${res.status}`);
  }
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
import { buildStanceLabels } from "@/lib/stanceColors";

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

// ---------- QuestionContextUpdates — C: lifecycle transparency ----------
// Shows context update history when a question has moved past the initial phase.
// Fetches from question_context_updates ordered newest-first.

type ContextUpdateRow = {
  id: string;
  new_phase: string;
  new_context: string;
  supporting_links: string[] | null;
  updated_at: string;
};

const PHASE_LABELS: Record<string, string> = {
  update:     "Update",
  resolution: "Resolved",
  follow_up:  "Follow-up",
};

function QuestionContextUpdates({ questionId }: { questionId: string }) {
  const sb = getSupabase();
  const { data: updates, isLoading } = useQuery<ContextUpdateRow[]>({
    queryKey: ["question-context-updates", questionId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!sb) return [];
      const { data, error } = await sb
        .from("question_context_updates")
        .select("id, new_phase, new_context, supporting_links, updated_at")
        .eq("question_id", questionId)
        .neq("new_phase", "initial")
        .order("updated_at", { ascending: false })
        .limit(5);
      if (error) return [];
      return (data ?? []) as ContextUpdateRow[];
    },
  });

  if (isLoading || !updates || updates.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {updates.map((u) => (
        <div
          key={u.id}
          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {PHASE_LABELS[u.new_phase] ?? u.new_phase}
            </span>
            <span className="text-[10px] text-slate-400">
              {new Date(u.updated_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </span>
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{u.new_context}</p>
          {u.supporting_links && u.supporting_links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {u.supporting_links.map((link, i) => (
                <a
                  key={i}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-600 hover:underline truncate max-w-[200px]"
                >
                  Source {i + 1} ↗
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
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
              <div className="text-slate-600 flex items-center gap-1.5">
                {(() => {
                  const parts: React.ReactNode[] = [];
                  if ((r.pct_agree ?? 0) > 0)    parts.push(<span key="a" className="text-slate-700 font-medium">{Math.round(r.pct_agree!)}% agree</span>);
                  if ((r.pct_disagree ?? 0) > 0)  parts.push(<span key="d">{Math.round(r.pct_disagree!)}% disagree</span>);
                  if ((r.pct_neutral ?? 0) > 0)   parts.push(<span key="n" className="text-slate-500">{Math.round(r.pct_neutral!)}% neutral</span>);
                  if (parts.length === 0) return <span className="text-slate-400">No data yet</span>;
                  return parts.reduce<React.ReactNode[]>((acc, el, i) =>
                    i === 0 ? [el] : [...acc, <span key={`sep-${i}`} className="text-slate-300">·</span>, el], []
                  );
                })()}
                <span className="text-[10px] text-slate-400">({r.total_responses} {r.total_responses === 1 ? "stance" : "stances"})</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── S4: Confidence feedback — shown once after user submits stance ────────────

function ConfidenceFeedback({ onSubmit }: { onSubmit: (score: number) => void }) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 mt-3">
      <p className="text-xs font-medium text-slate-700 mb-0.5">
        How confident are you in this stance?
      </p>
      <p className="text-[11px] text-slate-400 mb-3">
        Private — helps us understand conviction vs. uncertainty across the community.
      </p>
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= (hovered ?? 0);
          return (
            <button
              key={star}
              type="button"
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSubmit(star)}
              aria-label={`${star} out of 5`}
              className="transition-transform hover:scale-110"
            >
              <svg
                className="h-6 w-6"
                viewBox="0 0 24 24"
                fill={filled ? "#F59E0B" : "none"}
                stroke={filled ? "#F59E0B" : "#CBD5E1"}
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                />
              </svg>
            </button>
          );
        })}
        <span className="ml-2 text-[11px] text-slate-400">
          {hovered === 1 ? "Not very confident"
            : hovered === 2 ? "Somewhat uncertain"
            : hovered === 3 ? "Moderately confident"
            : hovered === 4 ? "Quite confident"
            : hovered === 5 ? "Very confident"
            : "Tap to rate"}
        </span>
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
  showConfidence,
  onConfidenceSubmit,
  showSharePrompt,
  onShareDismiss,
  isArchived,
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
  showConfidence?: boolean;
  onConfidenceSubmit?: (score: number) => void;
  showSharePrompt?: boolean;
  onShareDismiss?: () => void;
  isArchived?: boolean;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 md:p-5 shadow-sm">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-slate-500 mb-1">
        Your stance
      </h3>

      {/* M-C09: Archived banner — shown when question is archived/no longer active */}
      {isArchived && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
          <span className="text-amber-500 mt-0.5 text-base">📦</span>
          <div>
            <p className="text-sm font-medium text-amber-800">This question is archived</p>
            {question.archive_reason && (
              <p className="text-xs text-amber-700 mt-0.5">{question.archive_reason}</p>
            )}
            {question.archived_at && (
              <p className="text-xs text-amber-600 mt-0.5">
                Archived on {new Date(question.archived_at).toLocaleDateString(undefined, { dateStyle: "long" })}
              </p>
            )}
            <p className="text-xs text-amber-600 mt-1">Stances are no longer accepted for this question.</p>
          </div>
        </div>
      )}

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

          {/* S4: Trade-off explorer — shown before user commits stance */}
          {myStance == null && (
            <TradeoffExplorer
              questionId={questionId}
              questionText={question.question}
              summary={question.summary ?? null}
              avgScore={stats?.avgScore ?? null}
            />
          )}

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
              disabled={stanceMutation.isPending || stanceLoading || isArchived}
              mutationPending={stanceMutation.isPending}
              onSubmit={handleSetStance}
              stats={stats}
              pulseThumb={!stanceLoading && myStance == null}
              sliderLowLabel={question.slider_low_label ?? null}
              sliderHighLabel={question.slider_high_label ?? null}
            />
          </div>

          {/* W1: Post-stance share prompt */}
          {showSharePrompt && question && (
            <PostStanceSharePrompt
              questionId={questionId}
              questionText={question.question}
              questionSummary={question.summary}
              onDismiss={onShareDismiss}
            />
          )}

          {/* S4: Confidence feedback — shown once after first save */}
          {showConfidence && onConfidenceSubmit && (
            <ConfidenceFeedback onSubmit={onConfidenceSubmit} />
          )}

          <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-1">
            {stanceLoading ? (
              <span>Loading your stance…</span>
            ) : stanceMutation.isPending ? (
              <span>Saving…</span>
            ) : myStance === null || myStance === undefined ? (
              <span>No stance recorded yet.</span>
            ) : (
              <span>
                Saved as {buildStanceLabels(question?.slider_low_label, question?.slider_high_label)[myStance ?? 0]}.
              </span>
            )}

            {isAuthed && myStance != null && !stanceMutation.isPending && (
              <button type="button" className="underline" onClick={() => handleSetStance(null)}>
                Clear
              </button>
            )}
          </div>

          {/* RationaleEditor — shown once user has answered; lets them record
              why they hold this stance and add supporting links. */}
          {isAuthed && myStance != null && (
            <RationaleEditor questionId={questionId} />
          )}
        </>
      )}
    </section>
  );
}

// ---------- Main component ----------
export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const questionId = id ?? "";
  const [showSharePrompt, setShowSharePrompt] = React.useState(false);
  // S4: confidence feedback — shown once after first stance save
  const [showConfidence, setShowConfidence] = React.useState(false);
  const [confidenceScore, setConfidenceScore] = React.useState<number | null>(null);

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
  // Extract once — these never change for the lifetime of the client singleton.
  const supabaseUrl = React.useMemo(() => (sb as any)?.supabaseUrl as string ?? "", [sb]);
  const supabaseAnonKey = React.useMemo(() => (sb as any)?.supabaseKey as string ?? "", [sb]);

  // W2: Dynamic OG meta for social share previews (must be after question + supabaseUrl)
  useOgMeta({
    title: question?.question ?? "A question for you",
    description: question?.summary ?? "Share your stance on Stance Capture.",
    questionId,
  });

  // W2: OG image URL passed to ShareButton for direct X post image cards
  const ogImageUrl = supabaseUrl
    ? `${supabaseUrl}/functions/v1/og-image?question_id=${questionId}`
    : null;

  React.useEffect(() => {
    if (!sb || !questionId) return;

    channelReady.current = false;
    console.log(`[qdp:realtime] subscribing to question_stance_stats_region qId=${questionId.slice(0,8)}`);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Shared debounce handler — used by both postgres_changes listeners below.
    // Both tables (question_stance_stats and question_stance_stats_region) are
    // refreshed synchronously by the same DB triggers on every stance write, so
    // either firing is sufficient to drive a community-stats refetch.
    // The shared debounce ensures at most one refetch per 400ms regardless of
    // which table fires first (M-D06: all connected users update live).
    const handleStatsChange = (source: string, isDelete: boolean) => {
      console.log(`[qdp:realtime] ✓ ${source} ${isDelete ? "DELETED" : "changed"} for qId=${questionId.slice(0,8)} — debouncing 400ms`);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`[qdp:realtime] ✓ invalidating community-stats (triggered by ${source})`);
        // Only invalidate community-stats here.
        // question-stats is kept fresh via setQueryData in onSuccess so the
        // region comparison always reflects the user's own save immediately.
        // Invalidating question-stats here too would fire get_question_stats_for_user
        // concurrently with the community-stats refetch and the next save RPC,
        // exhausting the PostgREST connection pool.
        queryClient.invalidateQueries({ queryKey: communityStatsKey(questionId) });
      }, 400);
    };

    const channel = sb
      .channel(`qdp-stats-${questionId}`)
      // M-D06: Listen to question_stance_stats (global totals) so all connected
      // users see CommunityStanceBar update live when any user submits a stance,
      // not just the submitting user (who gets an update via onSuccess cache set).
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "question_stance_stats",
          filter: `question_id=eq.${questionId}`,
        },
        (payload) => {
          handleStatsChange("question_stance_stats", payload.eventType === "DELETE");
        }
      )
      // Also listen to question_stance_stats_region (regional breakdowns).
      // Both listeners share the same debounce so only one refetch fires per
      // stance write regardless of which table's CDC event arrives first.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "question_stance_stats_region",
          filter: `question_id=eq.${questionId}`,
        },
        (payload) => {
          handleStatsChange("question_stance_stats_region", payload.eventType === "DELETE");
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
  const webRefRef = React.useRef<string | null>(null); // anonymous visitor's own forward ref
  
  const stanceMutation = useMutation({
    mutationKey: ["set-stance", questionId],
    mutationFn: async (score: number | null) => {
      mutationInFlight.current = true;
      // Use the JWT from the session that React already has — no getSession() call.
      const jwt = session?.access_token;

      // ── Anonymous web-forward path ──────────────────────────────────────────
      // No session — visitor typically arrived via a forwarded ?ref= link.
      // record_web_stance reads the ref from the URL, dedups by device, mints
      // this responder's OWN ref, writes the anonymous stance, and returns the
      // live distribution. (Anonymous visitors can't "clear" a stance.)
      if (!jwt) {
        if (score === null) return null;
        const { my_ref } = await recordWebStance(questionId, score);
        webRefRef.current = my_ref;
        console.log("[qdp:mutation] anonymous web stance recorded", { qid: debugQid, score, my_ref });
        return score;
      }

      console.log("[qdp:mutation] start", { qid: debugQid, requestedScore: score, queryMyStanceBefore: queryClient.getQueryData(["my-stance", questionId]) });
      const result = await setMyStance(questionId, score, jwt, supabaseUrl, supabaseAnonKey);
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

      const savedScore = resolvedScore;
      console.log("[qdp:mutation] post-save cache updated", { qid: debugQid, savedScore });

      // Invalidate both community-stats and question-stats after a short delay,
      // giving the DB trigger time to write updated aggregates first.
      // community-stats → updates the community bar (fetchCommunityStats, raw fetch)
      // question-stats  → updates Compare by Region (get_question_stats_for_user RPC)
      // Both are safe to fire concurrently since fetchCommunityStats uses raw fetch
      // and the PostgREST pool is no longer contended.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: communityStatsKey(questionId) });
        queryClient.invalidateQueries({ queryKey: ["question-stats", questionId] });
      }, 700);

      // Broadcast for hero bar and other components.
      // communityStats: null → hero controller fetches fresh via its own path.
      window.dispatchEvent(new CustomEvent("stance-saved", {
        detail: { questionId, value: savedScore, communityStats: null }
      }));

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
          : (buildStanceLabels(question?.slider_low_label, question?.slider_high_label)[resolvedScore] ?? `Score ${resolvedScore}`);

      toast({
        title: resolvedScore == null ? "Stance cleared" : "Stance saved",
        description:
          resolvedScore == null
            ? "Your stance was removed from this question."
            : `Your stance is now: ${label}.`,
        duration: 2200,
      });

      // Show share prompt after first stance save
      if (resolvedScore !== null) {
        setShowSharePrompt(true);
        // S4: show confidence prompt once per question if not already answered
        if (!confidenceScore) setShowConfidence(true);
      }
    },
    onError: (err: any) => {
      mutationInFlight.current = false;
      const isTimeout = err?.message?.includes("timed out");
      console.error(
        `[qdp:mutation] ✗ onError — ${isTimeout ? "TIMEOUT (pool issue)" : err?.message ?? "unknown"}`,
        { qid: debugQid, isTimeout, code: err?.code ?? null, message: err?.message ?? null }
      );
      toast({
        title: isTimeout ? "Save timed out" : "Error saving stance",
        description: isTimeout
          ? "Connection issue — please try again. If this keeps happening, reload the page."
          : (err?.message ?? "Failed to save your stance. Please try again."),
        variant: "destructive",
      });
    },
  });

  // handleSetStance: synchronous trigger — no awaits here.
  // Keeping this synchronous closes the race window where a second slider commit
  // could slip past the mutationInFlight guard while async guards were awaited.
  //
  // channelReady gate: handleSetStance waits for the Realtime subscription to
  // reach SUBSCRIBED before allowing the first save. This prevents a save from
  // racing with the WebSocket handshake on first page load, which could cause
  // the stance RPC and the subscription setup to contend on the same PostgREST
  // connection slot.
  //
  // Fallback: if SUBSCRIBED has not fired within 8 seconds (matching the RPC
  // timeout), the gate opens anyway so a degraded Realtime connection never
  // permanently blocks stance submission. CHANNEL_ERROR / TIMED_OUT also open
  // the gate via the subscription status handler above.
  const handleSetStance = React.useCallback(
    (newVal: number | null) => {
      if (mutationInFlight.current) {
        console.log("[qdp:handleSetStance] dropped — mutation in flight (ref)", { newVal });
        return;
      }

      const proceed = () => {
        // Re-check in-flight inside the closure — the timeout path could
        // fire after a concurrent commit already set the ref.
        if (mutationInFlight.current) return;
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
      };

      if (channelReady.current) {
        proceed();
      } else {
        // Not yet subscribed — wait up to 8 s for SUBSCRIBED, then proceed anyway.
        console.log("[qdp:handleSetStance] channelReady=false — waiting for SUBSCRIBED (max 8 s)", { newVal });
        const deadline = setTimeout(() => {
          console.warn("[qdp:handleSetStance] channelReady timeout — proceeding without subscription", { newVal });
          proceed();
        }, 8_000);

        const poll = setInterval(() => {
          if (channelReady.current) {
            clearTimeout(deadline);
            clearInterval(poll);
            proceed();
          }
        }, 50);
      }
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
    showConfidence,
    onConfidenceSubmit: (score: number) => {
      setConfidenceScore(score);
      setShowConfidence(false);
      // M-D01: Persist the confidence rating. Fire-and-forget — errors are
      // logged but never surfaced; confidence is a secondary signal and must
      // not block or disrupt the post-stance UX.
      const jwt = session?.access_token;
      if (jwt && supabaseUrl && supabaseAnonKey) {
        upsertStanceConfidence(questionId, score, jwt, supabaseUrl, supabaseAnonKey)
          .then(() => {
            console.log("[qdp:confidence] saved", { questionId, score });
          })
          .catch((err) => {
            console.error("[qdp:confidence] save failed (non-blocking)", err);
          });
      }
    },
    showSharePrompt,
    onShareDismiss: () => setShowSharePrompt(false),
    isArchived: question?.status === "archived" || question?.state === "archived",
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
        <p className="text-sm text-slate-500">Question not found.</p>
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
            <h1 className="text-2xl md:text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-slate-900">
              {question.question}
            </h1>

            {/* Epic MP: verbatim manifesto quote + provenance for manifesto-promise questions */}
            <ManifestoProvenance sourceMeta={question.source_meta} />

            {/* Phase badge */}
            {question.phase && question.phase !== "initial" && (
              <div><QuestionPhaseBadge phase={question.phase} size="md" /></div>
            )}

            {/* C: Lifecycle context updates — shown when question has new developments */}
            {/* C: Lifecycle context updates — shown when question has new developments */}
            {question.context_version != null && question.context_version > 1 && (
              <QuestionContextUpdates questionId={question.id} />
            )}

            {question.summary && question.source !== "manifesto_promise" && (
              <p className="max-w-[44rem] font-normal text-base md:text-lg text-slate-600 leading-relaxed md:leading-[1.6] text-left">
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
                  <div className="shrink-0 flex items-center gap-2">
                    <ShareButton
                      questionId={question.id}
                      questionText={question.question}
                      questionSummary={question.summary}
                      ogImageUrl={ogImageUrl}
                    />
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
                lowLabel={question.slider_low_label ?? null}
                highLabel={question.slider_high_label ?? null}
              />

              {isAuthed && stats?.regions && (
                <>
                  <div className="border-t border-slate-200 my-3" />
                  <RegionComparison stats={stats ?? null} />
                </>
              )}

              {/* O3: 7-day inline trend */}
              <CommunityTrendSparkline questionId={questionId} />
            </section>

            {/* S3: Why is this trending? */}
            <WhyIsTrendingPanel
              questionId={question.id}
              topicId={question.topic_id}
            />

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
