import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { createSupabase } from "@/lib/createSupabase";

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

// ---- AI tip hook ----
function useAiStanceTip(
  questionId: string,
  stance: number,
  questionText?: string | null,
  summary?: string | null
) {
  const supabase = React.useMemo(createSupabase, []);

  return useQuery({
    queryKey: ["ai-stance-tip", questionId, stance, questionText, summary],
    enabled: !!questionId && Number.isFinite(stance),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "ai-stance-tip",
        {
          body: {
            question_id: questionId,
            stance,
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
        return { tip: null as string | null, source: "fallback" as const };
      }

      const tipText =
        data && typeof (data as any).tip === "string"
          ? ((data as any).tip as string).trim()
          : null;
      const source =
        (data as any).source === "ai" ? "ai" : "fallback";

      console.info("[QuestionStanceSlider] ai-stance-tip result", {
        stance,
        source,
        tip: tipText,
      });

      return { tip: tipText, source };
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

  const { data: aiData } = useAiStanceTip(
    questionId,
    value,
    questionText,
    summary
  );

  const label = STANCE_LABELS[value] ?? "Select stance";
  const fallbackTip = STANCE_TIPS_FALLBACK[value] ?? "";
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
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 sm:h-1.5 rounded-full bg-slate-200">
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-300",
                getStanceColor(value)
              )}
              style={{
                width: `${((value + 2) / 4) * 100}%`,
              }}
            />
          </div>
        </div>

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

      {/* Tip box */}
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
