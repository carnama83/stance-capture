// src/pages/PersonalInsightsPage.tsx
// S1 — Personal Opinion Intelligence dashboard.
// Combines: cognitive profile summary, topic belief profiles (stable/volatile),
// stance evolution timeline, and a "revisit old answers" CTA.

import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageLayout from "@/components/PageLayout";
import {
  useCognitiveState,
  useCalculateCognitiveState,
  useShouldRecalculateCognitiveState,
  type CognitiveState,
} from "@/hooks/useCognitiveState";
import { getStanceColorHex } from "@/lib/stanceColors";
import StanceEvolutionTimeline from "@/components/insights/StanceEvolutionTimeline";
import TopicBeliefProfile from "@/components/insights/TopicBeliefProfile";
import { Loader2, RefreshCw, ArrowLeft } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function meanStanceLabel(mean: number): string {
  if (mean >= 1.5)  return "Strongly agreement-leaning";
  if (mean >= 0.5)  return "Leans toward agreement";
  if (mean >= -0.5) return "Broadly neutral";
  if (mean >= -1.5) return "Leans toward disagreement";
  return "Strongly disagreement-leaning";
}

function consistencyLabel(score: number): string {
  if (score >= 0.8) return "Highly consistent";
  if (score >= 0.6) return "Mostly consistent";
  if (score >= 0.4) return "Somewhat variable";
  return "Actively evolving";
}

// ── Overall profile summary card ──────────────────────────────────────────────

function ProfileSummary({ state }: { state: CognitiveState }) {
  const p = state.cognitive_profile;
  const stanceColor = getStanceColorHex(Math.round(state.overall_mean_stance));
  const total = Object.values(p.stance_distribution).reduce((s, v) => s + v, 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 space-y-4">
      {/* Headline numbers */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-50 rounded-lg px-3 py-2.5">
          <p className="text-[11px] text-slate-400 mb-0.5">Questions answered</p>
          <p className="text-2xl font-medium text-slate-900">
            {state.total_questions_answered}
          </p>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2.5">
          <p className="text-[11px] text-slate-400 mb-0.5">Topics engaged</p>
          <p className="text-2xl font-medium text-slate-900">
            {state.active_topic_count}
          </p>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2.5">
          <p className="text-[11px] text-slate-400 mb-0.5">Per week</p>
          <p className="text-2xl font-medium text-slate-900">
            {p.engagement_patterns.questions_per_week.toFixed(1)}
          </p>
        </div>
      </div>

      {/* Overall stance */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Overall lean
          </p>
          <span className="text-sm font-medium" style={{ color: stanceColor }}>
            {meanStanceLabel(state.overall_mean_stance)}
          </span>
        </div>
        {/* Full distribution bar */}
        <div className="flex h-2 w-full rounded-full overflow-hidden bg-slate-100">
          {(["strong_disagree","disagree","neutral","agree","strong_agree"] as const).map((key, i) => {
            const count = p.stance_distribution[key] ?? 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            const colors = ["#D85A30","#EF9F27","#B4B2A9","#97C459","#639922"];
            return pct > 0 ? (
              <div key={key} style={{ width: `${pct}%`, background: colors[i] }} />
            ) : null;
          })}
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-0.5">
          <span>Strongly disagree</span>
          <span>Neutral</span>
          <span>Strongly agree</span>
        </div>
      </div>

      {/* Consistency */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-100">
        <p className="text-xs text-slate-500">Opinion consistency</p>
        <span className="text-xs font-medium text-slate-700">
          {consistencyLabel(state.stance_consistency_score)}
          <span className="text-slate-400 font-normal ml-1">
            ({Math.round(state.stance_consistency_score * 100)}%)
          </span>
        </span>
      </div>

      {/* Last evaluated */}
      <p className="text-[10px] text-slate-400">
        Profile last updated {new Date(state.evaluated_at).toLocaleDateString(undefined, {
          dateStyle: "medium",
        })}
      </p>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Revisit CTA ───────────────────────────────────────────────────────────────

function RevisitCTA() {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-900 mb-0.5">
          Revisit old answers
        </p>
        <p className="text-xs text-slate-500 leading-relaxed">
          Your views may have changed. Go back to questions you answered
          a while ago and see if you still feel the same way.
        </p>
      </div>
      <Link
        to="/me/stances"
        className="flex-shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap"
      >
        My stances →
      </Link>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PersonalInsightsPage() {
  const { data: cognitiveState, isLoading } = useCognitiveState();
  const { mutate: recalculate, isPending: isRecalculating } = useCalculateCognitiveState();
  const { data: shouldRecalculate } = useShouldRecalculateCognitiveState();

  const [activeTab, setActiveTab] = React.useState<"profile" | "evolution">("profile");

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto py-4 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              Your opinion profile
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              How your views look across topics, and how they've changed over time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {shouldRecalculate && (
              <button
                type="button"
                onClick={() => recalculate()}
                disabled={isRecalculating}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRecalculating ? "animate-spin" : ""}`} />
                Update profile
              </button>
            )}
            <Link
              to="/insights"
              className="text-xs text-slate-500 hover:underline flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </Link>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 py-8 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your profile…
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !cognitiveState && (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-5 py-8 text-center">
            <p className="text-sm font-medium text-slate-900 mb-1">
              No profile yet
            </p>
            <p className="text-xs text-slate-500 mb-4">
              Answer at least 3 questions to generate your opinion profile.
            </p>
            <Link
              to="/"
              className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
            >
              Answer questions
            </Link>
          </div>
        )}

        {/* Content */}
        {!isLoading && cognitiveState && (
          <>
            {/* Profile summary */}
            <Section title="Overview">
              <ProfileSummary state={cognitiveState} />
            </Section>

            {/* Tab toggle */}
            <div className="flex gap-1 border-b border-slate-100 pb-0">
              {(["profile", "evolution"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={[
                    "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors border-b-2 -mb-px",
                    activeTab === tab
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-700",
                  ].join(" ")}
                >
                  {tab === "profile" ? "Belief profile" : "How you've changed"}
                </button>
              ))}
            </div>

            {/* Tab: Belief profile */}
            {activeTab === "profile" && (
              <Section
                title="Your stance by topic"
                description="How strongly you hold your views, and whether they're consistent or still forming."
              >
                <TopicBeliefProfile
                  topicProfiles={cognitiveState.cognitive_profile.topic_profiles}
                />
              </Section>
            )}

            {/* Tab: Evolution timeline */}
            {activeTab === "evolution" && (
              <Section
                title="Stance changes over time"
                description="Questions where you changed your mind, most recent first."
              >
                <StanceEvolutionTimeline limit={30} />
              </Section>
            )}

            {/* Revisit CTA — always visible */}
            <RevisitCTA />
          </>
        )}
      </div>
    </PageLayout>
  );
}
