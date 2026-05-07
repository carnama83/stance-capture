// src/pages/Index.tsx
// HOMEPAGE V4 — Live Societal Intelligence Platform
//
// Structure (per final plan):
//   Band 1 — Header (PageLayout)
//   Band 2 — Hero (logged-out CTA | logged-in welcome + hero question state machine)
//   Band 3 — Since You Last Visited  [authed only]
//   Band 4 — Society Right Now
//   Band 5 — Add Your Voice (featured card + 2-col grid)
//   Band 6 — Continuing conversation + Reopened  [authed only]
//
// Changes in this pass (feedback review):
//   Point 12 — Featured question eligibility: cover_image_url + length ≤ 120 + summary preferred
//   Point 14 — get_societal_pulse_homepage as Tier 1; existing tiers as fallback
//   Point 19 — Logged-out hero: explicit "Log in to take stance" button inside hero
//   Rule 4   — Stats preloaded for hero + featured slots; passed to slider as `stats` prop
//   Rule 4   — pulseThumb=true on hero + featured sliders (micro-commitment)
//   QuestionStats type added (mirrors slider's internal type, avoids cross-import)
//
// ALL existing functionality preserved:
//   - Infinite scroll pagination (national / global / anon)
//   - Region tabs (country / global)
//   - Stance submit + distribution feedback (authed + anon)
//   - Continuing conversation + Reopened questions
//   - Cover image hydration safety net
//   - Society Pulse (get_societal_pulse_homepage → early_stage → legacy)
//   - Media Surge, Participation strip, Where You Stand
//   - tags, origin_location_label, audience_location_label, trend_micro_signal, user_has_answered
//   - Error fallbacks, loading skeletons
//   - Logged-out slider redirect pattern (onPointerUpCapture / onMouseUpCapture / onTouchEndCapture)
//   - record_question_view impressions
//   - All query invalidations after stance submit

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";

import PageLayout from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { QuestionCoverImage } from "@/components/question/QuestionCoverImage";
import { useGlobalAndCountryIds } from "@/hooks/useLocationIds";
import { HeroSection } from "@/components/hero/HeroSection";
import { useContributionAcknowledgement } from "@/hooks/useContributionAcknowledgement";
import { toast } from "sonner";

// ─────────────────────────── Types (all preserved) ───────────────────────────

type Session = import("@supabase/supabase-js").Session;

type RegionRow = {
  user_id: string;
  city_label: string | null;
  county_label: string | null;
  state_label: string | null;
  country_label: string | null;
  global_label: string | null;
};

type TrendingHomepageQuestionRow = {
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
  is_new_phase?: boolean | null;
  user_stance_value?: number | null;
};

type AnonQuestionRow = {
  id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  origin_location_label?: string | null;
  audience_location_label?: string | null;
  published_at: string | null;
  status?: string | null;
  cover_image_url?: string | null;
};

// FallbackQuestionRow — returned by the "any unanswered live question" safety-net query.
// Used when both national + global trending feeds are empty (e.g. user answered everything
// in their scope). Mapped to TrendingHomepageQuestionRow shape with null trend fields.
type FallbackQuestionRow = {
  id: string;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  origin_location_label: string | null;
  audience_location_label: string | null;
  cover_image_url: string | null;
  topic_title: string | null;
};

type SocietyPulseRow = {
  region: string;
  rapid_shifts_count: number;
  polarized_count: number;
  reawakening_count: number;
  volatility_level: "Low" | "Medium" | "High" | string;
  top_shift_question_id: string | null;
  top_shift_question_text: string | null;
  generated_at: string;
};

type SocietyPulseEarlyStageChip = {
  label: string;
  value: number | null;
};

type SocietyPulseEarlyStageTopic = {
  topic_id: string;
  title: string;
};

type SocietyPulseEarlyStageRow = {
  mode: string;
  headline: string;
  description: string;
  chips: SocietyPulseEarlyStageChip[];
  featured_topics: SocietyPulseEarlyStageTopic[];
  topic_count: number;
};

type SocietalPulseOutput = {
  region_label: string;
  updated_at: string;
  state: "STABLE" | "REAWAKENING" | "POLARIZING" | "ACCELERATING" | "FOCUSED";
  narrative: {
    title: string;
    sentence_1: string;
    sentence_2: string | null;
  };
  chips: Array<{
    topic_id: string;
    title: string;
    icon: "up" | "reawakening" | "polarized" | "steady";
    href: string;
  }>;
  micro_metrics: Array<{
    label: string;
    value: number | null;
  }>;
};

type ParticipationStatsRow = {
  region: string;
  stances_window: number;
  stances_7d: number;
  stances_60m: number;
  unique_users_window: number;
  generated_at: string;
};

type MediaSurgeRow = {
  cluster_id: string;
  cluster_title: string;
  articles_24h: number;
  outlets_24h: number;
  baseline_avg_daily_articles: number | null;
  surge_ratio: number | null;
  sample_title: string | null;
  sample_url: string | null;
  sample_published_at: string | null;
  generated_at?: string | null;
};

type QuestionDistributionRow = {
  question_id: string;
  region: string;
  responses: number;
  oppose_pct: number | null;
  neutral_pct: number | null;
  support_pct: number | null;
  avg_score: number | null;
  generated_at: string;
};

type AlignmentSnapshotRow = {
  user_id?: string;
  region: string;
  alignment_pct: number;
  minority_count: number;
  most_divergent_question_id: string | null;
  most_divergent_question_text: string | null;
  generated_at: string;
};

type BecauseYouRow = {
  question_id: string;
  question_text: string;
  topic_id: string | null;
  topic_title: string | null;
  reason: string | null;
  rank_score: number | null;
};

type ReopenedRow = {
  question_id: string;
  question_text: string;
  last_answered_at: string | null;
  public_shift_proxy: number | null;
  reason: string | null;
};

// TopicStanceItem — topic-level stance history for the WhereYouStandCard
// Sourced from get_my_stance_snapshot RPC.
export type TopicStanceItem = {
  topicTitle: string;
  avgScore: number;
  answerCount: number;
  scorePct: number; // Math.round((avgScore / 2) * 100), range -100..+100
};

// MyStanceSnapshot — full shape from get_my_stance_snapshot
export type MyStanceSnapshot = {
  totalAnswered: number;
  topics: TopicStanceItem[];
  alignmentLabel: string; // pre-computed backend label, e.g. "Your views generally align..."
};

// ─── Epic Q — Habit/Retention types ──────────────────────────────────────────

// Q1: Since Your Last Visit — mirrors get_since_last_visited() RPC output
type SinceLastVisitChange = {
  topic_id: string;
  topic_title: string;
  change_type: "shifted_positive" | "shifted_negative" | "gaining_attention" | "stable";
  delta: number;
  new_responses: number;
};

type SinceLastVisitData = {
  last_seen_at: string;
  days_away: number;
  has_changes: boolean;
  changes: SinceLastVisitChange[];
  region: { scope: string; label: string };
};

// Q2: Return Nudge — derived client-side from existing queries
type ReturnNudgeType = "minority_shift" | "opinion_shift" | "new_in_topics" | "answer_more";

type ReturnNudge = {
  type: ReturnNudgeType;
  title: string;
  body: string;
  ctaLabel: string;
  href: string;
};

// Q3: Streak — computed client-side from question_stances dates
type UserStreak = {
  currentStreak: number;
  answeredToday: boolean;
  isAtRisk: boolean; // had streak yesterday, nothing today — streak needs protecting
};

// ─── End Epic Q types ─────────────────────────────────────────────────────────

// ─── Epic E — Personal Analytics types ───────────────────────────────────────

type PersonalAnalyticsTrendPoint = {
  bucketStart: string;
  alignmentScore: number | null;
  answeredCount: number;
};

type AlignmentTrendDirection = "up" | "down" | "flat" | "insufficient";
type DivergenceDirection = "more_supportive" | "more_opposed" | "mixed" | null;
type OpinionFingerprintTag =
  | "Strong convictions"
  | "Moderate convictions"
  | "Nuanced responses"
  | "Often diverges from consensus"
  | "Sometimes diverges from consensus"
  | "Often aligns with consensus"
  | "Focused on a few topics"
  | "Broad across topics"
  | "Consistent stance pattern"
  | "Varied stance pattern";

type PersonalAnalyticsResponse = {
  totalAnswered: number;
  topicsAnswered: number;
  firstAnsweredAt: string | null;
  lastAnsweredAt: string | null;
  alignmentTrend: {
    windowDays: number;
    points: PersonalAnalyticsTrendPoint[];
    currentAlignmentScore: number | null;
    previousAlignmentScore: number | null;
    delta: number | null;
    direction: AlignmentTrendDirection;
  };
  mostDivergentTopic: {
    topicId: string | null;
    topicTitle: string | null;
    userAvgScore: number | null;
    communityAvgScore: number | null;
    divergenceScore: number | null;
    answeredCount: number;
    direction: DivergenceDirection;
  } | null;
  opinionFingerprint: {
    avgScore: number | null;
    absoluteAvgScore: number | null;
    consistencyScore: number | null;
    divergenceRate: number | null;
    concentrationScore: number | null;
    strongestTopicId: string | null;
    strongestTopicTitle: string | null;
    strongestTopicAvgScore: number | null;
    summaryTags: OpinionFingerprintTag[];
  };
};

type PersonalAnalyticsTier = "empty" | "sparse" | "basic" | "mature";

// ─── Epic E helpers ───────────────────────────────────────────────────────────

function buildPersonalAnalyticsResponse(raw: unknown): PersonalAnalyticsResponse {
  const r = raw as any;
  const trend = r?.alignment_trend ?? {};
  const fp = r?.opinion_fingerprint ?? {};
  const div = r?.most_divergent_topic ?? null;

  const points: PersonalAnalyticsTrendPoint[] = (trend?.points ?? []).map((p: any) => ({
    bucketStart: p.bucket_start ?? "",
    alignmentScore: p.alignment_score ?? null,
    answeredCount: p.answered_count ?? 0,
  }));

  return {
    totalAnswered: r?.total_answered ?? 0,
    topicsAnswered: r?.topics_answered ?? 0,
    firstAnsweredAt: r?.first_answered_at ?? null,
    lastAnsweredAt: r?.last_answered_at ?? null,
    alignmentTrend: {
      windowDays: trend?.window_days ?? 90,
      points,
      currentAlignmentScore: trend?.current_alignment_score ?? null,
      previousAlignmentScore: trend?.previous_alignment_score ?? null,
      delta: trend?.delta ?? null,
      direction: (trend?.direction ?? "insufficient") as AlignmentTrendDirection,
    },
    mostDivergentTopic: div ? {
      topicId: div.topic_id ?? null,
      topicTitle: div.topic_title ?? null,
      userAvgScore: div.user_avg_score ?? null,
      communityAvgScore: div.community_avg_score ?? null,
      divergenceScore: div.divergence_score ?? null,
      answeredCount: div.answered_count ?? 0,
      direction: (div.direction ?? null) as DivergenceDirection,
    } : null,
    opinionFingerprint: {
      avgScore: fp?.avg_score ?? null,
      absoluteAvgScore: fp?.absolute_avg_score ?? null,
      consistencyScore: fp?.consistency_score ?? null,
      divergenceRate: fp?.divergence_rate ?? null,
      concentrationScore: fp?.concentration_score ?? null,
      strongestTopicId: fp?.strongest_topic_id ?? null,
      strongestTopicTitle: fp?.strongest_topic_title ?? null,
      strongestTopicAvgScore: fp?.strongest_topic_avg_score ?? null,
      summaryTags: buildFingerprintTags(fp, r?.topics_answered ?? 0),
    },
  };
}

function getPersonalAnalyticsTier(totalAnswered: number): PersonalAnalyticsTier {
  if (totalAnswered === 0) return "empty";
  if (totalAnswered <= 4) return "sparse";
  if (totalAnswered <= 11) return "basic";
  return "mature";
}

function buildFingerprintTags(
  fp: Record<string, number | null>,
  topicsAnswered: number
): OpinionFingerprintTag[] {
  const tags: OpinionFingerprintTag[] = [];
  const abs = fp?.absolute_avg_score ?? null;
  const divRate = fp?.divergence_rate ?? null;
  const conc = fp?.concentration_score ?? null;
  const cons = fp?.consistency_score ?? null;

  // Conviction
  if (abs !== null) {
    if (abs >= 1.35) tags.push("Strong convictions");
    else if (abs >= 0.75) tags.push("Moderate convictions");
    else tags.push("Nuanced responses");
  }

  // Divergence from consensus
  if (divRate !== null) {
    if (divRate >= 0.45) tags.push("Often diverges from consensus");
    else if (divRate >= 0.20) tags.push("Sometimes diverges from consensus");
    else tags.push("Often aligns with consensus");
  }

  // Topic breadth
  if (conc !== null) {
    if (conc >= 0.60) tags.push("Focused on a few topics");
    else if (topicsAnswered >= 4) tags.push("Broad across topics");
  }

  // Consistency
  if (cons !== null) {
    if (cons >= 0.70) tags.push("Consistent stance pattern");
    else if (cons < 0.45) tags.push("Varied stance pattern");
  }

  return tags.slice(0, 3); // max 3 tags
}

function getAlignmentTrendCopy(direction: AlignmentTrendDirection): string {
  switch (direction) {
    case "up":   return "You've been aligning a bit more with community sentiment lately.";
    case "down": return "You've been diverging a bit more in recent responses.";
    case "flat": return "Your alignment has stayed fairly stable lately.";
    default:     return "Answer a few more questions to see your alignment trend.";
  }
}

function getDivergenceCopy(direction: DivergenceDirection): string {
  switch (direction) {
    case "more_supportive": return "Your responses here are more supportive than the current community average.";
    case "more_opposed":    return "Your responses here are more opposed than the current community average.";
    default:                return "Your responses here differ from the current community average.";
  }
}

function clamp01(v: number | null | undefined): number {
  if (v == null || isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ─── End Epic E helpers ───────────────────────────────────────────────────────

// QuestionStats — passed to slider for alignment messaging (Rule 4)
type RegionalStat = {
  region_scope: string;
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

// ─────────────────────────── Session hook (unchanged) ────────────────────────

function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);
  const [sessionResolved, setSessionResolved] = React.useState(false);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setSessionResolved(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
      setSessionResolved(true);
    });
    return () => sub.subscription?.unsubscribe();
  }, [sb]);

  return { session, sessionResolved };
}

// ─────────────────────────── Display name helper (unchanged) ─────────────────

function getDisplayHandle(
  profile:
    | { random_id: string; username: string | null; display_handle_mode: string }
    | null
    | undefined,
  session: Session | null
): string {
  if (!profile) {
    if (!session?.user?.email) return "there";
    const email = session.user.email;
    const atIdx = email.indexOf("@");
    if (atIdx > 0) {
      const local = email.slice(0, atIdx);
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    return email;
  }
  if (profile.display_handle_mode === "username" && profile.username) {
    return profile.username;
  }
  return profile.random_id;
}

// ─────────────────────────── Shared helpers ──────────────────────────────────

function formatPct(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)}%`;
}

function formatNum(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  if (v >= 1000) return `${Math.round((v / 1000) * 10) / 10}k`;
  return `${Math.round(v)}`;
}

// ─────── Shared card surface (Plan: layered, premium, consistent) ─────────────
// Used everywhere instead of the old "rounded-xl border bg-card shadow-sm"
const card = "bg-white rounded-xl shadow-sm ring-1 ring-slate-900/5";

// ─────────────────────────── Small UI atoms ──────────────────────────────────

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

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
      {children}
    </span>
  );
}

// S3 — Signal quality pill: enriches trend_micro_signal with descriptive copy + colour
function SignalPill({ signal }: { signal: string }) {
  const s = signal.toLowerCase();
  if (s.includes("media") || s.includes("surge")) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
        Media-driven
      </span>
    );
  }
  if (s.includes("polar")) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
        Polarising
      </span>
    );
  }
  if (s.includes("organic") || s.includes("momentum")) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-green-50 text-green-700 border border-green-200">
        Organic
      </span>
    );
  }
  if (s.includes("trend") || s.includes("surging")) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-orange-50 text-orange-700 border border-orange-200">
        Trending
      </span>
    );
  }
  // fallback — render raw signal as plain pill
  return <Pill>{signal.toUpperCase()}</Pill>;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between mb-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function ErrorFallback({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
      {message}
    </div>
  );
}

function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className={`${card} p-5 animate-pulse`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`h-3 rounded bg-slate-100 mb-2.5 ${
            i === 0 ? "w-3/4" : i === lines - 1 ? "w-2/5" : "w-full"
          }`}
        />
      ))}
      <div className="mt-4 h-10 rounded bg-slate-100" />
    </div>
  );
}

// ─────────────────────────── Band 2 — Hero ───────────────────────────────────

// Logged-out hero
function HeroCta({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-slate-900 shadow-lg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_28%_40%,rgba(99,102,241,0.35),transparent_65%)]" />
      <div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="relative px-6 py-10 sm:px-10 sm:py-12">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/70 mb-5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live societal intelligence
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl max-w-xl leading-tight">
          Track how society is thinking — in real time
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/70 sm:text-base">
          Take a stance in seconds. See where your region aligns — and where it shifts.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-white/60"
            onClick={onSignup}
          >
            Get started free
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/30"
            onClick={onLogin}
          >
            Log in
          </button>
        </div>
      </div>
    </section>
  );
}

// Logged-in welcome strip
function HeroWelcome({ name }: { name: string }) {
  return (
    <section className={`${card} px-6 py-5`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Live</span>
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">
        Welcome back, {name}
      </h2>
      <p className="mt-0.5 text-sm text-slate-500">
        Here's what's shifting — and what you can signal next.
      </p>
    </section>
  );
}

// ─────────────────────────── Hero Question Module (State Machine) ─────────────
//
// Rule 1: state resolved once from data — no flicker between states.
// State A: top question unanswered → show slider
// State B: top answered → promote next unanswered question
// State C: all answered → show media surge topic
// State D: nothing → show alignment insight
//
// Skeleton shown while loading, resolves to final state.

function HeroQuestionModule({
  questions,
  mediaSurge,
  alignmentSnap,
  isLoading,
  isAuthed,
  onSubmit,
  onLoginRedirect,
  heroStats,
}: {
  questions: TrendingHomepageQuestionRow[];
  mediaSurge: MediaSurgeRow | null;
  alignmentSnap: AlignmentSnapshotRow | null;
  isLoading: boolean;
  isAuthed: boolean;
  onSubmit: (questionId: string, value: number) => Promise<void>;
  onLoginRedirect: () => void;
  heroStats?: QuestionStats | null;
}) {
  // Resolve hero state once — Rule 1
  type HeroState = "loading" | "A" | "B" | "C" | "D";

  const heroState = React.useMemo<HeroState>(() => {
    if (isLoading) return "loading";
    if (questions.length === 0) {
      if (mediaSurge) return "C";
      if (alignmentSnap) return "D";
      return "loading"; // nothing yet — keep skeleton
    }
    const top = questions[0];
    if (!top.user_has_answered) return "A";
    // top is answered — find next unanswered
    const next = questions.find((q) => !q.user_has_answered);
    if (next) return "B";
    if (mediaSurge) return "C";
    if (alignmentSnap) return "D";
    return "A"; // fallback: just show top anyway
  }, [isLoading, questions, mediaSurge, alignmentSnap]);

  const heroQuestion = React.useMemo(() => {
    if (heroState === "A") return questions[0] ?? null;
    if (heroState === "B") return questions.find((q) => !q.user_has_answered) ?? null;
    return null;
  }, [heroState, questions]);

  // Skeleton (sized to State A — largest state — so no layout shift on resolve)
  if (heroState === "loading") {
    return (
      <div className={`${card} p-6 animate-pulse`}>
        <div className="h-3 w-32 rounded bg-slate-100 mb-4" />
        <div className="h-5 w-3/4 rounded bg-slate-100 mb-2" />
        <div className="h-4 w-1/2 rounded bg-slate-100 mb-2" />
        <div className="h-4 w-2/3 rounded bg-slate-100 mb-6" />
        <div className="h-12 rounded bg-slate-100" />
      </div>
    );
  }

  // ── State C — media surge topic ──
  if (heroState === "C" && mediaSurge) {
    return (
      <div className={`${card} p-6`}>
        <Eyebrow>🔥 A new issue is rapidly gaining attention</Eyebrow>
        <h3 className="text-lg font-semibold text-slate-900 leading-snug mb-3">
          {mediaSurge.cluster_title}
        </h3>
        <div className="flex flex-wrap gap-2 mb-4">
          <Pill>{mediaSurge.outlets_24h} outlets reporting</Pill>
          <Pill>{mediaSurge.articles_24h} articles today</Pill>
          {mediaSurge.surge_ratio != null && (
            <Pill>{Math.round(mediaSurge.surge_ratio * 10) / 10}× surge</Pill>
          )}
        </div>
        {mediaSurge.sample_title && (
          <p className="text-sm text-slate-500 line-clamp-2 mb-3">{mediaSurge.sample_title}</p>
        )}
        {mediaSurge.sample_url && (
          <a
            href={mediaSurge.sample_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2"
          >
            See the emerging discussion →
          </a>
        )}
      </div>
    );
  }

  // ── State D — post-answer alignment insight ──
  if (heroState === "D" && alignmentSnap) {
    return (
      <div className={`${card} p-6`}>
        <Eyebrow>🧭 Your societal alignment</Eyebrow>
        <div className="text-3xl font-bold text-slate-900 mb-1">
          {formatPct(alignmentSnap.alignment_pct)}
        </div>
        <p className="text-sm text-slate-500 mb-1">
          You hold the minority view on{" "}
          <strong className="text-slate-700">{alignmentSnap.minority_count}</strong>{" "}
          question{alignmentSnap.minority_count === 1 ? "" : "s"}.
        </p>
        {alignmentSnap.most_divergent_question_text && (
          <p className="mt-2 text-sm text-slate-500 line-clamp-2">
            Most divergent:{" "}
            <span className="text-slate-700">{alignmentSnap.most_divergent_question_text}</span>
          </p>
        )}
        {alignmentSnap.most_divergent_question_id && (
          <Link
            to={`/q/${alignmentSnap.most_divergent_question_id}`}
            className="mt-4 inline-flex items-center text-sm font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2"
          >
            Revisit your most divergent view →
          </Link>
        )}
      </div>
    );
  }

  // ── States A / B — question with slider ──
  // Layout matches the screenshot exactly:
  //   • Single unified card, white background
  //   • Top section: eyebrow + subtext on the LEFT, cover image on the RIGHT
  //     The image fades to transparent on its left edge via a horizontal gradient,
  //     so it bleeds into the white content area seamlessly
  //   • Question headline sits below the eyebrow, spanning left + into the fade zone
  //   • Divider, then slider below on white
  if (!heroQuestion) return null;

  return (
    <div className={`${card} overflow-hidden`}>

      {/* ── Top section: text left / image right (split layout) ── */}
      <div className="relative overflow-hidden">

        {/* Image — absolute, right-aligned, fills full height of this section */}
        {heroQuestion.cover_image_url && (
          <>
            <img
              src={heroQuestion.cover_image_url}
              alt=""
              className="absolute top-0 right-0 h-full w-3/5 object-cover object-center"
              loading="eager"
            />
            {/* Left-to-right fade: white → transparent, covering ~55% from left.
                This lets the question text sit on pure white while the image
                bleeds in naturally from the right, matching the screenshot. */}
            <div
              className="absolute top-0 right-0 h-full w-3/5 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to right, white 0%, white 15%, rgba(255,255,255,0.85) 35%, rgba(255,255,255,0.3) 65%, transparent 100%)",
              }}
            />
          </>
        )}

        {/* Text content — sits on top, left-aligned, z above the image */}
        <div className="relative z-10 p-5 pb-4" style={{ maxWidth: "68%" }}>

          {/* Eyebrow */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-sm font-semibold text-slate-900">
              🔥 One big shifting question
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Answer in seconds — see where society stands.
          </p>

          {/* Tags */}
          {heroQuestion.tags && heroQuestion.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Tag primary>{heroQuestion.tags[0]}</Tag>
              {heroQuestion.tags.slice(1, 3).map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
              {heroQuestion.trend_micro_signal && (
                <SignalPill signal={heroQuestion.trend_micro_signal} />
              )}
              {heroQuestion.user_has_answered && <Pill>ANSWERED</Pill>}
              {heroQuestion.origin_location_label &&
                heroQuestion.origin_location_label !== heroQuestion.audience_location_label && (
                  <Pill>📍 {heroQuestion.origin_location_label}</Pill>
                )}
            </div>
          )}

          {/* Question headline — large, dark, reads over both white and the fade */}
          <Link
            to={`/q/${heroQuestion.question_id}`}
            className="block text-2xl font-bold text-slate-900 leading-snug hover:underline underline-offset-2"
            style={{ maxWidth: "none" }}
          >
            {heroQuestion.question_text}
          </Link>

          {heroQuestion.topic_title && (
            <p className="mt-1.5 text-xs text-slate-400">
              {heroQuestion.topic_title}
            </p>
          )}
        </div>
      </div>

      {/* ── Slider section — full width, white, below the split ── */}
      <div className="px-5 pb-5 pt-3 border-t border-slate-100">
        {heroQuestion.summary && (
          <p className="text-xs text-slate-500 leading-relaxed mb-4 line-clamp-2">
            {heroQuestion.summary}
          </p>
        )}

        {isAuthed ? (
          <QuestionStanceSlider
            key={`hero-${heroQuestion.question_id}`}
            questionId={heroQuestion.question_id}
            questionText={heroQuestion.question_text}
            summary={heroQuestion.summary}
            initialValue={heroQuestion.user_stance_value ?? null}
            stats={heroStats ?? null}
            pulseThumb={true}
            onSubmit={(v) => onSubmit(heroQuestion.question_id, v)}
          />
        ) : (
          <>
            <div
              onPointerUpCapture={onLoginRedirect}
              onPointerCancelCapture={onLoginRedirect}
              onMouseUpCapture={onLoginRedirect}
              onTouchEndCapture={onLoginRedirect}
              className="cursor-pointer"
            >
              <QuestionStanceSlider
                key={`hero-anon-${heroQuestion.question_id}`}
                questionId={heroQuestion.question_id}
                questionText={heroQuestion.question_text}
                summary={heroQuestion.summary}
                initialValue={null}
                onSubmit={onLoginRedirect}
              />
            </div>
            <div className="mt-4 flex flex-col items-center gap-2">
              <p className="text-xs text-slate-400">Log in to record your stance</p>
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
                onClick={onLoginRedirect}
              >
                Log in to take stance
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Epic E — Personal Analytics Card ────────────────

// ─── PersonalAnalyticsSparkline — tiny inline SVG, no library ────────────────
function PersonalAnalyticsSparkline({
  points,
}: {
  points: PersonalAnalyticsTrendPoint[];
}) {
  const valid = points.filter((p) => p.alignmentScore !== null && p.answeredCount > 0);
  if (valid.length < 2) return null;

  const W = 88;
  const H = 28;
  const scores = valid.map((p) => p.alignmentScore as number);
  const minV = Math.min(...scores);
  const maxV = Math.max(...scores);
  const range = maxV - minV || 0.01;
  const xStep = W / (valid.length - 1);

  const coords = valid.map((p, i) => {
    const x = i * xStep;
    const y = H - ((( p.alignmentScore as number) - minV) / range) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Color by trend direction
  const first = scores[0];
  const last = scores[scores.length - 1];
  const color = last > first + 0.03 ? "#10b981" : last < first - 0.03 ? "#f43f5e" : "#94a3b8";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="flex-shrink-0">
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  );
}

// ─── PersonalAnalyticsCard ────────────────────────────────────────────────────
function PersonalAnalyticsCard({
  data,
  isLoading,
  isError,
}: {
  data: PersonalAnalyticsResponse | null;
  isLoading: boolean;
  isError: boolean;
}) {
  // Loading skeleton
  if (isLoading) {
    return (
      <div className={`${card} p-5`}>
        <Eyebrow>Your opinion profile</Eyebrow>
        <div className="space-y-3 animate-pulse mt-3">
          <div className="h-3 w-2/3 bg-slate-100 rounded" />
          <div className="h-3 w-full bg-slate-100 rounded" />
          <div className="h-3 w-4/5 bg-slate-100 rounded" />
          <div className="h-3 w-1/2 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  // Error — soft fail
  if (isError) {
    return (
      <div className={`${card} p-5`}>
        <Eyebrow>Your opinion profile</Eyebrow>
        <p className="text-sm text-slate-400 mt-2">
          Your analytics are unavailable right now.
        </p>
      </div>
    );
  }

  // No data
  if (!data) return null;

  const tier = getPersonalAnalyticsTier(data.totalAnswered);

  // Empty state
  if (tier === "empty") {
    return (
      <div className={`${card} p-5`}>
        <Eyebrow>Your opinion profile</Eyebrow>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
          Answer a few questions to unlock your personal analytics.
        </p>
      </div>
    );
  }

  const { alignmentTrend, mostDivergentTopic, opinionFingerprint } = data;

  return (
    <div className={`${card} p-5 space-y-4`}>
      <Eyebrow>Your opinion profile</Eyebrow>

      {/* Sparse state — condensed message */}
      {tier === "sparse" && (
        <p className="text-xs text-slate-500 leading-relaxed">
          You've started building a stance history. As you answer more questions,
          we'll show how your alignment changes over time.
        </p>
      )}

      {/* ── Section 1: Alignment Trend ── */}
      {(tier === "basic" || tier === "mature") && (
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-1">Alignment trend</p>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 leading-snug flex-1">
              {getAlignmentTrendCopy(alignmentTrend.direction)}
            </p>
            <PersonalAnalyticsSparkline points={alignmentTrend.points} />
          </div>
          {alignmentTrend.currentAlignmentScore !== null && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <div
                className="h-1.5 rounded-full bg-slate-100 flex-1 overflow-hidden"
                style={{ maxWidth: 80 }}
              >
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all"
                  style={{
                    width: `${Math.round(clamp01(alignmentTrend.currentAlignmentScore) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-slate-500 tabular-nums">
                {Math.round(clamp01(alignmentTrend.currentAlignmentScore) * 100)}% aligned
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Divider ── */}
      {mostDivergentTopic && tier !== "sparse" && (
        <div className="border-t border-slate-100" />
      )}

      {/* ── Section 2: Most Divergent Topic ── */}
      {mostDivergentTopic && tier !== "sparse" && (
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-1">Most divergent topic</p>
          {mostDivergentTopic.topicId ? (
            <Link
              to={`/topics/${mostDivergentTopic.topicId}`}
              className="text-[11px] font-semibold text-violet-600 hover:underline"
            >
              {mostDivergentTopic.topicTitle}
            </Link>
          ) : (
            <span className="text-[11px] font-semibold text-slate-700">
              {mostDivergentTopic.topicTitle}
            </span>
          )}
          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
            {getDivergenceCopy(mostDivergentTopic.direction)}
          </p>
        </div>
      )}

      {/* ── Divider ── */}
      {opinionFingerprint.summaryTags.length > 0 && (
        <div className="border-t border-slate-100" />
      )}

      {/* ── Section 3: Opinion Fingerprint ── */}
      {opinionFingerprint.summaryTags.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-2">Opinion fingerprint</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {opinionFingerprint.summaryTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
          {opinionFingerprint.strongestTopicTitle && (
            <p className="text-[11px] text-slate-500">
              Strongest lean:{" "}
              {opinionFingerprint.strongestTopicId ? (
                <Link
                  to={`/topics/${opinionFingerprint.strongestTopicId}`}
                  className="font-semibold text-slate-700 hover:underline"
                >
                  {opinionFingerprint.strongestTopicTitle}
                </Link>
              ) : (
                <span className="font-semibold text-slate-700">
                  {opinionFingerprint.strongestTopicTitle}
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Band 3 — Since You Last Visited ─────────────────

function SinceYouLastVisited({
  continuingData,
  reopenedData,
  isLoading,
}: {
  continuingData: BecauseYouRow[];
  reopenedData: ReopenedRow[];
  isLoading: boolean;
}) {
  // Build up to 3 meaningful items
  const items: Array<{ text: string; href: string }> = [];

  reopenedData.slice(0, 1).forEach((r) => {
    const shift =
      r.public_shift_proxy != null
        ? ` (shift: ${Math.round(r.public_shift_proxy * 10) / 10})`
        : "";
    items.push({
      text: `Opinion shifted on a question you answered${shift} — worth revisiting`,
      href: `/q/${r.question_id}`,
    });
  });

  continuingData.slice(0, 2).forEach((c) => {
    items.push({
      text: c.reason
        ? c.reason
        : `New activity in ${c.topic_title ?? "a topic you follow"}`,
      href: c.topic_id ? `/topics/${c.topic_id}` : `/q/${c.question_id}`,
    });
  });

  return (
    <div className={`${card} p-5`}>
      <Eyebrow>↻ Since you last visited</Eyebrow>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 rounded bg-slate-100 w-full" />
          <div className="h-3 rounded bg-slate-100 w-5/6" />
          <div className="h-3 rounded bg-slate-100 w-4/6" />
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div>
          <p className="text-sm font-medium text-slate-700 mb-1">Track how society changes.</p>
          <p className="text-sm text-slate-500">
            Answer a few questions and we'll show how opinion evolves around you.
          </p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <ul className="space-y-2.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
              <Link
                to={item.href}
                className="text-sm text-slate-600 leading-snug hover:text-slate-900 hover:underline"
              >
                {item.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────── Band 4 — Society Right Now ──────────────────────

function SocietyRightNow({ pulse }: { pulse: SocietalPulseOutput | null }) {
  if (!pulse) return null;

  const chips = Array.isArray(pulse.chips) ? pulse.chips : [];
  const mm = Array.isArray(pulse.micro_metrics) ? pulse.micro_metrics : [];

  const iconGlyph = (icon: SocietalPulseOutput["chips"][number]["icon"]) => {
    switch (icon) {
      case "reawakening": return "↺";
      case "polarized":   return "⇄";
      case "up":          return "↑";
      default:            return "→";
    }
  };

  return (
    <div className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Eyebrow>🌍 Society right now</Eyebrow>

          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
            {pulse.narrative?.title ?? "Societal Pulse"}
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">
            {pulse.narrative?.sentence_1}
            {pulse.narrative?.sentence_2 && (
              <span className="text-slate-500"> {pulse.narrative.sentence_2}</span>
            )}
          </p>

          {chips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.slice(0, 3).map((c) => (
                <Link
                  key={c.topic_id}
                  to={c.href || `/topics/${c.topic_id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-100 transition-colors"
                  title={c.title}
                >
                  <span className="text-slate-400">{iconGlyph(c.icon)}</span>
                  <span className="line-clamp-1 max-w-[180px]">{c.title}</span>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {mm.length > 0 ? (
              mm.slice(0, 3).map((m) => (
                <Pill key={m.label}>
                  {m.value == null ? m.label : <>{formatNum(m.value)} {m.label}</>}
                </Pill>
              ))
            ) : (
              <>
                <Pill>— topics shifting rapidly</Pill>
                <Pill>— polarized</Pill>
                <Pill>— reawakening</Pill>
              </>
            )}
          </div>
        </div>

        <Link
          to="/topics"
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
        >
          Explore →
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────── Participation Strip (preserved) ─────────────────

function ParticipationStrip({ stats }: { stats: ParticipationStatsRow | null }) {
  if (!stats) return null;
  return (
    <div className={`${card} px-5 py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-700">🌊 Live participation</div>
        <div className="flex flex-wrap gap-2">
          <Pill>{formatNum(stats.stances_window)} signals (24h)</Pill>
          <Pill>{formatNum(stats.stances_7d)} signals (7d)</Pill>
          <Pill>{formatNum(stats.unique_users_window)} people (24h)</Pill>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Media Surge (preserved, restyled) ───────────────

function MediaSurgeCard({ media }: { media: MediaSurgeRow | null }) {
  if (!media) return null;
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>📰 Media surge</Eyebrow>
          <div className="text-sm font-semibold text-slate-900 line-clamp-1 mb-2">
            {media.cluster_title}
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill>{media.outlets_24h} outlets (24h)</Pill>
            <Pill>{media.articles_24h} articles (24h)</Pill>
            <Pill>
              surge {media.surge_ratio != null ? `${Math.round(media.surge_ratio * 10) / 10}×` : "—"}
            </Pill>
          </div>
          {media.sample_title && (
            <p className="mt-2 text-xs text-slate-500 line-clamp-2">
              {media.sample_title}
            </p>
          )}
        </div>
        {media.sample_url && (
          <a
            href={media.sample_url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Read
          </a>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Where You Stand (preserved, restyled) ───────────

function WhereYouStandCard({ snap }: { snap: AlignmentSnapshotRow | null }) {
  if (!snap) return null;
  return (
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>🧭 Where you stand</Eyebrow>
          <div className="flex flex-wrap gap-2">
            <Pill>Alignment: {formatPct(snap.alignment_pct)}</Pill>
            <Pill>{snap.minority_count} in minority</Pill>
          </div>
        </div>
        {snap.most_divergent_question_id && (
          <Link
            to={`/q/${snap.most_divergent_question_id}`}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Revisit
          </Link>
        )}
      </div>
      {snap.most_divergent_question_text && (
        <p className="mt-3 text-sm text-slate-500 line-clamp-2">
          Most divergent:{" "}
          <span className="text-slate-700">{snap.most_divergent_question_text}</span>
        </p>
      )}
    </div>
  );
}

// ─────────────────────────── Instant Feedback (preserved, restyled) ──────────

function InstantFeedbackCard({
  dist,
  onClose,
  mode = "authed",
  userValue,
  onLogin,
}: {
  dist: QuestionDistributionRow | null;
  onClose: () => void;
  mode?: "authed" | "anon";
  userValue?: number | null;
  onLogin?: () => void;
}) {
  if (!dist) return null;

  const bucket =
    userValue == null
      ? null
      : userValue > 0.15
      ? "support"
      : userValue < -0.15
      ? "oppose"
      : "neutral";

  const alignedPct =
    bucket === "support" ? dist.support_pct
    : bucket === "oppose" ? dist.oppose_pct
    : bucket === "neutral" ? dist.neutral_pct
    : null;

  return (
    <div className={`${card} p-5 border-l-4 border-l-emerald-400`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 mb-2">
            {mode === "anon" ? "🎉 Instant reward" : "✅ Signal recorded"}
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill>{formatNum(dist.responses)} responses</Pill>
            <Pill>Support {formatPct(dist.support_pct)}</Pill>
            <Pill>Neutral {formatPct(dist.neutral_pct)}</Pill>
            <Pill>Oppose {formatPct(dist.oppose_pct)}</Pill>
            {mode === "anon" && bucket && (
              <Pill>You're aligned with {formatPct(alignedPct)}</Pill>
            )}
          </div>
          {mode === "anon" && (
            <p className="mt-2 text-xs text-slate-500">
              Create an account to save your stance and track how it shifts over time.
            </p>
          )}
          {mode === "anon" && onLogin && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 transition-colors"
                onClick={onLogin}
              >
                Create account
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                onClick={onLogin}
              >
                Log in
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 transition-colors"
          onClick={onClose}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────── Band 5 — Add Your Voice ─────────────────────────
//
// A. Featured question — large editorial card (image + summary + slider + CTA)
// B. 2-column question grid — compact cards with all existing metadata preserved

// A. Featured card — takes TrendingHomepageQuestionRow (authed)
function FeaturedQuestionCard({
  q,
  isAuthed,
  onSubmit,
  onLoginRedirect,
  onOpen,
  featuredStats,
}: {
  q: TrendingHomepageQuestionRow;
  isAuthed: boolean;
  onSubmit: (questionId: string, value: number) => Promise<void>;
  onLoginRedirect: () => void;
  onOpen: (id: string) => void;
  featuredStats?: QuestionStats | null;
}) {
  return (
    <div className={`${card} overflow-hidden`}>
      {/* Large cover image — Rule 3: featured card must have cover */}
      {q.cover_image_url ? (
        <div className="h-52 w-full overflow-hidden sm:h-60">
          <img
            src={q.cover_image_url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <QuestionCoverImage
          imageUrl={null}
          tags={q.tags}
          variant="banner"
          bannerHeight={180}
        />
      )}

      <div className="p-5">
        {/* Tags + signals */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {q.tags && q.tags.length > 0 && <Tag primary>{q.tags[0]}</Tag>}
          {q.tags && q.tags.slice(1, 3).map((t) => <Tag key={t}>{t}</Tag>)}
          {q.trend_micro_signal && <SignalPill signal={q.trend_micro_signal} />}
          {q.user_has_answered && <Pill>ANSWERED</Pill>}
          {q.origin_location_label && q.origin_location_label !== q.audience_location_label && (
            <Pill>📍 {q.origin_location_label}</Pill>
          )}
        </div>

        <Link
          to={`/q/${q.question_id}`}
          className="block text-lg font-semibold text-slate-900 leading-snug hover:underline mb-2"
        >
          {q.question_text}
        </Link>

        {q.summary && (
          <p className="text-sm text-slate-500 leading-relaxed line-clamp-2 mb-3">
            {q.summary}
          </p>
        )}

        {q.topic_title && (
          <p className="text-xs text-slate-400 mb-4">Topic: {q.topic_title}</p>
        )}

        {isAuthed ? (
          <QuestionStanceSlider
            key={`featured-${q.question_id}`}
            questionId={q.question_id}
            questionText={q.question_text}
            summary={q.summary}
            initialValue={q.user_stance_value ?? null}
            stats={featuredStats ?? null}
            pulseThumb={true}
            onSubmit={(v) => onSubmit(q.question_id, v)}
          />
        ) : (
          <div
            onPointerUpCapture={onLoginRedirect}
            onPointerCancelCapture={onLoginRedirect}
            onMouseUpCapture={onLoginRedirect}
            onTouchEndCapture={onLoginRedirect}
            className="cursor-pointer"
          >
            <QuestionStanceSlider
              key={`featured-anon-${q.question_id}`}
              questionId={q.question_id}
              questionText={q.question_text}
              summary={q.summary}
              initialValue={null}
              onSubmit={onLoginRedirect}
            />
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
            onClick={() => onOpen(q.question_id)}
          >
            Open full discussion →
          </button>
        </div>
      </div>
    </div>
  );
}

// Anon featured card (AnonQuestionRow shape)
function FeaturedQuestionCardAnon({
  q,
  onLoginRedirect,
  onOpen,
}: {
  q: AnonQuestionRow;
  onLoginRedirect: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={`${card} overflow-hidden`}>
      <QuestionCoverImage
        imageUrl={q.cover_image_url ?? null}
        tags={q.tags}
        variant="banner"
        bannerHeight={180}
      />
      <div className="p-5">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {q.tags && q.tags.length > 0 && <Tag primary>{q.tags[0]}</Tag>}
          {q.tags && q.tags.slice(1, 3).map((t) => <Tag key={t}>{t}</Tag>)}
          {q.origin_location_label && q.origin_location_label !== q.audience_location_label && (
            <Pill>📍 {q.origin_location_label}</Pill>
          )}
        </div>

        <Link
          to={`/q/${q.id}`}
          className="block text-lg font-semibold text-slate-900 leading-snug hover:underline mb-2"
        >
          {q.question}
        </Link>

        {q.summary && (
          <p className="text-sm text-slate-500 line-clamp-2 mb-4">{q.summary}</p>
        )}

        <div
          onPointerUpCapture={onLoginRedirect}
          onPointerCancelCapture={onLoginRedirect}
          onMouseUpCapture={onLoginRedirect}
          onTouchEndCapture={onLoginRedirect}
          className="cursor-pointer"
        >
          <QuestionStanceSlider
            questionId={q.id}
            questionText={q.question}
            summary={q.summary}
            initialValue={null}
            onSubmit={onLoginRedirect}
          />
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
            onClick={() => onOpen(q.id)}
          >
            Open full discussion →
          </button>
        </div>
      </div>
    </div>
  );
}

// B. Grid question card — compact, 2-col, all metadata preserved
function GridQuestionCard({
  q,
  isAuthed,
  onSubmit,
  onLoginRedirect,
  onOpen,
}: {
  q: TrendingHomepageQuestionRow;
  isAuthed: boolean;
  onSubmit: (questionId: string, value: number) => Promise<void>;
  onLoginRedirect: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={`${card} overflow-hidden flex flex-col`}>
      <QuestionCoverImage
        imageUrl={q.cover_image_url ?? null}
        tags={q.tags}
        variant="banner"
        bannerHeight={130}
      />
      <div className="p-4 flex flex-col flex-1">
        {/* Tags + signals */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {q.tags && q.tags.length > 0 && <Tag primary>{q.tags[0]}</Tag>}
          {q.tags && q.tags.slice(1, 2).map((t) => <Tag key={t}>{t}</Tag>)}
          {q.trend_micro_signal && <SignalPill signal={q.trend_micro_signal} />}
          {q.user_has_answered && <Pill>ANSWERED</Pill>}
          {q.origin_location_label && q.origin_location_label !== q.audience_location_label && (
            <Pill>📍 {q.origin_location_label}</Pill>
          )}
        </div>

        <Link
          to={`/q/${q.question_id}`}
          className="text-sm font-semibold text-slate-900 leading-snug hover:underline line-clamp-3 mb-1 flex-1"
        >
          {q.question_text}
        </Link>

        {q.topic_title && (
          <p className="text-[11px] text-slate-400 mt-1 mb-3">Topic: {q.topic_title}</p>
        )}

        <div className="mt-auto pt-2">
          {isAuthed ? (
            <QuestionStanceSlider
              questionId={q.question_id}
              questionText={q.question_text}
              summary={q.summary}
              initialValue={q.user_stance_value ?? null}
              onSubmit={(v) => onSubmit(q.question_id, v)}
            />
          ) : (
            <div
              onPointerUpCapture={onLoginRedirect}
              onPointerCancelCapture={onLoginRedirect}
              onMouseUpCapture={onLoginRedirect}
              onTouchEndCapture={onLoginRedirect}
              className="cursor-pointer"
            >
              <QuestionStanceSlider
                questionId={q.question_id}
                questionText={q.question_text}
                summary={q.summary}
                initialValue={null}
                onSubmit={onLoginRedirect}
              />
            </div>
          )}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
              onClick={() => onOpen(q.question_id)}
            >
              Open →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Anon grid card
function GridQuestionCardAnon({
  q,
  onLoginRedirect,
  onOpen,
}: {
  q: AnonQuestionRow;
  onLoginRedirect: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={`${card} overflow-hidden flex flex-col`}>
      <QuestionCoverImage
        imageUrl={q.cover_image_url ?? null}
        tags={q.tags}
        variant="banner"
        bannerHeight={130}
      />
      <div className="p-4 flex flex-col flex-1">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {q.tags && q.tags.length > 0 && <Tag primary>{q.tags[0]}</Tag>}
          {q.tags && q.tags.slice(1, 2).map((t) => <Tag key={t}>{t}</Tag>)}
          {q.origin_location_label && q.origin_location_label !== q.audience_location_label && (
            <Pill>📍 {q.origin_location_label}</Pill>
          )}
        </div>

        <Link
          to={`/q/${q.id}`}
          className="text-sm font-semibold text-slate-900 leading-snug hover:underline line-clamp-3 mb-1 flex-1"
        >
          {q.question}
        </Link>

        {q.summary && (
          <p className="text-[11px] text-slate-400 mt-1 mb-2 line-clamp-2">{q.summary}</p>
        )}

        <div className="mt-auto pt-2">
          <div
            onPointerUpCapture={onLoginRedirect}
            onPointerCancelCapture={onLoginRedirect}
            onMouseUpCapture={onLoginRedirect}
            onTouchEndCapture={onLoginRedirect}
            className="cursor-pointer"
          >
            <QuestionStanceSlider
              questionId={q.id}
              questionText={q.question}
              summary={q.summary}
              initialValue={null}
              onSubmit={onLoginRedirect}
            />
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
              onClick={() => onOpen(q.id)}
            >
              Open →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Main Page ───────────────────────────────────────

export default function IndexPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session, sessionResolved } = useSupabaseSession();
  const isAuthed = !!session;
  const sb = React.useMemo(getSupabase, []);
  const userId = session?.user?.id ?? null;

  // Q5 — contribution acknowledgement check (Phase 4)
  const { checkForAcknowledgement } = useContributionAcknowledgement(isAuthed);

  // Infinite scroll sentinel
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const actions = (
    <div className="flex items-center gap-2">
      <button
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        onClick={() => navigate("/search")}
        aria-label="Search questions"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
      </button>
      <button
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        onClick={() => navigate("/topics")}
        aria-label="Explore topics"
      >
        Explore topics
      </button>
    </div>
  );

  // ── Profile ──
  const { data: profile } = useQuery({
    enabled: !!userId,
    queryKey: ["profile", userId],
    queryFn: async () => {
      if (!sb || !userId) return null;
      const { data, error } = await sb
        .from("profiles")
        .select("random_id, username, display_handle_mode")
        .eq("id", userId)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 60_000,
  });

  // ── Region dims ──
  const { data: myRegion } = useQuery({
    enabled: !!userId,
    queryKey: ["my-region", userId],
    queryFn: async () => {
      if (!sb || !userId) return null;
      const { data, error } = await sb
        .from("user_region_dimensions")
        .select(
          "user_id, city_label, county_label, state_label, country_label, global_label"
        )
        .eq("user_id", userId)
        .maybeSingle<RegionRow>();
      if (error) return null;
      return data ?? null;
    },
    staleTime: 60_000,
  });

  const countryLabel = myRegion?.country_label ?? null;
  const globalLabel = myRegion?.global_label ?? "Global";
  const hasCountry = !!countryLabel;

  // Bootstrap completion listener: when useBootstrapUser finishes writing location
  // data on first login (including OAuth), invalidate my-region + all feed queries.
  // On OAuth, the page does a full reload — bootstrap may complete before or after
  // this effect runs. We handle both cases:
  //   1. Listener registered before event fires — handled by addEventListener
  //   2. Event already fired before listener registered — handled by bootstrapDoneRef flag
  React.useEffect(() => {
    const invalidateAll = () => {
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["my-region"] });
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-trending-questions"] });
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-society-pulse"] });
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-participation"] });
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-media-surge"] });
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-where-you-stand"] });
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-because-you"] });
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-reopened"] });
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-fallback-feed"] });
    };

    // Case 2: bootstrap already completed before this effect ran
    if ((window as any).__bootstrapComplete) {
      invalidateAll();
    }

    // Case 1: listen for future completion
    window.addEventListener("bootstrap:complete", invalidateAll);
    return () => window.removeEventListener("bootstrap:complete", invalidateAll);
  }, [qc]);

  const [regionTab, setRegionTab] = React.useState<"country" | "global">(
    hasCountry ? "country" : "global"
  );

  React.useEffect(() => {
    if (hasCountry) setRegionTab((t) => (t === "global" ? "country" : t));
    if (!hasCountry) setRegionTab("global");
  }, [hasCountry]);

  const regionLabel =
    regionTab === "country" && countryLabel ? countryLabel : globalLabel;

  // ── Cover hydration safety net (unchanged) ──
  const hydrateCoversForTrendingRows = React.useCallback(
    async (rows: TrendingHomepageQuestionRow[]) => {
      if (!sb) return rows;
      const missingIds = rows
        .filter((r) => !r.cover_image_url)
        .map((r) => r.question_id)
        .filter(Boolean);
      if (missingIds.length === 0) return rows;
      const { data, error } = await sb
        .from("questions")
        .select("id, cover_image_url")
        .in("id", missingIds);
      if (error) {
        console.warn("[home] hydrate covers failed", error);
        return rows;
      }
      const map = new Map<string, string | null>(
        (data ?? []).map((d: any) => [d.id, (d.cover_image_url ?? null) as string | null])
      );
      return rows.map((r) => ({
        ...r,
        cover_image_url: r.cover_image_url ?? map.get(r.question_id) ?? null,
      }));
    },
    [sb]
  );

  // ── Location IDs ──
  const {
    globalId: GLOBAL_LOCATION_ID,
    countryId: COUNTRY_LOCATION_ID,
    isLoading: locationIdsLoading,
  } = useGlobalAndCountryIds(countryLabel);

  // ──────────────────────── All queries (all preserved) ────────────────────────

  // Society Pulse
  // Tier 1: get_societal_pulse_homepage (final preferred RPC — Point 14)
  // Tier 2: get_society_pulse_early_stage (existing fallback)
  // Tier 3: get_society_pulse legacy (final fallback)
  const societyPulseQuery = useQuery({
    enabled: !!sb,
    queryKey: ["home-society-pulse", regionLabel],
    retry: false,
    queryFn: async () => {
      if (!sb) return null;

      const isNotFound = (err: any) => {
        const status = err?.status;
        const code = err?.code;
        const msg = String(err?.message ?? "").toLowerCase();
        return (
          status === 404 ||
          code === "PGRST202" ||
          code === "PGRST204" ||
          msg.includes("could not find the function") ||
          msg.includes("could not find the table") ||
          msg.includes("not find the function")
        );
      };

      // Tier 1: get_societal_pulse_homepage — homepage-ready structured output
      try {
        const { data, error } = await sb.rpc("get_societal_pulse_homepage", {
          p_region_label: regionLabel,
          p_topic_pick_n: 3,
        });
        if (error) {
          if (!isNotFound(error)) throw error;
          // not deployed yet — fall through to Tier 2
        } else {
          const row =
            Array.isArray(data) && data.length > 0
              ? (data[0] as SocietalPulseOutput)
              : data && !Array.isArray(data)
              ? (data as SocietalPulseOutput)
              : null;
          if (row?.narrative?.sentence_1) {
            // Normalise chips href if missing
            let chips = Array.isArray(row.chips)
              ? row.chips.map((c) => ({
                  ...c,
                  href: c.href || `/topics/${c.topic_id}`,
                }))
              : [];

            // If the RPC returned no chips (e.g. topic_pulse_metrics_mv stale or empty
            // for this region), build them from topic_region_trends which is always
            // publicly readable and populated independently of the MV refresh schedule.
            if (chips.length === 0) {
              const { data: trData } = await sb
                .from("topic_region_trends")
                .select("topic_id, movement_score, delta_24h_per_hour, polarization_score, momentum_24h, topics(title)")
                .order("movement_score", { ascending: false })
                .limit(5);
              chips = ((trData ?? []) as any[])
                .filter((r) => r.topics?.title)
                .map((r) => ({
                  topic_id: String(r.topic_id),
                  title: String(r.topics.title),
                  icon: (
                    r.polarization_score >= 0.6 ? "polarized"
                    : r.delta_24h_per_hour >= 0.4 ? "up"
                    : r.momentum_24h >= 0.5 ? "up"
                    : "steady"
                  ) as "up" | "reawakening" | "polarized" | "steady",
                  href: `/topics/${r.topic_id}`,
                }));
            }

            return { ...row, chips } as SocietalPulseOutput;
          }
        }
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }

      // Tier 2: Early-stage pulse
      try {
        const { data, error } = await sb.rpc("get_society_pulse_early_stage", {
          p_region: regionLabel,
          p_top_n: 2,
          p_min_candidates: 3,
          p_w24h: 0.7,
          p_w7d: 0.3,
        });
        if (error) {
          if (!isNotFound(error)) throw error;
        } else {
          const row =
            Array.isArray(data) && data.length > 0
              ? (data[0] as SocietyPulseEarlyStageRow)
              : null;
          if (row) {
            const featured = Array.isArray(row.featured_topics)
              ? row.featured_topics
              : [];
            const rpcChips = Array.isArray(row.chips) ? row.chips : [];
            const mapped: SocietalPulseOutput = {
              region_label: regionLabel,
              updated_at: new Date().toISOString(),
              state: "FOCUSED",
              narrative: {
                title: row.headline || "Societal Pulse",
                sentence_1:
                  row.description ||
                  "Signals are updating. Explore shifting topics to see where public sentiment is moving right now.",
                sentence_2: null,
              },
              chips: featured.slice(0, 3).map((t) => ({
                topic_id: String(t.topic_id),
                title: String(t.title ?? ""),
                icon: "up",
                href: `/topics/${String(t.topic_id)}`,
              })),
              micro_metrics:
                rpcChips.length > 0
                  ? rpcChips.slice(0, 3).map((c) => ({
                      label: String(c.label ?? ""),
                      value:
                        c.value === null || c.value === undefined
                          ? null
                          : Number(c.value),
                    }))
                  : [{ label: "topics surfacing", value: Number(row.topic_count ?? 0) }],
            };
            return mapped;
          }
        }
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }

      // Tier 3: Legacy pulse — also builds chips from topic_region_trends
      // topic_region_trends is publicly readable (policy: public_read_trends).
      // We use it as a last-resort chip source when Tier 1 + 2 produce no chips.
      const [legacyResult, trendsResult] = await Promise.allSettled([
        sb.rpc("get_society_pulse", { p_region: regionLabel, p_shift_threshold: 0.08 }),
        sb
          .from("topic_region_trends")
          .select("topic_id, movement_score, delta_24h_per_hour, polarization_score, momentum_24h, topics(title)")
          .order("movement_score", { ascending: false })
          .limit(6),
      ]);

      const legacyRow =
        legacyResult.status === "fulfilled" &&
        !legacyResult.value.error &&
        Array.isArray(legacyResult.value.data) &&
        legacyResult.value.data.length > 0
          ? (legacyResult.value.data[0] as SocietyPulseRow)
          : null;

      // Build chips from topic_region_trends — classify icon by momentum signals
      const trendRows =
        trendsResult.status === "fulfilled" && !trendsResult.value.error
          ? ((trendsResult.value.data ?? []) as any[])
          : [];

      const trendChips = trendRows
        .filter((r) => r.topics?.title)
        .slice(0, 5)
        .map((r) => ({
          topic_id: String(r.topic_id),
          title: String(r.topics.title),
          icon: (
            r.polarization_score >= 0.6
              ? "polarized"
              : r.delta_24h_per_hour >= 0.4
              ? "up"
              : r.momentum_24h >= 0.5
              ? "up"
              : "steady"
          ) as "up" | "reawakening" | "polarized" | "steady",
          href: `/topics/${r.topic_id}`,
        }));

      if (!legacyRow && trendChips.length === 0) return null;

      return {
        region_label: regionLabel,
        updated_at: legacyRow?.generated_at ?? new Date().toISOString(),
        state: "FOCUSED" as const,
        narrative: {
          title: "Societal Pulse",
          sentence_1:
            "Signals are updating. Explore shifting topics to see where public sentiment is moving right now.",
          sentence_2: null,
        },
        chips: trendChips,
        micro_metrics: legacyRow ? [
          { label: "topics shifting rapidly", value: Number(legacyRow.rapid_shifts_count ?? 0) },
          { label: "polarized", value: Number(legacyRow.polarized_count ?? 0) },
          { label: "reawakening", value: Number(legacyRow.reawakening_count ?? 0) },
        ] : [],
      } as SocietalPulseOutput;
    },
    staleTime: 30_000,
  });

  const participationQuery = useQuery({
    enabled: !!sb,
    queryKey: ["home-participation", regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_participation_stats", {
        p_region: regionLabel,
        p_window_hours: 24,
      });
      if (error) throw error;
      return Array.isArray(data) && data.length > 0
        ? (data[0] as ParticipationStatsRow)
        : null;
    },
    staleTime: 30_000,
  });

  const mediaSurgeQuery = useQuery({
    enabled: !!sb,
    queryKey: ["home-media-surge", regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_media_surge_homepage", {
        p_region: regionLabel,
        p_window_hours: 24,
        p_baseline_days: 7,
        p_limit: 5,
      });
      if (error) throw error;
      const rows = (data ?? []) as MediaSurgeRow[];
      return rows.length > 0 ? rows[0] : null;
    },
    staleTime: 30_000,
  });

  const whereYouStandQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-where-you-stand", userId, regionLabel],
    retry: false,
    queryFn: async () => {
      // Verify session token is actually available before calling —
      // userId can be truthy while the client's JWT header is still being set
      const { data: { session: liveSession } } = await sb!.auth.getSession();
      if (!liveSession?.access_token) return null;

      const { data, error } = await sb!.rpc("get_user_alignment_snapshot", {
        p_region: regionLabel,
      });
      if (error) {
        const status = (error as any)?.status ?? (error as any)?.code;
        if (status === 400 || status === 404 || status === "PGRST202") return null;
        throw error;
      }
      return Array.isArray(data) && data.length > 0
        ? (data[0] as AlignmentSnapshotRow)
        : null;
    },
    staleTime: 30_000,
  });

  const continuingQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-because-you", userId, regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_because_you_engaged", {
        p_region: regionLabel,
        p_limit: 6,
      });
      if (error) throw error;
      return (data ?? []) as BecauseYouRow[];
    },
    staleTime: 30_000,
  });

  const reopenedQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-reopened", userId, regionLabel],
    queryFn: async () => {
      const { data, error } = await sb!.rpc("get_reopened_questions_for_user", {
        p_region: regionLabel,
        p_limit: 3,
        p_min_shift: 1.0,
        p_min_age_days: 30,
      });
      if (error) throw error;
      return (data ?? []) as ReopenedRow[];
    },
    staleTime: 30_000,
  });

  // ── Recent stances — direct table query, no RPC needed ──
  // question_stances has RLS: SELECT USING (auth.uid() = user_id)
  // Joins to questions + topics for text. Ordered by updated_at DESC, limit 3.
  // ── My stance snapshot — topic-level aggregation for WhereYouStandCard ─────
  // Uses get_my_stance_snapshot (SECURITY DEFINER, auth.uid() scoped).
  // Returns total_answered, up to 5 topics with avg_score, and a pre-computed
  // regional alignment label. Invalidated after any stance submit.
  const myStanceSnapshotQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-my-stance-snapshot", userId],
    queryFn: async (): Promise<MyStanceSnapshot> => {
      const { data, error } = await sb!.rpc("get_my_stance_snapshot", {
        p_limit_topics: 5,
      });
      if (error) throw error;
      const raw = data as any;
      const topics: TopicStanceItem[] = ((raw?.topics ?? []) as any[]).map((t) => ({
        topicTitle: t.topic_title ?? "General",
        avgScore: typeof t.avg_score === "number" ? t.avg_score : 0,
        answerCount: t.n ?? 0,
        scorePct: Math.round(((typeof t.avg_score === "number" ? t.avg_score : 0) / 2) * 100),
      }));
      return {
        totalAnswered: raw?.total_answered ?? 0,
        topics,
        alignmentLabel: raw?.region?.alignment_label ?? "",
      };
    },
    staleTime: 60_000,
  });

  // ── Q1: Since Last Visit query ───────────────────────────────────────────────
  // Uses get_since_last_visited() SECURITY DEFINER RPC — reads profiles.last_seen_at,
  // computes topic sentiment shifts before/after, returns changes[].
  // retry:false so errors fail silently and hide the block (right rail stays clean).
  const sinceLastVisitQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-since-last-visit", userId],
    queryFn: async (): Promise<SinceLastVisitData> => {
      const { data, error } = await sb!.rpc("get_since_last_visited").single();
      if (error) throw error;
      return data as SinceLastVisitData;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // ── Q3: Streak query ──────────────────────────────────────────────────────────
  // Reads raw created_at dates from question_stances; streak computed client-side.
  // Limited to 60 rows — enough for ~2 months of daily answers.
  const streakQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-streak", userId],
    queryFn: async (): Promise<{ created_at: string }[]> => {
      const { data, error } = await sb!
        .from("question_stances")
        .select("created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as { created_at: string }[];
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // ── Q3: Streak computation (client-side) ──────────────────────────────────────
  // v1 uses browser-local day boundaries via toDateString().
  // Multiple stances on the same local calendar day count as 1 streak day.
  // Known edge case: answering at 11:59pm then 12:01am = 2 streak days — acceptable.
  // Future enhancement: use profile timezone if available.
  const userStreak = React.useMemo((): UserStreak | null => {
    const rows = streakQuery.data;
    if (!rows || rows.length === 0) return null;

    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86_400_000).toDateString();

    const distinctDays = [
      ...new Set(rows.map((r) => new Date(r.created_at).toDateString())),
    ].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    const answeredToday = distinctDays[0] === today;
    const answeredYesterday = distinctDays.includes(yesterday);

    // Count consecutive days backwards from today or yesterday
    let streak = 0;
    const startDay = answeredToday ? today : answeredYesterday ? yesterday : null;
    if (!startDay) return { currentStreak: 0, answeredToday: false, isAtRisk: false };

    let cursor = new Date(startDay);
    for (const day of distinctDays) {
      if (new Date(day).toDateString() === cursor.toDateString()) {
        streak++;
        cursor = new Date(cursor.getTime() - 86_400_000);
      } else {
        break;
      }
    }

    return {
      currentStreak: streak,
      answeredToday,
      isAtRisk: !answeredToday && answeredYesterday && streak > 1,
    };
  }, [streakQuery.data]);

  // ── Epic E: Personal analytics query ─────────────────────────────────────────
  // Derives regionScope/regionKey from existing regionLabel state.
  // regionLabel = "Global" → scope='global', key='Global'
  // regionLabel = "United States" → scope='country', key='United States'
  const paRegionScope = regionLabel === "Global" ? "global" : "country";
  const paRegionKey   = regionLabel; // matches question_stance_stats_region.region_key

  const personalAnalyticsQuery = useQuery({
    enabled: !!sb && !!userId,
    queryKey: ["home-personal-analytics", userId, paRegionScope, paRegionKey],
    queryFn: async (): Promise<PersonalAnalyticsResponse> => {
      const { data, error } = await sb!.rpc("get_my_personal_analytics", {
        p_region_scope: paRegionScope,
        p_region_key:   paRegionKey,
        p_days: 90,
      }).single();
      if (error) throw error;
      return buildPersonalAnalyticsResponse(data);
    },
    staleTime: 2 * 60_000,
    retry: false, // fail silently — card hides on error
  });

  // ── Q2: Return nudge derivation (client-side, zero new queries) ───────────────
  // Derives single highest-priority nudge from already-running queries.
  // Priority: minority_shift > opinion_shift > new_in_topics > answer_more.
  // Zero-answer users: all nudges gated out ("Where You Stand" handles onboarding).
  const returnNudge = React.useMemo((): ReturnNudge | null => {
    const totalAnswered = myStanceSnapshotQuery.data?.totalAnswered ?? 0;
    if (totalAnswered === 0) return null;

    // Priority 1: user holds minority view
    const snap = whereYouStandQuery.data;
    if (snap?.minority_count > 0 && snap.most_divergent_question_id) {
      return {
        type: "minority_shift",
        title: "You may be in the minority",
        body: "Public opinion moved away from your position on a question you answered.",
        ctaLabel: "See question",
        href: `/q/${snap.most_divergent_question_id}`,
      };
    }

    // Priority 2: community opinion shifted on an answered question
    const reopened = (reopenedQuery.data ?? [])[0];
    if (reopened) {
      return {
        type: "opinion_shift",
        title: "Public opinion moved since you answered",
        body: "The community balance changed on one of your questions.",
        ctaLabel: "See update",
        href: `/q/${reopened.question_id}`,
      };
    }

    // Priority 3: new questions in engaged topics
    const continuing = (continuingQuery.data ?? [])[0];
    if (continuing) {
      return {
        type: "new_in_topics",
        title: "New questions in your topics",
        body: "Fresh questions appeared in areas where you've already shared your stance.",
        ctaLabel: "Explore",
        href: continuing.topic_id
          ? `/topics/${continuing.topic_id}`
          : `/q/${continuing.question_id}`,
      };
    }

    // Priority 4: answer-more fallback (only for low-data, non-zero users)
    if (totalAnswered < 3) {
      return {
        type: "answer_more",
        title: "Build your stance profile",
        body: "Answer a few more questions to unlock stronger insight about where you stand.",
        ctaLabel: "Answer more",
        href: "/",
      };
    }

    return null;
  }, [
    whereYouStandQuery.data,
    reopenedQuery.data,
    continuingQuery.data,
    myStanceSnapshotQuery.data,
  ]);

  // ── update_last_seen on homepage mount ────────────────────────────────────────
  // Called 2s after mount so the sinceLastVisitQuery fires and renders first.
  // update_last_seen() writes profiles.last_seen_at, which get_since_last_visited()
  // reads on next visit — must run AFTER the query, not before.
  React.useEffect(() => {
    if (!sb || !userId) return;
    const t = setTimeout(async () => {
      try { await sb.rpc("update_last_seen"); } catch { /* silent */ }
    }, 2000);
    return () => clearTimeout(t);
  }, [sb, userId]);

  // ── Infinite queries (all preserved exactly) ──
  // NOTE: heroStatsQuery and featuredStatsQuery are defined after trendingQuestions
  // is available (below the infinite queries), using derived heroQ / featuredQ IDs.

  const canTrendingNational =
    !!sb && !!userId && !!countryLabel && !!COUNTRY_LOCATION_ID && !locationIdsLoading;
  const canTrendingGlobal =
    !!sb && !!userId && !!GLOBAL_LOCATION_ID && !locationIdsLoading;

  // DEBUG: log feed gate values when key vars change
  React.useEffect(() => {
    console.log("[FeedDebug]", {
      sb: !!sb,
      userId,
      countryLabel,
      globalLabel,
      GLOBAL_LOCATION_ID,
      COUNTRY_LOCATION_ID,
      locationIdsLoading,
      canTrendingNational,
      canTrendingGlobal,
      sessionResolved,
      isAuthed,
    });
  }, [!!sb, userId, countryLabel, globalLabel, GLOBAL_LOCATION_ID, COUNTRY_LOCATION_ID, locationIdsLoading, canTrendingNational, canTrendingGlobal, sessionResolved, isAuthed]); // eslint-disable-line react-hooks/exhaustive-deps

  const trendingQuestionsNationalQuery = useInfiniteQuery({
    enabled: canTrendingNational,
    queryKey: [
      "home-trending-questions",
      "national",
      userId,
      countryLabel,
      COUNTRY_LOCATION_ID,
    ],
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: TrendingHomepageQuestionRow[],
      _allPages: TrendingHomepageQuestionRow[][],
      lastPageParam: number
    ) => (lastPage.length < 10 ? undefined : lastPageParam + 10),
    queryFn: async ({ pageParam = 0 }) => {
      const { data, error } = await sb!.rpc("get_trending_questions_homepage", {
        p_user_id: userId,
        p_region_scope: "country",
        p_region_key: countryLabel,
        p_location_id: COUNTRY_LOCATION_ID,
        p_limit: 10,
        p_offset: pageParam,
      });
      if (error) throw error;
      return await hydrateCoversForTrendingRows(
        (data ?? []) as TrendingHomepageQuestionRow[]
      );
    },
    staleTime: 30_000,
  });

  const trendingQuestionsGlobalQuery = useInfiniteQuery({
    enabled: canTrendingGlobal,
    queryKey: ["home-trending-questions", "global", userId, GLOBAL_LOCATION_ID],
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: TrendingHomepageQuestionRow[],
      _allPages: TrendingHomepageQuestionRow[][],
      lastPageParam: number
    ) => (lastPage.length < 10 ? undefined : lastPageParam + 10),
    queryFn: async ({ pageParam = 0 }) => {
      console.log("[FeedDebug] global queryFn firing", { userId, globalLabel, GLOBAL_LOCATION_ID, pageParam });
      const { data, error } = await sb!.rpc("get_trending_questions_homepage", {
        p_user_id: userId,
        p_region_scope: "global",
        p_region_key: globalLabel,
        p_location_id: GLOBAL_LOCATION_ID,
        p_limit: 10,
        p_offset: pageParam,
      });
      console.log("[FeedDebug] global queryFn result", { count: data?.length, error });
      if (error) throw error;
      return await hydrateCoversForTrendingRows(
        (data ?? []) as TrendingHomepageQuestionRow[]
      );
    },
    staleTime: 30_000,
  });

  const anonTrendingQuery = useInfiniteQuery({
    enabled: !!sb && !isAuthed,
    queryKey: ["home-questions-anon", regionLabel],
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: AnonQuestionRow[],
      _allPages: AnonQuestionRow[][],
      lastPageParam: number
    ) => (lastPage.length < 10 ? undefined : lastPageParam + 10),
    queryFn: async ({ pageParam = 0 }) => {
      const q = sb!
        .from("v_live_questions")
        .select(
          "id, question, summary, tags, location_label, origin_location_label, audience_location_label, published_at, status, cover_image_url"
        )
        .order("published_at", { ascending: false })
        .range(pageParam, pageParam + 9);

      if (regionLabel !== "Global") {
        const eligible =
          regionLabel === "United States"
            ? ["United States", "Global"]
            : [regionLabel, "Global"];
        q.or(
          `audience_location_label.in.(${eligible
            .map((x) => `"${x}"`)
            .join(",")}),audience_location_label.is.null`
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AnonQuestionRow[];
    },
    staleTime: 60_000,
  });

  // ── Fallback feed — "any unanswered live question" safety net ──────────────
  // Placed here (after trending queries) so trendingQuestionsNationalQuery and
  // trendingQuestionsGlobalQuery are already declared before being referenced.
  // Enabled only when both primary feeds finished loading with zero unanswered
  // questions — prevents blank hero when audience_location_label mismatch causes
  // the scoped feed to return no eligible content.
  const primaryUnanswered = React.useMemo(
    () => (trendingQuestionsNationalQuery.data?.pages.flat() ?? [])
            .concat(trendingQuestionsGlobalQuery.data?.pages.flat() ?? [])
            .filter((q) => !q.user_has_answered || q.is_new_phase),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trendingQuestionsNationalQuery.data, trendingQuestionsGlobalQuery.data]
  );

  const needsFallback =
    !!sb &&
    !!userId &&
    !locationIdsLoading &&
    !trendingQuestionsNationalQuery.isLoading &&
    !trendingQuestionsGlobalQuery.isLoading &&
    primaryUnanswered.length === 0;

  const fallbackFeedQuery = useQuery({
    enabled: needsFallback,
    queryKey: ["home-fallback-feed", userId],
    queryFn: async (): Promise<FallbackQuestionRow[]> => {
      console.log("[FeedDebug] fallback queryFn firing", { userId, needsFallback });
      const { data, error } = await sb!
        .from("v_live_questions")
        .select("id, question, summary, tags, location_label, origin_location_label, audience_location_label, cover_image_url, topic_title")
        .order("published_at", { ascending: false })
        .limit(15);
      if (error) throw error;

      const rows = (data ?? []) as FallbackQuestionRow[];

      // Client-side filter: exclude questions the user has already answered.
      const { data: answeredData } = await sb!
        .from("question_stances")
        .select("question_id")
        .eq("user_id", userId!);
      const answeredIds = new Set((answeredData ?? []).map((r: any) => r.question_id as string));
      return rows.filter((r) => !answeredIds.has(r.id));
    },
    staleTime: 60_000,
  });

  // ── Flatten pages ──
  const trendingQuestions =
    regionTab === "country"
      ? (trendingQuestionsNationalQuery.data?.pages.flat() ?? [])
      : (trendingQuestionsGlobalQuery.data?.pages.flat() ?? []);
  const anonQuestions = anonTrendingQuery.data?.pages.flat() ?? [];

  // ── Infinite scroll controls ──
  const activeAuthedQuery =
    regionTab === "country"
      ? trendingQuestionsNationalQuery
      : trendingQuestionsGlobalQuery;

  const isFetchingNextPage = isAuthed
    ? activeAuthedQuery.isFetchingNextPage
    : anonTrendingQuery.isFetchingNextPage;
  const hasNextPage = isAuthed
    ? activeAuthedQuery.hasNextPage
    : anonTrendingQuery.hasNextPage;
  const fetchNextPage = isAuthed
    ? activeAuthedQuery.fetchNextPage
    : anonTrendingQuery.fetchNextPage;

  // ── Fallback mode derivation ──
  // Priority: primary scoped feed → global feed → any-unanswered fallback → empty.
  // isFallbackMode = true when hero is showing questions outside the user's normal scope.
  const globalFeedQuestions = trendingQuestionsGlobalQuery.data?.pages.flat() ?? [];
  const globalUnanswered = globalFeedQuestions.filter((q) => !q.user_has_answered || q.is_new_phase);

  const fallbackRows: TrendingHomepageQuestionRow[] = (fallbackFeedQuery.data ?? []).map((r) => ({
    question_id: r.id,
    question_text: r.question,
    summary: r.summary,
    tags: r.tags,
    topic_id: null,
    topic_title: r.topic_title,
    tier: null,
    location_label: r.location_label,
    origin_location_label: r.origin_location_label,
    audience_location_label: r.audience_location_label,
    user_has_answered: false,
    trend_micro_signal: null,
    trend_score: null,
    stance_momentum: null,
    topic_momentum: null,
    cover_image_url: r.cover_image_url,
    impact_normalized: null,
  }));

  const finalHeroQuestions: TrendingHomepageQuestionRow[] = (() => {
    if (!isAuthed) return []; // anon path uses anonQuestions, not this
    if (primaryUnanswered.length > 0) return trendingQuestions;
    if (regionTab === "country" && globalUnanswered.length > 0) return globalFeedQuestions;
    if (fallbackRows.length > 0) return fallbackRows;
    return trendingQuestions; // fall through to caught-up state
  })();

  const isFallbackMode =
    isAuthed &&
    primaryUnanswered.length === 0 &&
    (globalUnanswered.length > 0 || fallbackRows.length > 0);

  // ── Loading states ──
  // Wait for session to resolve before trusting isLoading for anon users.
  // Without this, the hero stays in hero_loading forever when the session
  // check hasn't completed yet and the anonTrendingQuery fires then gets disabled.
  const anonIsLoading = !sessionResolved || anonTrendingQuery.isLoading;
  const anonIsError = anonTrendingQuery.isError;
  const authedIsLoading =
  !sessionResolved ||
  locationIdsLoading ||
  trendingQuestionsNationalQuery.isLoading ||
  trendingQuestionsGlobalQuery.isLoading;

  // ── Question distribution into hero / featured / grid ──
  //
  // Hero: trendingQuestions[0] — used by HeroQuestionModule (state machine)
  // Featured: Rule 3 eligibility — must have cover_image_url, title ≤ 120 chars,
  //           prefer summary present. Falls back to [1] if no eligible candidate.
  // Grid: everything else after hero + featured
  const heroQ = trendingQuestions[0] ?? null;

  const isFeaturedEligible = (q: TrendingHomepageQuestionRow) =>
    !!q.cover_image_url &&
    q.question_text.length <= 120 &&
    !!q.summary;

  const featuredQ =
    trendingQuestions.find((q, i) => i > 0 && isFeaturedEligible(q)) ??
    trendingQuestions.find((q, i) => i > 0 && !!q.cover_image_url) ??
    trendingQuestions[1] ??
    null;

  const gridQs = trendingQuestions.filter(
    (q) => q !== heroQ && q !== featuredQ
  );

  // Anon splits (cover_image_url preferred for featured, no strict guard needed)
  const featuredAnonQ =
    anonQuestions.find((q, i) => i > 0 && !!q.cover_image_url) ??
    anonQuestions[1] ??
    null;
  const gridAnonQs = anonQuestions.filter((q) => q !== featuredAnonQ);

  // ── Rule 4: Preload stats for hero + featured slots ──
  // Grid card stats are lazy-loaded by the slider itself on demand.
  // ── Rule 4: Stats preload for hero + featured slots ──
  // Uses get_question_stats_for_user — same RPC as QuestionDetailPage
  const heroStatsQuery = useQuery({
    enabled: !!sb && !!userId && !!heroQ?.question_id,
    queryKey: ["home-hero-stats", heroQ?.question_id, regionLabel],
    retry: false,
    queryFn: async (): Promise<QuestionStats | null> => {
      if (!sb || !heroQ?.question_id) return null;
      try {
        const { data, error } = await sb.rpc("get_question_stats_for_user", {
          p_question_id: heroQ.question_id,
        });
        if (error) throw error;
        return (data as QuestionStats) ?? null;
      } catch { return null; }
    },
    staleTime: 60_000,
  });

  const featuredStatsQuery = useQuery({
    enabled: !!sb && !!userId && !!featuredQ?.question_id && featuredQ?.question_id !== heroQ?.question_id,
    queryKey: ["home-featured-stats", featuredQ?.question_id, regionLabel],
    retry: false,
    queryFn: async (): Promise<QuestionStats | null> => {
      if (!sb || !featuredQ?.question_id) return null;
      try {
        const { data, error } = await sb.rpc("get_question_stats_for_user", {
          p_question_id: featuredQ.question_id,
        });
        if (error) throw error;
        return (data as QuestionStats) ?? null;
      } catch { return null; }
    },
    staleTime: 60_000,
  });

  // ── Instant feedback state ──
  const [feedback, setFeedback] = React.useState<QuestionDistributionRow | null>(null);
  const [anonLastValue, setAnonLastValue] = React.useState<number | null>(null);

  const fetchDistribution = React.useCallback(
    async (questionId: string) => {
      if (!sb) return;
      try {
        const { data, error } = await sb.rpc("get_question_distribution", {
          p_question_id: questionId,
          p_region: regionLabel,
          p_window_hours: 168,
        });
        if (error) throw error;
        const row =
          Array.isArray(data) && data.length > 0
            ? (data[0] as QuestionDistributionRow)
            : null;
        setFeedback(row);
      } catch (e) {
        console.warn("get_question_distribution failed", e);
      }
    },
    [sb, regionLabel]
  );

  // ── Stance submit ──
  // Keep the hero save contract tight: resolve once the stance RPC succeeds.
  // Follow-up refreshes should run in the background so the controller can leave
  // hero_submitting immediately after a real save instead of waiting on every
  // homepage invalidation/refetch to settle.
  const submitStance = React.useCallback(
    async (questionId: string, value: number) => {
      if (!sb) {
        throw new Error("Supabase client not ready");
      }
      if (!userId) {
        const returnTo = window.location.hash || "#/";
        sessionStorage.setItem("return_to", returnTo);
        navigate("/login");
        return;
      }

      // Raw fetch with JWT from React session state — avoids sb.rpc() which
      // calls getSession() internally and can block on background token refresh.
      const jwt = session?.access_token;
      if (!jwt) throw new Error("No active session");
      const supabaseUrl = (sb as any).supabaseUrl as string;
      const anonKey    = (sb as any).supabaseKey as string;

      console.log(
        `[home:submit] START qId=${questionId.slice(0, 8)} userId=${userId.slice(0, 8)} value=${value}`
      );

      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/set_question_stance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": anonKey,
          "Authorization": `Bearer ${jwt}`,
        },
        body: JSON.stringify({ p_question_id: questionId, p_score: value }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("[home:submit] HTTP ERROR", res.status, body);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }

      const data = await res.json().catch(() => null);
      console.log("[home:submit] RPC OK", { questionId, value, data });

      // Same-tab fast path — hero/QDP listeners can react immediately.
      window.dispatchEvent(
        new CustomEvent("stance-saved", {
          detail: { questionId, value },
        })
      );

      // Refresh local community distribution without blocking the resolved save.
      void fetchDistribution(questionId);

      // Invalidate related homepage data in the background.
      void Promise.allSettled([
        qc.invalidateQueries({ queryKey: ["home-where-you-stand", userId, regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-because-you", userId, regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-reopened", userId, regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-participation", regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-society-pulse", regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-media-surge", regionLabel] }),
        qc.invalidateQueries({ queryKey: ["home-trending-questions"] }),
        qc.invalidateQueries({ queryKey: ["home-my-stance-snapshot", userId] }),
        qc.invalidateQueries({ queryKey: ["home-streak", userId] }),
        qc.invalidateQueries({ queryKey: ["home-personal-analytics", userId, paRegionScope, paRegionKey] }),
        // Note: home-since-last-visit intentionally NOT invalidated on submit.
        // Last visit timestamp hasn't changed from answering — let staleTime expire.
      ]).then((results) => {
        console.log("[home:submit] background invalidations settled", results);
      });

      console.log(`[home:submit] DONE qId=${questionId.slice(0, 8)} value=${value}`);

      // Q5 — check if this stance triggers a contribution acknowledgement
      // Fire-and-forget: runs in background, shows toast if threshold met
      void checkForAcknowledgement().then((ack?: any) => {
        if (ack && ack.should_show && ack.message) {
          toast(ack.message, {
            description: ack.secondary_text ?? undefined,
            duration: 4000,
          });
        }
      }).catch(() => { /* silent — ack is non-critical */ });
    },
    [sb, session, userId, qc, navigate, regionLabel, fetchDistribution]
  );

  const redirectToLogin = React.useCallback(
    (reason: "take_stances" | "generic" = "generic") => {
      const returnTo = window.location.hash || "#/";
      sessionStorage.setItem("return_to", returnTo);
      sessionStorage.setItem("login_reason", reason);
      navigate("/login");
    },
    [navigate]
  );

  const loginRedirect = () => redirectToLogin("take_stances");

  // ── Impression recording (unchanged) ──
  React.useEffect(() => {
    if (!sb || !userId) return;
    const ids = trendingQuestions.slice(0, 5).map((x) => x.question_id);
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      for (const qid of ids) {
        if (cancelled) break;
        try {
          await sb.rpc("record_question_view", {
            p_user_id: userId,
            p_question_id: qid,
          });
        } catch {
          // non-blocking
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sb, userId, trendingQuestions]);

  // ── IntersectionObserver for infinite scroll (unchanged) ──
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const goToQuestion = (id: string) => navigate(`/q/${id}`);

  // ─────────────────────────── Render ────────────────────────────────────────
  return (
    <PageLayout rightSlot={actions}>
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-5xl px-4 py-6">

          {/* ── Band 1 + 2 — New Hero Section (A/B/C) ── */}
          <HeroSection
            allQuestions={isAuthed ? finalHeroQuestions : anonQuestions.map((q) => ({
              question_id: q.id,
              question_text: q.question,
              summary: q.summary,
              tags: q.tags,
              topic_id: null,
              topic_title: null,
              tier: null,
              location_label: q.location_label,
              origin_location_label: q.origin_location_label,
              audience_location_label: q.audience_location_label,
              user_has_answered: false,
              trend_micro_signal: null,
              trend_score: null,
              stance_momentum: null,
              topic_momentum: null,
              cover_image_url: q.cover_image_url,
              impact_normalized: null,
            }))}
            isLoading={isAuthed ? authedIsLoading : anonIsLoading}
            isAuthed={isAuthed}
            regionLabel={regionLabel}
            isFallbackMode={isFallbackMode}
            alignmentSnap={whereYouStandQuery.data ?? null}
            alignmentSnapLoading={whereYouStandQuery.isLoading}
            societalPulseChips={(() => {
              // Use RPC chips if available
              const rpcChips = societyPulseQuery.data?.chips ?? [];
              if (rpcChips.length > 0) return rpcChips;
              // Fallback: derive chips from myStanceSnapshot topics (already fetched)
              // This works whenever the user has answered questions.
              const snapshotTopics = myStanceSnapshotQuery.data?.topics ?? [];
              if (snapshotTopics.length > 0) {
                return snapshotTopics.slice(0, 5).map((t, i) => ({
                  topic_id: `local-${i}`,
                  title: t.topicTitle,
                  icon: (
                    t.scorePct >= 50 ? "up"
                    : t.scorePct <= -30 ? "polarized"
                    : t.avgScore > 0 ? "up"
                    : "steady"
                  ) as "up" | "reawakening" | "polarized" | "steady",
                  href: "/topics",
                }));
              }
              return [];
            })()}
            myStanceSnapshot={myStanceSnapshotQuery.data ?? null}
            sinceLastVisit={sinceLastVisitQuery.data ?? null}
            sinceLastVisitLoading={sinceLastVisitQuery.isLoading}
            returnNudge={returnNudge}
            streak={userStreak}
            onRequestReplenish={fetchNextPage}
            onSubmitSuccess={submitStance}
            onLoginRedirect={loginRedirect}
            onNavigateToQuestion={goToQuestion}
            onLogin={() => navigate("/login")}
            onSignup={() => navigate("/signup")}
          />

          {/* ── Region tabs — Bands 3-6 ── */}
          <Tabs
            value={regionTab}
            onValueChange={(v) => setRegionTab(v as any)}
            className="w-full mt-6"
          >
            <TabsList>
              {hasCountry && (
                <TabsTrigger value="country">{countryLabel}</TabsTrigger>
              )}
              <TabsTrigger value="global">Global</TabsTrigger>
            </TabsList>

            <TabsContent value={regionTab} className="mt-5 space-y-5">

              {/* ── Band 3 — Since You Last Visited (authed only) ── */}
              {isAuthed && (
                <SinceYouLastVisited
                  continuingData={continuingQuery.data ?? []}
                  reopenedData={reopenedQuery.data ?? []}
                  isLoading={continuingQuery.isLoading || reopenedQuery.isLoading}
                />
              )}

              {/* ── Band 4 — Society Right Now ── */}
              {societyPulseQuery.isError ? (
                <ErrorFallback message="Failed to load Society Pulse. Please refresh the page." />
              ) : (
                <SocietyRightNow pulse={societyPulseQuery.data ?? null} />
              )}

              {/* Media surge sits below Society Right Now */}
              {!mediaSurgeQuery.isError && (
                <MediaSurgeCard media={mediaSurgeQuery.data ?? null} />
              )}

              {/* Participation strip */}
              {participationQuery.isError ? (
                <ErrorFallback message="Failed to load participation stats. Please refresh the page." />
              ) : (
                <ParticipationStrip stats={participationQuery.data ?? null} />
              )}

              {/* Where you stand (authed) */}
              {isAuthed && (
                <WhereYouStandCard snap={whereYouStandQuery.data ?? null} />
              )}

              {/* ── Epic E — Personal Analytics (authed only) ── */}
              {isAuthed && (
                <PersonalAnalyticsCard
                  data={personalAnalyticsQuery.data ?? null}
                  isLoading={personalAnalyticsQuery.isLoading}
                  isError={personalAnalyticsQuery.isError}
                />
              )}

              {/* ── Band 5 — Add Your Voice ── */}
              <section className="space-y-5">
                <SectionHeader
                  title="✋ Add your voice"
                  subtitle="High-momentum questions shaping the signal right now."
                />

                {/* A. Featured question — large editorial card */}
                {isAuthed ? (
                  authedIsLoading ? (
                    <CardSkeleton lines={4} />
                  ) : featuredQ ? (
                    <FeaturedQuestionCard
                      q={featuredQ}
                      isAuthed={true}
                      onSubmit={submitStance}
                      onLoginRedirect={loginRedirect}
                      onOpen={goToQuestion}
                      featuredStats={featuredStatsQuery.data ?? null}
                    />
                  ) : null
                ) : anonIsLoading ? (
                  <CardSkeleton lines={4} />
                ) : featuredAnonQ ? (
                  <FeaturedQuestionCardAnon
                    q={featuredAnonQ}
                    onLoginRedirect={loginRedirect}
                    onOpen={goToQuestion}
                  />
                ) : null}

                {/* B. 2-column question grid */}
                {isAuthed ? (
                  authedIsLoading ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {[1, 2, 3, 4].map((i) => (
                        <CardSkeleton key={i} lines={3} />
                      ))}
                    </div>
                  ) : gridQs.length === 0 && !featuredQ ? (
                    <div className={`${card} p-4 text-sm text-slate-500`}>
                      No questions available right now. Check back soon.
                    </div>
                  ) : gridQs.length === 0 ? (
                    <div className={`${card} p-4 text-sm text-slate-500`}>
                      More questions are on the way. Check back soon.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {gridQs.map((q) => (
                        <GridQuestionCard
                          key={q.question_id}
                          q={q}
                          isAuthed={true}
                          onSubmit={submitStance}
                          onLoginRedirect={loginRedirect}
                          onOpen={goToQuestion}
                        />
                      ))}
                    </div>
                  )
                ) : anonIsLoading ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {[1, 2, 3, 4].map((i) => (
                      <CardSkeleton key={i} lines={3} />
                    ))}
                  </div>
                ) : anonIsError ? (
                  <ErrorFallback message="Failed to load questions. Please refresh the page." />
                ) : gridAnonQs.length === 0 ? (
                  <div className={`${card} p-4 text-sm text-slate-500`}>
                    No questions available right now. Check back soon.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {gridAnonQs.map((q) => (
                      <GridQuestionCardAnon
                        key={q.id}
                        q={q}
                        onLoginRedirect={loginRedirect}
                        onOpen={goToQuestion}
                      />
                    ))}
                  </div>
                )}

                {/* Infinite scroll sentinel (unchanged) */}
                <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

                {isFetchingNextPage && (
                  <div className="flex justify-center py-6">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                  </div>
                )}

                {!hasNextPage &&
                  (trendingQuestions.length > 1 || anonQuestions.length > 1) && (
                    <p className="py-4 text-center text-xs text-slate-400">
                      You've seen all available questions
                    </p>
                  )}
              </section>

              {/* ── Band 6 — Continuing conversation (authed) ── */}
              {isAuthed && (
                <section className="space-y-3">
                  <SectionHeader
                    title="Continuing the conversation"
                    subtitle="Recommended based on your recent signals."
                  />
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(continuingQuery.data ?? []).slice(0, 4).map((r) => (
                      <div key={r.question_id} className={`${card} p-4`}>
                        <Link
                          to={`/q/${r.question_id}`}
                          className="font-semibold text-slate-900 line-clamp-2 hover:underline text-sm leading-snug"
                        >
                          {r.question_text}
                        </Link>
                        {r.topic_title && (
                          <p className="mt-1 text-xs text-slate-400">
                            Topic: {r.topic_title}
                          </p>
                        )}
                        {r.reason && (
                          <p className="mt-2 text-xs text-slate-500 line-clamp-2">
                            {r.reason}
                          </p>
                        )}
                        <div className="mt-3">
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                            onClick={() => goToQuestion(r.question_id)}
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    ))}
                    {(!continuingQuery.data || continuingQuery.data.length === 0) && (
                      <div className={`${card} p-4 text-sm text-slate-500`}>
                        No recommendations yet — answer a few more questions to personalize this.
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* ── Reopened questions (authed) ── */}
              {isAuthed && (
                <section className="space-y-3">
                  <SectionHeader
                    title="Reopened questions"
                    subtitle="Your past signals worth revisiting."
                  />
                  <div className="space-y-3">
                    {(reopenedQuery.data ?? []).map((r) => (
                      <div key={r.question_id} className={`${card} p-4`}>
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            to={`/q/${r.question_id}`}
                            className="min-w-0 font-semibold text-slate-900 line-clamp-2 hover:underline text-sm"
                          >
                            {r.question_text}
                          </Link>
                          <button
                            type="button"
                            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                            onClick={() => goToQuestion(r.question_id)}
                          >
                            Revisit
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {r.public_shift_proxy != null && (
                            <Pill>
                              shift proxy: {Math.round(r.public_shift_proxy * 10) / 10}
                            </Pill>
                          )}
                          {r.reason && <Pill>{r.reason}</Pill>}
                        </div>
                      </div>
                    ))}
                    {(!reopenedQuery.data || reopenedQuery.data.length === 0) && (
                      <div className={`${card} p-4 text-sm text-slate-500`}>
                        Nothing reopened yet — this appears after you've answered and time passes.
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Social proof for anon users */}
              {!isAuthed && (
                <section className="space-y-3">
                  <SectionHeader
                    title="Social proof"
                    subtitle="A quick sense of how many people are participating."
                  />
                  {participationQuery.isError ? (
                    <ErrorFallback message="Failed to load participation stats. Please refresh the page." />
                  ) : (
                    <ParticipationStrip stats={participationQuery.data ?? null} />
                  )}
                </section>
              )}

            </TabsContent>
          </Tabs>
        </div>
      </div>
    </PageLayout>
  );
}
