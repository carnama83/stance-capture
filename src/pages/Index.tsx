// src/pages/Index.tsx
// HOMEPAGE V5 — Restructured (design pass only; all data logic preserved)
//
// What changed vs V4 (design review fixes):
//   1. Every section keeps its slot. Where data is missing, the card states what
//      will land there instead of showing zeros — a new visitor still learns
//      what the product tracks for them ("sample view" ribbon on the profile card).
//   2. The same question set was presented 4× (hero, featured, grid, continuing).
//      Now: hero (HeroSection) + ONE feed ("Add your voice") + a compact
//      "Worth revisiting" list. No parallel presentations of the same rows.
//   3. "Where you stand" + "Society right now" + "Personal analytics" +
//      participation + media surge merged into ONE tabbed "You vs. society" card.
//   4. Single colour system:
//        · stance   = teal → grey → ochre (diverging, non-editorial)
//        · brand    = indigo, interactive elements ONLY
//        · momentum = 3 states, always dot + WORD (never colour alone)
//        · neutrals = 4 steps; metadata never below 12px
//   5. Unanswered sliders carry an explicit "Drag to take a position" hint so an
//      untouched control never reads as "already answered".
//   6. Dead code removed: HeroCta, HeroWelcome, HeroQuestionModule (which also
//      referenced an undefined `submittingQuestionId`), InstantFeedbackCard,
//      unused `anonLastValue` state.
//
// UNCHANGED (verified line-by-line):
//   - every query / RPC / queryKey / staleTime / retry policy
//   - infinite scroll pagination (national / global / anon) + sentinel observer
//   - region tabs (country / global) + IP country detection for anon
//   - submitStance (raw fetch + JWT, cache patch, invalidations, ack toast)
//   - anonymous staging (recordWebStance) + HomeOptInPrompt
//   - cover image hydration safety net, fallback feed, isFallbackMode
//   - record_question_view impressions, update_last_seen
//   - streak / return nudge / since-last-visit derivations
//   - scroll-collapse answered cards, cardStats, distribution fetch

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";

import PageLayout from "@/components/PageLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSupabase } from "@/lib/supabaseClient";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { recordWebStance } from "@/lib/webStance";
import { HomeOptInPrompt } from "@/components/HomeOptInPrompt";
import { QuestionCoverImage } from "@/components/question/QuestionCoverImage";
import { StanceDistributionBar } from "@/components/question/StanceDistributionBar";
import { useGlobalAndCountryIds } from "@/hooks/useLocationIds";
import { HeroSection } from "@/components/hero/HeroSection";
import { useContributionAcknowledgement } from "@/hooks/useContributionAcknowledgement";
import { useIPLocation } from "@/hooks/useIPLocation";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";
import { toast } from "sonner";

// ─────────────────────────── Colour system (single source) ───────────────────
// Four roles, no overlap. Stance is a teal→grey→ochre diverging scale rather
// than red/green (right vs. wrong) or red/blue (party colours): a civic product
// must not editorialise which end of a slider is correct.
const C = {
  ink: "#131A24",
  body: "#5A6472",
  meta: "#8A93A1",
  line: "#E4E7EC",
  hairline: "#EDEFF2",
  surface: "#FFFFFF",
  page: "#F1F2F5",
  wash: "#F7F8FA",
  brand: "#3F3BC9",
  brandWash: "#EFEEFB",
  stanceLow: "#0E8C7F",
  stanceMid: "#C3C9D2",
  stanceHigh: "#C4661C",
  rising: "#0E8C7F",
  polarising: "#8C4A9E",
  steady: "#C3C9D2",
} as const;

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
  slider_low_label?: string | null;
  slider_high_label?: string | null;
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
  slider_low_label?: string | null;
  slider_high_label?: string | null;
};

// FallbackQuestionRow — returned by the "any unanswered live question" safety-net query.
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
  slider_low_label?: string | null;
  slider_high_label?: string | null;
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
  comparable_count: number;
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

// TopicStanceItem — topic-level stance history, sourced from get_my_stance_snapshot
export type TopicStanceItem = {
  topicTitle: string;
  avgScore: number;
  answerCount: number;
  scorePct: number; // Math.round((avgScore / 2) * 100), range -100..+100
  latestScore?: number | null;
  latestLowLabel?: string | null;
  latestHighLabel?: string | null;
};

export type MyStanceSnapshot = {
  totalAnswered: number;
  topics: TopicStanceItem[];
  alignmentLabel: string;
};

// ─── Epic Q — Habit/Retention types ──────────────────────────────────────────

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
  is_first_visit?: boolean;
  has_changes: boolean;
  changes: SinceLastVisitChange[];
  region: { scope: string; label: string };
};

type ReturnNudgeType = "minority_shift" | "opinion_shift" | "new_in_topics" | "answer_more";

type ReturnNudge = {
  type: ReturnNudgeType;
  title: string;
  body: string;
  ctaLabel: string;
  href: string;
};

type UserStreak = {
  currentStreak: number;
  answeredToday: boolean;
  isAtRisk: boolean;
};

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

// ─── Epic E helpers (unchanged) ───────────────────────────────────────────────

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

  if (abs !== null) {
    if (abs >= 1.35) tags.push("Strong convictions");
    else if (abs >= 0.75) tags.push("Moderate convictions");
    else tags.push("Nuanced responses");
  }

  if (divRate !== null) {
    if (divRate >= 0.45) tags.push("Often diverges from consensus");
    else if (divRate >= 0.20) tags.push("Sometimes diverges from consensus");
    else tags.push("Often aligns with consensus");
  }

  if (conc !== null) {
    if (conc >= 0.60) tags.push("Focused on a few topics");
    else if (topicsAnswered >= 4) tags.push("Broad across topics");
  }

  if (cons !== null) {
    if (cons >= 0.70) tags.push("Consistent stance pattern");
    else if (cons < 0.45) tags.push("Varied stance pattern");
  }

  return tags.slice(0, 3);
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

// QuestionStats — passed to slider for alignment messaging
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

// Shared card surface
const card = "bg-white rounded-2xl shadow-sm ring-1 ring-slate-900/5";

// ─────────────────────────── Small UI atoms ──────────────────────────────────

// Topic tag — indigo is reserved for interactive things, so the primary tag is
// indigo-on-wash (it links into a topic); secondary tags are neutral.
function Tag({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-[3px] text-xs font-semibold"
      style={
        primary
          ? { color: C.brand, background: C.brandWash }
          : { color: C.body, background: "#F4F5F7", fontWeight: 400 }
      }
    >
      {children}
    </span>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-[3px] text-xs"
      style={{ color: C.body, background: "#F4F5F7" }}
    >
      {children}
    </span>
  );
}

// Momentum — exactly 3 states, always a dot AND a word, so it survives
// colour-blindness and greyscale print. Replaces the old 5-colour SignalPill.
type Momentum = "rising" | "polarising" | "steady";

function toMomentum(signal: string | null | undefined): Momentum | null {
  if (!signal) return null;
  const s = signal.toLowerCase();
  if (s.includes("polar")) return "polarising";
  if (
    s.includes("media") || s.includes("surge") || s.includes("organic") ||
    s.includes("momentum") || s.includes("trend") || s.includes("rising")
  ) return "rising";
  return "steady";
}

function MomentumTag({ state }: { state: Momentum }) {
  const map: Record<Momentum, { label: string; dot: string; text: string }> = {
    rising:     { label: "Rising",     dot: C.rising,     text: C.rising },
    polarising: { label: "Polarising", dot: C.polarising, text: C.polarising },
    steady:     { label: "Steady",     dot: C.steady,     text: C.meta },
  };
  const m = map[state];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold"
      style={{ color: m.text }}
    >
      <span className="h-[5px] w-[5px] rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-xs font-bold uppercase mb-2"
      style={{ color: C.meta, letterSpacing: "0.14em" }}
    >
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
        <h2
          className="text-xl font-semibold tracking-tight"
          style={{ color: C.ink }}
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-sm" style={{ color: C.body }}>{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function ErrorFallback({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
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

// ─────────────────────────── Sparkline (unchanged maths, new palette) ────────

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
    const y = H - (((p.alignmentScore as number) - minV) / range) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const first = scores[0];
  const last = scores[scores.length - 1];
  const color =
    last > first + 0.03 ? C.stanceLow : last < first - 0.03 ? C.stanceHigh : C.meta;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="flex-shrink-0">
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );
}

// ─────────────────────────── Since you last visited (always visible) ────────
//
// Design note: this strip ALWAYS renders. When there is nothing to report yet
// it states what it will report instead of showing zeros or an empty card —
// a new visitor should still learn that the product tracks this for them.

function SinceLastVisitStrip({
  data,
  loading,
  isAuthed,
  moved,
  totalAnswered,
}: {
  data: SinceLastVisitData | null;
  loading: boolean;
  isAuthed: boolean;
  moved: RevisitItem[];
  totalAnswered: number;
}) {
  const changes = data?.changes ?? [];
  const newResponses = changes.reduce((n, c) => n + (c.new_responses ?? 0), 0);
  const shifted = changes.filter(
    (c) => c.change_type === "shifted_positive" || c.change_type === "shifted_negative"
  ).length;
  const gaining = changes.filter((c) => c.change_type === "gaining_attention").length;
  const hasData = !!data && changes.length > 0;
  // A genuinely first-ever login has nothing to compare "since last visited"
  // against — showing that framing (even correctly, as "Today") implies a
  // prior visit that never happened. Swap the whole label/sub-label for a
  // real welcome instead of just relabeling the time text.
  const isFirstVisit = isAuthed && !!data?.is_first_visit;

  const away =
    data?.days_away == null || data.days_away < 1
      ? "Today"
      : data.days_away === 1
      ? "1 day ago"
      : data.days_away + " days ago";

  return (
    <section className={card + " mb-6 px-5 py-4"}>
      <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
        <div className="min-w-[168px]">
          <p
            className="text-xs font-bold uppercase"
            style={{ color: C.meta, letterSpacing: "0.14em" }}
          >
            {isFirstVisit ? "Welcome to Stance" : "Since you last visited"}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: C.meta }}>
            {loading
              ? "Checking…"
              : isFirstVisit
              ? "Answer your first question to start building your stance profile."
              : isAuthed
              ? away
              : "Tracked once you sign in"}
          </p>
        </div>

        {hasData ? (
          <div className="grid flex-1 grid-cols-1 gap-5 sm:grid-cols-3">
            <SinceStat value={gaining} label="topics gaining attention" />
            <SinceStat value={shifted} label="of your stances moved" />
            <SinceStat value={newResponses} label="new responses where you answered" />
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-3">
            {[
              "Topics gaining attention",
              "Stances that moved into the minority",
              "New responses on questions you answered",
            ].map((t) => (
              <div key={t} className="flex items-start gap-2">
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: C.line }}
                />
                <span className="text-sm leading-snug" style={{ color: C.body }}>
                  {t}
                </span>
              </div>
            ))}
          </div>
        )}

        <Link
          to={isAuthed ? "/topics" : "/signup"}
          className="whitespace-nowrap text-sm font-semibold"
          style={{ color: C.brand }}
        >
          {hasData ? "Catch me up →" : isAuthed ? "Explore topics →" : "Start tracking →"}
        </Link>
      </div>

      {/* Answered questions earn homepage space only when something changed.
          One line each, capped at three — the rest lives in My stances. */}
      {moved.length > 0 && (
        <div className="mt-4 pt-3.5" style={{ borderTop: `1px solid ${C.hairline}` }}>
          <div className="mb-1.5 flex items-baseline justify-between gap-4">
            <p className="text-sm font-semibold" style={{ color: C.ink }}>
              Moved since you answered
            </p>
            <Link to="/my-stances" className="text-xs font-semibold" style={{ color: C.brand }}>
              {totalAnswered > 0 ? `All ${totalAnswered} in My stances →` : "My stances →"}
            </Link>
          </div>
          <div>
            {moved.slice(0, 3).map((item, i) => (
              <Link
                key={item.key}
                to={item.href}
                className="flex items-center gap-4 py-2"
                style={i === 0 ? undefined : { borderTop: `1px solid #F2F4F6` }}
              >
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: C.ink }}>
                  {item.text}
                </span>
                {item.meta && (
                  <span className="hidden shrink-0 text-xs sm:block" style={{ color: C.meta }}>
                    {item.meta}
                  </span>
                )}
                <span className="shrink-0">
                  <MomentumTag state={item.momentum} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SinceStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className="text-2xl font-semibold leading-none tracking-tight tabular-nums"
        style={{ color: C.ink }}
      >
        {formatNum(value)}
      </span>
      <span className="text-sm leading-snug" style={{ color: C.body }}>
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────── The room right now (always visible) ─────────────
//
// Society right now · Media surge · Live participation — three signals that
// belong together, on one row. Each card keeps its slot even before its data
// exists, and says what will land there.

function RoomCard({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div className={card + " flex flex-col p-5"}>
      <p className="text-sm font-semibold" style={{ color: C.ink }}>
        {title}
      </p>
      <p className="mt-1 text-xs leading-snug" style={{ color: C.meta }}>
        {blurb}
      </p>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

function Promise_({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-relaxed" style={{ color: C.body }}>
      {children}
    </p>
  );
}

function TheRoomRightNow({
  pulse,
  media,
  participation,
  regionLabel,
}: {
  pulse: SocietalPulseOutput | null;
  media: MediaSurgeRow | null;
  participation: ParticipationStatsRow | null;
  regionLabel: string;
}) {
  const iconGlyph = (icon: SocietalPulseOutput["chips"][number]["icon"]) => {
    switch (icon) {
      case "reawakening": return "↺";
      case "polarized":   return "⇄";
      case "up":          return "↑";
      default:            return "→";
    }
  };

  const surge = media?.surge_ratio == null ? null : Math.round(media.surge_ratio * 10) / 10;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">

        <RoomCard
          title="Society right now"
          blurb={"Aggregate sentiment across today's questions in " + regionLabel + "."}
        >
          {pulse?.narrative || (pulse?.chips?.length ?? 0) > 0 ? (
            <>
              {pulse?.narrative && (
                <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
                  {pulse.narrative.sentence_1}
                  {pulse.narrative.sentence_2 && (
                    <span style={{ color: C.body }}> {pulse.narrative.sentence_2}</span>
                  )}
                </p>
              )}
              {(pulse?.chips?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {pulse!.chips.slice(0, 3).map((c) => (
                    <Link
                      key={c.topic_id}
                      to={c.href || "/topics/" + c.topic_id}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
                      style={{ color: C.brand, background: C.brandWash }}
                      title={c.title}
                    >
                      <span style={{ color: C.meta }}>{iconGlyph(c.icon)}</span>
                      <span className="line-clamp-1 max-w-[170px]">{c.title}</span>
                    </Link>
                  ))}
                </div>
              )}
              {(pulse?.micro_metrics?.length ?? 0) > 0 && (
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  {pulse!.micro_metrics.slice(0, 3).map((m) => (
                    <Pill key={m.label}>
                      {m.value == null ? m.label : formatNum(m.value) + " " + m.label}
                    </Pill>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Promise_>
              Once the day's questions have responses, this reads the balance back to
              you in a sentence — which way {regionLabel} is leaning, and how thin the
              middle is.
            </Promise_>
          )}
        </RoomCard>

        <RoomCard title="Media surge" blurb="Coverage volume against the 7-day average.">
          {media ? (
            <>
              <p className="line-clamp-2 text-sm font-semibold" style={{ color: C.ink }}>
                {media.cluster_title}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {surge != null && <Pill>{surge}× surge</Pill>}
                <Pill>{media.outlets_24h} outlets · 24h</Pill>
                <Pill>{media.articles_24h} articles · 24h</Pill>
              </div>
              {media.sample_title && (
                <p className="mt-2.5 line-clamp-2 text-sm" style={{ color: C.body }}>
                  {media.sample_title}
                </p>
              )}
              {media.sample_url && (
                <a
                  href={media.sample_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-auto pt-3 text-sm font-semibold"
                  style={{ color: C.brand }}
                >
                  Read the coverage →
                </a>
              )}
            </>
          ) : (
            <Promise_>
              When a story starts running well above its usual volume, it shows up here
              first — so you can take a position before the coverage peaks.
            </Promise_>
          )}
        </RoomCard>

        <RoomCard title="Live participation" blurb="Positions taken across the platform.">
          {participation ? (
            <>
              <div className="flex items-end gap-2">
                <span
                  className="text-4xl font-semibold leading-none tracking-tight tabular-nums"
                  style={{ color: C.ink }}
                >
                  {formatNum(participation.stances_window)}
                </span>
                <span className="pb-1 text-xs" style={{ color: C.meta }}>
                  in the last 24h
                </span>
              </div>
              <div className="mt-4 space-y-2.5">
                {[
                  { label: "signals · 7d", value: participation.stances_7d },
                  { label: "people · 24h", value: participation.unique_users_window },
                ].map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm" style={{ color: C.body }}>{row.label}</span>
                    <span
                      className="text-base font-semibold tabular-nums"
                      style={{ color: C.ink }}
                    >
                      {formatNum(row.value)}
                    </span>
                  </div>
                ))}
              </div>
              <Link
                to="/topics"
                className="mt-auto pt-3 text-sm font-semibold"
                style={{ color: C.brand }}
              >
                Explore all topics →
              </Link>
            </>
          ) : (
            <Promise_>
              Every position taken feeds the counts here. It is the fastest way to see
              whether a question is actually live or already settled.
            </Promise_>
          )}
        </RoomCard>

    </div>
  );
}

// ─────────────────────────── Today's picture (one band, above the feed) ──────
//
// The feed below is unbounded, so anything after it is unreachable in practice.
// The two "state of play" surfaces therefore sit ABOVE it, under one header:
// today's live signals, then where the reader sits inside them.

function TodaysPicture({
  pulse,
  media,
  participation,
  snap,
  analytics,
  snapshot,
  regionLabel,
}: {
  pulse: SocietalPulseOutput | null;
  media: MediaSurgeRow | null;
  participation: ParticipationStatsRow | null;
  snap: AlignmentSnapshotRow | null;
  analytics: PersonalAnalyticsResponse | null;
  snapshot: MyStanceSnapshot | null;
  regionLabel: string;
}) {
  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" style={{ color: C.ink }}>
            Today's picture
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: C.body }}>
            Where {regionLabel} sits right now, and where you sit inside it.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: C.meta }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.rising }} />
          Updating live
        </span>
      </div>

      <TheRoomRightNow
        pulse={pulse}
        media={media}
        participation={participation}
        regionLabel={regionLabel}
      />

      <YouVsSociety
        snap={snap}
        analytics={analytics}
        snapshot={snapshot}
        regionLabel={regionLabel}
      />
    </section>
  );
}

// ─────────────────────────── You vs. society (always visible) ────────────────
//
// Merges WhereYouStandCard · PersonalAnalyticsCard into one card with a
// four-tile band: Your stance profile · Alignment trend · Most divergent topic ·
// Opinion fingerprint. The card is NOT gated — a new account sees the same
// structure behind a "sample view" ribbon so the payoff for answering is legible.

function TileHead({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-bold uppercase"
      style={{ color: C.meta, letterSpacing: "0.1em" }}
    >
      {children}
    </p>
  );
}

function YouVsSociety({
  snap,
  analytics,
  snapshot,
  regionLabel,
}: {
  snap: AlignmentSnapshotRow | null;
  analytics: PersonalAnalyticsResponse | null;
  snapshot: MyStanceSnapshot | null;
  regionLabel: string;
}) {
  const analyticsTier = getPersonalAnalyticsTier(analytics?.totalAnswered ?? 0);
  // A snapshot row can exist and still say nothing (0 comparable questions) —
  // in that case this is still a sample view, not the reader's own numbers.
  const hasAlignment = !!snap && (snap.comparable_count ?? 0) > 0;
  const hasYou = hasAlignment || (!!analytics && analyticsTier !== "empty");

  const fingerprint = analytics?.opinionFingerprint ?? null;
  const trend = analytics?.alignmentTrend ?? null;
  const divergent = analytics?.mostDivergentTopic ?? null;
  const topics = snapshot?.topics ?? [];
  const answered = analytics?.totalAnswered ?? snapshot?.totalAnswered ?? 0;
  const topicsAnswered = analytics?.topicsAnswered ?? topics.length;

  // Fingerprint tiles: one square per answered topic, coloured on the stance scale.
  const fpTiles = topics.slice(0, 18).map((t) => {
    const v = t.avgScore ?? 0;
    return v <= -1 ? C.stanceLow
      : v < -0.3 ? "#6FB6AC"
      : v <= 0.3 ? C.stanceMid
      : v < 1 ? "#E0A578"
      : C.stanceHigh;
  });

  return (
    <section className={card + " overflow-hidden"}>
      {!hasYou && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-2.5 text-xs"
          style={{ background: C.brandWash }}
        >
          <span className="font-semibold" style={{ color: C.brand }}>Sample view</span>
          <span style={{ color: C.body }}>
            These become your own numbers after five answers — nothing here is guessed for you.
          </span>
        </div>
      )}

      <div className="grid gap-0 md:grid-cols-[300px_1fr]">
        <div className="p-5" style={{ borderRight: "1px solid " + C.hairline }}>
          <Eyebrow>You and society</Eyebrow>
          {hasAlignment ? (
            <>
              <div className="flex items-end gap-2">
                <span
                  className="text-5xl font-semibold leading-none tracking-tight"
                  style={{ color: C.ink }}
                >
                  {formatPct(snap.alignment_pct)}
                </span>
                <span className="pb-1.5 text-sm" style={{ color: C.body }}>
                  aligned with {regionLabel}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: C.body }}>
                You hold the minority view on{" "}
                <strong style={{ color: C.ink }}>{snap.minority_count}</strong> of{" "}
                {snap.comparable_count} comparable question
                {snap.comparable_count === 1 ? "" : "s"}.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <span
                  className="text-5xl font-semibold leading-none tracking-tight"
                  style={{ color: C.line }}
                >
                  --%
                </span>
                <span className="pb-1.5 text-sm" style={{ color: C.body }}>
                  aligned with {regionLabel}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: C.body }}>
                One number for how often you land with your region — and the list of
                questions where you do not. It needs five answers to mean anything, so
                it waits until then.
              </p>
            </>
          )}

          {fingerprint && fingerprint.summaryTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {fingerprint.summaryTags.map((t) => (
                <Pill key={t}>{t}</Pill>
              ))}
            </div>
          )}

          {hasAlignment && snap?.most_divergent_question_id && (
            <Link
              to={"/q/" + snap.most_divergent_question_id}
              className="mt-4 inline-flex text-sm font-semibold"
              style={{ color: C.brand }}
            >
              Revisit your most divergent view →
            </Link>
          )}
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <p className="text-sm font-semibold" style={{ color: C.ink }}>
              Where you sit against {regionLabel}
            </p>
            {topics.length > 0 && (
              <Link to="/topics" className="text-xs font-semibold" style={{ color: C.brand }}>
                All {topics.length} topics →
              </Link>
            )}
          </div>

          {topics.length > 0 ? (
            <div className="space-y-4">
              {topics.slice(0, 3).map((t) => {
                const you = Math.max(2, Math.min(98, ((t.avgScore ?? 0) + 2) / 4 * 100));
                const dot = (t.avgScore ?? 0) < -0.3 ? C.stanceLow
                  : (t.avgScore ?? 0) > 0.3 ? C.stanceHigh
                  : C.stanceMid;
                return (
                  <div
                    key={t.topicTitle}
                    className="grid grid-cols-[130px_1fr] items-center gap-4 sm:grid-cols-[190px_1fr_88px]"
                  >
                    <span className="truncate text-sm" style={{ color: C.ink }}>
                      {t.topicTitle}
                    </span>
                    <div
                      className="relative h-2 rounded-full"
                      style={{
                        background:
                          "linear-gradient(90deg,#DCEEEB,#F0F1F3 50%,#F6E7DA)",
                      }}
                    >
                      <span
                        className="absolute top-[-4px] h-4 w-px"
                        style={{ left: "50%", background: "#D4D8DE" }}
                      />
                      <span
                        className="absolute top-[-3px] h-3.5 w-3.5 rounded-full border-2 border-white"
                        style={{
                          left: "calc(" + you + "% - 7px)",
                          background: dot,
                          boxShadow: "0 1px 3px rgba(16,24,40,.3)",
                        }}
                      />
                    </div>
                    <span
                      className="hidden text-right text-xs sm:block"
                      style={{ color: C.meta }}
                    >
                      {Math.abs(t.scorePct ?? 0) < 8
                        ? "In step"
                        : Math.round(Math.abs(t.scorePct ?? 0)) + " pts apart"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Promise_>
              Every topic you answer in gets a line here: your position, the regional
              average, and the distance between them. Three answers is enough for the
              first line to appear.
            </Promise_>
          )}

          <div
            className="mt-5 flex items-center gap-4 pt-4 text-xs"
            style={{ borderTop: "1px solid " + C.hairline, color: C.meta }}
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: C.stanceLow }}
              />
              You
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: C.meta }} />
              Regional average
            </span>
          </div>
        </div>
      </div>

      {/* ── Four-tile band: profile · trend · divergence · fingerprint ── */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
        style={{ borderTop: "1px solid " + C.hairline }}
      >
        <div
          className="flex flex-col p-5"
          style={{ borderRight: "1px solid " + C.hairline }}
        >
          <TileHead>Your stance profile</TileHead>
          {fingerprint?.summaryTags.length ? (
            <>
              <p
                className="mt-2.5 text-lg font-semibold leading-snug tracking-tight"
                style={{ color: C.ink }}
              >
                {fingerprint.summaryTags.slice(0, 2).join(", ").toLowerCase()}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: C.body }}>
                Drawn from {answered} answer{answered === 1 ? "" : "s"} across{" "}
                {topicsAnswered} topic{topicsAnswered === 1 ? "" : "s"}.
              </p>
            </>
          ) : (
            <p className="mt-2.5 text-sm leading-relaxed" style={{ color: C.body }}>
              A plain-language read of how you answer — how strongly you commit, and
              how widely you range across topics.
            </p>
          )}
          <div className="mt-auto flex items-center gap-3 pt-4">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full"
              style={{ background: C.line }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: Math.min(100, Math.round((answered / 50) * 100)) + "%",
                  background: C.brand,
                }}
              />
            </div>
            <span className="text-xs tabular-nums" style={{ color: C.meta }}>
              {answered} answered
            </span>
          </div>
        </div>

        <div
          className="flex flex-col p-5"
          style={{ borderRight: "1px solid " + C.hairline }}
        >
          <TileHead>Alignment trend</TileHead>
          {trend && trend.points.length > 1 ? (
            <>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span
                  className="text-2xl font-semibold leading-none tracking-tight"
                  style={{ color: C.ink }}
                >
                  {trend.delta == null
                    ? "—"
                    : (trend.delta > 0 ? "+" : "") +
                      Math.round(trend.delta * 100) +
                      " pts"}
                </span>
                <span className="text-xs" style={{ color: C.body }}>
                  last {trend.windowDays} days
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: C.body }}>
                {analyticsTier === "sparse"
                  ? "You've started building a stance history. Answer a few more and the line fills in."
                  : getAlignmentTrendCopy(trend.direction)}
              </p>
              <div className="mt-auto pt-4">
                <PersonalAnalyticsSparkline points={trend.points} />
              </div>
            </>
          ) : (
            <p className="mt-2.5 text-sm leading-relaxed" style={{ color: C.body }}>
              Alignment is not fixed. This tracks whether you are drifting toward the
              regional centre or away from it, month over month.
            </p>
          )}
        </div>

        <div
          className="flex flex-col p-5"
          style={{ borderRight: "1px solid " + C.hairline }}
        >
          <TileHead>Most divergent topic</TileHead>
          {divergent?.topicTitle ? (
            <>
              <p
                className="mt-2.5 text-lg font-semibold leading-snug tracking-tight"
                style={{ color: C.ink }}
              >
                {divergent.topicId ? (
                  <Link to={"/topics/" + divergent.topicId} style={{ color: C.brand }}>
                    {divergent.topicTitle}
                  </Link>
                ) : (
                  divergent.topicTitle
                )}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: C.body }}>
                {getDivergenceCopy(divergent.direction)}
              </p>
              <div className="mt-auto pt-4">
                <div
                  className="relative h-2 rounded-full"
                  style={{
                    background: "linear-gradient(90deg,#DCEEEB,#F0F1F3 50%,#F6E7DA)",
                  }}
                >
                  {divergent.communityAvgScore != null && (
                    <span
                      className="absolute top-[1px] h-1.5 w-1.5 rounded-full"
                      style={{
                        left:
                          "calc(" +
                          ((divergent.communityAvgScore + 2) / 4) * 100 +
                          "% - 3px)",
                        background: C.meta,
                      }}
                    />
                  )}
                  {divergent.userAvgScore != null && (
                    <span
                      className="absolute top-[-3px] h-3.5 w-3.5 rounded-full border-2 border-white"
                      style={{
                        left:
                          "calc(" + ((divergent.userAvgScore + 2) / 4) * 100 + "% - 7px)",
                        background:
                          divergent.userAvgScore < 0 ? C.stanceLow : C.stanceHigh,
                        boxShadow: "0 1px 3px rgba(16,24,40,.3)",
                      }}
                    />
                  )}
                </div>
                <p className="mt-2 text-xs" style={{ color: C.meta }}>
                  {divergent.answeredCount} answer
                  {divergent.answeredCount === 1 ? "" : "s"} in this topic
                </p>
              </div>
            </>
          ) : (
            <p className="mt-2.5 text-sm leading-relaxed" style={{ color: C.body }}>
              The topic where you sit furthest from everyone else — usually the most
              interesting thing the platform can tell you about yourself.
            </p>
          )}
        </div>

        <div className="flex flex-col p-5">
          <TileHead>Opinion fingerprint</TileHead>
          <p className="mt-2.5 text-sm leading-relaxed" style={{ color: C.body }}>
            {fpTiles.length > 0
              ? "Your position on every topic you've answered, at a glance. No two profiles look alike."
              : "One square per topic, coloured by where you stand. It becomes a shape only you have."}
          </p>
          <div className="mt-auto pt-4">
            <div className="grid grid-cols-6 gap-1">
              {Array.from({ length: 18 }).map((_, i) => (
                <span
                  key={i}
                  className="rounded-[3px]"
                  style={{
                    aspectRatio: "1 / 1",
                    background: fpTiles[i] ?? "#F0F1F3",
                  }}
                />
              ))}
            </div>
            <p className="mt-2.5 text-xs" style={{ color: C.meta }}>
              {fpTiles.length > 0
                ? fpTiles.length + " of 18 tiles filled"
                : "Fills in as you answer"}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────── Moved since you answered (row type) ─────────────
//
// Rows for "Moved since you answered", rendered inside the SinceLastVisitStrip
// card. Answered questions only earn homepage space when something changed;
// the full history lives on My stances.

type RevisitItem = {
  key: string;
  text: string;
  href: string;
  meta: string | null;
  momentum: Momentum;
};

// ─────────────────────────── Scroll-collapse helpers (unchanged) ─────────────

const STANCE_LABELS_SHORT: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]: "Neutral",
  [1]: "Agree",
  [2]: "Strongly agree",
};

function clampLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "Neutral";
  const clamped = Math.max(-2, Math.min(2, Math.round(v)));
  return STANCE_LABELS_SHORT[clamped] ?? "Neutral";
}

function useScrollCollapse(
  ref: React.RefObject<HTMLElement>,
  enabled: boolean,
  onLeave: () => void,
) {
  const hasLeftRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && !hasLeftRef.current) {
          hasLeftRef.current = true;
          onLeave();
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, ref, onLeave]);
}

function CompactAnsweredStrip({
  questionText,
  stanceValue,
  globalRegion,
  onExpand,
  lowLabel,
  highLabel,
}: {
  questionText: string;
  stanceValue: number | null | undefined;
  globalRegion: RegionalStat | null;
  onExpand: () => void;
  lowLabel?: string | null;
  highLabel?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="w-full rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-slate-900/5 transition-colors hover:bg-slate-50"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="line-clamp-2 flex-1 text-sm font-medium" style={{ color: C.ink }}>
          {questionText}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="text-xs font-semibold"
            style={{
              color:
                (stanceValue ?? 0) < -0.35 ? C.stanceLow
                : (stanceValue ?? 0) > 0.35 ? C.stanceHigh
                : C.body,
            }}
          >
            {clampLabel(stanceValue)}
          </span>
          <svg className="h-3.5 w-3.5" style={{ color: C.meta }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {globalRegion && (
        <StanceDistributionBar
          distribution={{
            support_pct: globalRegion.pct_agree,
            neutral_pct: globalRegion.pct_neutral,
            oppose_pct: globalRegion.pct_disagree,
            responses: globalRegion.total_responses,
          }}
          userStance={stanceValue ?? null}
          showCount={true}
          size="sm"
          lowLabel={lowLabel ?? null}
          highLabel={highLabel ?? null}
        />
      )}
    </button>
  );
}

// Unset-slider hint — an untouched control must never read as "already answered".
function SliderHint({ answered }: { answered: boolean }) {
  if (answered) return null;
  return (
    <p className="mt-3 text-xs" style={{ color: C.meta }}>
      Drag to take a position
    </p>
  );
}

// ─────────────────────────── Feed cards ──────────────────────────────────────

function FeaturedQuestionCard({
  q,
  isAuthed,
  onSubmit,
  onLoginRedirect,
  onStage,
  onOpen,
  featuredStats,
  submittingQuestionId,
  cardStats,
}: {
  q: TrendingHomepageQuestionRow;
  isAuthed: boolean;
  onSubmit: (questionId: string, value: number) => Promise<void>;
  onLoginRedirect: () => void;
  onStage?: (questionId: string, value: number) => void;
  onOpen: (id: string) => void;
  featuredStats?: QuestionStats | null;
  submittingQuestionId?: string | null;
  cardStats?: Map<string, QuestionStats>;
}) {
  const postAnswerStats = cardStats?.get(q.question_id) ?? null;
  const effectiveStats = postAnswerStats ?? featuredStats ?? null;
  const globalRegion = effectiveStats?.regions?.global ?? null;
  const [collapsed, setCollapsed] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const momentum = toMomentum(q.trend_micro_signal);

  const handleLeave = React.useCallback(() => setCollapsed(true), []);
  useScrollCollapse(cardRef, !!postAnswerStats, handleLeave);

  if (collapsed && postAnswerStats) {
    return (
      <div ref={cardRef}>
        <CompactAnsweredStrip
          questionText={q.question_text}
          stanceValue={q.user_stance_value}
          globalRegion={globalRegion}
          lowLabel={q.slider_low_label ?? null}
          highLabel={q.slider_high_label ?? null}
          onExpand={() => setCollapsed(false)}
        />
      </div>
    );
  }

  return (
    <div ref={cardRef} className={`${card} overflow-hidden md:grid md:grid-cols-[1.25fr_1fr]`}>
      <div className="order-2 p-6 md:order-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {q.tags && q.tags.length > 0 && <Tag primary>{q.tags[0]}</Tag>}
          {q.tags && q.tags.slice(1, 3).map((t) => <Tag key={t}>{t}</Tag>)}
          {momentum && <MomentumTag state={momentum} />}
          {q.origin_location_label && q.origin_location_label !== q.audience_location_label && (
            <Pill>{q.origin_location_label}</Pill>
          )}
        </div>

        <Link
          to={`/q/${q.question_id}`}
          className="block text-2xl font-semibold leading-snug hover:underline"
          style={{ color: C.ink, textWrap: "pretty" as any }}
        >
          {q.question_text}
        </Link>

        {q.summary && (
          <p className="mt-3 line-clamp-3 text-sm leading-relaxed" style={{ color: C.body }}>
            {q.summary}
          </p>
        )}

        {q.topic_title && (
          <p className="mt-2 text-xs" style={{ color: C.meta }}>{q.topic_title}</p>
        )}

        <div className="mt-5 pt-5" style={{ borderTop: `1px solid ${C.hairline}` }}>
          {isAuthed ? (
            <>
              <QuestionStanceSlider
                key={`featured-${q.question_id}`}
                questionId={q.question_id}
                questionText={q.question_text}
                summary={q.summary}
                initialValue={q.user_stance_value ?? null}
                stats={effectiveStats}
                pulseThumb={true}
                mutationPending={submittingQuestionId === q.question_id}
                onSubmit={(v) => onSubmit(q.question_id, v)}
                sliderLowLabel={q.slider_low_label ?? null}
                sliderHighLabel={q.slider_high_label ?? null}
              />
              <SliderHint answered={!!q.user_has_answered} />
              {postAnswerStats && globalRegion && (
                <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <p className="mb-2 text-xs font-bold uppercase" style={{ color: C.meta, letterSpacing: "0.14em" }}>
                    Where the responses sit
                  </p>
                  <StanceDistributionBar
                    distribution={{
                      support_pct: globalRegion.pct_agree,
                      neutral_pct: globalRegion.pct_neutral,
                      oppose_pct: globalRegion.pct_disagree,
                      responses: globalRegion.total_responses,
                    }}
                    userStance={q.user_stance_value ?? null}
                    showCount={true}
                    size="sm"
                    lowLabel={q.slider_low_label ?? null}
                    highLabel={q.slider_high_label ?? null}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="cursor-pointer">
              <QuestionStanceSlider
                key={`featured-anon-${q.question_id}`}
                questionId={q.question_id}
                questionText={q.question_text}
                summary={q.summary}
                initialValue={null}
                onSubmit={(v) => (onStage ? onStage(q.question_id, v) : onLoginRedirect())}
                sliderLowLabel={q.slider_low_label ?? null}
                sliderHighLabel={q.slider_high_label ?? null}
              />
              <SliderHint answered={false} />
            </div>
          )}

          <div className="mt-4">
            <button
              type="button"
              className="text-sm font-semibold"
              style={{ color: C.brand }}
              onClick={() => onOpen(q.question_id)}
            >
              Open full discussion →
            </button>
          </div>
        </div>
      </div>

      <div className="order-1 min-h-[200px] md:order-2">
        {q.cover_image_url ? (
          <img
            src={q.cover_image_url}
            alt=""
            className="h-56 w-full object-cover md:h-full"
            loading="lazy"
          />
        ) : (
          <QuestionCoverImage
            imageUrl={null}
            tags={q.tags}
            variant="banner"
            bannerHeight={220}
          />
        )}
      </div>
    </div>
  );
}

function FeaturedQuestionCardAnon({
  q,
  onLoginRedirect,
  onStage,
  onOpen,
}: {
  q: AnonQuestionRow;
  onLoginRedirect: () => void;
  onStage?: (questionId: string, value: number) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={`${card} overflow-hidden md:grid md:grid-cols-[1.25fr_1fr]`}>
      <div className="order-2 p-6 md:order-1">
        <div className="mb-3 flex flex-wrap gap-2">
          {q.tags && q.tags.length > 0 && <Tag primary>{q.tags[0]}</Tag>}
          {q.tags && q.tags.slice(1, 3).map((t) => <Tag key={t}>{t}</Tag>)}
          {q.origin_location_label && q.origin_location_label !== q.audience_location_label && (
            <Pill>{q.origin_location_label}</Pill>
          )}
        </div>

        <Link
          to={`/q/${q.id}`}
          className="block text-2xl font-semibold leading-snug hover:underline"
          style={{ color: C.ink, textWrap: "pretty" as any }}
        >
          {q.question}
        </Link>

        {q.summary && (
          <p className="mt-3 line-clamp-3 text-sm leading-relaxed" style={{ color: C.body }}>
            {q.summary}
          </p>
        )}

        <div className="mt-5 pt-5" style={{ borderTop: `1px solid ${C.hairline}` }}>
          <div className="cursor-pointer">
            <QuestionStanceSlider
              questionId={q.id}
              questionText={q.question}
              summary={q.summary}
              initialValue={null}
              onSubmit={(v) => (onStage ? onStage(q.id, v) : onLoginRedirect())}
              sliderLowLabel={q.slider_low_label ?? null}
              sliderHighLabel={q.slider_high_label ?? null}
            />
            <SliderHint answered={false} />
          </div>

          <div className="mt-4">
            <button
              type="button"
              className="text-sm font-semibold"
              style={{ color: C.brand }}
              onClick={() => onOpen(q.id)}
            >
              Open full discussion →
            </button>
          </div>
        </div>
      </div>

      <div className="order-1 min-h-[200px] md:order-2">
        <QuestionCoverImage
          imageUrl={q.cover_image_url ?? null}
          tags={q.tags}
          variant="banner"
          bannerHeight={220}
        />
      </div>
    </div>
  );
}

function GridQuestionCard({
  q,
  isAuthed,
  onSubmit,
  onLoginRedirect,
  onStage,
  onOpen,
  submittingQuestionId,
  cardStats,
}: {
  q: TrendingHomepageQuestionRow;
  isAuthed: boolean;
  onSubmit: (questionId: string, value: number) => Promise<void>;
  onLoginRedirect: () => void;
  onStage?: (questionId: string, value: number) => void;
  onOpen: (id: string) => void;
  submittingQuestionId?: string | null;
  cardStats?: Map<string, QuestionStats>;
}) {
  const postAnswerStats = cardStats?.get(q.question_id) ?? null;
  const globalRegion = postAnswerStats?.regions?.global ?? null;
  const [collapsed, setCollapsed] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const momentum = toMomentum(q.trend_micro_signal);

  const handleLeave = React.useCallback(() => setCollapsed(true), []);
  useScrollCollapse(cardRef, !!postAnswerStats, handleLeave);

  if (collapsed && postAnswerStats) {
    return (
      <div ref={cardRef}>
        <CompactAnsweredStrip
          questionText={q.question_text}
          stanceValue={q.user_stance_value}
          globalRegion={globalRegion}
          lowLabel={q.slider_low_label ?? null}
          highLabel={q.slider_high_label ?? null}
          onExpand={() => setCollapsed(false)}
        />
      </div>
    );
  }

  return (
    <div ref={cardRef} className={`${card} flex flex-col overflow-hidden`}>
      {q.cover_image_url ? (
        <img src={q.cover_image_url} alt="" className="h-40 w-full object-cover" loading="lazy" />
      ) : (
        <QuestionCoverImage
          imageUrl={null}
          tags={q.tags}
          variant="banner"
          bannerHeight={140}
        />
      )}
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          {q.tags && q.tags.length > 0 && <Tag primary>{q.tags[0]}</Tag>}
          {momentum && <MomentumTag state={momentum} />}
          {q.origin_location_label && q.origin_location_label !== q.audience_location_label && (
            <Pill>{q.origin_location_label}</Pill>
          )}
        </div>

        <Link
          to={`/q/${q.question_id}`}
          className="line-clamp-4 text-lg font-semibold leading-snug hover:underline"
          style={{ color: C.ink, textWrap: "pretty" as any }}
        >
          {q.question_text}
        </Link>

        {q.topic_title && (
          <p className="mt-1.5 text-xs" style={{ color: C.meta }}>{q.topic_title}</p>
        )}

        <div className="mt-auto pt-4">
          {isAuthed ? (
            <>
              <QuestionStanceSlider
                questionId={q.question_id}
                questionText={q.question_text}
                summary={q.summary}
                initialValue={q.user_stance_value ?? null}
                stats={postAnswerStats}
                mutationPending={submittingQuestionId === q.question_id}
                onSubmit={(v) => onSubmit(q.question_id, v)}
                sliderLowLabel={q.slider_low_label ?? null}
                sliderHighLabel={q.slider_high_label ?? null}
              />
              <SliderHint answered={!!q.user_has_answered} />
              {postAnswerStats && globalRegion && (
                <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <p className="mb-2 text-xs font-bold uppercase" style={{ color: C.meta, letterSpacing: "0.14em" }}>
                    Where the responses sit
                  </p>
                  <StanceDistributionBar
                    distribution={{
                      support_pct: globalRegion.pct_agree,
                      neutral_pct: globalRegion.pct_neutral,
                      oppose_pct: globalRegion.pct_disagree,
                      responses: globalRegion.total_responses,
                    }}
                    userStance={q.user_stance_value ?? null}
                    showCount={true}
                    size="sm"
                    lowLabel={q.slider_low_label ?? null}
                    highLabel={q.slider_high_label ?? null}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="cursor-pointer">
              <QuestionStanceSlider
                questionId={q.question_id}
                questionText={q.question_text}
                summary={q.summary}
                initialValue={null}
                onSubmit={(v) => (onStage ? onStage(q.question_id, v) : onLoginRedirect())}
                sliderLowLabel={q.slider_low_label ?? null}
                sliderHighLabel={q.slider_high_label ?? null}
              />
              <SliderHint answered={false} />
            </div>
          )}
          <div className="mt-3">
            <button
              type="button"
              className="text-xs font-semibold"
              style={{ color: C.brand }}
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

function GridQuestionCardAnon({
  q,
  onLoginRedirect,
  onStage,
  onOpen,
}: {
  q: AnonQuestionRow;
  onLoginRedirect: () => void;
  onStage?: (questionId: string, value: number) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={`${card} flex flex-col overflow-hidden`}>
      <QuestionCoverImage
        imageUrl={q.cover_image_url ?? null}
        tags={q.tags}
        variant="banner"
        bannerHeight={140}
      />
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2.5 flex flex-wrap gap-2">
          {q.tags && q.tags.length > 0 && <Tag primary>{q.tags[0]}</Tag>}
          {q.origin_location_label && q.origin_location_label !== q.audience_location_label && (
            <Pill>{q.origin_location_label}</Pill>
          )}
        </div>

        <Link
          to={`/q/${q.id}`}
          className="line-clamp-4 text-lg font-semibold leading-snug hover:underline"
          style={{ color: C.ink, textWrap: "pretty" as any }}
        >
          {q.question}
        </Link>

        {q.summary && (
          <p className="mt-1.5 line-clamp-2 text-xs" style={{ color: C.meta }}>{q.summary}</p>
        )}

        <div className="mt-auto pt-4">
          <div className="cursor-pointer">
            <QuestionStanceSlider
              questionId={q.id}
              questionText={q.question}
              summary={q.summary}
              initialValue={null}
              onSubmit={(v) => (onStage ? onStage(q.id, v) : onLoginRedirect())}
              sliderLowLabel={q.slider_low_label ?? null}
              sliderHighLabel={q.slider_high_label ?? null}
            />
            <SliderHint answered={false} />
          </div>
          <div className="mt-3">
            <button
              type="button"
              className="text-xs font-semibold"
              style={{ color: C.brand }}
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

  // Q5 — contribution acknowledgement check
  const { checkForAcknowledgement } = useContributionAcknowledgement(isAuthed);

  // Infinite scroll sentinel
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const actions = (
    <div className="flex items-center gap-2">
      <button
        className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-slate-50"
        style={{ borderColor: C.line, color: C.body }}
        onClick={() => navigate("/search")}
        aria-label="Search questions"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
      </button>
      <button
        className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-slate-50"
        style={{ borderColor: C.line, color: C.body }}
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
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    staleTime: 60_000,
  });

  const displayName = getDisplayHandle(profile as any, session);

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

  // ── IP-based country detection for anonymous users ──
  const { country: ipCountry, isLoading: ipLoading } = useIPLocation(!isAuthed);
  const anonCountryLabel = !isAuthed ? (ipCountry ?? null) : null;
  const hasAnonCountry = !!anonCountryLabel;
  const effectiveHasCountry = isAuthed ? hasCountry : hasAnonCountry;
  const effectiveCountryLabel = isAuthed ? countryLabel : anonCountryLabel;

  // Bootstrap completion listener (unchanged)
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
      // FIX: this query reads public.profiles.last_seen_at, which
      // bootstrap_user_after_login() is what actually creates on a brand-new
      // user's first login. Without this, a first-time OAuth login could
      // fire get_since_last_visited() before that row exists (profiles
      // row missing => fabricated "days away" from the SQL fallback) and
      // then sit on that wrong result for up to 5 minutes (staleTime).
      qc.invalidateQueries({ refetchType: 'all', queryKey: ["home-since-last-visit"] });
    };

    if ((window as any).__bootstrapComplete) {
      invalidateAll();
    }

    window.addEventListener("bootstrap:complete", invalidateAll);
    return () => window.removeEventListener("bootstrap:complete", invalidateAll);
  }, [qc]);

  const [regionTab, setRegionTab] = React.useState<"country" | "global">(
    effectiveHasCountry ? "country" : "global"
  );

  React.useEffect(() => {
    if (effectiveHasCountry) setRegionTab((t) => (t === "global" ? "country" : t));
    if (!effectiveHasCountry) setRegionTab("global");
  }, [effectiveHasCountry]);

  const regionLabel =
    regionTab === "country" && effectiveCountryLabel
      ? effectiveCountryLabel
      : globalLabel;

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

      // Tier 1: get_societal_pulse_homepage
      try {
        const { data, error } = await sb.rpc("get_societal_pulse_homepage", {
          p_region_label: regionLabel,
          p_topic_pick_n: 3,
        });
        if (error) {
          if (!isNotFound(error)) throw error;
        } else {
          const row =
            Array.isArray(data) && data.length > 0
              ? (data[0] as SocietalPulseOutput)
              : data && !Array.isArray(data)
              ? (data as SocietalPulseOutput)
              : null;
          if (row?.narrative?.sentence_1) {
            let chips = Array.isArray(row.chips)
              ? row.chips.map((c) => ({
                  ...c,
                  href: c.href || `/topics/${c.topic_id}`,
                }))
              : [];

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

      // Tier 3: Legacy pulse
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
        p_min_age_days: 1,
      });
      if (error) throw error;
      return (data ?? []) as ReopenedRow[];
    },
    staleTime: 30_000,
  });

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
        latestScore: t.latest_score == null ? null : Number(t.latest_score),
        latestLowLabel: t.latest_low_label ?? null,
        latestHighLabel: t.latest_high_label ?? null,
      }));
      return {
        totalAnswered: raw?.total_answered ?? 0,
        topics,
        alignmentLabel: raw?.region?.alignment_label ?? "",
      };
    },
    staleTime: 60_000,
  });

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

  const paRegionScope = regionLabel === "Global" ? "global" : "country";
  const paRegionKey   = regionLabel;

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
    retry: false,
  });

  const returnNudge = React.useMemo((): ReturnNudge | null => {
    const totalAnswered = myStanceSnapshotQuery.data?.totalAnswered ?? 0;
    if (totalAnswered === 0) return null;

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

  React.useEffect(() => {
    if (!sb || !userId) return;
    const t = setTimeout(async () => {
      try { await sb.rpc("update_last_seen"); } catch { /* silent */ }
    }, 2000);
    return () => clearTimeout(t);
  }, [sb, userId]);

  // ── Infinite queries (all preserved exactly) ──

  const canTrendingNational =
    !!sb && !!userId && !!countryLabel && !!COUNTRY_LOCATION_ID && !locationIdsLoading;
  const canTrendingGlobal =
    !!sb && !!userId && !!GLOBAL_LOCATION_ID && !locationIdsLoading;

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
      // Raw fetch, not sb.from() — the SDK client's internal auth-mutex lock
      // can stall this exact call on a cold navigation (fresh tab, no cached
      // session yet), leaving the anon feed empty until a manual refresh.
      // Matches the raw-fetch + getJwt()/supabaseHeaders() pattern used
      // everywhere else in this app for exactly this reason.
      const params = new URLSearchParams({
        select:
          "id,question,summary,tags,location_label,origin_location_label,audience_location_label,published_at,status,cover_image_url,slider_low_label,slider_high_label",
        order: "published_at.desc",
        limit: "10",
        offset: String(pageParam),
      });
      if (regionLabel !== "Global") {
        params.set("audience_location_label", `eq.${regionLabel}`);
      } else if (effectiveCountryLabel) {
        params.set("audience_location_label", `neq.${effectiveCountryLabel}`);
      }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/v_live_questions?${params.toString()}`, {
        headers: supabaseHeaders(getJwt()),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Failed to load questions (${res.status}): ${errBody.slice(0, 200)}`);
      }
      const data = await res.json();
      return (data ?? []) as AnonQuestionRow[];
    },
    staleTime: 60_000,
  });

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
        .select("id, question, summary, tags, location_label, origin_location_label, audience_location_label, cover_image_url, topic_title, slider_low_label, slider_high_label")
        .order("published_at", { ascending: false })
        .limit(15);
      if (error) throw error;

      const rows = (data ?? []) as FallbackQuestionRow[];

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
  const rawFeedRows =
    regionTab === "country"
      ? (trendingQuestionsNationalQuery.data?.pages.flat() ?? [])
      : (trendingQuestionsGlobalQuery.data?.pages.flat() ?? []);

  // Answered questions do not hold a slot in the feed — they live on My stances.
  // The one exception is a question answered in THIS session: it stays mounted so
  // its result reveals in place, then clears on the next load. A question that
  // entered a new phase surfaces as a "Moved since you answered" row instead.
  const answeredThisSession = React.useRef<Set<string>>(new Set());

  const newPhaseAnswered = rawFeedRows.filter(
    (q) =>
      q.user_has_answered &&
      q.is_new_phase &&
      !answeredThisSession.current.has(q.question_id)
  );
  const newPhaseKey = newPhaseAnswered.map((q) => q.question_id).join(",");

  const trendingQuestions = rawFeedRows.filter(
    (q) => !q.user_has_answered || answeredThisSession.current.has(q.question_id)
  );
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
  const globalFeedQuestions = trendingQuestionsGlobalQuery.data?.pages.flat() ?? [];
  const globalUnanswered = globalFeedQuestions.filter(
    (q) => !q.user_has_answered || answeredThisSession.current.has(q.question_id)
  );

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
    slider_low_label: r.slider_low_label ?? null,
    slider_high_label: r.slider_high_label ?? null,
  }));

  const finalHeroQuestions: TrendingHomepageQuestionRow[] = (() => {
    if (!isAuthed) return [];
    // Check trendingQuestions itself, not primaryUnanswered (a different,
    // region-independent union) — checking one array and returning another
    // meant this branch could pass "something exists across both regions"
    // while returning the single-region-scoped array that actually had
    // nothing, skipping the fallback branch below that exists specifically
    // to handle that case.
    if (trendingQuestions.length > 0) return trendingQuestions;
    if (regionTab === "country" && globalUnanswered.length > 0) return globalFeedQuestions;
    if (fallbackRows.length > 0) return fallbackRows;
    return trendingQuestions;
  })();

  const isFallbackMode =
    isAuthed &&
    primaryUnanswered.length === 0 &&
    (globalUnanswered.length > 0 || fallbackRows.length > 0);

  // ── Loading states ──
  // isPending (not isLoading): isLoading is only true while ACTIVELY fetching,
  // and reads false while the query is merely disabled/not-yet-started (e.g.
  // sb hasn't initialized yet on a cold tab). useHeroController treats
  // isLoading=false + allQuestions=[] as "definitively no questions" and
  // locks into hero_error with no self-recovery — so this flag needs to stay
  // true through that not-yet-started window, which is what isPending does.
  const anonIsLoading = anonTrendingQuery.isPending;
  const anonIsError = anonTrendingQuery.isError;
  const authedIsLoading =
    !sessionResolved ||
    locationIdsLoading ||
    trendingQuestionsNationalQuery.isLoading ||
    trendingQuestionsGlobalQuery.isLoading;

  // ── Question distribution into hero / featured / grid ──
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

  const featuredAnonQ =
    anonQuestions.find((q, i) => i > 0 && !!q.cover_image_url) ??
    anonQuestions[1] ??
    null;
  const gridAnonQs = anonQuestions.filter((q) => q !== featuredAnonQ);

  // ── Stats preload for hero + featured slots ──
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

  // ── Per-card post-answer stats ──
  const [cardStats, setCardStats] = React.useState<Map<string, QuestionStats>>(new Map());
  const [feedback, setFeedback] = React.useState<QuestionDistributionRow | null>(null);

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

  const fetchCardStats = React.useCallback(
    async (questionId: string) => {
      if (!sb) return;
      try {
        const { data, error } = await sb.rpc("get_question_stats_for_user", {
          p_question_id: questionId,
        });
        if (error) throw error;
        if (!data) return;
        const raw = data as any;
        const stats: QuestionStats = {
          my_stance: typeof raw.my_stance === "number" ? raw.my_stance : null,
          location: raw.location ?? null,
          regions: (raw.regions ?? {}) as QuestionStats["regions"],
        };
        setCardStats((prev) => {
          const next = new Map(prev);
          next.set(questionId, stats);
          return next;
        });
      } catch (e) {
        console.warn("[home] fetchCardStats failed", e);
      }
    },
    [sb]
  );

  // Pre-populate cardStats for already-answered questions when the feed loads.
  React.useEffect(() => {
    if (!isAuthed) return;
    const answeredIds = trendingQuestions
      .filter((q) => q.user_has_answered && !cardStats.has(q.question_id))
      .map((q) => q.question_id);
    if (answeredIds.length === 0) return;
    answeredIds.forEach((id) => void fetchCardStats(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendingQuestionsNationalQuery.data, trendingQuestionsGlobalQuery.data, isAuthed]);

  const [submittingQuestionId, setSubmittingQuestionId] = React.useState<string | null>(null);

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

      const jwt = session?.access_token;
      if (!jwt) throw new Error("No active session");
      const supabaseUrl = (sb as any).supabaseUrl as string;
      const anonKey    = (sb as any).supabaseKey as string;

      console.log(
        `[home:submit] START qId=${questionId.slice(0, 8)} userId=${userId.slice(0, 8)} value=${value}`
      );

      // Keep this card mounted for its in-place result reveal.
      answeredThisSession.current.add(questionId);

      setSubmittingQuestionId(questionId);

      let res: Response;
      try {
        res = await fetch(`${supabaseUrl}/rest/v1/rpc/set_question_stance`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": anonKey,
            "Authorization": `Bearer ${jwt}`,
          },
          body: JSON.stringify({ p_question_id: questionId, p_score: value }),
        });
      } finally {
        setSubmittingQuestionId(null);
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("[home:submit] HTTP ERROR", res.status, body);
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }

      const data = await res.json().catch(() => null);
      console.log("[home:submit] RPC OK", { questionId, value, data });

      window.dispatchEvent(
        new CustomEvent("stance-saved", {
          detail: { questionId, value },
        })
      );

      const patchPage = (page: TrendingHomepageQuestionRow[]) =>
        page.map((q) =>
          q.question_id === questionId
            ? { ...q, user_stance_value: value, user_has_answered: true }
            : q
        );
      qc.setQueriesData<{ pages: TrendingHomepageQuestionRow[][] }>(
        { queryKey: ["home-trending-questions"] },
        (old) => {
          if (!old?.pages) return old;
          return { ...old, pages: old.pages.map(patchPage) };
        }
      );

      void fetchDistribution(questionId);
      void fetchCardStats(questionId);

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
      ]).then((results) => {
        console.log("[home:submit] background invalidations settled", results);
      });

      console.log(`[home:submit] DONE qId=${questionId.slice(0, 8)} value=${value}`);

      void checkForAcknowledgement().then((ack?: any) => {
        if (ack && ack.should_show && ack.message) {
          toast(ack.message, {
            description: ack.secondary_text ?? undefined,
            duration: 4000,
          });
        }
      }).catch(() => { /* silent — ack is non-critical */ });
    },
    [sb, session, userId, qc, navigate, regionLabel, fetchDistribution, fetchCardStats]
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

  // ── Anonymous staging ──
  const [stagedQuestions, setStagedQuestions] = React.useState<Set<string>>(new Set());
  const [promptDismissed, setPromptDismissed] = React.useState(false);

  const stageStance = React.useCallback(
    async (questionId: string, value: number) => {
      try {
        await recordWebStance(questionId, value);
        setStagedQuestions((prev) => {
          const next = new Set(prev);
          next.add(questionId);
          return next;
        });
      } catch {
        loginRedirect();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Impression recording ──
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

  // ── IntersectionObserver for infinite scroll ──
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

  // ── "Worth revisiting" items — built from the two queries that used to power
  //    three separate sections. Reopened first (strongest signal), then topics.
  const revisitItems = React.useMemo<RevisitItem[]>(() => {
    if (!isAuthed) return [];
    const out: RevisitItem[] = [];

    // Questions you answered that have since entered a new phase — a one-line
    // row here rather than a full card back in the feed.
    newPhaseAnswered.slice(0, 2).forEach((q) => {
      out.push({
        key: `newphase-${q.question_id}`,
        text: q.question_text,
        href: `/q/${q.question_id}`,
        meta: "New phase since you answered",
        momentum: toMomentum(q.trend_micro_signal) ?? "rising",
      });
    });

    (reopenedQuery.data ?? []).slice(0, 2).forEach((r) => {
      out.push({
        key: `reopened-${r.question_id}`,
        text: r.question_text,
        href: `/q/${r.question_id}`,
        meta:
          r.reason ??
          (r.public_shift_proxy != null
            ? `Public balance moved ${Math.round(r.public_shift_proxy * 10) / 10} since you answered`
            : "Public balance moved since you answered"),
        momentum: "polarising",
      });
    });

    (continuingQuery.data ?? []).slice(0, 3).forEach((c) => {
      out.push({
        key: `continuing-${c.question_id}`,
        text: c.question_text,
        href: c.topic_id ? `/topics/${c.topic_id}` : `/q/${c.question_id}`,
        meta: c.reason ?? c.topic_title ?? null,
        momentum: "rising",
      });
    });

    return out.slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, reopenedQuery.data, continuingQuery.data, newPhaseKey]);

  // Cards answered during this session stay mounted so the result reveals in
  // place; they clear on the next load rather than holding a permanent slot.
  const answeredHereToday = React.useMemo(
    () => trendingQuestions.filter((q) => q.user_has_answered).length,
    [trendingQuestions]
  );

  const feedHasContent = isAuthed
    ? !!featuredQ || gridQs.length > 0
    : !!featuredAnonQ || gridAnonQs.length > 0;
  const feedIsLoading = isAuthed ? authedIsLoading : anonIsLoading;

  // ─────────────────────────── Render ────────────────────────────────────────
  return (
    <PageLayout rightSlot={actions}>
      <div className="min-h-screen" style={{ background: C.page, color: C.ink }}>
        <div className="mx-auto max-w-5xl px-4 py-7">

          {/* ── Greeting + region switch: one line, no card ── */}
          <Tabs
            value={regionTab}
            onValueChange={(v) => setRegionTab(v as any)}
            className="w-full"
          >
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight" style={{ color: C.ink }}>
                  {!isAuthed
                    ? "Where does society stand today?"
                    : sinceLastVisitQuery.data?.is_first_visit
                    ? `Welcome, ${displayName}`
                    : `Welcome back, ${displayName}`}
                </h1>
                <p className="mt-1 text-sm" style={{ color: C.body }}>
                  {isAuthed
                    ? "Take a position, then see where your region sits."
                    : "Take a position in seconds — see how your region compares."}
                </p>
              </div>
              <TabsList>
                {effectiveHasCountry && (
                  <TabsTrigger value="country">{effectiveCountryLabel}</TabsTrigger>
                )}
                <TabsTrigger value="global">Global</TabsTrigger>
              </TabsList>
            </div>

            {/* ── Since you last visited — always present ── */}
            <SinceLastVisitStrip
              data={sinceLastVisitQuery.data ?? null}
              loading={sinceLastVisitQuery.isLoading}
              isAuthed={isAuthed}
              moved={revisitItems}
              totalAnswered={myStanceSnapshotQuery.data?.totalAnswered ?? 0}
            />

            {/* ── Hero — the single canonical "today's question" surface ── */}
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
                slider_low_label: q.slider_low_label ?? null,
                slider_high_label: q.slider_high_label ?? null,
              }))}
              isLoading={isAuthed ? authedIsLoading : anonIsLoading}
              isAuthed={isAuthed}
              regionLabel={regionLabel}
              isFallbackMode={isFallbackMode}
              alignmentSnap={whereYouStandQuery.data ?? null}
              alignmentSnapLoading={whereYouStandQuery.isLoading}
              societalPulseChips={(() => {
                const rpcChips = societyPulseQuery.data?.chips ?? [];
                if (rpcChips.length > 0) return rpcChips;
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
              onStage={stageStance}
              onNavigateToQuestion={goToQuestion}
              onLogin={() => navigate("/login")}
              onSignup={() => navigate("/signup")}
            />

            <TabsContent value={regionTab} className="mt-8 space-y-10">

              {/* ── Today's picture — above the unbounded feed ── */}
              <TodaysPicture
                pulse={societyPulseQuery.data ?? null}
                media={mediaSurgeQuery.data ?? null}
                participation={participationQuery.data ?? null}
                snap={isAuthed ? (whereYouStandQuery.data ?? null) : null}
                analytics={isAuthed ? (personalAnalyticsQuery.data ?? null) : null}
                snapshot={isAuthed ? (myStanceSnapshotQuery.data ?? null) : null}
                regionLabel={regionLabel}
              />

              {/* ── Feed — the ONE place questions are listed ── */}
              <section>
                <SectionHeader
                  title="Add your voice"
                  subtitle="Only questions you haven't answered. Answered ones clear out once you've seen the result."
                />

                {feedIsLoading ? (
                  <div className="space-y-5">
                    <CardSkeleton lines={4} />
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                      {[1, 2].map((i) => <CardSkeleton key={i} lines={3} />)}
                    </div>
                  </div>
                ) : !isAuthed && anonIsError ? (
                  <ErrorFallback message="Failed to load questions. Please refresh the page." />
                ) : !feedHasContent ? (
                  <div className={`${card} px-5 py-4 text-sm`} style={{ color: C.body }}>
                    You're caught up. New questions arrive through the day.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {isAuthed
                      ? featuredQ && (
                          <FeaturedQuestionCard
                            q={featuredQ}
                            isAuthed={true}
                            onSubmit={submitStance}
                            onLoginRedirect={loginRedirect}
                            onStage={stageStance}
                            onOpen={goToQuestion}
                            featuredStats={featuredStatsQuery.data ?? null}
                            submittingQuestionId={submittingQuestionId}
                            cardStats={cardStats}
                          />
                        )
                      : featuredAnonQ && (
                          <FeaturedQuestionCardAnon
                            q={featuredAnonQ}
                            onLoginRedirect={loginRedirect}
                            onStage={stageStance}
                            onOpen={goToQuestion}
                          />
                        )}

                    {isAuthed
                      ? gridQs.length > 0 && (
                          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                            {gridQs.map((q) => (
                              <GridQuestionCard
                                key={q.question_id}
                                q={q}
                                isAuthed={true}
                                onSubmit={submitStance}
                                onLoginRedirect={loginRedirect}
                                onStage={stageStance}
                                onOpen={goToQuestion}
                                submittingQuestionId={submittingQuestionId}
                                cardStats={cardStats}
                              />
                            ))}
                          </div>
                        )
                      : gridAnonQs.length > 0 && (
                          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                            {gridAnonQs.map((q) => (
                              <GridQuestionCardAnon
                                key={q.id}
                                q={q}
                                onLoginRedirect={loginRedirect}
                                onStage={stageStance}
                                onOpen={goToQuestion}
                              />
                            ))}
                          </div>
                        )}
                  </div>
                )}

                {/* Infinite scroll sentinel (unchanged) */}
                <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

                {isFetchingNextPage && (
                  <div className="flex justify-center py-6">
                    <div
                      className="h-6 w-6 animate-spin rounded-full border-2"
                      style={{ borderColor: C.line, borderTopColor: C.brand }}
                    />
                  </div>
                )}

                {!hasNextPage &&
                  (trendingQuestions.length > 1 || anonQuestions.length > 1) && (
                    <p className="py-4 text-center text-xs" style={{ color: C.meta }}>
                      You've seen all available questions
                    </p>
                  )}

                {/* Answered questions live in My stances, not in the feed. */}
                {isAuthed && (myStanceSnapshotQuery.data?.totalAnswered ?? 0) > 0 && (
                  <div
                    className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs"
                    style={{ color: C.meta }}
                  >
                    {answeredHereToday > 0 && (
                      <>
                        <span>
                          You answered {answeredHereToday} question
                          {answeredHereToday === 1 ? "" : "s"} today
                        </span>
                        <span className="h-3 w-px" style={{ background: C.line }} />
                      </>
                    )}
                    <Link to="/my-stances" className="font-semibold" style={{ color: C.brand }}>
                      See all {myStanceSnapshotQuery.data?.totalAnswered} in My stances →
                    </Link>
                  </div>
                )}
              </section>

            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Floating opt-in: shown once a logged-out user has staged a stance. */}
      {!isAuthed && !promptDismissed && (
        <HomeOptInPrompt
          stagedCount={stagedQuestions.size}
          onDismiss={() => setPromptDismissed(true)}
        />
      )}
    </PageLayout>
  );
}
