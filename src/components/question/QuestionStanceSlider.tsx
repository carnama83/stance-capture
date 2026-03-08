// src/components/question/QuestionStanceSlider.tsx
// OPTIMIZED: Instant feedback with debounced AI calls
// DESIGN PASS 2: Gradient spectrum track, micro-commitment prompt, pulseThumb prop,
//   stats prop wired for personalized alignment messaging in parent
// COPY UPDATE: Decision-oriented pre-commit prompts for hero/featured (pulseThumb=true)
//   Hero:     "Do you support or oppose this?" + "Choose a position in seconds."
//   Featured: same (pulseThumb=true from Index)
//   Grid:     "Move the slider to express your view." (unchanged)
//   Header label: "Your position" for prominent, "Your stance" for small

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/lib/supabaseClient";
import { getStanceColorHex } from "@/lib/stanceColors";

// RegionalStat type — mirrored from QuestionDetailPage to avoid cross-import
type RegionalStat = {
  region_scope: string;
  region_label: string;
  total_responses: number;
  pct_agree: number | null;
  pct_disagree: number | null;
  pct_neutral: number | null;
  avg_score: number | null;
};

type QuestionStats = {
  my_stance: number | null;
  location: {
    city: string | null;
    county: string | null;
    state: string | null;
    country: string | null;
  } | null;
  regions: {
    global?: RegionalStat | null;
    city?: RegionalStat | null;
    county?: RegionalStat | null;
    state?: RegionalStat | null;
    country?: RegionalStat | null;
    [key: string]: RegionalStat | null | undefined;
  } | null;
};

export type QuestionStanceSliderProps = {
  questionId: string;
  questionText?: string | null;
  summary?: string | null;
  initialValue: number | null; // -2..2 or null
  onSubmit?: (value: number) => Promise<void> | void;
  disabled?: boolean;
  // Point 16: stats passed from parent for personalized alignment messaging
  stats?: QuestionStats | null;
  // Point 17: pulse thumb + decision-oriented copy for hero/featured slots
  pulseThumb?: boolean;
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

// ---------- Helpers ----------

function getMajorityStance(
  r: RegionalStat | null | undefined
): "agree" | "disagree" | "neutral" | null {
  if (!r) return null;
  const { pct_agree, pct_disagree, pct_neutral } = r;
  if (pct_agree == null && pct_disagree == null && pct_neutral == null)
    return null;
  const a = pct_agree ?? 0;
  const d = pct_disagree ?? 0;
  const n = pct_neutral ?? 0;
  if (a >= d && a >= n) return "agree";
  if (d >= a && d >= n) return "disagree";
  return "neutral";
}

function stanceToCategory(val: number): "agree" | "disagree" | "neutral" {
  if (val > 0) return "agree";
  if (val < 0) return "disagree";
  return "neutral";
}

// Debounced AI tip hook — only calls AI after user stops moving slider
function useDebouncedAiStanceTip(
  questionId: string,
  stance: number,
  questionText?: string | null,
  summary?: string | null
) {
  const supabase = getSupabase()!;
  const [debouncedStance, setDebouncedStance] = React.useState(stance);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedStance(stance);
    }, 500);
    return () => clearTimeout(timer);
  }, [stance]);

  return useQuery({
    queryKey: ["ai-stance-tip", questionId, debouncedStance, questionText, summary],
    enabled: !!questionId && Number.isFinite(debouncedStance),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-stance-tip", {
        body: {
          question_id: questionId,
          stance: debouncedStance,
          question_text: questionText ?? null,
          summary: summary ?? null,
        },
      });

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
        raw && typeof raw.tip === "string" ? (raw.tip as string).trim() : null;
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
  stats,
  pulseThumb,
}: QuestionStanceSliderProps) {
  const [value, setValue] = React.useState<number>(
    typeof initialValue === "number" ? initialValue : 0
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [committed, setCommitted] = React.useState(
    typeof initialValue === "number" && initialValue !== null
  );
  // Pending submit value — set synchronously on commit, consumed by effect
  const pendingSubmit = React.useRef<number | null>(null);

  const { data: aiData, isLoading: aiLoading } = useDebouncedAiStanceTip(
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

  // Synchronous commit — updates state immediately, queues submission via ref.
  // Never async: Radix onValueCommit must return synchronously or it breaks
  // pointer capture on subsequent drags.
  const handleCommit = (vals: number[]) => {
    const v = Math.max(-2, Math.min(2, Math.round(vals[0] ?? 0)));
    setValue(v);
    setCommitted(true);
    if (onSubmit && !disabled) {
      pendingSubmit.current = v;
    }
  };

  // Side-effect: run submission after render, decoupled from the drag event.
  // Slider is never disabled during submission — user can keep interacting.
  React.useEffect(() => {
    if (pendingSubmit.current === null) return;
    const v = pendingSubmit.current;
    pendingSubmit.current = null;
    if (!onSubmit || disabled) return;
    let cancelled = false;
    setSubmitting(true);
    Promise.resolve(onSubmit(v)).finally(() => {
      if (!cancelled) setSubmitting(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, value]);

  const stanceColor = getStanceColorHex(value);
  const rawPercent = ((value + 2) / 4) * 100;
  const fillPercent = Math.max(8, rawPercent);

  // ---------- Point 18: Personalized alignment messaging ----------
  const userCategory = stanceToCategory(value);
  const globalRegion = stats?.regions?.global ?? null;
  const countryRegion = stats?.regions?.country ?? null;
  const stateRegion = stats?.regions?.state ?? null;
  const locationState = stats?.location?.state ?? null;
  const locationCountry = stats?.location?.country ?? null;

  type AlignmentLine = { label: string; pct: number; aligns: boolean };
  const alignmentLines: AlignmentLine[] = [];

  function buildLine(
    r: RegionalStat | null | undefined,
    regionLabel: string
  ): AlignmentLine | null {
    if (!r) return null;
    const pct =
      userCategory === "agree"
        ? r.pct_agree
        : userCategory === "disagree"
        ? r.pct_disagree
        : r.pct_neutral;
    if (pct == null) return null;
    const majority = getMajorityStance(r);
    return {
      label: regionLabel,
      pct: Math.round(pct),
      aligns: majority === userCategory,
    };
  }

  const globalLine = buildLine(globalRegion, "globally");
  const countryLine = buildLine(countryRegion, locationCountry ?? "your country");
  const stateLine = buildLine(stateRegion, locationState ?? "your state");

  if (globalLine) alignmentLines.push(globalLine);
  if (countryLine) alignmentLines.push(countryLine);
  if (stateLine) alignmentLines.push(stateLine);

  const showAlignment = committed && alignmentLines.length > 0;

  // Hero/featured: pulseThumb=true → decision-oriented copy
  // Small grid cards: pulseThumb=false/undefined → lighter UI-hint copy
  const isProminent = !!pulseThumb;

  return (
    <div className="w-full space-y-3">

      {/* Pre-commit prompt — decision-first framing for hero/featured */}
      {!committed && (
        isProminent ? (
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Do you support or oppose this?
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Choose a position in seconds.
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">
            Move the slider to express your view.
          </p>
        )
      )}

      {/* Header label */}
      <div className="flex items-center justify-between text-[11px] text-slate-600">
        <span className="font-semibold uppercase tracking-wide">
          {isProminent ? "Your position" : "Your stance"}
        </span>
        <span className="font-semibold text-slate-900">{label}</span>
      </div>

      {/* Slider */}
      <div className="space-y-1">
        <div className="relative py-2 sm:py-1 touch-pan-x">
          {/*
           * Point 15: Opinion spectrum gradient behind track.
           * Low opacity (15%) avoids strong political color coding
           * while still communicating disagree → neutral → agree direction.
           */}
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full"
            style={{ height: "12px" }}
            aria-hidden
          >
            <div
              className="h-full w-full rounded-full"
              style={{
                background:
                  "linear-gradient(to right, rgba(248,113,113,0.15), rgba(203,213,225,0.15), rgba(74,222,128,0.15))",
              }}
            />
          </div>

          <Slider
            min={-2}
            max={2}
            step={1}
            value={[value]}
            disabled={disabled}
            onValueChange={handleChange}
            onValueCommit={handleCommit}
            className="relative w-full"
          />

          {/* Colored fill under the thumb */}
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-slate-200"
            style={{ height: "12px" }}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-300"
              )}
              style={{
                width: `${fillPercent}%`,
                backgroundColor: stanceColor,
                opacity: 0.85,
              }}
            />
          </div>

          {/*
           * Point 17: Pulse overlay on thumb area when no stance committed.
           * Positioned at current slider value percentage.
           */}
          {!committed && !disabled && (
            <div
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${fillPercent}%` }}
              aria-hidden
            >
              <div className="h-5 w-5 rounded-full bg-slate-400/20 animate-ping" />
            </div>
          )}
        </div>

        {/* Tick labels */}
        <div className="flex justify-between text-[10px] text-slate-500">
          <span className="max-w-[48px] sm:max-w-none">
            Strongly <span className="hidden sm:inline">disagree</span>
          </span>
          <span className="hidden sm:inline">Disagree</span>
          <span>Neutral</span>
          <span className="hidden sm:inline">Agree</span>
          <span className="max-w-[60px] sm:max-w-none text-right">
            Strongly <span className="hidden sm:inline">agree</span>
          </span>
        </div>

        <div className="block sm:hidden text-[10px] text-slate-400 mt-0.5">
          Swipe or drag the slider to adjust your stance.
        </div>
      </div>

      {/* Tip box */}
      <div className="rounded-md border bg-slate-50 px-3 py-2 text-[11px] text-slate-700 min-h-[52px]">
        <div className="flex items-center justify-between mb-0.5">
          <div className="font-semibold">What this stance means</div>
          {aiLoading && (
            <div className="text-[9px] text-slate-400 animate-pulse">
              Loading AI tip...
            </div>
          )}
        </div>
        <p
          className={cn(
            "transition-opacity duration-200",
            aiLoading && "opacity-50"
          )}
        >
          {tip}
        </p>
      </div>

      {/*
       * Point 18: Personalized alignment messaging — shown after stance committed.
       * Only renders when stats are available.
       */}
      {showAlignment && (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-[11px] space-y-1.5">
          <div className="font-semibold text-slate-700">
            You chose: <span className="text-slate-900">{label}</span>
          </div>
          <div className="text-slate-500 font-medium uppercase tracking-wide text-[10px]">
            You align with
          </div>
          <div className="space-y-1">
            {alignmentLines.map((line) => (
              <div key={line.label} className="flex items-center justify-between">
                <span className="text-slate-600 capitalize">{line.label}</span>
                <span
                  className={cn(
                    "font-medium",
                    line.aligns ? "text-slate-800" : "text-slate-500"
                  )}
                >
                  {line.pct}%{" "}
                  {line.aligns ? (
                    <span className="text-[10px] text-slate-400">(majority)</span>
                  ) : (
                    <span className="text-[10px] text-slate-400">(minority)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {submitting && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <div className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse" />
          Saving…
        </div>
      )}
    </div>
  );
}
