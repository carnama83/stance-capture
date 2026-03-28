// src/components/insights/TopicBeliefProfile.tsx
// S1 — Per-topic belief stability labels derived from consistency_score in
// the cognitive profile. High score = stable conviction, low = evolving view.

import * as React from "react";
import { Link } from "react-router-dom";
import { type CognitiveState } from "@/hooks/useCognitiveState";
import { getStanceColorHex } from "@/lib/stanceColors";

type TopicProfile = CognitiveState["cognitive_profile"]["topic_profiles"][string];

// Maps consistency_score (0..1) to a stability label + description
function stabilityLabel(score: number): {
  label: string;
  description: string;
  bg: string;
  text: string;
} {
  if (score >= 0.8) {
    return {
      label: "Stable conviction",
      description: "Your answers on this topic are highly consistent.",
      bg:   "#EAF3DE",
      text: "#27500A",
    };
  }
  if (score >= 0.6) {
    return {
      label: "Mostly consistent",
      description: "You have a clear lean, with some variation.",
      bg:   "#E6F1FB",
      text: "#0C447C",
    };
  }
  if (score >= 0.4) {
    return {
      label: "Evolving view",
      description: "Your stance on this topic has shifted over time.",
      bg:   "#FAEEDA",
      text: "#633806",
    };
  }
  return {
    label: "Exploring",
    description: "You're working through different perspectives here.",
    bg:   "#F1EFE8",
    text: "#5F5E5A",
  };
}

const STANCE_LABEL: Record<string, string> = {
  "strongly agree":    "Strongly agree",
  "agree":             "Agree",
  "neutral":           "Neutral",
  "disagree":          "Disagree",
  "strongly disagree": "Strongly disagree",
};

function meanStanceLabel(mean: number): string {
  if (mean >= 1.5)  return "Strongly agree";
  if (mean >= 0.5)  return "Agree";
  if (mean >= -0.5) return "Neutral";
  if (mean >= -1.5) return "Disagree";
  return "Strongly disagree";
}

interface TopicBeliefProfileProps {
  topicProfiles: CognitiveState["cognitive_profile"]["topic_profiles"];
}

export default function TopicBeliefProfile({ topicProfiles }: TopicBeliefProfileProps) {
  const topics = Object.entries(topicProfiles)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.question_count - a.question_count);

  if (topics.length === 0) {
    return (
      <p className="text-xs text-slate-500 py-4">
        Answer questions across multiple topics to see your belief profile here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {topics.map((topic) => {
        const stability = stabilityLabel(topic.consistency_score);
        const stanceColor = getStanceColorHex(Math.round(topic.mean_stance));
        const total = Object.values(topic.stance_distribution).reduce((s, v) => s + v, 0);

        return (
          <div
            key={topic.id}
            className="rounded-lg border border-slate-100 px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 leading-snug">
                  {topic.topic_name}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {topic.question_count} question{topic.question_count !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Stability badge */}
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: stability.bg, color: stability.text }}
              >
                {stability.label}
              </span>
            </div>

            {/* Mean stance + distribution bar */}
            <div className="flex items-center gap-3 mb-1.5">
              <span
                className="text-xs font-medium flex-shrink-0"
                style={{ color: stanceColor }}
              >
                {meanStanceLabel(topic.mean_stance)}
              </span>
              <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-slate-100">
                {/* Stack distribution bar: SD / D / N / A / SA */}
                {(["strong_disagree","disagree","neutral","agree","strong_agree"] as const).map((key, i) => {
                  const count = topic.stance_distribution[key] ?? 0;
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  const colors = ["#D85A30","#EF9F27","#B4B2A9","#97C459","#639922"];
                  return pct > 0 ? (
                    <div
                      key={key}
                      style={{ width: `${pct}%`, background: colors[i] }}
                    />
                  ) : null;
                })}
              </div>
            </div>

            {/* Stability description */}
            <p className="text-[11px] text-slate-400">{stability.description}</p>
          </div>
        );
      })}
    </div>
  );
}
