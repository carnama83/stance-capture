// src/components/question/QuestionStanceSlider.tsx
import * as React from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export type QuestionStanceSliderProps = {
  questionId: string;
  initialValue: number | null; // -2, -1, 0, 1, 2 or null
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

const STANCE_TIPS: Record<number, string> = {
  [-2]:
    "You strongly oppose this. You’d prefer decisions or policies that stop or reverse it, even if it’s inconvenient.",
  [-1]:
    "You lean against this. You see more downsides than upsides, but might accept it with strong safeguards.",
  [0]:
    "You’re neutral or unsure. You might see valid points on both sides, or don’t feel strongly either way.",
  [1]:
    "You generally support this. You see more benefits than costs and would like to see it move forward.",
  [2]:
    "You strongly support this. You’d like to see clear action and are okay with real tradeoffs to make it happen.",
};

function getStanceColor(value: number): string {
  // Map stance to Tailwind bg color class
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

export function QuestionStanceSlider(props: QuestionStanceSliderProps) {
  const { initialValue, onSubmit, disabled } = props;

  // local stance value
  const [value, setValue] = React.useState<number>(
    typeof initialValue === "number" ? initialValue : 0
  );
  const [submitting, setSubmitting] = React.useState(false);

  const label = STANCE_LABELS[value] ?? "Choose your stance";
  const tip = STANCE_TIPS[value] ?? "";

  const handleChange = (vals: number[]) => {
    // Slider returns array; we want the single value in [-2, 2]
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
    <div className="w-full space-y-2">
      {/* Label row */}
      <div className="flex items-center justify-between text-[11px] text-slate-600">
        <span className="font-medium uppercase tracking-wide">
          Your stance
        </span>
        <span className="font-semibold text-slate-900">
          {STANCE_LABELS[value]}
        </span>
      </div>

      {/* Slider track + ticks */}
      <div className="space-y-1">
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
          {/* Animated color overlay track */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-slate-200">
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-300",
                getStanceColor(value)
              )}
              style={{
                width: `${((value + 2) / 4) * 100}%`, // map -2..2 → 0..100%
              }}
            />
          </div>
        </div>

        {/* Tick labels */}
        <div className="flex justify-between text-[10px] text-slate-500 mt-1">
          <span>Strongly disagree</span>
          <span>Disagree</span>
          <span>Neutral</span>
          <span>Agree</span>
          <span>Strongly agree</span>
        </div>
      </div>

      {/* Tip */}
      <div className="rounded-md border bg-slate-50 px-3 py-2 text-[11px] text-slate-700 min-h-[52px]">
        <div className="font-semibold mb-0.5">
          What this stance usually means
        </div>
        <p>{tip}</p>
      </div>

      {submitting && (
        <div className="text-[10px] text-slate-500">
          Saving your stance…
        </div>
      )}
    </div>
  );
}
// src/components/question/QuestionStanceSlider.tsx
import * as React from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export type QuestionStanceSliderProps = {
  questionId: string;
  initialValue: number | null; // -2, -1, 0, 1, 2 or null
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

const STANCE_TIPS: Record<number, string> = {
  [-2]:
    "You strongly oppose this. You’d prefer decisions or policies that stop or reverse it, even if it’s inconvenient.",
  [-1]:
    "You lean against this. You see more downsides than upsides, but might accept it with strong safeguards.",
  [0]:
    "You’re neutral or unsure. You might see valid points on both sides, or don’t feel strongly either way.",
  [1]:
    "You generally support this. You see more benefits than costs and would like to see it move forward.",
  [2]:
    "You strongly support this. You’d like to see clear action and are okay with real tradeoffs to make it happen.",
};

function getStanceColor(value: number): string {
  // Map stance to Tailwind bg color class
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

export function QuestionStanceSlider(props: QuestionStanceSliderProps) {
  const { initialValue, onSubmit, disabled } = props;

  // local stance value
  const [value, setValue] = React.useState<number>(
    typeof initialValue === "number" ? initialValue : 0
  );
  const [submitting, setSubmitting] = React.useState(false);

  const label = STANCE_LABELS[value] ?? "Choose your stance";
  const tip = STANCE_TIPS[value] ?? "";

  const handleChange = (vals: number[]) => {
    // Slider returns array; we want the single value in [-2, 2]
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
    <div className="w-full space-y-2">
      {/* Label row */}
      <div className="flex items-center justify-between text-[11px] text-slate-600">
        <span className="font-medium uppercase tracking-wide">
          Your stance
        </span>
        <span className="font-semibold text-slate-900">
          {STANCE_LABELS[value]}
        </span>
      </div>

      {/* Slider track + ticks */}
      <div className="space-y-1">
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
          {/* Animated color overlay track */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-slate-200">
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-300",
                getStanceColor(value)
              )}
              style={{
                width: `${((value + 2) / 4) * 100}%`, // map -2..2 → 0..100%
              }}
            />
          </div>
        </div>

        {/* Tick labels */}
        <div className="flex justify-between text-[10px] text-slate-500 mt-1">
          <span>Strongly disagree</span>
          <span>Disagree</span>
          <span>Neutral</span>
          <span>Agree</span>
          <span>Strongly agree</span>
        </div>
      </div>

      {/* Tip */}
      <div className="rounded-md border bg-slate-50 px-3 py-2 text-[11px] text-slate-700 min-h-[52px]">
        <div className="font-semibold mb-0.5">
          What this stance usually means
        </div>
        <p>{tip}</p>
      </div>

      {submitting && (
        <div className="text-[10px] text-slate-500">
          Saving your stance…
        </div>
      )}
    </div>
  );
}
