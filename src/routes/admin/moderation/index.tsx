// src/routes/admin/moderation/index.tsx
// Epic H — Moderation & Safety
// H1: Report queue with filters, comment context, and moderator actions
// H2: Toxicity score display for prioritisation
// H3: Notification sent to comment author when action taken (via RPC)

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import {
  AlertTriangle, CheckCircle2, EyeOff, Eye, XCircle,
  Shield, Loader2, RefreshCw, Flag, ArrowDownNarrowWide
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type ReportRow = {
  report_id: string;
  comment_id: string;
  comment_body: string;
  comment_user_id: string;
  reporter_id: string;
  reason: string;
  reported_at: string;
  toxicity_score: number | null;
  flagged: boolean | null;
  action_taken: string | null;
  action_at: string | null;
};

type ActionType = "hide_comment" | "restore_comment" | "dismiss_report" | "warn_user";

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function toxicityColor(score: number | null, flagged: boolean | null): string {
  if (flagged) return "text-red-600 bg-red-50";
  if (score === null) return "text-slate-400 bg-slate-50";
  if (score >= 0.7) return "text-red-600 bg-red-50";
  if (score >= 0.4) return "text-amber-600 bg-amber-50";
  return "text-green-600 bg-green-50";
}

function reasonLabel(reason: string): string {
  const map: Record<string, string> = {
    spam:        "Spam",
    harassment:  "Harassment",
    hate_speech: "Hate speech",
    other:       "Other",
  };
  return map[reason] ?? reason;
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    hide_comment:    "Comment hidden",
    restore_comment: "Comment restored",
    dismiss_report:  "Report dismissed",
    warn_user:       "User warned",
    restrict_user:   "User restricted",
    ban_user:        "User banned",
  };
  return map[action] ?? action;
}

const REASON_FILTERS = [
  { value: "",            label: "All reasons" },
  { value: "spam",        label: "Spam" },
  { value: "harassment",  label: "Harassment" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "other",       label: "Other" },
];

const STATUS_FILTERS = [
  { value: "pending",  label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "all",      label: "All" },
];

const SEVERITY_FILTERS = [
  { value: "",    label: "All severity",  minToxicity: null },
  { value: "high",   label: "High risk (≥70%)", minToxicity: 0.7  },
  { value: "medium", label: "Medium (≥40%)",    minToxicity: 0.4  },
  { value: "low",    label: "Low (≥0%)",        minToxicity: 0.0  },
];

// Returns ISO string for "now minus N hours", or null for "any time"
const AGE_FILTERS = [
  { value: "",     label: "Any time",    hours: null },
  { value: "24h",  label: "Last 24h",   hours: 24   },
  { value: "7d",   label: "Last 7 days", hours: 168  },
  { value: "30d",  label: "Last 30 days",hours: 720  },
];

// ── Action confirmation modal ──────────────────────────────────────────────────

function ActionModal({
  report,
  action,
  onConfirm,
  onCancel,
  isPending,
}: {
  report: ReportRow;
  action: ActionType;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [reason, setReason] = React.useState("");

  const titles: Record<ActionType, string> = {
    hide_comment:    "Hide comment",
    restore_comment: "Restore comment",
    dismiss_report:  "Dismiss report",
    warn_user:       "Warn user",
  };

  const descriptions: Record<ActionType, string> = {
    hide_comment:    "The comment will be hidden from all users. The author will be notified.",
    restore_comment: "The comment will be made visible again.",
    dismiss_report:  "The report will be marked as resolved with no action taken.",
    warn_user:       "A notification will be sent to the user about their comment.",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border shadow-lg p-5 w-96 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">{titles[action]}</h3>
        <p className="text-xs text-slate-600">{descriptions[action]}</p>

        {/* Comment preview */}
        <div className="rounded-lg bg-slate-50 border px-3 py-2">
          <p className="text-[11px] text-slate-500 mb-1">Comment:</p>
          <p className="text-xs text-slate-800 line-clamp-3">{report.comment_body}</p>
        </div>

        {/* Optional reason */}
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">
            Reason (optional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Add a note for the audit log..."
            className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Report card ────────────────────────────────────────────────────────────────

function ReportCard({
  report,
  onAction,
}: {
  report: ReportRow;
  onAction: (report: ReportRow, action: ActionType) => void;
}) {
  const isResolved = !!report.action_taken;
  const toxClass = toxicityColor(report.toxicity_score, report.flagged);

  return (
    <div className={[
      "rounded-lg border px-4 py-4 space-y-3",
      isResolved ? "bg-slate-50 border-slate-100" : "bg-white",
    ].join(" ")}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Reason badge */}
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-slate-700">
            <Flag className="h-3 w-3" />
            {reasonLabel(report.reason)}
          </span>

          {/* Toxicity score */}
          {report.toxicity_score !== null && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${toxClass}`}>
              {report.flagged ? "⚠ Flagged" : `Score: ${(report.toxicity_score * 100).toFixed(0)}%`}
            </span>
          )}

          {/* Action taken badge */}
          {isResolved && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
              <CheckCircle2 className="h-3 w-3" />
              {actionLabel(report.action_taken!)}
            </span>
          )}
        </div>

        <span className="text-[10px] text-slate-400 shrink-0">
          {timeAgo(report.reported_at)}
        </span>
      </div>

      {/* Comment body */}
      <div className="rounded-md bg-slate-50 border border-slate-100 px-3 py-2">
        <p className="text-xs text-slate-800 leading-relaxed">{report.comment_body}</p>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 text-[10px] text-slate-400">
        <span>Comment: <code className="font-mono">{report.comment_id.slice(0, 8)}</code></span>
        <span>Reported by: <code className="font-mono">{report.reporter_id.slice(0, 8)}</code></span>
        {report.action_at && (
          <span>Actioned: {timeAgo(report.action_at)}</span>
        )}
      </div>

      {/* Action buttons — only show for pending */}
      {!isResolved && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => onAction(report, "hide_comment")}
            className="flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-50 transition-colors"
          >
            <EyeOff className="h-3.5 w-3.5" />
            Hide comment
          </button>
          <button
            type="button"
            onClick={() => onAction(report, "warn_user")}
            className="flex items-center gap-1.5 rounded-md border border-amber-200 px-3 py-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-50 transition-colors"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Warn user
          </button>
          <button
            type="button"
            onClick={() => onAction(report, "dismiss_report")}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <XCircle className="h-3.5 w-3.5" />
            Dismiss
          </button>
        </div>
      )}

      {/* Resolved: restore option */}
      {isResolved && report.action_taken === "hide_comment" && (
        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <button
            type="button"
            onClick={() => onAction(report, "restore_comment")}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            Restore comment
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminModerationPage() {
  const sb = getSupabase()!;
  const queryClient = useQueryClient();

  const [reasonFilter,   setReasonFilter]   = React.useState("");
  const [statusFilter,   setStatusFilter]   = React.useState("pending");
  const [severityFilter, setSeverityFilter] = React.useState("");
  const [ageFilter,      setAgeFilter]      = React.useState("");
  const [activeModal, setActiveModal] = React.useState<{
    report: ReportRow;
    action: ActionType;
  } | null>(null);

  // Fetch reports
  const { data: reports, isLoading, refetch } = useQuery<ReportRow[]>({
    queryKey: ["moderation-reports", reasonFilter, statusFilter, severityFilter, ageFilter],
    staleTime: 30_000,
    queryFn: async () => {
      const severityEntry = SEVERITY_FILTERS.find((f) => f.value === severityFilter);
      const ageEntry      = AGE_FILTERS.find((f) => f.value === ageFilter);
      const pAfter        = ageEntry?.hours
        ? new Date(Date.now() - ageEntry.hours * 3_600_000).toISOString()
        : null;

      const { data, error } = await sb.rpc("list_comment_reports", {
        p_limit:        100,
        p_offset:       0,
        p_reason:       reasonFilter || null,
        p_status:       statusFilter,
        p_min_toxicity: severityEntry?.minToxicity ?? null,
        p_after:        pAfter,
        p_before:       null,
      });
      if (error) throw error;
      return (data ?? []) as ReportRow[];
    },
  });

  // Take action mutation
  const actionMutation = useMutation({
    mutationFn: async ({
      report,
      action,
      reason,
    }: {
      report: ReportRow;
      action: ActionType;
      reason: string;
    }) => {
      const { data, error } = await sb.rpc("take_moderation_action", {
        p_report_id:   report.report_id,
        p_comment_id:  report.comment_id,
        p_target_user: report.comment_user_id,
        p_action:      action,
        p_reason:      reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setActiveModal(null);
      queryClient.invalidateQueries({ queryKey: ["moderation-reports"] });
    },
  });

  const pending  = (reports ?? []).filter((r) => !r.action_taken);
  const resolved = (reports ?? []).filter((r) =>  r.action_taken);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-600" />
            Moderation Queue
          </h1>
          <p className="text-sm text-slate-500 mt-0.5 flex items-center gap-2">
            Review reported comments and take action.
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              <ArrowDownNarrowWide className="h-3 w-3" />
              Highest risk first
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                statusFilter === f.value
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {f.label}
              {f.value === "pending" && pending.length > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 text-white px-1.5 py-0.5 text-[10px]">
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {REASON_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {SEVERITY_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <select
          value={ageFilter}
          onChange={(e) => setAgeFilter(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {AGE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-slate-400 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading reports…
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (reports ?? []).length === 0 && (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-6 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-700">
            {statusFilter === "pending" ? "No pending reports" : "No reports found"}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {statusFilter === "pending"
              ? "All reports have been actioned."
              : "Try adjusting your filters."}
          </p>
        </div>
      )}

      {/* Report list */}
      {!isLoading && (reports ?? []).length > 0 && (
        <div className="space-y-3">
          {(reports ?? []).map((report) => (
            <ReportCard
              key={report.report_id}
              report={report}
              onAction={(r, action) => setActiveModal({ report: r, action })}
            />
          ))}
        </div>
      )}

      {/* Action modal */}
      {activeModal && (
        <ActionModal
          report={activeModal.report}
          action={activeModal.action}
          isPending={actionMutation.isPending}
          onConfirm={(reason) =>
            actionMutation.mutate({
              report: activeModal.report,
              action: activeModal.action,
              reason,
            })
          }
          onCancel={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}
