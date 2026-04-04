// src/components/insights/TradeoffExplorer.tsx
// S4 — Decision Support & Trade-off Modeling.
//
// FIX (S4): User weight persistence.
// Previously weights reset to 50/50 on every page load, meaning a user
// who had configured their priorities would lose them on navigating away
// and returning to the question. Now weights are saved to localStorage
// keyed by question_id and restored on mount.
// Storage key format: "tradeoff_weights:<question_id>"
// Weights are pruned automatically: entries older than 30 days are cleared
// on mount to avoid unbounded localStorage growth.

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

function communityLeaning(avgScore: number | null): string | null {
  if (avgScore === null) return null;
  if (avgScore >= 0.5)  return "Most people lean toward agreement";
  if (avgScore <= -0.5) return "Most people lean toward disagreement";
  return "Community is fairly split";
}

function deriveOutcomeSummary(
  tradeoffs: Tradeoff[],
  weights: Record<number, number>,
): string | null {
  if (tradeoffs.length === 0) return null;
  const dominated: string[] = [];
  const balanced: string[] = [];
  tradeoffs.forEach((t, i) => {
    const w = weights[i] ?? 50;
    if (w <= 25)      dominated.push(t.side_a);
    else if (w >= 75) dominated.push(t.side_b);
    else              balanced.push(t.label);
  });
  if (dominated.length === 0) {
    return "You're weighing the trade-offs evenly — your stance will reflect a balanced view.";
  }
  const prioritised = dominated.slice(0, 2).join(" and ");
  const qualifier   = balanced.length > 0 ? ", with some nuance" : "";
  return `Your priorities suggest you lean toward ${prioritised}${qualifier}. Consider how that shapes your stance below.`;
}

// ── localStorage weight persistence ──────────────────────────────────────────

const STORAGE_PREFIX = "tradeoff_weights:";
const STORAGE_TTL_DAYS = 30;

type PersistedWeights = {
  weights: Record<number, number>;
  savedAt: number; // Date.now()
};

function loadWeights(questionId: string): Record<number, number> | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${questionId}`);
    if (!raw) return null;
    const parsed: PersistedWeights = JSON.parse(raw);
    const age = Date.now() - parsed.savedAt;
    if (age > STORAGE_TTL_DAYS * 86_400_000) {
      localStorage.removeItem(`${STORAGE_PREFIX}${questionId}`);
      return null;
    }
    return parsed.weights;
  } catch {
    return null;
  }
}

function saveWeights(questionId: string, weights: Record<number, number>) {
  try {
    const payload: PersistedWeights = { weights, savedAt: Date.now() };
    localStorage.setItem(
      `${STORAGE_PREFIX}${questionId}`,
      JSON.stringify(payload),
    );
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

/** Remove weight entries older than TTL to avoid unbounded storage growth */
function pruneStaleWeights() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed: PersistedWeights = JSON.parse(raw);
      if (Date.now() - parsed.savedAt > STORAGE_TTL_DAYS * 86_400_000) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore
  }
}

// ── Slider component ──────────────────────────────────────────────────────────

function PrioritySlider({
  tradeoff,
  value,
  onChange,
}: {
  tradeoff: Tradeoff;
  value: number;
  onChange: (v: number) => void;
}) {
  const labelA    = value <= 30 ? "font-medium text-slate-900" : "text-slate-400";
  const labelB    = value >= 70 ? "font-medium text-slate-900" : "text-slate-400";
  const fillColor = value < 45 ? "#1D9E75" : value > 55 ? "#378ADD" : "#888780";

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Scale className="h-3 w-3 text-slate-400 flex-shrink-0" />
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
          {tradeoff.label}
        </span>
      </div>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs transition-colors ${labelA}`}>{tradeoff.side_a}</span>
        <span className={`text-xs transition-colors ${labelB}`}>{tradeoff.side_b}</span>
      </div>
      <div className="relative h-5 flex items-center mb-1.5">
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-slate-200" />
        <div
          className="absolute h-1.5 rounded-full left-0 transition-all"
          style={{ width: `${value}%`, background: fillColor }}
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
      <p className="text-[11px] text-slate-400 leading-snug">{tradeoff.description}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface TradeoffExplorerProps {
  questionId: string;
  questionText: string;
  summary: string | null;
  avgScore: number | null;
}

export default function TradeoffExplorer({
  questionId,
  questionText,
  summary,
  avgScore,
}: TradeoffExplorerProps) {
  const [expanded, setExpanded] = React.useState(false);

  // FIX: weights initialise from localStorage if available, fall back to empty
  // (filled at 50 once tradeoffs load via useEffect below)
  const [weights, setWeights] = React.useState<Record<number, number>>(
    () => loadWeights(questionId) ?? {}
  );

  // Prune stale entries once on mount
  React.useEffect(() => { pruneStaleWeights(); }, []);

  // If questionId changes (user navigates to a different QDP), reload weights
  React.useEffect(() => {
    const saved = loadWeights(questionId);
    setWeights(saved ?? {});
  }, [questionId]);

  const { data, isLoading } = useQuery<TradeoffResponse>({
    queryKey: ["s4-tradeoffs", questionId],
    staleTime: 30 * 60_000,
    enabled: expanded,
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

  // Initialise weights at 50 when tradeoffs first load —
  // but only for indices that have no persisted value
  React.useEffect(() => {
    if (tradeoffs.length === 0) return;
    setWeights((prev) => {
      const next = { ...prev };
      let changed = false;
      tradeoffs.forEach((_, i) => {
        if (next[i] === undefined) {
          next[i] = 50;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tradeoffs.length]);

  // Persist weights to localStorage whenever they change (debounced 500ms)
  const saveRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (Object.keys(weights).length === 0) return;
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => saveWeights(questionId, weights), 500);
    return () => {
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [weights, questionId]);

  function handleWeightChange(index: number, value: number) {
    setWeights((prev) => ({ ...prev, [index]: value }));
  }

  return (
    <div className="mb-3">
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

          {/* No data */}
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
                  onChange={(v) => handleWeightChange(i, v)}
                />
              ))}

              {/* Outcome summary */}
              {outcomeSummary && (
                <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
                  <p className="text-[11px] text-slate-600 leading-snug">
                    {outcomeSummary}
                  </p>
                </div>
              )}

              {/* Persistence note */}
              <p className="text-[10px] text-slate-400">
                Your priority weights are saved privately and will be here when
                you return to this question.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
