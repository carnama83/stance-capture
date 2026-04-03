// src/components/insights/TradeoffExplorer.tsx
// S4 — Decision Support & Trade-off Modeling.
// Shown above the stance slider on QuestionDetailPage.
// Surfaces 2-3 competing priorities in the question, lets the user
// weigh them with sliders, then shows which side of each trade-off
// aligns with the community before they commit their stance.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ChevronDown, ChevronUp, Scale } from "lucide-react";

type Tradeoff = {
  label: string;
  side_a: string;
  side_b: string;
  description: string;
};

type TradeoffResponse = {
  tradeoffs: Tradeoff[];
  cached: boolean;
};

// Community lean for a tradeoff inferred from the question's avg_score
// avg_score > 0 → community leans toward agreement (side_b = "more/expand/increase")
// We keep this simple — just show which way community leans overall
function communityLeaning(avgScore: number | null): string | null {
  if (avgScore === null) return null;
  if (avgScore >= 0.5)  return "Most people lean toward agreement";
  if (avgScore <= -0.5) return "Most people lean toward disagreement";
  return "Community is fairly split";
}

// S4: Derive an outcome summary from the user's weight configuration.
// Weights are 0 (side_a) to 100 (side_b). If the user has skewed weights,
// describe which values they're prioritising and hint at the implied stance.
function deriveOutcomeSummary(
  tradeoffs: Tradeoff[],
  weights: Record<number, number>,
): string | null {
  if (tradeoffs.length === 0) return null;

  const dominated: string[] = [];
  const balanced: string[] = [];

  tradeoffs.forEach((t, i) => {
    const w = weights[i] ?? 50;
    if (w <= 25)       dominated.push(t.side_a);
    else if (w >= 75)  dominated.push(t.side_b);
    else               balanced.push(t.label);
  });

  if (dominated.length === 0) {
    return "You're weighing the trade-offs evenly — your stance will reflect a balanced view.";
  }

  const prioritised = dominated.slice(0, 2).join(" and ");
  const qualifier    = balanced.length > 0 ? ", with some nuance" : "";
  return `Your priorities suggest you lean toward ${prioritised}${qualifier}. Consider how that shapes your stance below.`;
}

// Priority slider — 0 (value A) to 100 (value B)
function PrioritySlider({
  tradeoff,
  value,
  onChange,
}: {
  tradeoff: Tradeoff;
  value: number;
  onChange: (v: number) => void;
}) {
  const labelA = value <= 30 ? "font-medium text-slate-900" : "text-slate-400";
  const labelB = value >= 70 ? "font-medium text-slate-900" : "text-slate-400";
  const fillColor = value < 45 ? "#1D9E75" : value > 55 ? "#378ADD" : "#888780";

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
      {/* Trade-off label */}
      <div className="flex items-center gap-1.5 mb-2">
        <Scale className="h-3 w-3 text-slate-400 flex-shrink-0" />
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
          {tradeoff.label}
        </span>
      </div>

      {/* Side labels */}
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs transition-colors ${labelA}`}>{tradeoff.side_a}</span>
        <span className={`text-xs transition-colors ${labelB}`}>{tradeoff.side_b}</span>
      </div>

      {/* Slider */}
      <div className="relative h-5 flex items-center mb-1.5">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-200" />
        <div
          className="absolute h-1.5 rounded-full left-0 transition-all"
          style={{
            width: `${value}%`,
            background: fillColor,
          }}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-0 w-full appearance-none bg-transparent cursor-pointer"
          style={{ height: "20px" }}
        />
      </div>

      {/* Description */}
      <p className="text-[11px] text-slate-400 leading-snug">{tradeoff.description}</p>
    </div>
  );
}

interface TradeoffExplorerProps {
  questionId: string;
  questionText: string;
  summary: string | null;
  avgScore: number | null; // community avg for lean hint
}

export default function TradeoffExplorer({
  questionId,
  questionText,
  summary,
  avgScore,
}: TradeoffExplorerProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [weights, setWeights] = React.useState<Record<number, number>>({});

  const { data, isLoading } = useQuery<TradeoffResponse>({
    queryKey: ["s4-tradeoffs", questionId],
    staleTime: 30 * 60_000, // 30 min — tradeoffs don't change
    enabled: expanded, // only fetch when user expands
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-tradeoffs", {
        body: { question_id: questionId, question_text: questionText, summary },
      });
      if (error) throw error;
      return data as TradeoffResponse;
    },
  });

  const tradeoffs = data?.tradeoffs ?? [];
  const leaning = communityLeaning(avgScore);
  const outcomeSummary = deriveOutcomeSummary(tradeoffs, weights);

  // Initialise weights at 50 when tradeoffs load
  React.useEffect(() => {
    if (tradeoffs.length > 0 && Object.keys(weights).length === 0) {
      const init: Record<number, number> = {};
      tradeoffs.forEach((_, i) => { init[i] = 50; });
      setWeights(init);
    }
  }, [tradeoffs.length]);

  return (
    <div className="mb-3">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left py-1.5"
      >
        <div className="flex items-center gap-2">
          <Scale className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Explore the trade-offs
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400">
            {expanded ? "Hide" : "Before you answer"}
          </span>
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
            : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </div>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2.5">
          {/* Community lean hint */}
          {leaning && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-[11px] text-slate-500">{leaning} on this question.</span>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center gap-2 py-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analysing trade-offs…
            </div>
          )}

          {/* Error / no data */}
          {!isLoading && tradeoffs.length === 0 && (
            <p className="text-xs text-slate-400 py-2">
              Could not extract trade-offs for this question.
            </p>
          )}

          {/* Priority sliders */}
          {!isLoading && tradeoffs.length > 0 && (
            <>
              <p className="text-xs text-slate-500 leading-snug">
                Adjust the sliders to reflect what matters most to you,
                then record your stance below.
              </p>
              {tradeoffs.map((t, i) => (
                <PrioritySlider
                  key={i}
                  tradeoff={t}
                  value={weights[i] ?? 50}
                  onChange={(v) => setWeights((prev) => ({ ...prev, [i]: v }))
                  }
                />
              ))}
              {/* S4: Dynamic outcome summary derived from weight configuration */}
              {outcomeSummary && (
                <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
                  <p className="text-[11px] text-slate-600 leading-snug">
                    {outcomeSummary}
                  </p>
                </div>
              )}
              <p className="text-[10px] text-slate-400">
                Your priority weights are private — they help you think through the issue
                before taking a stance.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
