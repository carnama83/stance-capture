// src/routes/admin/ingestion-review/Index.tsx
// W4 — Admin Ingestion Review
//
// Lists social_reply_inbox rows with their AI classifications from
// ingested_stances. Admin can:
//   - See each reply text, question context, confidence score, classified
//     stance value, and classification reason
//   - Accept a pending_review stance → writes to question_stances via
//     promote_ingested_stance RPC
//   - Reject a pending_review stance → marks it rejected, never promoted
//   - Filter by status: pending_review | accepted | rejected | conflict | all
//   - See per-question stats (how many replies ingested, acceptance rate)

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  CheckCircle2, XCircle, Loader2, AlertCircle,
  MessageSquare, User, BarChart3, RefreshCw,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type IngestStatus = "pending_review" | "accepted" | "rejected" | "conflict" | "all";

type IngestedRow = {
  // from ingested_stances
  ingested_id: string;
  status: string;
  stance_value: number;
  confidence_score: number;
  classification_reason: string | null;
  ingested_at: string;
  reviewed_at: string | null;
  attributed_user_id: string | null;
  // from social_reply_inbox
  reply_inbox_id: string;
  reply_text: string;
  reply_timestamp: string;
  platform: string;
  external_user_id: string | null;
  // from questions (joined)
  question_id: string;
  question_text: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STANCE_LABEL: Record<number, { label: string; color: string }> = {
  [-2]: { label: "Strongly disagree", color: "#dc2626" },
  [-1]: { label: "Disagree",          color: "#f97316" },
  [0]:  { label: "Neutral",           color: "#64748b" },
  [1]:  { label: "Agree",             color: "#22c55e" },
  [2]:  { label: "Strongly agree",    color: "#16a34a" },
};

function confidenceColor(score: number): string {
  if (score >= 0.9) return "text-emerald-600";
  if (score >= 0.75) return "text-blue-600";
  if (score >= 0.5) return "text-amber-600";
  return "text-red-500";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (hours < 1)  return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending_review: { label: "Pending",  className: "bg-amber-100 text-amber-800 border-amber-200" },
  accepted:       { label: "Accepted", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  rejected:       { label: "Rejected", className: "bg-red-100 text-red-700 border-red-200" },
  conflict:       { label: "Conflict", className: "bg-purple-100 text-purple-700 border-purple-200" },
};

// ── Data hook ─────────────────────────────────────────────────────────────────

function useIngestionRows(statusFilter: IngestStatus) {
  return useQuery<IngestedRow[]>({
    queryKey: ["admin-ingestion-review", statusFilter],
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];

      // Step 1: fetch ingested_stances with status filter
      let query = sb
        .from("ingested_stances")
        .select(`
          id,
          reply_inbox_id,
          question_id,
          attributed_user_id,
          stance_value,
          confidence_score,
          classification_reason,
          status,
          ingested_at,
          reviewed_at
        `)
        .order("ingested_at", { ascending: false })
        .limit(200);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data: stances, error: sErr } = await query;
      if (sErr) throw sErr;
      if (!stances?.length) return [];

      // Step 2: batch fetch social_reply_inbox
      const inboxIds = stances.map((s: any) => s.reply_inbox_id);
      const { data: inboxRows } = await sb
        .from("social_reply_inbox")
        .select("id, reply_text, reply_timestamp, platform, external_user_id")
        .in("id", inboxIds);

      const inboxMap: Record<string, any> = {};
      for (const r of inboxRows ?? []) inboxMap[(r as any).id] = r;

      // Step 3: batch fetch question text
      const qids = [...new Set(stances.map((s: any) => s.question_id))];
      const { data: qRows } = await sb
        .from("questions")
        .select("id, question")
        .in("id", qids);

      const qMap: Record<string, string> = {};
      for (const q of qRows ?? []) qMap[(q as any).id] = (q as any).question;

      return stances.map((s: any): IngestedRow => {
        const inbox = inboxMap[s.reply_inbox_id] ?? {};
        return {
          ingested_id:           s.id,
          status:                s.status,
          stance_value:          s.stance_value,
          confidence_score:      s.confidence_score,
          classification_reason: s.classification_reason,
          ingested_at:           s.ingested_at,
          reviewed_at:           s.reviewed_at,
          attributed_user_id:    s.attributed_user_id,
          reply_inbox_id:        s.reply_inbox_id,
          reply_text:            inbox.reply_text ?? "",
          reply_timestamp:       inbox.reply_timestamp ?? s.ingested_at,
          platform:              inbox.platform ?? "twitter",
          external_user_id:      inbox.external_user_id ?? null,
          question_id:           s.question_id,
          question_text:         qMap[s.question_id] ?? s.question_id,
        };
      });
    },
  });
}

// ── Summary stats hook ────────────────────────────────────────────────────────

function useIngestionStats() {
  return useQuery<{ total: number; pending: number; accepted: number; rejected: number; conflict: number; acceptance_rate: number }>({
    queryKey: ["admin-ingestion-stats"],
    staleTime: 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return { total: 0, pending: 0, accepted: 0, rejected: 0, conflict: 0, acceptance_rate: 0 };

      const { data } = await sb
        .from("ingested_stances")
        .select("status");

      const rows = (data ?? []) as { status: string }[];
      const counts = { pending: 0, accepted: 0, rejected: 0, conflict: 0 };
      for (const r of rows) {
        if (r.status === "pending_review") counts.pending++;
        else if (r.status === "accepted") counts.accepted++;
        else if (r.status === "rejected") counts.rejected++;
        else if (r.status === "conflict") counts.conflict++;
      }
      const reviewed = counts.accepted + counts.rejected;
      return {
        total: rows.length,
        ...counts,
        acceptance_rate: reviewed > 0 ? (counts.accepted / reviewed) * 100 : 0,
      };
    },
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

function useReviewMutation() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "accept" | "reject" }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");

      if (action === "accept") {
        // Mark accepted first, then promote
        const { error: updateErr } = await sb
          .from("ingested_stances")
          .update({ status: "accepted", reviewed_at: new Date().toISOString() })
          .eq("id", id);
        if (updateErr) throw updateErr;

        const { error: promoteErr } = await sb
          .rpc("promote_ingested_stance", { p_ingested_stance_id: id });
        if (promoteErr) throw promoteErr;
      } else {
        const { error } = await sb
          .from("ingested_stances")
          .update({ status: "rejected", reviewed_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: (_, { action }) => {
      qc.invalidateQueries({ queryKey: ["admin-ingestion-review"] });
      qc.invalidateQueries({ queryKey: ["admin-ingestion-stats"] });
      toast({ title: action === "accept" ? "Stance accepted and promoted ✓" : "Stance rejected" });
    },
    onError: (e: any) => {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    },
  });
}

// ── Row component ─────────────────────────────────────────────────────────────

function IngestionRow({
  row,
  onAccept,
  onReject,
  isActing,
}: {
  row: IngestedRow;
  onAccept: () => void;
  onReject: () => void;
  isActing: boolean;
}) {
  const stanceDef = STANCE_LABEL[Math.round(row.stance_value)] ?? { label: String(row.stance_value), color: "#888" };
  const statusBadge = STATUS_BADGE[row.status] ?? STATUS_BADGE.pending_review;
  const isPending = row.status === "pending_review";

  return (
    <div className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">
            {row.platform} reply · {timeAgo(row.reply_timestamp)}
            {row.external_user_id && (
              <span className="ml-2">· @{row.external_user_id}</span>
            )}
          </p>
          <p className="text-xs font-medium text-slate-900 line-clamp-2">{row.question_text}</p>
        </div>
        <Badge className={`text-[10px] shrink-0 ${statusBadge.className}`}>
          {statusBadge.label}
        </Badge>
      </div>

      {/* Reply text */}
      <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
        <div className="flex items-start gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-700 leading-relaxed">{row.reply_text}</p>
        </div>
      </div>

      {/* Classification result */}
      <div className="flex items-center gap-4 text-[11px] flex-wrap">
        {/* Classified stance */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">Classified as:</span>
          <span className="font-semibold" style={{ color: stanceDef.color }}>
            {stanceDef.label}
          </span>
          <span className="text-slate-300">({row.stance_value > 0 ? "+" : ""}{row.stance_value})</span>
        </div>

        {/* Confidence */}
        <div className="flex items-center gap-1">
          <span className="text-slate-400">Confidence:</span>
          <span className={`font-semibold ${confidenceColor(row.confidence_score)}`}>
            {Math.round(row.confidence_score * 100)}%
          </span>
        </div>

        {/* Attribution */}
        {row.attributed_user_id ? (
          <div className="flex items-center gap-1 text-emerald-600">
            <User className="h-3 w-3" />
            <span>Attributed to account</span>
          </div>
        ) : (
          <span className="text-slate-400">Anonymous (unattributed)</span>
        )}
      </div>

      {/* Classification reason */}
      {row.classification_reason && (
        <p className="text-[11px] text-slate-500 italic leading-snug">
          AI: "{row.classification_reason}"
        </p>
      )}

      {/* Conflict warning */}
      {row.status === "conflict" && (
        <div className="flex items-center gap-1.5 text-[11px] text-purple-700 bg-purple-50 rounded px-2 py-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Conflict — user already has a native stance on this question. Not promoted.</span>
        </div>
      )}

      {/* Action buttons — only for pending_review */}
      {isPending && (
        <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={onAccept}
            disabled={isActing}
          >
            {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Accept & promote
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
            onClick={onReject}
            disabled={isActing}
          >
            {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
            Reject
          </Button>
          <span className="text-[10px] text-slate-400 ml-auto">
            {row.confidence_score >= 0.75
              ? "Auto-accepted by pipeline — review optional"
              : "Below confidence threshold — manual review required"}
          </span>
        </div>
      )}

      {/* Reviewed timestamp for non-pending */}
      {!isPending && row.reviewed_at && (
        <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-100">
          Reviewed {timeAgo(row.reviewed_at)}
        </p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminIngestionReviewPage() {
  const [statusFilter, setStatusFilter] = React.useState<IngestStatus>("pending_review");
  const { data: rows, isLoading, isError, refetch, isFetching } = useIngestionRows(statusFilter);
  const { data: stats } = useIngestionStats();
  const { mutate: review, isPending: isActing, variables: actingVars } = useReviewMutation();

  const pendingCount = stats?.pending ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            X Reply Ingestion Review
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {pendingCount}
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            AI-classified stances from X replies to shared questions.
            High-confidence rows (≥75%) are auto-promoted. Below threshold requires manual review.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="shrink-0"
        >
          {isFetching
            ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          Refresh
        </Button>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total ingested", value: stats.total, color: "text-slate-700" },
            { label: "Pending review", value: stats.pending, color: "text-amber-600" },
            { label: "Accepted",       value: stats.accepted, color: "text-emerald-600" },
            { label: "Rejected",       value: stats.rejected, color: "text-red-500" },
            { label: "Acceptance rate", value: `${stats.acceptance_rate.toFixed(0)}%`, color: "text-blue-600" },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-center">
              <p className={`text-xl font-semibold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500 shrink-0">Show:</span>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as IngestStatus)}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending_review">Pending review</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="conflict">Conflicts</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        {rows && (
          <span className="text-xs text-slate-400">{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading ingestion queue…
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-600 py-4">Failed to load ingestion data. Check Supabase connection.</p>
      )}

      {!isLoading && !isError && (!rows || rows.length === 0) && (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center space-y-2">
          <BarChart3 className="h-8 w-8 text-slate-300 mx-auto" />
          <p className="text-sm text-slate-500">
            {statusFilter === "pending_review"
              ? "No replies waiting for review. The x-reply-ingestion cron runs every 15 minutes."
              : `No ${statusFilter} rows.`}
          </p>
        </div>
      )}

      {!isLoading && rows && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map(row => (
            <IngestionRow
              key={row.ingested_id}
              row={row}
              onAccept={() => review({ id: row.ingested_id, action: "accept" })}
              onReject={() => review({ id: row.ingested_id, action: "reject" })}
              isActing={isActing && (actingVars as any)?.id === row.ingested_id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
