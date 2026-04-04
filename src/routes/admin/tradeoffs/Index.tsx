// src/routes/admin/tradeoffs/Index.tsx
// S4 — Admin Tradeoff Preview Surface
//
// Lists all questions that have generated tradeoffs cached in question_tradeoffs.
// Admin can:
//   - Browse the generated tradeoffs for any question
//   - Preview exactly what the user sees in TradeoffExplorer
//   - Delete the cache row to force regeneration on next question view
//   - Search by question text
//   - Filter by tradeoff count (0 = not yet generated)

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Scale, RefreshCw, Trash2, Search, Loader2, ChevronDown, ChevronUp } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type TradeoffRow = {
  question_id: string;
  tradeoffs: Tradeoff[];
  generated_at: string;
};

type Tradeoff = {
  label: string;
  side_a: string;
  side_b: string;
  description: string;
};

type QuestionRow = {
  id: string;
  question: string;
  summary: string | null;
  topic_id: string | null;
  topic_title?: string | null;
};

type MergedRow = QuestionRow & {
  tradeoffs: Tradeoff[];
  generated_at: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (hours < 1)  return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useTradeoffRows() {
  return useQuery<MergedRow[]>({
    queryKey: ["admin-tradeoffs"],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");

      // Fetch all cached tradeoff rows
      const { data: tradeoffRows, error: tErr } = await sb
        .from("question_tradeoffs")
        .select("question_id, tradeoffs, generated_at")
        .order("generated_at", { ascending: false })
        .limit(200);

      if (tErr) throw tErr;
      if (!tradeoffRows?.length) return [];

      const qids = (tradeoffRows as TradeoffRow[]).map((r) => r.question_id);

      // Batch fetch question text + topic title
      const { data: questions } = await sb
        .from("questions")
        .select("id, question, summary, topic_id, topics(title)")
        .in("id", qids);

      const qMap: Record<string, QuestionRow> = {};
      for (const q of (questions ?? []) as any[]) {
        qMap[q.id] = {
          id: q.id,
          question: q.question,
          summary: q.summary,
          topic_id: q.topic_id,
          topic_title: q.topics?.title ?? null,
        };
      }

      return (tradeoffRows as TradeoffRow[]).map((row) => ({
        ...( qMap[row.question_id] ?? {
          id: row.question_id,
          question: "[Question unavailable]",
          summary: null,
          topic_id: null,
          topic_title: null,
        }),
        tradeoffs: (row.tradeoffs ?? []) as Tradeoff[],
        generated_at: row.generated_at,
      }));
    },
  });
}

function useDeleteTradeoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questionId: string) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb
        .from("question_tradeoffs")
        .delete()
        .eq("question_id", questionId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tradeoffs"] }),
  });
}

function useRegenerateTradeoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: MergedRow) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      // Delete cache row first, then call generate-tradeoffs to regenerate
      await sb.from("question_tradeoffs").delete().eq("question_id", row.id);
      const { error } = await sb.functions.invoke("generate-tradeoffs", {
        body: {
          question_id: row.id,
          question_text: row.question,
          summary: row.summary,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tradeoffs"] }),
  });
}

// ── Tradeoff preview card ─────────────────────────────────────────────────────

function TradeoffPreviewCard({ tradeoff }: { tradeoff: Tradeoff }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Scale className="h-3 w-3 text-slate-400 shrink-0" />
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
          {tradeoff.label}
        </span>
      </div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-slate-600">{tradeoff.side_a}</span>
        <span className="text-[10px] text-slate-400 px-1">vs</span>
        <span className="text-xs text-slate-600">{tradeoff.side_b}</span>
      </div>
      <p className="text-[11px] text-slate-400 leading-snug">{tradeoff.description}</p>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function QuestionTradeoffRow({
  row,
  onDelete,
  onRegenerate,
  isDeleting,
  isRegenerating,
}: {
  row: MergedRow;
  onDelete: () => void;
  onRegenerate: () => void;
  isDeleting: boolean;
  isRegenerating: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const busy = isDeleting || isRegenerating;

  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      {/* Header row */}
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded
            ? <ChevronUp className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          {row.topic_title && (
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">
              {row.topic_title}
            </p>
          )}
          <p className="text-sm font-medium text-slate-900 leading-snug">
            {row.question}
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
            <span className="font-medium text-slate-600">
              {row.tradeoffs.length} tradeoff{row.tradeoffs.length !== 1 ? "s" : ""}
            </span>
            {row.generated_at && (
              <span>Generated {timeAgo(row.generated_at)}</span>
            )}
            <a
              href={`/#/q/${row.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              View question →
            </a>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            title="Delete cache and regenerate from OpenAI"
          >
            {isRegenerating
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            Regenerate
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-red-100 px-2.5 py-1.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            title="Delete cached tradeoffs (will regenerate on next user view)"
          >
            {isDeleting
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Trash2 className="h-3 w-3" />}
            Delete cache
          </button>
        </div>
      </div>

      {/* Expanded tradeoffs */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2 bg-slate-50/50">
          <p className="text-[11px] text-slate-400 mb-2">
            Preview — exactly what the user sees in the TradeoffExplorer on the question page:
          </p>
          {row.tradeoffs.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No tradeoffs cached.</p>
          ) : (
            row.tradeoffs.map((t, i) => (
              <TradeoffPreviewCard key={i} tradeoff={t} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminTradeoffsPage() {
  const { data: rows, isLoading, isError } = useTradeoffRows();
  const { mutate: deleteRow, isPending: isDeleting, variables: deletingId } = useDeleteTradeoff();
  const { mutate: regenerateRow, isPending: isRegenerating, variables: regeneratingRow } = useRegenerateTradeoff();

  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    if (!rows) return [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.question.toLowerCase().includes(q) ||
        (r.topic_title ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalCached = rows?.length ?? 0;
  const totalTradeoffs = rows?.reduce((s, r) => s + r.tradeoffs.length, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Tradeoff Preview</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            S4 — Review and manage AI-generated tradeoffs cached for each question.
            Tradeoffs are generated on first user view and cached in{" "}
            <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">
              question_tradeoffs
            </code>.
          </p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Questions with cached tradeoffs", value: totalCached },
          { label: "Total tradeoff pairs cached", value: totalTradeoffs },
          { label: "Avg per question", value: totalCached > 0 ? (totalTradeoffs / totalCached).toFixed(1) : "—" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] text-slate-400">{stat.label}</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search by question text or topic…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading cached tradeoffs…
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-600 py-4">
          Failed to load tradeoffs. Check Supabase connection.
        </p>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
          <Scale className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">
            {search ? "No questions match your search." : "No tradeoffs cached yet."}
          </p>
          {!search && (
            <p className="text-xs text-slate-400 mt-1">
              Tradeoffs are generated the first time a user expands the
              "Explore the trade-offs" section on a question page.
            </p>
          )}
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            Showing {filtered.length} of {totalCached} cached questions
          </p>
          {filtered.map((row) => (
            <QuestionTradeoffRow
              key={row.id}
              row={row}
              onDelete={() => deleteRow(row.id)}
              onRegenerate={() => regenerateRow(row)}
              isDeleting={isDeleting && deletingId === row.id}
              isRegenerating={isRegenerating && regeneratingRow?.id === row.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
