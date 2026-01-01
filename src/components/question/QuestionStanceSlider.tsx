// src/components/question/QuestionStanceSlider.tsx
// OPTIMIZED: Instant feedback with debounced AI calls

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/lib/supabaseClient";
import { getStanceColorHex } from "@/lib/stanceColors";

export type QuestionStanceSliderProps = {
  questionId: string;
  questionText?: string | null;
  summary?: string | null;
  initialValue: number | null; // -2..2 or null
  onSubmit?: (value: number) => Promise<void> | void;
  disabled?: boolean;
};

const STANCE_LABELS: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]: "Neutral / unsure",
  [1]: "Agree",
  [2]: "Strongly agree",
};

const STANCE_TIPS_FALLBACK: Record<number, string> = {
  [-2]:
    "You strongly oppose this approach and would prefer alternatives that avoid these trade-offs entirely.",
  [-1]:
    "You lean against this option. You see more downsides than upsides, but might accept it with strong modifications.",
  [0]:
    "You're neutral or unsure. You may see valid points on multiple sides or need more information to decide.",
  [1]:
    "You generally support this direction and believe the benefits outweigh the costs.",
  [2]:
    "You strongly support this approach, accepting the trade-offs as worthwhile to achieve the outcome.",
};

// ✨ NEW: Debounced AI tip hook - only calls AI after user stops moving slider
function useDebouncedAiStanceTip(
  questionId: string,
  stance: number,
  questionText?: string | null,
  summary?: string | null
) {
  const supabase = getSupabase()!;
  const [debouncedStance, setDebouncedStance] = React.useState(stance);

  // ✨ Debounce: Wait 500ms after last change before calling AI
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedStance(stance);
    }, 500);

    return () => clearTimeout(timer);
  }, [stance]);

  return useQuery({
    queryKey: ["ai-stance-tip", questionId, debouncedStance, questionText, summary],
    enabled: !!questionId && Number.isFinite(debouncedStance),
    staleTime: 10 * 60_000, // Cache for 10 minutes
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "ai-stance-tip",
        {
          body: {
            question_id: questionId,
            stance: debouncedStance,
            question_text: questionText ?? null,
            summary: summary ?? null,
          },
        }
      );

      if (error) {
        console.warn(
          "[QuestionStanceSlider] ai-stance-tip error; using fallback",
          error
        );
        return {
          tip: null as string | null,
          source: "fallback" as const,
          reason: "invoke_error" as const,
        };
      }

      const raw = data as any;
      const tipText =
        raw && typeof raw.tip === "string"
          ? (raw.tip as string).trim()
          : null;
      const source =
        raw && raw.source === "ai" ? ("ai" as const) : ("fallback" as const);
      const reason = raw?.reason ?? null;

      console.info("[QuestionStanceSlider] ai-stance-tip result", {
        stance: debouncedStance,
        source,
        reason,
        tip: tipText,
      });

      return { tip: tipText, source, reason };
    },
  });
}

// ---- Component ----
export function QuestionStanceSlider({
  questionId,
  questionText,
  summary,
  initialValue,
  onSubmit,
  disabled,
}: QuestionStanceSliderProps) {
  const [value, setValue] = React.useState<number>(
    typeof initialValue === "number" ? initialValue : 0
  );
  const [submitting, setSubmitting] = React.useState(false);

  // ✨ Use debounced AI hook
  const { data: aiData, isLoading: aiLoading } = useDebouncedAiStanceTip(
    questionId,
    value,
    questionText,
    summary
  );

  const label = STANCE_LABELS[value] ?? "Select stance";
  const fallbackTip = STANCE_TIPS_FALLBACK[value] ?? "";
  
  // ✨ INSTANT FEEDBACK: Always show fallback immediately, then replace with AI when ready
  const tip = aiData?.tip || fallbackTip;

  const handleChange = (vals: number[]) => {
    const v = Math.max(-2, Math.min(2, Math.round(vals[0] ?? 0)));
    setValue(v);
  };

  const handleCommit = async (vals: number[]) => {
    const v = Math.max(-2, Math.min(2, Math.round(vals[0] ?? 0)));
    setValue(v);

    if (!onSubmit || disabled) return;

    try {
      setSubmitting(true);
      await onSubmit(v);
    } finally {
      setSubmitting(false);
    }
  };

  // Color + fill width for visual feedback
  const stanceColor = getStanceColorHex(value);
  const rawPercent = ((value + 2) / 4) * 100;
  const fillPercent = Math.max(8, rawPercent); // minimum width so red is visible at -2

  return (
    <div className="w-full space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between text-[11px] text-slate-600">
        <span className="font-semibold uppercase tracking-wide">
          Your stance
        </span>
        <span className="font-semibold text-slate-900">
          {label}
        </span>
      </div>

      {/* Slider */}
      <div className="space-y-1">
        <div className="relative py-2 sm:py-1 touch-pan-x">
          <Slider
            min={-2}
            max={2}
            step={1}
            value={[value]}
            disabled={disabled || submitting}
            onValueChange={handleChange}
            onValueCommit={handleCommit}
            className="relative w-full"
          />
          {/* Colored fill under the thumb */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 sm:h-1.5 rounded-full bg-slate-200">
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-300"
              )}
              style={{
                width: `${fillPercent}%`,
                backgroundColor: stanceColor,
              }}
            />
          </div>
        </div>

        {/* Tick labels */}
        <div className="flex justify-between text-[10px] text-slate-500">
          <span className="max-w-[48px] sm:max-w-none">
            Strongly{" "}
            <span className="hidden sm:inline">disagree</span>
          </span>
          <span className="hidden sm:inline">Disagree</span>
          <span>Neutral</span>
          <span className="hidden sm:inline">Agree</span>
          <span className="max-w-[60px] sm:max-w-none text-right">
            Strongly{" "}
            <span className="hidden sm:inline">agree</span>
          </span>
        </div>

        <div className="block sm:hidden text-[10px] text-slate-400 mt-0.5">
          Swipe or drag the slider to adjust your stance.
        </div>
      </div>

      {/* Tip box - ✨ Now with loading indicator */}
      <div className="rounded-md border bg-slate-50 px-3 py-2 text-[11px] text-slate-700 min-h-[52px]">
        <div className="flex items-center justify-between mb-0.5">
          <div className="font-semibold">
            What this stance means
          </div>
          {aiLoading && (
            <div className="text-[9px] text-slate-400 animate-pulse">
              Loading AI tip...
            </div>
          )}
        </div>
        <p className={cn(
          "transition-opacity duration-200",
          aiLoading && "opacity-50"
        )}>
          {tip}
        </p>
      </div>

      {submitting && (
        <div className="text-[10px] text-slate-500">Saving…</div>
      )}
    </div>
  );
}
