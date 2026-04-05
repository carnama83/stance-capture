// src/routes/admin/pipeline-runs/Index.tsx
// Epic J — Pipeline Run Ledger
//
// Shows ingest → cluster → generate jobs grouped into unified "runs" —
// a run is a set of jobs that fired within 5 minutes of each other.
// Since pipeline_jobs has no run_id, runs are reconstructed client-side
// by sorting jobs by started_at and grouping within the 5-minute window.
//
// Each run row shows:
//   - Run timestamp and overall status (all green / partial / any failed)
//   - Per-stage pill: ingest / cluster / generate / score / notify
//   - Duration, items processed, any errors
//   - Expandable detail for each stage
//   - Admin can resolve failed jobs inline

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/use-toast";
import {
  CheckCircle2, XCircle, Loader2, RefreshCw,
  ChevronDown, ChevronUp, AlertTriangle, Clock,
  Activity, Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = "running" | "success" | "failed" | "retrying";

type PipelineJob = {
  id: string;
  job_type: string;
  source_name: string | null;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  items_processed: number | null;
  error_message: string | null;
  retry_count: number | null;
  resolved: boolean;
  resolved_note: string | null;
};

type PipelineRun = {
  run_id: string;          // synthetic — ISO timestamp of first job in group
  started_at: string;
  finished_at: string | null;
  overall_status: "success" | "failed" | "partial" | "running";
  jobs: PipelineJob[];
  total_items: number;
  total_duration_ms: number;
  has_unresolved_failure: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const JOB_ORDER: Record<string, number> = {
  ingest: 0, cluster: 1, generate: 2, score: 3, notify: 4, other: 5,
};

const JOB_COLORS: Record<string, string> = {
  ingest:   "bg-blue-100 text-blue-800 border-blue-200",
  cluster:  "bg-purple-100 text-purple-800 border-purple-200",
  generate: "bg-emerald-100 text-emerald-800 border-emerald-200",
  score:    "bg-amber-100 text-amber-800 border-amber-200",
  notify:   "bg-sky-100 text-sky-800 border-sky-200",
  other:    "bg-slate-100 text-slate-700 border-slate-200",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Group flat job list into runs by proximity of started_at (5-minute window)
const RUN_WINDOW_MS = 5 * 60_000;

function groupJobsIntoRuns(jobs: PipelineJob[]): PipelineRun[] {
  if (!jobs.length) return [];

  const sorted = [...jobs].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  const runs: PipelineRun[] = [];
  let currentGroup: PipelineJob[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].started_at).getTime();
    const curr = new Date(sorted[i].started_at).getTime();
    if (curr - prev <= RUN_WINDOW_MS) {
      currentGroup.push(sorted[i]);
    } else {
      runs.push(buildRun(currentGroup));
      currentGroup = [sorted[i]];
    }
  }
  runs.push(buildRun(currentGroup));

  // Most recent first
  return runs.reverse();
}

function buildRun(jobs: PipelineJob[]): PipelineRun {
  const statuses = jobs.map(j => j.status);
  const hasFailed  = statuses.some(s => s === "failed");
  const hasRunning = statuses.some(s => s === "running" || s === "retrying");
  const allSuccess = statuses.every(s => s === "success");

  let overall_status: PipelineRun["overall_status"] = "partial";
  if (allSuccess) overall_status = "success";
  else if (hasFailed && !hasRunning) overall_status = "failed";
  else if (hasRunning) overall_status = "running";

  const finishedTimes = jobs
    .map(j => j.finished_at)
    .filter(Boolean)
    .map(t => new Date(t!).getTime());

  return {
    run_id: jobs[0].started_at,
    started_at: jobs[0].started_at,
    finished_at: finishedTimes.length
      ? new Date(Math.max(...finishedTimes)).toISOString()
      : null,
    overall_status,
    jobs: [...jobs].sort((a, b) => (JOB_ORDER[a.job_type] ?? 9) - (JOB_ORDER[b.job_type] ?? 9)),
    total_items: jobs.reduce((s, j) => s + (j.items_processed ?? 0), 0),
    total_duration_ms: jobs.reduce((s, j) => s + (j.duration_ms ?? 0), 0),
    has_unresolved_failure: jobs.some(j => j.status === "failed" && !j.resolved),
  };
}

// ── Status badge ──────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: PipelineRun["overall_status"] }) {
  if (status === "success") return (
    <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
      <CheckCircle2 className="h-3 w-3" /> Success
    </Badge>
  );
  if (status === "failed") return (
    <Badge className="text-[10px] bg-red-50 text-red-700 border-red-200 gap-1">
      <XCircle className="h-3 w-3" /> Failed
    </Badge>
  );
  if (status === "running") return (
    <Badge className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Running
    </Badge>
  );
  return (
    <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 gap-1">
      <AlertTriangle className="h-3 w-3" /> Partial
    </Badge>
  );
}

function JobStatusIcon({ status }: { status: JobStatus }) {
  if (status === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "failed")  return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function usePipelineRuns() {
  return useQuery<PipelineRun[]>({
    queryKey: ["pipeline-runs"],
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb.rpc("list_pipeline_jobs", {
        p_limit: 500,
        p_status: null,
        p_job_type: null,
      });
      if (error) throw error;
      return groupJobsIntoRuns((data ?? []) as PipelineJob[]);
    },
  });
}

function useResolveJob() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ jobId, note }: { jobId: string; note: string }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { error } = await sb.rpc("resolve_pipeline_job", {
        p_job_id: jobId,
        p_note: note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-runs"] });
      toast({ title: "Job marked resolved" });
    },
    onError: (e: any) => toast({ title: "Failed to resolve", description: e.message, variant: "destructive" }),
  });
}

// ── Job detail row ────────────────────────────────────────────────────────────

function JobDetailRow({
  job,
  onResolve,
  isResolving,
}: {
  job: PipelineJob;
  onResolve: (note: string) => void;
  isResolving: boolean;
}) {
  const [showResolve, setShowResolve] = React.useState(false);
  const [note, setNote] = React.useState("");
  const colors = JOB_COLORS[job.job_type] ?? JOB_COLORS.other;

  return (
    <div className={`rounded-lg border px-3 py-2.5 space-y-1.5 ${job.status === "failed" && !job.resolved ? "border-red-200 bg-red-50/40" : "border-slate-100 bg-white"}`}>
      <div className="flex items-center gap-2">
        <JobStatusIcon status={job.status} />
        <Badge className={`text-[10px] ${colors}`}>
          {job.job_type}
        </Badge>
        {job.source_name && (
          <span className="text-[10px] text-slate-500 truncate">{job.source_name}</span>
        )}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-slate-400 shrink-0">
          {job.items_processed !== null && job.items_processed > 0 && (
            <span>{job.items_processed} items</span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmtDuration(job.duration_ms)}
          </span>
          {job.retry_count !== null && job.retry_count > 0 && (
            <span className="text-amber-600">{job.retry_count} retries</span>
          )}
        </div>
      </div>

      {job.error_message && (
        <p className="text-[11px] text-red-600 font-mono bg-red-50 rounded px-2 py-1 leading-relaxed">
          {job.error_message}
        </p>
      )}

      {job.status === "failed" && !job.resolved && (
        <div>
          {!showResolve ? (
            <button
              type="button"
              className="text-[10px] text-slate-400 hover:text-slate-600 underline"
              onClick={() => setShowResolve(true)}
            >
              Mark resolved
            </button>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Resolution note (optional)"
                className="flex-1 rounded border border-slate-200 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <Button
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={() => { onResolve(note); setShowResolve(false); }}
                disabled={isResolving}
              >
                {isResolving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Resolve"}
              </Button>
              <button
                type="button"
                className="text-[10px] text-slate-400 hover:text-slate-600"
                onClick={() => setShowResolve(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {job.resolved && job.resolved_note && (
        <p className="text-[10px] text-slate-400 italic">Resolved: {job.resolved_note}</p>
      )}
    </div>
  );
}

// ── Run row ───────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: PipelineRun }) {
  const [expanded, setExpanded] = React.useState(false);
  const { mutate: resolve, isPending: isResolving, variables: resolvingVars } = useResolveJob();

  return (
    <div className={`border rounded-lg bg-white overflow-hidden ${run.has_unresolved_failure ? "border-red-200" : "border-slate-200"}`}>
      {/* Run header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        {/* Expand chevron */}
        <span className="text-slate-400 shrink-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>

        {/* Timestamp */}
        <div className="w-28 shrink-0">
          <p className="text-xs font-medium text-slate-700">{timeAgo(run.started_at)}</p>
          <p className="text-[10px] text-slate-400">
            {new Date(run.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        {/* Stage pills */}
        <div className="flex-1 flex flex-wrap gap-1.5">
          {run.jobs.map(job => (
            <div key={job.id} className="flex items-center gap-1">
              <JobStatusIcon status={job.status} />
              <Badge className={`text-[10px] ${JOB_COLORS[job.job_type] ?? JOB_COLORS.other}`}>
                {job.job_type}
              </Badge>
            </div>
          ))}
        </div>

        {/* Run summary */}
        <div className="flex items-center gap-4 shrink-0 text-[11px] text-slate-500">
          {run.total_items > 0 && (
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {run.total_items} items
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmtDuration(run.total_duration_ms || null)}
          </span>
          <RunStatusBadge status={run.overall_status} />
        </div>
      </button>

      {/* Expanded job details */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2 bg-slate-50/50">
          {run.jobs.map(job => (
            <JobDetailRow
              key={job.id}
              job={job}
              onResolve={(note) => resolve({ jobId: job.id, note })}
              isResolving={isResolving && (resolvingVars as any)?.jobId === job.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPipelineRunsPage() {
  const { data: runs, isLoading, isError, refetch, isFetching } = usePipelineRuns();

  const totalRuns      = runs?.length ?? 0;
  const failedRuns     = runs?.filter(r => r.overall_status === "failed").length ?? 0;
  const successRate    = totalRuns > 0
    ? Math.round(((totalRuns - failedRuns) / totalRuns) * 100)
    : null;
  const unresolvedFails = runs?.filter(r => r.has_unresolved_failure).length ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-slate-400" />
            Pipeline Run Ledger
            {unresolvedFails > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {unresolvedFails}
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingest → cluster → generate jobs grouped into pipeline runs.
            Jobs within 5 minutes of each other are treated as one run.
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total runs",        value: totalRuns,         color: "text-slate-700" },
          { label: "Failed",            value: failedRuns,        color: failedRuns > 0 ? "text-red-600" : "text-slate-400" },
          { label: "Unresolved",        value: unresolvedFails,   color: unresolvedFails > 0 ? "text-amber-600" : "text-slate-400" },
          { label: "Success rate",      value: successRate !== null ? `${successRate}%` : "—", color: "text-emerald-600" },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-center">
            <p className={`text-xl font-semibold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading pipeline runs…
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-600 py-4">Failed to load pipeline jobs.</p>
      )}

      {!isLoading && !isError && totalRuns === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center space-y-2">
          <Activity className="h-8 w-8 text-slate-300 mx-auto" />
          <p className="text-sm text-slate-500">
            No pipeline jobs logged yet. Run the pipeline to see runs here.
          </p>
        </div>
      )}

      {!isLoading && !isError && runs && runs.length > 0 && (
        <ScrollArea className="h-[600px] pr-1">
          <div className="space-y-2">
            {runs.map(run => (
              <RunRow key={run.run_id} run={run} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
