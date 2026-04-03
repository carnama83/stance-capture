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
import { Loader2, RefreshCw, ArrowLeft, MapPin, RotateCcw } from "lucide-react";

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

// ── S1: Revisit section — questions answered >30 days ago ordered by drift ────

type RevisitRow = {
  question_id: string;
  question_text: string;
  topic_title: string | null;
  user_score: number;
  community_avg_score: number | null;
  drift: number; // |user_score - community_avg_score|
  answered_at: string;
};

function useRevisitQuestions() {
  return useQuery<RevisitRow[]>({
    queryKey: ["s1-revisit-questions"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();

      // Fetch stances answered >30 days ago joined to questions + community avg
      const { data, error } = await supabase
        .from("question_stances")
        .select(`
          question_id,
          score,
          updated_at,
          questions!inner (
            id,
            question,
            topic_id,
            topics ( title ),
            question_stance_stats ( avg_score )
          )
        `)
        .eq("user_id", user.id)
        .lt("updated_at", cutoff)
        .order("updated_at", { ascending: true })
        .limit(50);

      if (error) throw error;

      return (data ?? [])
        .map((row: any) => {
          const communityAvg = row.questions?.question_stance_stats?.[0]?.avg_score ?? null;
          const drift = communityAvg !== null
            ? Math.abs(row.score - communityAvg)
            : 0;
          return {
            question_id:         row.question_id,
            question_text:       row.questions?.question ?? "",
            topic_title:         row.questions?.topics?.title ?? null,
            user_score:          row.score,
            community_avg_score: communityAvg,
            drift,
            answered_at:         row.updated_at,
          } as RevisitRow;
        })
        .sort((a, b) => b.drift - a.drift)
        .slice(0, 5);
    },
  });
}

function RevisitSection() {
  const { data: rows, isLoading } = useRevisitQuestions();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking for questions to revisit…
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    // Fallback to generic CTA when no old questions exist yet
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-900 mb-0.5">Revisit old answers</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Your views may have changed. Go back to questions you answered a while ago
            and see if you still feel the same way.
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
          <p className="text-xs font-medium text-slate-700">
            Questions to revisit
          </p>
        </div>
        <Link to="/me/stances" className="text-[11px] text-slate-400 hover:text-slate-600 hover:underline">
          See all →
        </Link>
      </div>
      <p className="text-[11px] text-slate-400 mb-2">
        You answered these 30+ days ago. The community's view has since shifted away from yours.
      </p>
      {rows.map((row) => {
        const userColor = getStanceColorHex(row.user_score);
        const driftPct  = Math.min(100, Math.round((row.drift / 4) * 100));
        return (
          <Link
            key={row.question_id}
            to={`/q/${row.question_id}`}
            className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5 hover:bg-slate-50 transition-colors"
          >
            <div
              className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ background: userColor }}
            />
            <div className="flex-1 min-w-0">
              {row.topic_title && (
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 mb-0.5">
                  {row.topic_title}
                </p>
              )}
              <p className="text-xs font-medium text-slate-900 leading-snug line-clamp-2">
                {row.question_text}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{ width: `${driftPct}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 flex-shrink-0">
                  {row.drift.toFixed(1)} drift
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── S2: Region divergence alert ────────────────────────────────────────────────
// Shows questions where the user's region's average stance diverges >0.75 from
// global avg — signals the user may be in a local opinion bubble.

type DivergenceRow = {
  question_id: string;
  question_text: string;
  region_label: string;
  region_avg: number;
  global_avg: number;
  divergence: number;
};

function useRegionDivergence() {
  return useQuery<DivergenceRow[]>({
    queryKey: ["s2-region-divergence"],
    staleTime: 15 * 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Get questions the user has answered
      const { data: stances, error: sErr } = await supabase
        .from("question_stances")
        .select("question_id")
        .eq("user_id", user.id)
        .limit(100);

      if (sErr || !stances?.length) return [];

      const qids = stances.map((s: any) => s.question_id);

      // Get regional stats for those questions — look for country-level divergence
      const { data: regionRows, error: rErr } = await supabase
        .from("question_stance_stats_region")
        .select("question_id, region_scope, region_label, avg_score, total_responses")
        .in("question_id", qids)
        .in("region_scope", ["country", "global"])
        .gt("total_responses", 10);

      if (rErr || !regionRows?.length) return [];

      // Group by question_id: find pairs where country avg vs global avg diverge >0.75
      const byQuestion = new Map<string, { global?: any; country?: any }>();
      for (const row of regionRows as any[]) {
        if (!byQuestion.has(row.question_id)) byQuestion.set(row.question_id, {});
        const entry = byQuestion.get(row.question_id)!;
        if (row.region_scope === "global")  entry.global  = row;
        if (row.region_scope === "country") entry.country = row;
      }

      const divergent: DivergenceRow[] = [];
      for (const [qid, pair] of byQuestion.entries()) {
        if (!pair.global || !pair.country) continue;
        const div = Math.abs(pair.country.avg_score - pair.global.avg_score);
        if (div < 0.75) continue;

        // Get question text
        const { data: qRow } = await supabase
          .from("questions")
          .select("question")
          .eq("id", qid)
          .maybeSingle();

        divergent.push({
          question_id:   qid,
          question_text: qRow?.question ?? "",
          region_label:  pair.country.region_label,
          region_avg:    pair.country.avg_score,
          global_avg:    pair.global.avg_score,
          divergence:    div,
        });
      }

      return divergent.sort((a, b) => b.divergence - a.divergence).slice(0, 3);
    },
  });
}

function RegionDivergenceAlert() {
  const { data: rows, isLoading } = useRegionDivergence();

  if (isLoading || !rows?.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <MapPin className="h-3.5 w-3.5 text-amber-500" />
        <p className="text-xs font-medium text-slate-700">Your region thinks differently</p>
      </div>
      <p className="text-[11px] text-slate-400 mb-2">
        On these questions, your region's view diverges significantly from the global average.
      </p>
      {rows.map((row) => {
        const regionColor = getStanceColorHex(Math.round(row.region_avg));
        const globalColor = getStanceColorHex(Math.round(row.global_avg));
        return (
          <Link
            key={row.question_id}
            to={`/q/${row.question_id}`}
            className="block rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 hover:bg-amber-100 transition-colors"
          >
            <p className="text-xs font-medium text-slate-900 leading-snug line-clamp-2 mb-2">
              {row.question_text}
            </p>
            <div className="flex items-center gap-4 text-[11px]">
              <span>
                <span className="text-slate-400">Your region </span>
                <span className="font-medium" style={{ color: regionColor }}>
                  {row.region_avg > 0 ? "+" : ""}{row.region_avg.toFixed(1)}
                </span>
              </span>
              <span className="text-slate-300">vs</span>
              <span>
                <span className="text-slate-400">Global </span>
                <span className="font-medium" style={{ color: globalColor }}>
                  {row.global_avg > 0 ? "+" : ""}{row.global_avg.toFixed(1)}
                </span>
              </span>
              <span className="text-[10px] text-amber-600 font-medium ml-auto">
                {row.divergence.toFixed(1)} gap
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── (legacy) simple revisit CTA — kept as fallback ────────────────────────────

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

            {/* Revisit section — drift-ordered questions answered 30+ days ago */}
            <Section title="Questions to revisit">
              <RevisitSection />
            </Section>

            {/* S2: Region divergence alerts */}
            <RegionDivergenceAlert />
          </>
        )}
      </div>
    </PageLayout>
  );
}
