// src/components/question/QuestionStanceSlider.tsx

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { createSupabase } from "@/lib/createSupabase";

export type QuestionStanceSliderProps = {
  questionId: string;
  initialValue: number | null; // -2..2 or null
  onSubmit?: (value: number) => Promise<void> | void;
  disabled?: boolean;
};

// ---------- Static fallback tips ----------
const STANCE_LABELS: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]: "Neutral / unsure",
  [1]: "Agree",
  [2]: "Strongly agree",
};

const STANCE_TIPS_FALLBACK: Record<number, string> = {
  [-2]:
    "You strongly oppose this and would prefer decisions or policies that stop or reverse it.",
  [-1]:
    "You lean against this. You see more downsides than upsides, but might accept it with strong safeguards.",
  [0]:
    "You’re neutral or unsure. You may see valid points on both sides or don’t feel strongly yet.",
  [1]:
    "You generally support this and see more benefits than costs.",
  [2]:
    "You strongly support this, even accepting real tradeoffs to move it forward.",
};

// ---------- Color ramp ----------
function getStanceColor(value: number): string {
  switch (value) {
    case -2:
      return "bg-red-500";
    case -1:
      return "bg-orange-500";
    case 0:
      return "bg-amber-500";
    case 1:
      return "bg-lime-500";
    case 2:
      return "bg-emerald-500";
    default:
      return "bg-slate-400";
  }
}

// ---------- AI tip hook (optional) ----------
function useAiStanceTip(questionId: string, stance: number) {
  const supabase = React.useMemo(createSupabase, []);
  return useQuery({
    queryKey: ["ai-stance-tip", questionId, stance],
    enabled: !!questionId && Number.isFinite(stance),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      // If you haven't deployed the function yet, this will just error and we'll fall back.
      const { data, error } = await supabase.functions.invoke(
        "ai-stance-tip",
        {
          body: {
            question_id: questionId,
            stance,
          },
        }
      );

      if (error) {
        console.warn("ai-stance-tip error; using fallback copy", error);
        return null as string | null;
      }

      // Expected payload shape: { tip: string }
      const tipText =
        (data && typeof data.tip === "string" && data.tip.trim()) || null;
      return tipText;
    },
  });
}

// ---------- Component ----------
export function QuestionStanceSlider({
  questionId,
  initialValue,
  onSubmit,
  disabled,
}: QuestionStanceSliderProps) {
  const [value, setValue] = React.useState<number>(
    typeof initialValue === "number" ? initialValue : 0
  );
  const [submitting, setSubmitting] = React.useState(false);

  // AI tip hook, with graceful fallback
  const { data: aiTip } = useAiStanceTip(questionId, value);

  const label = STANCE_LABELS[value] ?? "Select stance";
  const fallbackTip = STANCE_TIPS_FALLBACK[value] ?? "";
  const tip = aiTip ?? fallbackTip;

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

      {/* Slider + mobile-friendly wrapper */}
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

          {/* Color ramp track behind the slider thumb */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 sm:h-1.5 rounded-full bg-slate-200">
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-300",
                getStanceColor(value)
              )}
              style={{
                width: `${((value + 2) / 4) * 100}%`, // -2 → 0%, +2 → 100%
              }}
            />
          </div>
        </div>

        {/* Tick labels (mobile-friendly) */}
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

        {/* Tiny helper text for mobile “swipe” mental model */}
        <div className="block sm:hidden text-[10px] text-slate-400 mt-0.5">
          Swipe or drag the slider to adjust your stance.
        </div>
      </div>

      {/* Tip box (AI-powered with fallback) */}
      <div className="rounded-md border bg-slate-50 px-3 py-2 text-[11px] text-slate-700 min-h-[52px]">
        <div className="font-semibold mb-0.5">
          What this stance means
        </div>
        <p>{tip}</p>
      </div>

      {submitting && (
        <div className="text-[10px] text-slate-500">Saving…</div>
      )}
    </div>
  );
}
