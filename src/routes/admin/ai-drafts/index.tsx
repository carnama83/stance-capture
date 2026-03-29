// src/routes/admin/ai-drafts/index.tsx
// Epic J — Admin & AI Ops
// J3: Pipeline failure logs with retry/resolve controls
// Extended from original AI Pipeline Dashboard (counts + freshness)

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type FreshnessRow = {
  last_ingest_queue: string | null;
  last_topic_cluster: string | null;
  last_ingest: string | null;
  last_cluster: string | null;
  last_generate: string | null;
};

type Stats = {
  newsCount: number | null;
  newsLast24h: number | null;
  topicDraftCount: number | null;
  topicDraftsLast24h: number | null;
  questionDraftCount: number | null;
  questionDraftsLast24h: number | null;
  liveQuestionCount: number | null;
  freshness: FreshnessRow | null;
};

type PipelineJob = {
  id: string;
  job_type: string;
  source_name: string | null;
  status: "running" | "success" | "failed" | "retrying";
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  items_processed: number | null;
  error_message: string | null;
  retry_count: number | null;
  resolved: boolean;
  resolved_note: string | null;
};

type JobFilter = "all" | "failed" | "running" | "success";

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

function StatusBadge({ status }: { status: string }) {
  if (status === "success") return (
    <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50 gap-1 text-[10px]">
      <CheckCircle2 className="h-3 w-3" /> Success
    </Badge>
  );
  if (status === "failed") return (
    <Badge variant="outline" className="text-red-700 border-red-200 bg-red-50 gap-1 text-[10px]">
      <XCircle className="h-3 w-3" /> Failed
    </Badge>
  );
  if (status === "running") return (
    <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50 gap-1 text-[10px]">
      <Loader2 className="h-3 w-3 animate-spin" /> Running
    </Badge>
  );
  if (status === "retrying") return (
    <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50 gap-1 text-[10px]">
      <AlertTriangle className="h-3 w-3" /> Retrying
    </Badge>
  );
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

// ── Pipeline Jobs Panel ───────────────────────────────────────────────────────

function PipelineJobsPanel() {
  const supabase = getSupabase()!;
  const [jobs, setJobs] = React.useState<PipelineJob[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filter, setFilter] = React.useState<JobFilter>("all");
  const [resolving, setResolving] = React.useState<string | null>(null);
  const [resolveNote, setResolveNote] = React.useState("");
  const [resolveTarget, setResolveTarget] = React.useState<string | null>(null);

  async function loadJobs() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("list_pipeline_jobs", {
        p_limit:    100,
        p_status:   filter === "all" ? null : filter,
        p_job_type: null,
      });
      if (error) throw error;
      setJobs((data ?? []) as PipelineJob[]);
    } catch (err: any) {
      console.error("Failed to load pipeline jobs", err);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadJobs(); }, [filter]);

  async function handleResolve(jobId: string, note: string) {
    setResolving(jobId);
    try {
      const { error } = await supabase.rpc("resolve_pipeline_job", {
        p_job_id: jobId,
        p_note:   note || null,
      });
      if (error) throw error;
      setResolveTarget(null);
      setResolveNote("");
      await loadJobs();
    } catch (err: any) {
      alert(`Failed to resolve: ${err?.message ?? err}`);
    } finally {
      setResolving(null);
    }
  }

  const failedUnresolved = jobs.filter(j => j.status === "failed" && !j.resolved).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Pipeline job log</CardTitle>
            {failedUnresolved > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {failedUnresolved} unresolved failure{failedUnresolved > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadJobs} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Filter tabs */}
        <div className="flex gap-1">
          {(["all", "failed", "running", "success"] as JobFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={[
                "rounded-md px-3 py-1 text-xs font-medium transition-colors capitalize",
                filter === f
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {f}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-slate-400 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading jobs…
          </div>
        )}

        {!loading && jobs.length === 0 && (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-8 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
            <p className="text-xs text-slate-600">
              {filter === "all" ? "No pipeline jobs logged yet." : `No ${filter} jobs.`}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Jobs are logged when Edge Functions write to the pipeline_jobs table.
            </p>
          </div>
        )}

        {!loading && jobs.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
            {jobs.map((job) => (
              <div key={job.id} className={[
                "px-4 py-3 text-xs",
                job.status === "failed" && !job.resolved ? "bg-red-50/40" : "bg-white",
                job.resolved ? "opacity-60" : "",
              ].join(" ")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={job.status} />
                      <span className="font-medium text-slate-800 capitalize">{job.job_type}</span>
                      {job.source_name && (
                        <span className="text-slate-500">— {job.source_name}</span>
                      )}
                      {job.resolved && (
                        <span className="text-[10px] text-emerald-600 font-medium">Resolved</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo(job.started_at)}
                      </span>
                      {job.duration_ms != null && (
                        <span>{(job.duration_ms / 1000).toFixed(1)}s</span>
                      )}
                      {(job.items_processed ?? 0) > 0 && (
                        <span>{job.items_processed} items</span>
                      )}
                      {(job.retry_count ?? 0) > 0 && (
                        <span className="text-amber-600">{job.retry_count} retries</span>
                      )}
                    </div>

                    {job.error_message && (
                      <div className="mt-1 rounded-md bg-red-50 border border-red-100 px-2 py-1.5">
                        <p className="text-[11px] text-red-700 font-mono break-all">
                          {job.error_message}
                        </p>
                      </div>
                    )}

                    {job.resolved && job.resolved_note && (
                      <p className="text-[11px] text-slate-500 italic">
                        Resolution note: {job.resolved_note}
                      </p>
                    )}

                    {/* Resolve flow */}
                    {resolveTarget === job.id && (
                      <div className="mt-2 space-y-2">
                        <input
                          type="text"
                          value={resolveNote}
                          onChange={(e) => setResolveNote(e.target.value)}
                          placeholder="Optional resolution note…"
                          className="w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-300"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-6 text-[11px]"
                            onClick={() => handleResolve(job.id, resolveNote)}
                            disabled={resolving === job.id}
                          >
                            {resolving === job.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Mark resolved"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[11px]"
                            onClick={() => { setResolveTarget(null); setResolveNote(""); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!job.resolved && job.status === "failed" && resolveTarget !== job.id && (
                    <button
                      type="button"
                      onClick={() => setResolveTarget(job.id)}
                      className="shrink-0 text-[11px] text-slate-500 hover:text-slate-800 underline transition-colors"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminAIDashboardPage() {
  const supabase = getSupabase()!;
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastRefreshMs, setLastRefreshMs] = React.useState<number | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = React.useState<string | null>(null);

  const loadStats = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    const started = performance.now();
    try {
      const now = new Date();
      const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const countPair = async (table: string) => {
        const total  = await supabase.from(table).select("id", { count: "exact", head: true });
        const last24h = await supabase.from(table).select("id", { count: "exact", head: true }).gte("created_at", since24h);
        return {
          total:  total.error  ? null : total.count  ?? null,
          last24h: last24h.error ? null : last24h.count ?? null,
        };
      };

      const [news, topicDrafts, questionDrafts, liveQuestions, freshnessRes] =
        await Promise.all([
          countPair("news_items"),
          countPair("topic_drafts"),
          countPair("topic_question_drafts"),
          supabase.from("questions").select("id", { count: "exact", head: true }),
          supabase.from("pipeline_freshness").select("*").maybeSingle(),
        ]);

      const freshness: FreshnessRow | null =
        freshnessRes.error || !freshnessRes.data ? null : (freshnessRes.data as FreshnessRow);

      setStats({
        newsCount:           news.total,
        newsLast24h:         news.last24h,
        topicDraftCount:     topicDrafts.total,
        topicDraftsLast24h:  topicDrafts.last24h,
        questionDraftCount:  questionDrafts.total,
        questionDraftsLast24h: questionDrafts.last24h,
        liveQuestionCount:   liveQuestions.error ? null : liveQuestions.count ?? null,
        freshness,
      });

      setLastRefreshMs(Math.round(performance.now() - started));
      setLastRefreshAt(new Date().toLocaleString());
    } catch (err: any) {
      console.error("Failed to load AI dashboard stats", err);
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => { loadStats(); }, [loadStats]);

  const formatTs = (ts: string | null) => ts ? new Date(ts).toLocaleString() : "—";

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">AI Pipeline Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Ingestion → topics → questions counts, pipeline freshness, and job failure log.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadStats} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {loading ? "Refreshing…" : "Refresh stats"}
            <RefreshCw className="ml-1 h-3 w-3" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Failed to load stats: {error}
        </div>
      )}

      {lastRefreshAt && (
        <p className="text-[11px] text-muted-foreground">
          Last refresh: {lastRefreshAt}
          {lastRefreshMs != null && ` • took ${lastRefreshMs} ms`}
        </p>
      )}

      {/* Counts */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <MetricCard label="News items"       total={stats?.newsCount}          last24h={stats?.newsLast24h}         hint="Raw articles in news_items" />
        <MetricCard label="Topic drafts"     total={stats?.topicDraftCount}     last24h={stats?.topicDraftsLast24h}  hint="Topics awaiting review" />
        <MetricCard label="Question drafts"  total={stats?.questionDraftCount}  last24h={stats?.questionDraftsLast24h} hint="AI-generated questions" />
        <MetricCard label="Live questions"   total={stats?.liveQuestionCount}   last24h={null}                       hint="Currently available to users" />
      </div>

      {/* Freshness */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pipeline freshness</CardTitle>
        </CardHeader>
        <CardContent className="text-xs">
          {!stats?.freshness ? (
            <p className="text-muted-foreground">No freshness data yet. Run the pipeline at least once.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-2 gap-x-6">
              <FreshnessRowView label="Ingest (legacy queue)"          value={formatTs(stats.freshness.last_ingest_queue)} />
              <FreshnessRowView label="Cluster (legacy topic_clusters)" value={formatTs(stats.freshness.last_topic_cluster)} />
              <FreshnessRowView label="Ingest (news_items)"            value={formatTs(stats.freshness.last_ingest)} />
              <FreshnessRowView label="Cluster (topic_drafts)"         value={formatTs(stats.freshness.last_cluster)} />
              <FreshnessRowView label="Generate (topic_question_drafts)" value={formatTs(stats.freshness.last_generate)} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* J3: Pipeline failure log */}
      <PipelineJobsPanel />
    </div>
  );
}

function MetricCard(props: { label: string; total: number | null | undefined; last24h: number | null | undefined; hint?: string }) {
  const { label, total, last24h, hint } = props;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{label}</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold">{total == null ? "—" : total.toLocaleString()}</div>
        {typeof last24h === "number" && (
          <div className="text-xs text-muted-foreground">Last 24h: <span className="font-medium">{last24h.toLocaleString()}</span></div>
        )}
        {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function FreshnessRowView(props: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{props.label}</span>
      <span className="text-xs font-medium">{props.value}</span>
    </div>
  );
}
