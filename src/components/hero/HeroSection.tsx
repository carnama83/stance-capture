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

// Recent stance item — mapped from question_stances join in Index.tsx
export interface RecentStanceItem {
  questionId: string;
  questionText: string;
  topicTitle: string | null;
  score: number;
  label: "support" | "neutral" | "oppose";
}

export interface HeroSectionProps {
  allQuestions: HeroQuestion[];
  isLoading: boolean;
  isAuthed: boolean;
  regionLabel: string;
  alignmentSnap: AlignmentSnapshotShape | null;
  alignmentSnapLoading: boolean;
  societalPulseChips: SocietalPulseChip[];
  recentStances: RecentStanceItem[];
  // True when hero is showing questions outside the user's normal region scope
  // (fallback feed active). Surfaces a subtle "broader view" chip on the hero card.
  isFallbackMode?: boolean;
  onRequestReplenish: () => void;
  onSubmitSuccess: (questionId: string, value: number) => Promise<void>;
  onLoginRedirect: () => void;
  onNavigateToQuestion: (id: string) => void;
  onLogin: () => void;
  onSignup: () => void;
}

// Minimal alignment snapshot shape (matches AlignmentSnapshotRow in Index.tsx)
export interface AlignmentSnapshotShape {
  alignment_pct: number;
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

// ─── Section B — Alignment ring meter ────────────────────────────────────────

function AlignmentRing({ pct }: { pct: number }) {
  const size = 72;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * circ;
  const gap = circ - dash;

  // Color: < 40 red-ish, 40-65 amber, > 65 emerald
  const trackColor =
    clamped >= 65 ? "#10b981" : clamped >= 40 ? "#f59e0b" : "#f87171";

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
      {/* Progress arc — starts at top (rotate -90deg) */}
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
        style={{ transition: "stroke-dasharray 0.5s ease" }}
      />
      {/* Center label */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        fill="#0f172a"
      >
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

// ─── Section B — Societal pulse row ──────────────────────────────────────────

function PulseRow({ chip }: { chip: SocietalPulseChip }) {
  const momentumLabel =
    chip.icon === "up"
      ? "Rising"
      : chip.icon === "reawakening"
      ? "Reawakening"
      : chip.icon === "polarized"
      ? "Polarizing"
      : "Steady";

  const momentumColor =
    chip.icon === "polarized"
      ? "text-red-500"
      : chip.icon === "steady"
      ? "text-slate-400"
      : "text-emerald-600";

  const bgColor =
    chip.icon === "up"
      ? "bg-emerald-50"
      : chip.icon === "reawakening"
      ? "bg-amber-50"
      : chip.icon === "polarized"
      ? "bg-red-50"
      : "bg-slate-100";

  const iconGlyph =
    chip.icon === "up"
      ? "↑"
      : chip.icon === "reawakening"
      ? "↺"
      : chip.icon === "polarized"
      ? "⇄"
      : "→";

  return (
    <Link
      to={chip.href}
      className="flex items-center gap-2.5 rounded-lg p-2 hover:bg-slate-50 transition-colors group"
    >
      {/* Icon badge */}
      <div
        className={`flex-shrink-0 h-8 w-8 rounded-lg ${bgColor} flex items-center justify-center text-sm font-semibold text-slate-600`}
      >
        {iconGlyph}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-800 truncate group-hover:text-slate-900">
          {chip.title}
        </p>
        <p className={`text-[10px] font-medium ${momentumColor}`}>
          Momentum · {momentumLabel}
        </p>
      </div>
    </Link>
  );
}

// ─── Section B — Logged-in content ───────────────────────────────────────────

// ─── Section B — Recent stance pill ──────────────────────────────────────────

function StancePill({ label }: { label: "support" | "neutral" | "oppose" }) {
  if (label === "support") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
        Support
      </span>
    );
  }
  if (label === "oppose") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 border border-red-200">
        Oppose
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
      Neutral
    </span>
  );
}

// ─── Section B — Logged-in content ───────────────────────────────────────────

function SectionBAuthed({
  snap,
  isLoading,
  pulseChips,
  recentStances,
}: {
  snap: AlignmentSnapshotShape | null;
  isLoading: boolean;
  pulseChips: SocietalPulseChip[];
  recentStances: RecentStanceItem[];
}) {
  if (isLoading) {
    return <SectionBSkeleton />;
  }

  const hasSnap = snap != null;
  const hasPulse = pulseChips.length > 0;
  const hasStances = recentStances.length > 0;

  if (!hasSnap && !hasPulse && !hasStances) {
    // Empty state — user hasn't answered enough yet
    return (
      <div className="flex flex-col justify-center h-full p-5">
        <div className="flex items-center gap-1.5 mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Your profile
          </span>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          Start answering questions to build your stance profile.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Answer the question on the left to compare your position here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-5 gap-4 overflow-y-auto">

      {/* ── Block 1: Where you stand ── */}
      {hasSnap && (
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Where you stand
            </span>
          </div>

          {/* Ring + label row */}
          <div className="flex items-center gap-3 mb-3">
            <AlignmentRing pct={snap.alignment_pct} />
            <div>
              <p className="text-sm font-semibold text-slate-900 leading-snug">
                Overall Alignment
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                You hold the minority view on{" "}
                <strong className="text-slate-700">{snap.minority_count}</strong>{" "}
                question{snap.minority_count === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {/* Recent stances list — shown when available, replaces divergent card */}
          {hasStances ? (
            <div className="space-y-1">
              {recentStances.map((s) => (
                <div
                  key={s.questionId}
                  className="flex items-center justify-between gap-2 py-1"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/q/${s.questionId}`}
                      className="text-xs text-slate-700 font-medium line-clamp-1 hover:underline leading-snug"
                    >
                      {s.questionText}
                    </Link>
                    {s.topicTitle && (
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {s.topicTitle}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <StancePill label={s.label} />
                  </div>
                </div>
              ))}
              <Link
                to="/me/stances"
                className="mt-1 block text-[11px] font-medium text-violet-600 hover:text-violet-800 transition-colors"
              >
                See all →
              </Link>
            </div>
          ) : (
            // Fallback: most divergent card when no recent stances yet
            snap.most_divergent_question_text && (
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                  Most divergent view
                </p>
                {snap.most_divergent_question_id ? (
                  <Link
                    to={`/q/${snap.most_divergent_question_id}`}
                    className="text-xs text-slate-600 line-clamp-2 leading-relaxed hover:underline"
                  >
                    {snap.most_divergent_question_text}
                  </Link>
                ) : (
                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {snap.most_divergent_question_text}
                  </p>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* ── Divider ── */}
      {(hasSnap || hasStances) && hasPulse && (
        <div className="border-t border-slate-100" />
      )}

      {/* ── Block 2: Societal pulse ── */}
      {hasPulse && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Societal Pulse
            </span>
          </div>

          <div className="space-y-0.5">
            {pulseChips.slice(0, 3).map((chip) => (
              <PulseRow key={chip.topic_id} chip={chip} />
            ))}
          </div>

          {pulseChips.length > 3 && (
            <Link
              to="/topics"
              className="mt-2 flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-700 transition-colors px-2"
            >
              {pulseChips.length - 3} more <span className="text-slate-300">›</span>
            </Link>
          )}
        </div>
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

          {/* Question headline */}
          <button
            type="button"
            onClick={() => onNavigateToQuestion(question.question_id)}
            className={[
              "text-left font-bold text-slate-900 leading-snug hover:underline underline-offset-2 line-clamp-4",
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
            />
          </>
        ) : (
          <>
            {/* Guest: slider first, then pill CTA, then community teaser */}
            {/* onGuestEngage is wired only to the guest slider — NOT the authed path */}
            <div
              onPointerUpCapture={onLoginRedirect}
              onPointerCancelCapture={onLoginRedirect}
              onMouseUpCapture={onLoginRedirect}
              onTouchEndCapture={onLoginRedirect}
              className="cursor-pointer"
            >
              <QuestionStanceSlider
                key={`hero-anon-${question.question_id}`}
                questionId={question.question_id}
                questionText={question.question_text}
                summary={question.summary}
                initialValue={null}
                onSubmit={onLoginRedirect}
                onInteractionStart={onGuestEngage}
              />
            </div>

            {/* Share Your Stance pill CTA */}
            <div className="mt-5 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={onLoginRedirect}
                className="inline-flex items-center justify-center gap-2 rounded-full py-2.5 px-10 text-sm font-semibold text-white shadow-md transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                style={{ backgroundColor: "#6048C0" }}
              >
                Share Your Stance →
              </button>
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>👁</span> See how society stands after you answer.
              </p>
            </div>

            {/* Community teaser — replaces CommunityStanceBar for guests */}
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-center">
              <p className="text-xs font-medium text-slate-500">
                💬 State your opinion to unlock how the community is thinking —{" "}
                <button
                  type="button"
                  onClick={onLoginRedirect}
                  className="font-semibold underline underline-offset-2 transition-colors"
                  style={{ color: "#6048C0" }}
                >
                  sign in to see the full picture.
                </button>
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
  recentStances,
  isFallbackMode = false,
  onRequestReplenish,
  onSubmitSuccess,
  onLoginRedirect,
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
              recentStances={recentStances}
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
