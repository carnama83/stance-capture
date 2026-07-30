// src/components/hero/HeroSection.tsx
//
// Full hero section — Sections A, B, C — wired to useHeroController.
//
// Layout (desktop):
//   ┌─────────────────────────┬──────────────────┐
//   │  Section A (65%)        │  Section B (35%) │
//   │  Main question          │  Insight panel   │
//   ├─────────────────────────┴──────────────────┤
//   │  Section C — Question stream (full width)  │
//   └────────────────────────────────────────────┘
//
// Mobile: A → B → C stacked vertically.
// Section C mobile: horizontal snap carousel, max 3 visible.
//
// Spec rules enforced:
//   - Section A container stays mounted; only inner content swaps (fade)
//   - Slider key={currentHeroQuestion.id} — remounts on question change
//   - Section B min-height: 300px desktop / flexible mobile — no layout shift
//   - Timer lives in useHeroController (outside this tree)
//   - "Up Next" label on first queue card only after answer
//   - Queue card click → promoteQuestion (works from both ready + answered_result)
//   - hero_error shows inline retry in Section A
//   - Section B guest panel: two states (locked / engaged) driven by slider interaction
//   - guestHasEngaged resets on question change and auth transition
//   - distribution data (real community stats) feeds guest preview card
//
// TODO (mobile): Section B stacks below Section A on mobile, so the locked→engaged
//   panel transition is below the fold. Future enhancement: add an inline cue near
//   the guest slider after first interaction so mobile users get immediate feedback.

import * as React from "react";
import { Link } from "react-router-dom";
import { QuestionStanceSlider } from "@/components/question/QuestionStanceSlider";
import { CommunityStanceBar } from "@/components/question/CommunityStanceBar";
import { ShareButton } from "@/components/share/ShareButton";
import { clampPole } from "@/lib/poleLabels";
import {
  useHeroController,
  deriveTeaserLabel,
  type HeroQuestion,
  type HeroStatus,
  type HeroDistribution,
} from "@/hooks/useHeroController";

// ─── Types passed in from IndexPage ──────────────────────────────────────────

// Societal pulse chip — mirrors SocietalPulseOutput chips from Index.tsx
export interface SocietalPulseChip {
  topic_id: string;
  title: string;
  icon: "up" | "reawakening" | "polarized" | "steady";
  href: string;
}

// TopicStanceItem + MyStanceSnapshot — mirrored from Index.tsx export types
export interface TopicStanceItem {
  topicTitle: string;
  avgScore: number;
  answerCount: number;
  scorePct: number; // -100..+100
  // Latest answered question in this topic — lets the row name the user's most
  // recent position in that question's own poles (a topic-level average can't).
  latestScore?: number | null; // -2..+2
  latestLowLabel?: string | null;
  latestHighLabel?: string | null;
}

export interface MyStanceSnapshot {
  totalAnswered: number;
  topics: TopicStanceItem[];
  alignmentLabel: string;
}

// ─── Epic Q types (mirrored from Index.tsx) ──────────────────────────────────

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

type ReturnNudge = {
  type: "minority_shift" | "opinion_shift" | "new_in_topics" | "answer_more";
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

export interface HeroSectionProps {
  allQuestions: HeroQuestion[];
  isLoading: boolean;
  isAuthed: boolean;
  regionLabel: string;
  alignmentSnap: AlignmentSnapshotShape | null;
  alignmentSnapLoading: boolean;
  societalPulseChips: SocietalPulseChip[];
  myStanceSnapshot: MyStanceSnapshot | null;
  sinceLastVisit: SinceLastVisitData | null;
  sinceLastVisitLoading: boolean;
  returnNudge: ReturnNudge | null;
  streak: UserStreak | null;
  isFallbackMode?: boolean;
  onRequestReplenish: () => void;
  onSubmitSuccess: (questionId: string, value: number) => Promise<void>;
  onLoginRedirect: () => void;
  onStage?: (questionId: string, value: number) => void;
  onNavigateToQuestion: (id: string) => void;
  onLogin: () => void;
  onSignup: () => void;
}

// Minimal alignment snapshot shape (matches AlignmentSnapshotRow in Index.tsx)
export interface AlignmentSnapshotShape {
  alignment_pct: number;
  comparable_count?: number;
  minority_count: number;
  most_divergent_question_id: string | null;
  most_divergent_question_text: string | null;
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

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

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
      {children}
    </span>
  );
}

function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)}%`;
}

// ─── Section A — Skeletons ────────────────────────────────────────────────────

function SectionASkeleton() {
  return (
    <div className="animate-pulse p-5 space-y-3">
      <div className="h-3 w-24 rounded bg-slate-100" />
      <div className="h-6 w-4/5 rounded bg-slate-100" />
      <div className="h-4 w-3/5 rounded bg-slate-100" />
      <div className="mt-4 h-48 rounded-lg bg-slate-100" />
      <div className="mt-4 h-10 rounded bg-slate-100" />
    </div>
  );
}

function SectionBSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-5">
      <div className="h-3 w-20 rounded bg-slate-100" />
      <div className="h-4 w-3/4 rounded bg-slate-100" />
      <div className="h-3 w-full rounded bg-slate-100" />
      <div className="h-3 w-5/6 rounded bg-slate-100" />
      <div className="mt-4 h-3 w-1/2 rounded bg-slate-100" />
    </div>
  );
}

// ─── Guest preview card — shared between locked + engaged ─────────────────────
//
// Shows real community distribution data when available (responses > 0).
// Falls back to skeleton pulse while data is loading (distribution === null).
// The "locked" vs "engaged" visual state is controlled by the parent.

function GuestPreviewCard({
  distribution,
  state,
}: {
  distribution: HeroDistribution | null;
  state: "locked" | "engaged";
}) {
  const hasData = distribution != null && (distribution.responses ?? 0) > 0;
  const isLocked = state === "locked";

  return (
    <div
      className={[
        "rounded-xl border p-3 transition-all duration-300",
        isLocked
          ? "bg-slate-50 border-slate-200"
          : "bg-white border-violet-200 shadow-sm",
      ].join(" ")}
    >
      {/* Card header */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {isLocked ? "Community view" : "Your comparison"}
        </p>
        {!isLocked && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: "#6048C0" }}
          >
            Ready to compare
          </span>
        )}
      </div>

      {/* Distribution bar — real data or skeleton */}
      {!hasData ? (
        // Loading skeleton or no data yet
        <div className="space-y-1.5 animate-pulse">
          <div className="h-2 w-full rounded-full bg-slate-200" />
          <div className="flex justify-between">
            <div className="h-2 w-12 rounded bg-slate-200" />
            <div className="h-2 w-12 rounded bg-slate-200" />
            <div className="h-2 w-12 rounded bg-slate-200" />
          </div>
        </div>
      ) : (
        // Real segmented bar
        <div className="space-y-1.5">
          <div className="flex h-2 w-full overflow-hidden rounded-full gap-px">
            {(distribution.opposePct ?? 0) > 0 && (
              <div
                className="bg-red-400 rounded-l-full transition-all duration-500"
                style={{ width: `${distribution.opposePct}%` }}
              />
            )}
            {(distribution.neutralPct ?? 0) > 0 && (
              <div
                className="bg-slate-300 transition-all duration-500"
                style={{ width: `${distribution.neutralPct}%` }}
              />
            )}
            {(distribution.supportPct ?? 0) > 0 && (
              <div
                className="bg-emerald-400 rounded-r-full transition-all duration-500"
                style={{ width: `${distribution.supportPct}%` }}
              />
            )}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400 mr-1" />
              Oppose {formatPct(distribution.opposePct)}
            </span>
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300 mr-1" />
              Neutral {formatPct(distribution.neutralPct)}
            </span>
            <span>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1" />
              Support {formatPct(distribution.supportPct)}
            </span>
          </div>
          <p className="text-[10px] text-slate-400">
            {distribution.responses.toLocaleString()} stance{distribution.responses === 1 ? "" : "s"} recorded
          </p>
        </div>
      )}

      {/* Supporting line */}
      <p className="mt-2 text-[11px] text-slate-500 leading-snug">
        {isLocked
          ? "See where your stance lands after you respond."
          : "See whether your stance is closer to the majority or the minority."}
      </p>

      {/* Lock chip — locked state only */}
      {isLocked && (
        <div className="mt-2 flex justify-center">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-500">
            🔒 Answer to compare
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Section B — Guest locked state ──────────────────────────────────────────

function SectionBGuestLocked({
  distribution,
  onLogin,
  onSignup,
}: {
  distribution: HeroDistribution | null;
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <div className="flex flex-col justify-between h-full p-5">
      <div>
        {/* Eyebrow */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Live insight
          </span>
        </div>

        <h3 className="text-base font-semibold text-slate-900 leading-snug mb-1">
          See where you stand
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed mb-3">
          Answer the question to reveal how your stance compares with society.
        </p>

        {/* Preview card with real community data */}
        <GuestPreviewCard distribution={distribution} state="locked" />

        {/* Value bullets */}
        <ul className="mt-3 space-y-1.5">
          {[
            "Compare with your region, country, and globally",
            "Track how opinions shift over time",
            "Build your personal stance profile",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs text-slate-500">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* CTAs */}
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onSignup}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
        >
          Create free account
        </button>
        <button
          type="button"
          onClick={onLogin}
          className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Log in
        </button>
        <p className="text-center text-[10px] text-slate-400 mt-1">
          Join others tracking how society is thinking in real time
        </p>
      </div>
    </div>
  );
}

// ─── Section B — Guest engaged state ─────────────────────────────────────────

function SectionBGuestEngaged({
  distribution,
  onLogin,
  onSignup,
}: {
  distribution: HeroDistribution | null;
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <div className="flex flex-col justify-between h-full p-5">
      <div>
        {/* Eyebrow */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Live insight
          </span>
        </div>

        <h3 className="text-base font-semibold text-slate-900 leading-snug mb-1">
          See how your stance compares
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed mb-3">
          Create an account to compare your stance with society and keep tracking how it changes.
        </p>

        {/* Engaged preview card — same data, stronger visual */}
        <GuestPreviewCard distribution={distribution} state="engaged" />

        {/* Engaged-specific bullets */}
        <ul className="mt-3 space-y-1.5">
          {[
            "Save your stance history",
            "Compare across regions",
            "Follow issues that matter to you",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs text-slate-500">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* CTAs — more prominent in engaged state */}
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onSignup}
          className="w-full rounded-lg px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:brightness-110"
          style={{ backgroundColor: "#6048C0" }}
        >
          Create free account
        </button>
        <button
          type="button"
          onClick={onLogin}
          className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Log in
        </button>
        <p className="text-center text-[10px] text-slate-400 mt-1">
          Unlock your stance profile in seconds
        </p>
      </div>
    </div>
  );
}

// ─── Section B — Guest (state router) ────────────────────────────────────────

function SectionBGuest({
  guestPanelState,
  distribution,
  onLogin,
  onSignup,
}: {
  guestPanelState: "locked" | "engaged";
  distribution: HeroDistribution | null;
  onLogin: () => void;
  onSignup: () => void;
}) {
  if (guestPanelState === "engaged") {
    return (
      <SectionBGuestEngaged
        distribution={distribution}
        onLogin={onLogin}
        onSignup={onSignup}
      />
    );
  }
  return (
    <SectionBGuestLocked
      distribution={distribution}
      onLogin={onLogin}
      onSignup={onSignup}
    />
  );
}

// ─── Section B — Alignment ring (large, centered) ────────────────────────────
// 115px outer size, percentage + "Overall Alignment" label centered inside.
// Empty state: muted track, "—" center text, no arc.

function AlignmentRing({
  pct,
  isEmpty = false,
}: {
  pct: number;
  isEmpty?: boolean;
}) {
  const size = 115;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, isEmpty ? 0 : pct));
  const dash = isEmpty ? 0 : (clamped / 100) * circ;
  const gap = circ - dash;

  const trackColor = isEmpty
    ? "#e2e8f0"
    : clamped >= 65
    ? "#10b981"
    : clamped >= 40
    ? "#f59e0b"
    : "#f87171";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={stroke}
      />
      {/* Progress arc */}
      {!isEmpty && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${gap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      )}
      {/* Center: large % */}
      <text
        x="50%"
        y="44%"
        dominantBaseline="middle"
        textAnchor="middle"
        fontSize={isEmpty ? "22" : "20"}
        fontWeight="700"
        fill={isEmpty ? "#94a3b8" : "#0f172a"}
      >
        {isEmpty ? "—" : `${Math.round(clamped)}%`}
      </text>
      {/* Center: pole-neutral sublabel — describes being in step with the
          crowd ("with the majority"), not agreement with a correct answer.
          Consistent with the "minority" wording used elsewhere in the panel. */}
      <text
        x="50%"
        y="62%"
        dominantBaseline="middle"
        textAnchor="middle"
        fontSize="9"
        fill="#94a3b8"
        fontWeight="500"
      >
        with the majority
      </text>
    </svg>
  );
}

// ─── Section B — Societal pulse row ──────────────────────────────────────────

// ─── Section B — Mini sparkline ──────────────────────────────────────────────
// Static point arrays per momentum type — conveys direction honestly.
// "up" = rising line, "polarized" = jagged flat, "reawakening" = dip then rise,
// "steady" = gentle flat. No time-series data needed.

const SPARKLINE_POINTS: Record<SocietalPulseChip["icon"], number[]> = {
  up:          [2, 3, 3, 5, 6, 7, 9],
  reawakening: [7, 5, 3, 2, 4, 6, 8],
  polarized:   [5, 7, 4, 8, 3, 7, 5],
  steady:      [5, 5, 6, 5, 6, 5, 6],
};

function MiniSparkline({
  icon,
  color,
}: {
  icon: SocietalPulseChip["icon"];
  color: string;
}) {
  const pts = SPARKLINE_POINTS[icon];
  const W = 80;
  const H = 24;
  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || 1;
  const xStep = W / (pts.length - 1);

  const coords = pts.map((v, i) => {
    const x = i * xStep;
    const y = H - ((v - minV) / range) * (H - 4) - 2;
    return `${x},${y}`;
  });
  const polyline = coords.join(" ");

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="flex-shrink-0"
      aria-hidden
    >
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    </svg>
  );
}

// ─── Section B — Societal pulse row ──────────────────────────────────────────

// Per-icon config: badge colors, momentum label, text color, sparkline color
const PULSE_CONFIG: Record<
  SocietalPulseChip["icon"],
  {
    label: string;
    labelColor: string;
    badgeBg: string;
    badgeText: string;
    badgeGlyph: string;
    sparkColor: string;
  }
> = {
  up: {
    label: "Rising",
    labelColor: "#10b981",
    badgeBg: "#ecfdf5",
    badgeText: "#059669",
    badgeGlyph: "↑",
    sparkColor: "#10b981",
  },
  reawakening: {
    label: "Reawakening",
    labelColor: "#f59e0b",
    badgeBg: "#fffbeb",
    badgeText: "#d97706",
    badgeGlyph: "↺",
    sparkColor: "#f59e0b",
  },
  polarized: {
    label: "Polarizing",
    labelColor: "#ef4444",
    badgeBg: "#fef2f2",
    badgeText: "#dc2626",
    badgeGlyph: "⇄",
    sparkColor: "#ef4444",
  },
  steady: {
    label: "Steady",
    labelColor: "#94a3b8",
    badgeBg: "#f8fafc",
    badgeText: "#64748b",
    badgeGlyph: "→",
    sparkColor: "#94a3b8",
  },
};

function PulseRow({ chip }: { chip: SocietalPulseChip }) {
  const cfg = PULSE_CONFIG[chip.icon];

  return (
    <Link
      to={chip.href}
      className="flex items-center gap-2.5 rounded-lg px-1.5 py-2 hover:bg-slate-50 transition-colors group"
    >
      {/* Circular icon badge */}
      <div
        className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold"
        style={{ backgroundColor: cfg.badgeBg, color: cfg.badgeText }}
      >
        {cfg.badgeGlyph}
      </div>

      {/* Topic name + momentum label */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-800 truncate group-hover:text-slate-900 leading-snug">
          {chip.title}
        </p>
        <p className="text-[10px] leading-snug mt-0.5">
          <span className="text-slate-400">Momentum </span>
          <span className="font-semibold" style={{ color: cfg.labelColor }}>
            {cfg.label}
          </span>
        </p>
      </div>

      {/* Mini sparkline */}
      <MiniSparkline icon={chip.icon} color={cfg.sparkColor} />
    </Link>
  );
}

// ─── Section B — Societal pulse card ─────────────────────────────────────────

function SocietalPulseCard({ chips }: { chips: SocietalPulseChip[] }) {
  if (chips.length === 0) {
    return (
      <div className="px-1">
        <p className="text-[11px] text-slate-400 italic">
          Trending topic shifts will appear here.
        </p>
      </div>
    );
  }

  const visible = chips.slice(0, 3);
  const remaining = chips.length - visible.length;

  return (
    <div>
      {/* Skeleton rows shown via parent loading state — card always renders when called */}
      <div className="space-y-0">
        {visible.map((chip) => (
          <PulseRow key={chip.topic_id} chip={chip} />
        ))}
      </div>

      {remaining > 0 && (
        <Link
          to="/topics"
          className="mt-1 flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors px-1.5"
        >
          {remaining} more <span className="text-slate-300 ml-0.5">›</span>
        </Link>
      )}
    </div>
  );
}

// ─── Section B — Stance history row ──────────────────────────────────────────

// Fixed 5-color palette by row index (teal, blue, amber, orange, pink)
const TOPIC_PALETTE = [
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#f97316", // orange
  "#ec4899", // pink
];

function StanceHistoryRow({
  topic,
  index,
}: {
  topic: TopicStanceItem;
  index: number;
}) {
  const color = TOPIC_PALETTE[index % TOPIC_PALETTE.length];

  // Show the user's LATEST position in this topic, named in that question's own
  // poles — the meaningful readout for trade-off questions. A topic-level score
  // average blends questions with different poles and can't name a side, so we
  // use the most recent answered question. Falls back to a neutral strength word
  // only when that question has no poles (older, pre-QF rows).
  const low = topic.latestLowLabel?.trim() || null;
  const high = topic.latestHighLabel?.trim() || null;
  const hasPoles = !!(low && high);
  const score = typeof topic.latestScore === "number" ? topic.latestScore : null;
  const dir = score == null ? 0 : score > 0 ? 1 : score < 0 ? -1 : 0;

  let leanText: string;
  let leanTitle: string;
  let muted = false;

  if (hasPoles && dir !== 0) {
    const full = (dir > 0 ? high : low) as string;
    leanText = clampPole(full, 3);
    leanTitle =
      `Your latest position — leans toward "${full}"` +
      (topic.answerCount > 1 ? ` · ${topic.answerCount} answered` : "");
  } else if (hasPoles && dir === 0) {
    leanText = "Middle ground";
    leanTitle = "Your latest position — right in the middle";
    muted = true;
  } else {
    // No poles on the latest question — neutral strength descriptor only.
    const mag = Math.min(100, Math.abs(topic.scorePct));
    leanText =
      mag >= 67 ? "Strong view"
      : mag >= 34 ? "Clear view"
      : mag >= 1 ? "Slight view"
      : "No strong view";
    leanTitle = "Your average position on this topic";
    muted = true;
  }

  return (
    <div className="flex items-center gap-2 py-0.5" title={leanTitle}>
      {/* Colored dot */}
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {/* Topic label */}
      <span className="flex-1 text-xs text-slate-700 font-medium truncate min-w-0">
        {topic.topicTitle}
      </span>
      {/* Latest position, named in the question's poles (full text on hover) */}
      <span
        className="text-[11px] font-medium flex-shrink-0 max-w-[48%] truncate text-right"
        style={{ color: muted ? "#94a3b8" : color }}
      >
        {leanText}
      </span>
    </div>
  );
}

// ─── Epic Q — Since Last Visit block ─────────────────────────────────────────

function SinceLastVisitBlock({
  data,
  isLoading,
}: {
  data: SinceLastVisitData | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-2.5 w-1/2 bg-slate-100 rounded" />
        <div className="h-2.5 w-full bg-slate-100 rounded" />
        <div className="h-2.5 w-4/5 bg-slate-100 rounded" />
        <div className="h-2.5 w-3/5 bg-slate-100 rounded" />
      </div>
    );
  }
  if (!data || data.days_away === 0 || !data.has_changes) return null;

  const changeIcon = (type: SinceLastVisitChange["change_type"]) =>
    type === "shifted_positive" ? "↑"
    : type === "shifted_negative" ? "↓"
    : type === "gaining_attention" ? "↻"
    : "→";

  const changeColor = (type: SinceLastVisitChange["change_type"]) =>
    type === "shifted_positive" ? "#10b981"
    : type === "shifted_negative" ? "#f43f5e"
    : type === "gaining_attention" ? "#3b82f6"
    : "#94a3b8";

  const daysText =
    data.days_away === 1 ? "yesterday"
    : data.days_away < 7 ? `${data.days_away} days ago`
    : data.days_away < 30 ? `${Math.floor(data.days_away / 7)} weeks ago`
    : `${Math.floor(data.days_away / 30)} months ago`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Since your last visit
          </span>
        </div>
        <span className="text-[10px] text-slate-400">{daysText}</span>
      </div>
      <div className="space-y-1.5">
        {data.changes.slice(0, 3).map((c) => (
          <Link
            key={c.topic_id}
            to={`/topics/${c.topic_id}`}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50 transition-colors group"
          >
            <span
              className="flex-shrink-0 text-sm font-bold w-4 text-center"
              style={{ color: changeColor(c.change_type) }}
            >
              {changeIcon(c.change_type)}
            </span>
            <span className="text-[11px] text-slate-700 truncate group-hover:text-slate-900 leading-snug">
              {c.topic_title}
              {c.change_type === "gaining_attention" && c.new_responses > 0 && (
                <span className="text-slate-400 ml-1">· {c.new_responses} new</span>
              )}
              {c.change_type !== "gaining_attention" && c.delta !== 0 && (
                <span className="text-slate-400 ml-1">
                  · {c.delta > 0 ? "+" : ""}{c.delta.toFixed(1)}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Epic Q — Return Nudge block ──────────────────────────────────────────────

function ReturnNudgeBlock({ nudge }: { nudge: ReturnNudge | null }) {
  if (!nudge) return null;

  const icons: Record<ReturnNudge["type"], string> = {
    minority_shift: "💡",
    opinion_shift:  "📊",
    new_in_topics:  "✨",
    answer_more:    "→",
  };

  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="flex-shrink-0 text-sm mt-0.5">{icons[nudge.type]}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-slate-800 leading-snug">
            {nudge.title}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
            {nudge.body}
          </p>
          <Link
            to={nudge.href}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-800 transition-colors"
          >
            {nudge.ctaLabel} →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Epic Q — Streak block ────────────────────────────────────────────────────

function StreakBlock({ streak }: { streak: UserStreak | null }) {
  if (!streak || (streak.currentStreak === 0 && !streak.isAtRisk)) return null;

  if (streak.isAtRisk) {
    return (
      <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base">⚠️</span>
          <div>
            <p className="text-[11px] font-semibold text-amber-800">
              Keep your {streak.currentStreak} day streak alive
            </p>
            <p className="text-[10px] text-amber-600 mt-0.5">
              Answer one question today
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-orange-100 bg-orange-50/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-base">🔥</span>
        <div>
          <p className="text-[11px] font-semibold text-orange-800">
            {streak.currentStreak} day streak
          </p>
          <p className="text-[10px] text-orange-600 mt-0.5">
            {streak.answeredToday
              ? "You've answered today — keep it up"
              : "You've shared a stance every day recently"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Section B — Logged-in content ───────────────────────────────────────────

function SectionBAuthed({
  snap,
  isLoading,
  pulseChips,
  myStanceSnapshot,
  sinceLastVisit,
  sinceLastVisitLoading,
  returnNudge,
  streak,
}: {
  snap: AlignmentSnapshotShape | null;
  isLoading: boolean;
  pulseChips: SocietalPulseChip[];
  myStanceSnapshot: MyStanceSnapshot | null;
  sinceLastVisit: SinceLastVisitData | null;
  sinceLastVisitLoading: boolean;
  returnNudge: ReturnNudge | null;
  streak: UserStreak | null;
}) {
  if (isLoading) {
    return <SectionBSkeleton />;
  }

  const totalAnswered = myStanceSnapshot?.totalAnswered ?? 0;
  const isEmpty = totalAnswered === 0;
  const isForming = totalAnswered > 0 && totalAnswered < 3;
  const alignmentPct = snap?.alignment_pct ?? 0;
  // How many of the user's answers have a real crowd to compare against.
  // When 0, "% with the majority" is not meaningful (the user is first/only
  // respondent), so we show a forming state rather than a misleading 0%.
  const comparableCount = snap?.comparable_count ?? 0;
  const noCommunityData = totalAnswered > 0 && comparableCount === 0;
  const ringEmpty = isEmpty || noCommunityData;
  const topics = myStanceSnapshot?.topics ?? [];
  const hasPulse = pulseChips.length > 0;

  // Insight line: pole-neutral, majority/minority framing derived from the same
  // alignment_pct the ring shows, but only once there's a crowd to compare
  // against. Avoids agree/disagree wording so it reads correctly for trade-off
  // questions (no implied "right" side). Softer copy for low / no data.
  const insightLine = isEmpty
    ? "Answer a few questions to see where you stand"
    : noCommunityData
    ? "Not enough community data yet to compare"
    : isForming
    ? "Your profile is still forming"
    : alignmentPct >= 65
    ? "You're usually in step with the majority"
    : alignmentPct >= 40
    ? "Sometimes with the majority, sometimes not"
    : "You often take the less common view";

  return (
    <div className="flex flex-col h-full p-4 gap-3 overflow-y-auto">

      {/* ── Block 1: Where you stand ── */}
      <div>
        {/* Eyebrow */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Where you stand
          </span>
        </div>

        {/* Large centered ring */}
        <div className="flex justify-center mb-2">
          <AlignmentRing pct={alignmentPct} isEmpty={ringEmpty} />
        </div>

        {/* Insight line */}
        {insightLine && (
          <p className="text-[11px] text-slate-500 text-center leading-snug px-1">
            {insightLine}
          </p>
        )}
      </div>

      {/* ── Block 2: Stance history ── */}
      <div>
        <p className="text-xs font-semibold text-slate-700 mb-2">
          Your Stance History
        </p>

        {isEmpty || topics.length === 0 ? (
          <p className="text-[11px] text-slate-400 italic">
            {isEmpty
              ? "No stance history yet"
              : "Answer more questions to build your history"}
          </p>
        ) : (
          <div className="space-y-1">
            {topics.slice(0, 5).map((t, i) => (
              <StanceHistoryRow key={t.topicTitle} topic={t} index={i} />
            ))}
          </div>
        )}

        {!isEmpty && (
          <Link
            to="/me/stances"
            className="mt-2 block text-[11px] font-medium text-violet-600 hover:text-violet-800 transition-colors"
          >
            See all →
          </Link>
        )}
      </div>

      {/* ── Block 3: Since Your Last Visit (Q1) ── */}
      {(sinceLastVisitLoading || (sinceLastVisit?.has_changes && (sinceLastVisit?.days_away ?? 0) >= 1)) && (
        <>
          <div className="border-t border-slate-100" />
          <SinceLastVisitBlock data={sinceLastVisit} isLoading={sinceLastVisitLoading} />
        </>
      )}

      {/* ── Block 4: Return Nudge (Q2) ── */}
      {returnNudge && <ReturnNudgeBlock nudge={returnNudge} />}

      {/* ── Divider before Societal Pulse ── */}
      {hasPulse && <div className="border-t border-slate-100" />}

      {/* ── Block 5: Societal Pulse ── */}
      {hasPulse && (
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Societal Pulse
            </span>
          </div>
          <SocietalPulseCard chips={pulseChips} />
        </div>
      )}

      {/* ── Block 6: Streak (Q3) ── */}
      {streak && (streak.currentStreak > 0 || streak.isAtRisk) && (
        <>
          <div className="border-t border-slate-100" />
          <StreakBlock streak={streak} />
        </>
      )}

    </div>
  );
}

// ─── Section A inner content ──────────────────────────────────────────────────

function SectionAQuestion({
  question,
  status,
  submittedStance,
  distribution,
  isAuthed,
  hasQueue,
  onSubmit,
  onLoginRedirect,
  onNavigateToQuestion,
  onAdvanceNow,
  onRefreshDistribution,
  onGuestEngage,
  onStage,
  isFallbackMode = false,
}: {
  question: HeroQuestion;
  status: HeroStatus;
  submittedStance: number | null;
  distribution: HeroDistribution | null;
  isAuthed: boolean;
  hasQueue: boolean;
  onSubmit: (v: number) => Promise<void>;
  onLoginRedirect: () => void;
  onNavigateToQuestion: (id: string) => void;
  onAdvanceNow: () => void;
  onRefreshDistribution: () => void;
  // Guest-only: fires once on first slider interaction to transition right panel
  onGuestEngage: () => void;
  // Guest-only: stages an anonymous stance instead of bouncing to login
  onStage?: (questionId: string, value: number) => void;
  // True when showing fallback-scope content — surfaces a subtle chip on the card
  isFallbackMode?: boolean;
}) {
  const isResultMode =
    status === "hero_answered_result" || status === "hero_transitioning";
  const isSubmitting = status === "hero_submitting";

  return (
    <div className="flex flex-col h-full">

      {/* ── Split layout: text left on white, image right with fade ── */}
      <div className="relative overflow-hidden">

        {question.cover_image_url && (
          <>
            <img
              src={question.cover_image_url}
              alt=""
              className="absolute top-0 right-0 h-full w-3/5 object-cover object-center"
              loading="eager"
            />
            <div
              className="absolute top-0 right-0 h-full w-3/5 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to right, white 0%, white 15%, rgba(255,255,255,0.85) 35%, rgba(255,255,255,0.3) 65%, transparent 100%)",
              }}
            />
          </>
        )}

        <div className="relative z-10 p-5 pb-4" style={{ maxWidth: "68%" }}>

          {/* Eyebrow */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-semibold" style={{ color: "#5E3D9E" }}>One big shifting question</span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Answer in seconds — see where society stands.
          </p>

          {/* Tags + signals */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {question.topic_title && (
              <Tag primary>{question.topic_title}</Tag>
            )}
            {question.audience_location_label && (
              <Tag>📍 {question.audience_location_label}</Tag>
            )}
            {question.tags && question.tags.slice(0, 2).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
            {question.trend_micro_signal && (
              <Pill>{question.trend_micro_signal.toUpperCase()}</Pill>
            )}
            {isFallbackMode && (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 gap-1">
                🌐 Global conversation
              </span>
            )}
          </div>

          {/* Question headline — always shown in full.
              Users must be able to read the complete question before submitting
              a stance. line-clamp removed deliberately: truncation forces a
              click-through to QDP just to read what you're being asked. */}
          <button
            type="button"
            onClick={() => onNavigateToQuestion(question.question_id)}
            className={[
              "text-left font-bold text-slate-900 leading-snug hover:underline underline-offset-2",
              question.question_text.length > 160
                ? "text-base"
                : question.question_text.length > 100
                ? "text-lg"
                : "text-2xl",
            ].join(" ")}
          >
            {question.question_text}
          </button>
        </div>
      </div>

      {/* ── Slider / Result section ── */}
      <div className="flex-1 px-5 pb-5 pt-4 border-t border-slate-100">

        {isAuthed ? (
          <>
            {/* Authed: Community bar → divider → slider */}
            <div className="mb-4">
              <CommunityStanceBar
                responses={distribution?.responses ?? 0}
                supportPct={distribution?.supportPct ?? null}
                opposePct={distribution?.opposePct ?? null}
                neutralPct={distribution?.neutralPct ?? null}
                regionLabel={distribution?.regionLabel ?? "Global"}
                avgScore={distribution?.avgScore ?? null}
                isLoading={false}
                isEmpty={!distribution || (distribution.responses ?? 0) === 0}
                onRefresh={onRefreshDistribution}
                compact={true}
                lowLabel={question.slider_low_label ?? null}
                highLabel={question.slider_high_label ?? null}
              />
              {status === "hero_answered_result" && hasQueue && (
                <button
                  type="button"
                  onClick={onAdvanceNow}
                  className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-700 transition-colors underline underline-offset-2"
                >
                  Next question →
                </button>
              )}
            </div>
            <div className="border-t border-slate-100 mb-4" />
            <QuestionStanceSlider
              key={`hero-${question.question_id}`}
              questionId={question.question_id}
              questionText={question.question_text}
              summary={question.summary}
              initialValue={isResultMode ? (submittedStance ?? null) : null}
              disabled={isSubmitting}
              pulseThumb={!isSubmitting && !isResultMode}
              onSubmit={onSubmit}
              sliderLowLabel={question.slider_low_label ?? null}
              sliderHighLabel={question.slider_high_label ?? null}
              headerAction={
                <ShareButton
                  questionId={question.question_id}
                  questionText={question.question_text}
                  questionSummary={question.summary}
                  compact
                />
              }
            />
          </>
        ) : (
          <>
            {/* Guest: slider stages anonymously (no login bounce). */}
            <QuestionStanceSlider
              key={`hero-anon-${question.question_id}`}
              questionId={question.question_id}
              questionText={question.question_text}
              summary={question.summary}
              initialValue={null}
              onSubmit={(v) => (onStage ? onStage(question.question_id, v) : onLoginRedirect())}
              onInteractionStart={onGuestEngage}
              sliderLowLabel={question.slider_low_label ?? null}
              sliderHighLabel={question.slider_high_label ?? null}
            />

            <div className="mt-5 flex flex-col items-center gap-2">
              <p className="text-xs text-slate-400">
                Your stance is recorded anonymously — add your voice below to count it.
              </p>
            </div>

            {/* Community teaser — replaces CommunityStanceBar for guests */}
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-center">
              <p className="text-xs font-medium text-slate-500">
                💬 Add your voice to unlock how the community is thinking.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Section A — Error state ──────────────────────────────────────────────────

function SectionAError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[240px] p-6 text-center gap-3">
      <p className="text-sm text-slate-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

// ─── Section A — Waiting for next ─────────────────────────────────────────────

function SectionAWaiting() {
  const [showSpinner, setShowSpinner] = React.useState(true);
  React.useEffect(() => {
    const t = setTimeout(() => setShowSpinner(false), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[240px] p-6 gap-3 text-center">
      {showSpinner ? (
        <>
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
          <p className="text-sm text-slate-400">Loading next question…</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-600">You're all caught up!</p>
          <p className="text-xs text-slate-400">New questions are on their way. Check back shortly.</p>
        </>
      )}
    </div>
  );
}

// ─── Section C — Queue card ───────────────────────────────────────────────────

function QueueCard({
  question,
  isUpNext,
  onClick,
}: {
  question: HeroQuestion;
  isUpNext: boolean;
  onClick: () => void;
}) {
  const teaser = deriveTeaserLabel(question);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group flex-shrink-0 w-48 sm:w-56 text-left rounded-xl overflow-hidden transition-all duration-200",
        "ring-1 ring-slate-900/5 bg-white shadow-sm",
        "hover:shadow-md hover:ring-slate-900/10 hover:-translate-y-0.5",
        isUpNext ? "ring-2 ring-indigo-300 shadow-indigo-100" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="relative h-24 overflow-hidden bg-slate-100">
        {question.cover_image_url ? (
          <img
            src={question.cover_image_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300" />
        )}

        {isUpNext && (
          <div className="absolute top-2 left-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            Up Next
          </div>
        )}

        {teaser && !isUpNext && (
          <div className="absolute bottom-2 left-2 rounded-full bg-black/50 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white">
            {teaser}
          </div>
        )}
      </div>

      <div className="p-3">
        {question.topic_title && (
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
            {question.topic_title}
          </p>
        )}
        <p className="text-xs font-semibold text-slate-800 leading-snug line-clamp-3">
          {question.question_text}
        </p>
      </div>
    </button>
  );
}

// ─── Section C — Queue stream ─────────────────────────────────────────────────

function SectionC({
  queuedQuestions,
  status,
  onPromote,
}: {
  queuedQuestions: HeroQuestion[];
  status: HeroStatus;
  onPromote: (id: string) => void;
}) {
  const hasAnswered =
    status === "hero_answered_result" || status === "hero_transitioning";

  if (queuedQuestions.length === 0) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex-shrink-0 w-48 sm:w-56 rounded-xl bg-slate-100 animate-pulse"
            style={{ height: 160 }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {queuedQuestions.slice(0, 6).map((q, i) => (
        <div key={q.question_id} className="snap-start">
          <QueueCard
            question={q}
            isUpNext={hasAnswered && i === 0}
            onClick={() => onPromote(q.question_id)}
          />
        </div>
      ))}
    </div>
  );
}

// ─── HeroSection — main export ────────────────────────────────────────────────

export function HeroSection({
  allQuestions,
  isLoading,
  isAuthed,
  regionLabel,
  alignmentSnap,
  alignmentSnapLoading,
  societalPulseChips,
  myStanceSnapshot,
  sinceLastVisit,
  sinceLastVisitLoading,
  returnNudge,
  streak,
  isFallbackMode = false,
  onRequestReplenish,
  onSubmitSuccess,
  onLoginRedirect,
  onStage,
  onNavigateToQuestion,
  onLogin,
  onSignup,
}: HeroSectionProps) {
  const {
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
  } = useHeroController({
    allQuestions,
    isLoading,
    isAuthed,
    regionLabel,
    onRequestReplenish,
    onSubmitSuccess,
    onLoginRedirect,
  });

  // ── Guest engagement state ──
  // Flips to true when a logged-out user first interacts with the hero slider.
  // Drives the locked → engaged transition in the right panel.
  // Reset when: (a) hero question changes, (b) user becomes authenticated.
  const [guestHasEngaged, setGuestHasEngaged] = React.useState(false);

  // Reset on question change
  const currentQuestionId = currentHeroQuestion?.question_id;
  React.useEffect(() => {
    setGuestHasEngaged(false);
  }, [currentQuestionId]);

  // Reset on auth transition (false → true only, no-op if already authed)
  React.useEffect(() => {
    if (isAuthed) setGuestHasEngaged(false);
  }, [isAuthed]);

  const guestPanelState: "locked" | "engaged" =
    !isAuthed && guestHasEngaged ? "engaged" : "locked";

  // ── Content visibility (fade on question transition) ──
  const [contentVisible, setContentVisible] = React.useState(true);

  React.useEffect(() => {
    if (status === "hero_transitioning") {
      setContentVisible(false);
    } else if (status === "hero_ready" || status === "hero_answered_result") {
      const t = setTimeout(() => setContentVisible(true), 30);
      return () => clearTimeout(t);
    }
  }, [status]);

  return (
    <section className="space-y-3">

      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">

        {/* ── Section A — Hero question ── */}
        <div
          className={`${card} overflow-hidden lg:flex-[65]`}
          style={{ minHeight: 380 }}
        >
          <div
            className="h-full transition-opacity duration-300"
            style={{ opacity: contentVisible ? 1 : 0 }}
          >
            {status === "hero_loading" && <SectionASkeleton />}

            {status === "hero_error" && (
              <SectionAError
                message={errorMessage ?? "Something went wrong."}
                onRetry={retry}
              />
            )}

            {status === "hero_waiting_next" && <SectionAWaiting />}

            {currentHeroQuestion &&
              status !== "hero_loading" &&
              status !== "hero_error" &&
              status !== "hero_waiting_next" && (
                <SectionAQuestion
                  question={currentHeroQuestion}
                  status={status}
                  submittedStance={submittedStance}
                  distribution={distribution}
                  isAuthed={isAuthed}
                  hasQueue={queuedQuestions.length > 0}
                  onSubmit={submitHeroStance}
                  onLoginRedirect={onLoginRedirect}
                  onNavigateToQuestion={onNavigateToQuestion}
                  onAdvanceNow={advanceNow}
                  onRefreshDistribution={refreshDistribution}
                  onGuestEngage={() => setGuestHasEngaged(true)}
                  onStage={onStage}
                  isFallbackMode={isFallbackMode}
                />
              )}
          </div>
        </div>

        {/* ── Section B — Right panel ── */}
        <div
          className={`${card} overflow-hidden lg:flex-[35]`}
          style={{ minHeight: 300 }}
        >
          {isAuthed ? (
            <SectionBAuthed
              snap={alignmentSnap}
              isLoading={alignmentSnapLoading}
              pulseChips={societalPulseChips}
              myStanceSnapshot={myStanceSnapshot}
              sinceLastVisit={sinceLastVisit}
              sinceLastVisitLoading={sinceLastVisitLoading}
              returnNudge={returnNudge}
              streak={streak}
            />
          ) : (
            <SectionBGuest
              guestPanelState={guestPanelState}
              distribution={distribution}
              onLogin={onLogin}
              onSignup={onSignup}
            />
          )}
        </div>
      </div>

      {/* ── Section C — Queue ── */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Up next
          </p>
          {queuedQuestions.length > 0 && (
            <p className="text-[11px] text-slate-400">
              {queuedQuestions.length} question{queuedQuestions.length === 1 ? "" : "s"} queued
            </p>
          )}
        </div>
        <SectionC
          queuedQuestions={queuedQuestions}
          status={status}
          onPromote={promoteQuestion}
        />
      </div>

    </section>
  );
}

export default HeroSection;
