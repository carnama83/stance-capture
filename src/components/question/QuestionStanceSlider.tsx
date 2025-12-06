// src/components/question/QuestionStanceSlider.tsx

import React from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export type QuestionStanceSliderProps = {
  questionId: string;
  initialValue: number | null; // -2..2 or null
  onSubmit?: (value: number) => Promise<void> | void;
  disabled?: boolean;
};

// ---------- Stance Labels ----------
const STANCE_LABELS: Record<number, string> = {
  [-2]: "Strongly disagree",
  [-1]: "Disagree",
  [0]: "Neutral / unsure",
  [1]: "Agree",
  [2]: "Strongly agree",
};

// ---------- Stance Tips (can be replaced with AI later) ----------
const STANCE_TIPS: Record<number, string> = {
  [-2]:
    "You strongly oppose this and prefer decisions or policies that stop or reverse it.",
  [-1]:
    "You lean against this. You see more downsides than upsides, but might accept it with safeguards.",
  [0]:
    "You’re neutral or unsure. You may see valid points on both sides.",
  [1]:
    "You generally support this and see more benefits than costs.",
  [2]:
    "You strongly support this, even accepting tradeoffs to move it forward.",
};

// ---------- Color Mapping ----------
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

// ---------- Component ----------
export function QuestionStanceSlider({
  questionId,
  initialValue,
  onSubmit,
  disabled,
}: QuestionStanceSliderProps) {
  // local stance
  const [value, setValue] = React.useState<number>(
    typeof initialValue === "number" ? initialValue : 0
  );
  const [submitting, setSubmitting] = React.useState(false);

  const label = STANCE_LABELS[value] ?? "Select stance";
  const tip = STANCE_TIPS[value] ?? "";

  // Update when dragging
  const handleChange = (vals: number[]) => {
    const v = Math.max(-2, Math.min(2, Math.round(vals[0] ?? 0)));
    setValue(v);
  };

  // Commit when released
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
        <span className="font-semibold text-slate-900">{label}</span>
      </div>

      {/* Slider */}
      <div className="relative py-1">
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

        {/* Color ramp background */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-slate-200">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              getStanceColor(value)
            )}
            style={{
              width: `${((value + 2) / 4) * 100}%`, // map -2 → 0%, +2 → 100%
            }}
          />
        </div>
      </div>

      {/* Tick labels */}
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>Strongly disagree</span>
        <span>Disagree</span>
        <span>Neutral</span>
        <span>Agree</span>
        <span>Strongly agree</span>
      </div>

      {/* Tip Box */}
      <div className="rounded-md border bg-slate-50 px-3 py-2 text-[11px] text-slate-700 min-h-[48px]">
        <div className="font-semibold mb-0.5">What this stance means</div>
        <p>{tip}</p>
      </div>

      {submitting && (
        <div className="text-[10px] text-slate-500">Saving…</div>
      )}
    </div>
  );
}
