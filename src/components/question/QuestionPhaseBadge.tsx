// src/components/question/QuestionPhaseBadge.tsx
// Displays phase badges (Update, Resolution, Follow-up) for questions

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type QuestionPhase = "initial" | "update" | "resolution" | "follow_up";

interface QuestionPhaseBadgeProps {
  phase: QuestionPhase | string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const PHASE_CONFIG: Record<
  Exclude<QuestionPhase, "initial">,
  {
    labelKey: string;
    icon: string;
    colors: {
      bg: string;
      text: string;
      border: string;
    };
    descriptionKey: string;
  }
> = {
  update: {
    labelKey: "stance.phaseUpdate",
    icon: "🔄",
    colors: {
      bg: "bg-blue-100",
      text: "text-blue-800",
      border: "border-blue-300",
    },
    descriptionKey: "questionPhaseBadge.newDevelopmentsOnThisIssue",
  },
  resolution: {
    labelKey: "questionPhaseBadge.resolution",
    icon: "✅",
    colors: {
      bg: "bg-green-100",
      text: "text-green-800",
      border: "border-green-300",
    },
    descriptionKey: "questionPhaseBadge.thisIssueHasBeenResolved",
  },
  follow_up: {
    labelKey: "stance.phaseFollowUp",
    icon: "↩️",
    colors: {
      bg: "bg-purple-100",
      text: "text-purple-800",
      border: "border-purple-300",
    },
    descriptionKey: "questionPhaseBadge.continuedDiscussionOfThisTopic",
  },
};

const SIZE_CLASSES = {
  sm: {
    badge: "text-[10px] px-1.5 py-0.5",
    icon: "text-[10px]",
  },
  md: {
    badge: "text-xs px-2 py-1",
    icon: "text-xs",
  },
  lg: {
    badge: "text-sm px-3 py-1.5",
    icon: "text-sm",
  },
};

/**
 * Badge component that displays question phases (Update, Resolution, Follow-up)
 * 
 * @example
 * // Basic usage
 * <QuestionPhaseBadge phase="update" />
 * 
 * // With size
 * <QuestionPhaseBadge phase="resolution" size="lg" />
 * 
 * // With custom class
 * <QuestionPhaseBadge phase="follow_up" className="ml-2" />
 */
export function QuestionPhaseBadge({
  phase,
  className,
  size = "md",
}: QuestionPhaseBadgeProps) {
  const { t } = useTranslation();

  // Don't show badge for initial phase
  if (phase === "initial") {
    return null;
  }

  const config = PHASE_CONFIG[phase as Exclude<QuestionPhase, "initial">];

  // If phase is not recognized, don't render
  if (!config) {
    return null;
  }

  const sizeClasses = SIZE_CLASSES[size];

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        config.colors.bg,
        config.colors.text,
        config.colors.border,
        sizeClasses.badge,
        className
      )}
      title={t(config.descriptionKey)}
    >
      <span className={cn("leading-none", sizeClasses.icon)}>
        {config.icon}
      </span>
      <span className="leading-none">{t(config.labelKey)}</span>
    </Badge>
  );
}

/**
 * Compact version showing only the icon (for space-constrained areas)
 */
export function QuestionPhaseBadgeIcon({
  phase,
  className,
}: Omit<QuestionPhaseBadgeProps, "size">) {
  const { t } = useTranslation();

  if (phase === "initial") {
    return null;
  }

  const config = PHASE_CONFIG[phase as Exclude<QuestionPhase, "initial">];

  if (!config) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-5 h-5 rounded-full text-xs",
        config.colors.bg,
        config.colors.text,
        className
      )}
      title={`${t(config.labelKey)}: ${t(config.descriptionKey)}`}
    >
      {config.icon}
    </span>
  );
}

/**
 * Helper function to get phase label without rendering
 */
export function getPhaseLabelKey(phase: string): string | null {
  if (phase === "initial") return null;
  return PHASE_CONFIG[phase as Exclude<QuestionPhase, "initial">]?.labelKey ?? null;
}

/**
 * Helper function to check if phase should show a badge
 */
export function shouldShowPhaseBadge(phase: string): boolean {
  return phase !== "initial" && phase in PHASE_CONFIG;
}
