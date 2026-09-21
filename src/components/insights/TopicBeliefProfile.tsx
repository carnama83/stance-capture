// src/components/insights/TopicBeliefProfile.tsx
// S1 — Per-topic belief stability labels derived from consistency_score.
//
// FIX (S1-B): Added onTopicClick and activeTopic props so PersonalInsightsPage
// can wire this component to the TopicHistoryDrawer. Clicking a topic row
// highlights it and signals the parent to open the drawer for that topic.
// Visually: active topic gets a blue left border + subtle bg tint.

import * as React from "react";
import { type CognitiveState } from "@/hooks/useCognitiveState";
import { getStanceColorHex } from "@/lib/stanceColors";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

type TopicProfile = CognitiveState["cognitive_profile"]["topic_profiles"][string];

function stabilityLabel(score: number): {
  labelKey: string;
  descriptionKey: string;
  bg: string;
  text: string;
} {
  if (score >= 0.8) return {
    labelKey: "topicBeliefProfile.stableConviction",
    descriptionKey: "topicBeliefProfile.yourAnswersOnThisTopic",
    bg: "#EAF3DE", text: "#27500A",
  };
  if (score >= 0.6) return {
    labelKey: "topicBeliefProfile.mostlyConsistent",
    descriptionKey: "topicBeliefProfile.youHaveAClearLean",
    bg: "#E6F1FB", text: "#0C447C",
  };
  if (score >= 0.4) return {
    labelKey: "topicBeliefProfile.evolvingView",
    descriptionKey: "topicBeliefProfile.yourStanceOnThisTopic",
    bg: "#FAEEDA", text: "#633806",
  };
  return {
    labelKey: "topicBeliefProfile.exploring",
    descriptionKey: "topicBeliefProfile.youReWorkingThroughDifferent",
    bg: "#F1EFE8", text: "#5F5E5A",
  };
}

function meanStanceLabelKey(mean: number): string {
  if (mean >= 1.5)  return "stance.stronglyAgree";
  if (mean >= 0.5)  return "stance.agree";
  if (mean >= -0.5) return "stance.neutral";
  if (mean >= -1.5) return "stance.disagree";
  return "stance.stronglyDisagree";
}

interface TopicBeliefProfileProps {
  topicProfiles: CognitiveState["cognitive_profile"]["topic_profiles"];
  /** Called when user clicks a topic row — passes the topic name */
  onTopicClick?: (topicName: string) => void;
  /** The currently active/open topic name (for visual highlight) */
  activeTopic?: string | null;
}

export default function TopicBeliefProfile({
  topicProfiles,
  onTopicClick,
  activeTopic,
}: TopicBeliefProfileProps) {
  const { t } = useTranslation();
  const topics = Object.entries(topicProfiles)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.question_count - a.question_count);

  if (topics.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-4">
        {t("topicBeliefProfile.answerQuestionsAcrossMultipleTopics")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {topics.map((topic) => {
        const stability = stabilityLabel(topic.consistency_score);
        const stanceColor = getStanceColorHex(Math.round(topic.mean_stance));
        const total = Object.values(topic.stance_distribution).reduce((s, v) => s + v, 0);
        const isActive = activeTopic === topic.topic_name;
        const isClickable = !!onTopicClick;

        return (
          <div
            key={topic.id}
            onClick={() => onTopicClick?.(topic.topic_name)}
            className={[
              "rounded-lg border px-3 py-3 transition-all",
              isClickable ? "cursor-pointer" : "",
              isActive
                ? "border-blue-300 bg-blue-50/60 shadow-sm"
                : isClickable
                ? "border-slate-100 hover:border-slate-300 hover:bg-slate-50/60"
                : "border-slate-100",
            ].join(" ")}
            role={isClickable ? "button" : undefined}
            aria-expanded={isClickable ? isActive : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => {
              if (e.key === "Enter" || e.key === " ") onTopicClick?.(topic.topic_name);
            } : undefined}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 leading-snug">
                  {topic.topic_name}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t("topicBeliefProfile.questionCount", { count: topic.question_count })}
                  {isClickable && (
                    <span className="ml-1 text-blue-500">
                      · {isActive ? t("topicBeliefProfile.closeHistory") : t("topicBeliefProfile.viewHistory")}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Stability badge */}
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: stability.bg, color: stability.text }}
                >
                  {t(stability.labelKey)}
                </span>
                {/* Chevron when clickable */}
                {isClickable && (
                  <ChevronRight
                    className={[
                      "h-3.5 w-3.5 text-slate-400 transition-transform",
                      isActive ? "rotate-90" : "",
                    ].join(" ")}
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>

            {/* Mean stance + distribution bar */}
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-xs font-medium flex-shrink-0" style={{ color: stanceColor }}>
                {t(meanStanceLabelKey(topic.mean_stance))}
              </span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-slate-100">
                {(["strong_disagree","disagree","neutral","agree","strong_agree"] as const).map((key, i) => {
                  const count = topic.stance_distribution[key] ?? 0;
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  const colors = ["#D85A30","#EF9F27","#B4B2A9","#97C459","#639922"];
                  return pct > 0 ? (
                    <div key={key} style={{ width: `${pct}%`, background: colors[i] }} />
                  ) : null;
                })}
              </div>
            </div>

            {/* Stability description */}
            <p className="text-[11px] text-slate-400">{t(stability.descriptionKey)}</p>
          </div>
        );
      })}
    </div>
  );
}
