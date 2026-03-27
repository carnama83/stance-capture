// src/components/StanceSparkline.tsx
// E1: Inline sparkline showing stance score history for a single question.
// Renders as a small SVG — no chart library dependency.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";

interface HistoryPoint {
  id: string;
  old_score: number | null;
  new_score: number;
  changed_at: string;
}

interface StanceSparklineProps {
  questionId: string;
  currentScore: number;
}

const SCORE_LABELS: Record<number, string> = {
  [-2]: "SD", [-1]: "D", [0]: "N", [1]: "A", [2]: "SA",
};

const SCORE_COLOR: Record<number, string> = {
  [-2]: "#f43f5e", [-1]: "#fb923c", [0]: "#94a3b8", [1]: "#34d399", [2]: "#10b981",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function StanceSparkline({ questionId, currentScore }: StanceSparklineProps) {
  const [expanded, setExpanded] = React.useState(false);

  const { data: history, isLoading } = useQuery<HistoryPoint[]>({
    queryKey: ["stance-history", questionId],
    enabled: expanded,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_my_stance_history", {
        p_question_id: questionId,
      });
      if (error) throw error;
      return (data ?? []) as HistoryPoint[];
    },
  });

  const points = history ?? [];
  const hasHistory = points.length > 1;

  // % change label
  const pctLabel = React.useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].new_score;
    const last = points[points.length - 1].new_score;
    const delta = last - first;
    if (delta === 0) return null;
    return delta > 0 ? `+${delta} from first answer` : `${delta} from first answer`;
  }, [points]);

  // SVG sparkline — maps scores (-2 to +2) to Y coords
  const svgWidth = 120;
  const svgHeight = 32;
  const pad = 4;

  const svgPath = React.useMemo(() => {
    if (points.length < 2) return null;
    const xs = points.map((_, i) =>
      pad + (i / (points.length - 1)) * (svgWidth - pad * 2)
    );
    const ys = points.map((p) =>
      svgHeight - pad - ((p.new_score + 2) / 4) * (svgHeight - pad * 2)
    );
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
    const lastColor = SCORE_COLOR[points[points.length - 1].new_score] ?? "#94a3b8";
    return { d, lastX: xs[xs.length - 1], lastY: ys[ys.length - 1], color: lastColor };
  }, [points]);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
      >
        <span className="font-medium">History</span>
        <span>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1.5">
          {isLoading && (
            <p className="text-[10px] text-slate-400">Loading history…</p>
          )}

          {!isLoading && !hasHistory && (
            <p className="text-[10px] text-slate-400 italic">
              No changes yet — you've answered this question once.
            </p>
          )}

          {!isLoading && hasHistory && (
            <>
              {/* Sparkline SVG */}
              <div className="flex items-center gap-3">
                <svg
                  width={svgWidth}
                  height={svgHeight}
                  className="overflow-visible"
                  aria-hidden="true"
                >
                  {svgPath && (
                    <>
                      <path
                        d={svgPath.d}
                        fill="none"
                        stroke={svgPath.color}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {/* Endpoint dot */}
                      <circle
                        cx={svgPath.lastX}
                        cy={svgPath.lastY}
                        r="2.5"
                        fill={svgPath.color}
                      />
                    </>
                  )}
                </svg>
                {pctLabel && (
                  <span className="text-[10px] text-slate-500 italic">{pctLabel}</span>
                )}
              </div>

              {/* Timeline list */}
              <ol className="space-y-0.5">
                {points.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-2 text-[10px] text-slate-600">
                    <span className="text-slate-400 w-16 shrink-0">{formatDate(p.changed_at)}</span>
                    {i === 0 ? (
                      <span>
                        First answer:{" "}
                        <span
                          className="font-medium"
                          style={{ color: SCORE_COLOR[p.new_score] }}
                        >
                          {SCORE_LABELS[p.new_score]}
                        </span>
                      </span>
                    ) : (
                      <span>
                        Changed{" "}
                        <span style={{ color: SCORE_COLOR[p.old_score ?? 0] }}>
                          {SCORE_LABELS[p.old_score ?? 0]}
                        </span>
                        {" → "}
                        <span
                          className="font-medium"
                          style={{ color: SCORE_COLOR[p.new_score] }}
                        >
                          {SCORE_LABELS[p.new_score]}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
