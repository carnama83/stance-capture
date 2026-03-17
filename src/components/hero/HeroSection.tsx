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
//   - Section B min-height: 280px desktop / 220px mobile — no layout shift
//   - Timer lives in useHeroController (outside this tree)
//   - "Up Next" label on first queue card only after answer
//   - Queue card click → promoteQuestion (works from both ready + answered_result)
//   - hero_error shows inline retry in Section A
//   - Section B mobile CTA: direction-neutral "Answer above"

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

export interface HeroSectionProps {
  allQuestions: HeroQuestion[];
  isLoading: boolean;
  isAuthed: boolean;
  regionLabel: string;
  alignmentSnap: AlignmentSnapshotShape | null;
  alignmentSnapLoading: boolean;
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

// ─── Shared atoms (self-contained — no import from Index.tsx) ────────────────

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
}) {
  const isResultMode =
    status === "hero_answered_result" || status === "hero_transitioning";
  const isSubmitting = status === "hero_submitting";

  return (
    <div className="flex flex-col h-full">

      {/* ── Split layout: text left on white, image right with fade ── */}
      <div className="relative overflow-hidden">

        {/* Image — absolute, right-aligned, fills full height of this section */}
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

        {/* Text content */}
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

        {/* Community distribution bar — uses shared CommunityStanceBar with normalized field names */}
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

          {/* Next question nudge — only when answered AND queue has items to advance to */}
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

        {/* Divider between community bar and user's slider */}
        <div className="border-t border-slate-100 mb-4" />

        {/* Slider — always visible so user can change their stance after answering */}
        <>
        {isAuthed ? (
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
        ) : (
          <>
            {/* Slider first for guests */}
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
              />
            </div>

            {/* Share Your Stance CTA — half-width, centered, below slider */}
            <div className="mt-4 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={onLoginRedirect}
                className="flex items-center justify-center gap-2 rounded-xl py-3 px-8 text-sm font-semibold text-white transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                style={{ backgroundColor: "#5E3D9E", minWidth: "260px" }}
              >
                Share Your Stance <span className="text-base">→</span>
              </button>
              <p className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>👁</span> See how society stands after you answer.
              </p>
            </div>
          </>
        )}
        </>
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
  // Show a brief spinner, then switch to a friendly "all caught up" message
  // to avoid an infinite loading state when no new questions are available yet.
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

// ─── Section B — Guest content ────────────────────────────────────────────────

function SectionBGuest({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <div className="flex flex-col justify-between h-full p-5">
      <div>
        <div className="flex items-center gap-1.5 mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Live
          </span>
        </div>

        <h3 className="text-base font-semibold text-slate-900 leading-snug mb-2">
          See where you stand
        </h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          Answer the question above to compare your stance with society. See whether
          you align with the majority or minority view.
        </p>

        <ul className="mt-4 space-y-2">
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

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={onSignup}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
        >
          Get started free
        </button>
        <button
          type="button"
          onClick={onLogin}
          className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Log in
        </button>
      </div>
    </div>
  );
}

// ─── Section B — Logged-in content ───────────────────────────────────────────

function SectionBAuthed({
  snap,
  isLoading,
}: {
  snap: AlignmentSnapshotShape | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <SectionBSkeleton />;
  }

  if (!snap) {
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
          Answer the question above to compare your position here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-between h-full p-5">
      <div>
        <div className="flex items-center gap-1.5 mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            Where you stand
          </span>
        </div>

        <div className="mb-1">
          <span className="text-3xl font-bold text-slate-900">
            {formatPct(snap.alignment_pct)}
          </span>
          <span className="ml-2 text-sm text-slate-500">overall alignment</span>
        </div>

        <p className="text-xs text-slate-500 mb-4">
          You hold the minority view on{" "}
          <strong className="text-slate-700">{snap.minority_count}</strong>{" "}
          question{snap.minority_count === 1 ? "" : "s"}.
        </p>

        {snap.most_divergent_question_text && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Most divergent view
            </p>
            <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
              {snap.most_divergent_question_text}
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400 leading-relaxed">
        Answer the question above to update your profile.
      </p>
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
                />
              )}
          </div>
        </div>

        <div
          className={`${card} overflow-hidden lg:flex-[35]`}
          style={{ minHeight: 280 }}
        >
          {isAuthed ? (
            <SectionBAuthed
              snap={alignmentSnap}
              isLoading={alignmentSnapLoading}
            />
          ) : (
            <SectionBGuest onLogin={onLogin} onSignup={onSignup} />
          )}
        </div>
      </div>

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
