import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ExternalLink, Edit2, RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

type DraftStatus = "draft" | "approved" | "rejected";

type TopicDraftRow = {
  id: string;
  news_item_id: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  status: DraftStatus;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  news_items?: {
    id: string;
    title: string;
    url: string | null;
    published_at: string | null;
  } | null;
};

const STATUS_FILTERS: { value: "all" | DraftStatus; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return (await Promise.race([
    p,
    (async () => {
      await sleep(ms);
      throw new Error(`${label} timeout after ${ms}ms`);
    })(),
  ])) as T;
}

export default function TopicDraftsPage() {
  // ✅ IMPORTANT: Memoize the client so this page doesn't create multiple instances across re-renders.
  // This is a frequent cause of “works after refresh” + GoTrue warnings.
  const supabase = React.useMemo(() => getSupabase()!, []);
  const { toast } = useToast();

  const [rows, setRows] = React.useState<TopicDraftRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  // NEW: which topic_drafts already have a question_drafts row
  const [topicDraftHasQDraft, setTopicDraftHasQDraft] = React.useState<Set<string>>(new Set());

  // Pipeline button states with elapsed time
  const [clusterLoading, setClusterLoading] = React.useState(false);
  const [clusterElapsed, setClusterElapsed] = React.useState(0);
  const [clusterProgress, setClusterProgress] = React.useState("");

  const [createDraftsLoading, setCreateDraftsLoading] = React.useState(false);
  const [createDraftsElapsed, setCreateDraftsElapsed] = React.useState(0);
  const [createDraftsProgress, setCreateDraftsProgress] = React.useState("");

  const [statusFilter, setStatusFilter] = React.useState<"all" | DraftStatus>("all");
  const [search, setSearch] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  // Keep interval ids so we can always cleanup (prevents stuck UI)
  const clusterIntervalRef = React.useRef<number | null>(null);
  const draftsIntervalRef = React.useRef<number | null>(null);

  const clearClusterInterval = React.useCallback(() => {
    if (clusterIntervalRef.current != null) {
      window.clearInterval(clusterIntervalRef.current);
      clusterIntervalRef.current = null;
    }
  }, []);

  const clearDraftsInterval = React.useCallback(() => {
    if (draftsIntervalRef.current != null) {
      window.clearInterval(draftsIntervalRef.current);
      draftsIntervalRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    // ✅ Auth/session hydration (helps “works only after refresh”)
    supabase.auth.getSession().catch(() => {});
  }, [supabase]);

  React.useEffect(() => {
    // Cleanup timers on unmount (prevents ghost stuck states)
    return () => {
      clearClusterInterval();
      clearDraftsInterval();
    };
  }, [clearClusterInterval, clearDraftsInterval]);

  const load = React.useCallback(async () => {
    setLoading(true);

    let q = supabase
      .from("topic_drafts")
      .select(
        `
        id,
        news_item_id,
        title,
        summary,
        tags,
        location_label,
        status,
        created_at,
        updated_at,
        approved_at,
        rejected_at,
        news_items (
          id,
          title,
          url,
          published_at
        )
      `,
      )
      .order("created_at", { ascending: false })
      // NEW: stable secondary ordering to avoid same-timestamp weirdness in UI ordering
      .order("id", { ascending: false })
      .limit(200);

    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (dateFrom) q = q.gte("created_at", dateFrom);
    if (dateTo) q = q.lte("created_at", dateTo);

    const { data, error } = await q;
    if (error) {
      console.error("Failed to load topic_drafts:", error);
      toast({
        title: "Failed to load topic drafts",
        description: error.message,
        variant: "destructive",
      });
      setRows([]);
      setTopicDraftHasQDraft(new Set());
      setLoading(false);
      return;
    }

    let items = (data ?? []) as TopicDraftRow[];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter((r) => (r.title ?? "").toLowerCase().includes(needle));
    }

    // NEW: Build a set of topic_draft_id -> has question_draft
    try {
      const ids = items.map((r) => r.id);
      if (ids.length) {
        const { data: qds, error: qErr } = await supabase
          .from("question_drafts")
          .select("topic_draft_id")
          .in("topic_draft_id", ids);

        if (qErr) {
          console.warn("Failed to load question_drafts mapping:", qErr);
          setTopicDraftHasQDraft(new Set());
        } else {
          setTopicDraftHasQDraft(new Set((qds ?? []).map((x: any) => x.topic_draft_id)));
        }
      } else {
        setTopicDraftHasQDraft(new Set());
      }
    } catch (e) {
      console.warn("question_drafts mapping exception:", e);
      setTopicDraftHasQDraft(new Set());
    }

    setRows(items);
    setLoading(false);
  }, [supabase, statusFilter, search, dateFrom, dateTo, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Cluster progress polling
  const pollClusterProgress = React.useCallback(async () => {
    const { count: clusterCount, error: e1 } = await supabase
      .from("topic_clusters")
      .select("*", { count: "exact", head: true });

    if (e1) throw e1;

    const { count: itemCount, error: e2 } = await supabase
      .from("topic_cluster_items")
      .select("*", { count: "exact", head: true });

    if (e2) throw e2;

    return { clusters: clusterCount || 0, items: itemCount || 0 };
  }, [supabase]);

  // ✅ Run cluster with real-time polling (FIXED: timer starts immediately, not after awaiting anything)
  const runCluster = React.useCallback(async () => {
    if (clusterLoading) return;

    clearClusterInterval();

    setClusterLoading(true);
    setClusterElapsed(0);
    setClusterProgress("Starting...");

    toast({
      title: "Clustering started",
      description: "Monitoring progress in real-time...",
    });

    const startTime = Date.now();
    let initial: { clusters: number; items: number } | null = null;

    // Start polling IMMEDIATELY
    clusterIntervalRef.current = window.setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setClusterElapsed(elapsed);

      try {
        const current = await pollClusterProgress();
        if (!initial) initial = current;

        const newClusters = current.clusters - initial.clusters;
        const newItems = current.items - initial.items;

        setClusterProgress(`${newClusters} clusters, ${newItems} items`);

        if (newClusters > 0) {
          clearClusterInterval();
          setClusterLoading(false);

          toast({
            title: "Clustering complete! ✅",
            description: `Created ${newClusters} clusters from ${newItems} articles in ${elapsed}s`,
          });

          // Don’t auto-refresh drafts here (matches your existing behavior)
        }

        if (elapsed > 60) {
          clearClusterInterval();
          setClusterLoading(false);

          if (newClusters === 0) {
            toast({
              title: "Clustering timeout",
              description:
                "No clusters created after 60s. Check logs or try refreshing the page first.",
              variant: "destructive",
            });
          }
        }
      } catch (err) {
        console.warn("pollClusterProgress failed:", err);
        // Don’t stop polling due to one failure
      }
    }, 2000);

    try {
      // Trigger the RPC, but NEVER block the UI timer
      const rpcPromise = supabase.rpc("run_cluster_http");
      // Client timeout so we don’t hang forever waiting for the rpc call
      await withTimeout(rpcPromise as any, 60000, "run_cluster_http");
    } catch (e: any) {
      console.error("run_cluster_http error/timeout:", e);

      toast({
        title: "Cluster trigger issue",
        description:
          e?.message ??
          "Failed to trigger cluster job. The job may still run if it was triggered server-side.",
        variant: "destructive",
      });

      // Let polling continue briefly, but ensure UI doesn’t hang forever
      setTimeout(() => {
        clearClusterInterval();
        setClusterLoading(false);
      }, 8000);
    }
  }, [clusterLoading, supabase, toast, pollClusterProgress, clearClusterInterval]);

  // Create drafts progress polling
  const pollCreateDraftsProgress = React.useCallback(async () => {
    const { count, error } = await supabase
      .from("topic_drafts")
      .select("*", { count: "exact", head: true });

    if (error) throw error;
    return count || 0;
  }, [supabase]);

  const runCreateDrafts = React.useCallback(async () => {
    if (createDraftsLoading) return;

    clearDraftsInterval();

    setCreateDraftsLoading(true);
    setCreateDraftsElapsed(0);
    setCreateDraftsProgress("Starting...");

    // Force auth hydration (helps “works only after refresh”)
    supabase.auth.getSession().catch(() => {});

    toast({
      title: "Create drafts started",
      description: "Monitoring progress in real-time...",
    });

    const startTime = Date.now();
    let initialDrafts: number | null = null;

    // NEW: track whether RPC finished
    let rpcFinished = false;
    let rpcFailed: string | null = null;

    // Start polling immediately
    draftsIntervalRef.current = window.setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setCreateDraftsElapsed(elapsed);

      // IMPORTANT: timeout must run even if polling fails
      const hardTimeoutSec = 60; // slightly higher than 45 so we can handle slow DB/cache
      if (elapsed > hardTimeoutSec) {
        clearDraftsInterval();
        setCreateDraftsLoading(false);

        toast({
          title: "Create drafts timed out",
          description:
            "No visible progress after 60s. The job may still be running. Try Refresh or check logs.",
          variant: "destructive",
        });
        return;
      }

      try {
        const currentDrafts = await pollCreateDraftsProgress();

        if (initialDrafts == null) {
          initialDrafts = currentDrafts;
        }

        const newDrafts = currentDrafts - initialDrafts;
        setCreateDraftsProgress(`${newDrafts} drafts created`);

        // Success path
        if (newDrafts > 0) {
          clearDraftsInterval();
          setCreateDraftsLoading(false);

          toast({
            title: "Drafts created ✅",
            description: `Created ${newDrafts} topic drafts in ${elapsed}s`,
          });

          await load();
          return;
        }

        // NEW: if RPC already finished and we still have 0 after a few seconds, stop
        if (rpcFinished && elapsed >= 6 && newDrafts === 0) {
          clearDraftsInterval();
          setCreateDraftsLoading(false);

          toast({
            title: "No drafts created",
            description: rpcFailed
              ? `Trigger error: ${rpcFailed}`
              : "No eligible clusters found (most recent clusters already have drafts). Run Cluster again after ingesting new items, or expand backend search window.",
            variant: rpcFailed ? "destructive" : "default",
          });

          return;
        }
      } catch (err) {
        // Keep polling; but we no longer skip timeout because timeout is above
        console.warn("pollCreateDraftsProgress failed:", err);
        setCreateDraftsProgress("Polling failed… retrying");
      }
    }, 2000);

    try {
      // Trigger RPC but don’t block UI updates
      const rpcPromise = supabase.rpc("run_create_drafts_http");

      // client timeout so the awaited call can't hang forever
      await withTimeout(rpcPromise as any, 60000, "run_create_drafts_http");

      rpcFinished = true;
    } catch (e: any) {
      console.error("run_create_drafts_http error/timeout:", e);
      rpcFinished = true;
      rpcFailed = e?.message ?? String(e);

      toast({
        title: "Create drafts trigger issue",
        description:
          rpcFailed ??
          "Failed to trigger create drafts job. The job may still run if it was triggered server-side.",
        variant: "destructive",
      });
    }
  }, [
    createDraftsLoading,
    supabase,
    toast,
    pollCreateDraftsProgress,
    load,
    clearDraftsInterval,
  ]);

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Topic Drafts</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search draft title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value ? new Date(e.target.value).toISOString() : "")}
            className="w-48"
          />
          <Input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value ? new Date(e.target.value).toISOString() : "")}
            className="w-48"
          />
          <select
            className="border rounded px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | DraftStatus)}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Pipeline buttons with real-time progress */}
          <Button
            variant="outline"
            onClick={runCluster}
            disabled={clusterLoading}
            className="min-w-[200px]"
          >
            {clusterLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {clusterLoading
              ? `Clustering... ${clusterElapsed}s (${clusterProgress})`
              : "1. Run Cluster"}
          </Button>

          <Button
            variant="outline"
            onClick={runCreateDrafts}
            disabled={createDraftsLoading}
            className="min-w-[220px]"
          >
            {createDraftsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {createDraftsLoading
              ? `Creating... ${createDraftsElapsed}s (${createDraftsProgress})`
              : "2. Create Topic Drafts"}
          </Button>

          <Button variant="outline" size="icon" onClick={load} title="Refresh" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground space-y-3">
            <div className="font-medium">No topic drafts found.</div>
            <div className="text-xs space-y-2 bg-slate-50 p-3 rounded border">
              <p className="font-semibold">📋 Pipeline Instructions:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>
                  <strong>Run Cluster</strong> - Groups similar articles (real-time progress shown)
                </li>
                <li>
                  <strong>Create Topic Drafts</strong> - Generates drafts from clusters (real-time progress shown)
                </li>
                <li>
                  <strong>Refresh</strong> - See your new drafts and review/approve them
                </li>
              </ol>
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                <p className="font-semibold text-yellow-800">💡 Tip:</p>
                <p className="text-yellow-700">
                  If clustering seems stuck, try refreshing the page first, then clicking "1. Run Cluster"
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={runCluster} disabled={clusterLoading}>
                {clusterLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {clusterLoading ? `Clustering... ${clusterElapsed}s` : "1. Run Cluster"}
              </Button>
              <Button variant="outline" onClick={runCreateDrafts} disabled={createDraftsLoading}>
                {createDraftsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {createDraftsLoading ? `Creating... ${createDraftsElapsed}s` : "2. Create Topic Drafts"}
              </Button>
              <Button variant="outline" onClick={load} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Refresh
              </Button>
            </div>
          </div>
        )}

        {rows.map((row) => (
          <TopicDraftRowView
            key={row.id}
            row={row}
            onChanged={load}
            hasQuestionDraft={topicDraftHasQDraft.has(row.id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function TopicDraftRowView({
  row,
  onChanged,
  hasQuestionDraft,
}: {
  row: TopicDraftRow;
  onChanged: () => void;
  hasQuestionDraft: boolean;
}) {
  const sourceName = row.location_label ?? row.news_items?.title ?? "—";
  const newsUrl = row.news_items?.url ?? null;
  const newsTitle = row.news_items?.title ?? null;

  return (
    <div className="border rounded p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">{sourceName}</span>
            <StatusBadge status={row.status} />
            {hasQuestionDraft && (
              <Badge variant="secondary" className="text-xs">
                Question Draft ✅
              </Badge>
            )}
            <span>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</span>
          </div>
          <h3 className="text-lg font-semibold break-words">{row.title}</h3>
          {row.tags && row.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {row.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 items-end">
          <EditTopicDialog row={row} onSaved={onChanged} />
          <div className="flex gap-2">
            <CreateQuestionDraftButton
              row={row}
              onCreated={onChanged}
              disabled={hasQuestionDraft}
              disabledReason="Question draft already exists for this Topic Draft"
            />
            <StatusButtons row={row} onChanged={onChanged} />
          </div>
        </div>
      </div>

      {row.summary && <p className="text-sm whitespace-pre-wrap">{row.summary}</p>}

      {newsUrl && (
        <a
          href={newsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 underline"
        >
          View article <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {newsTitle && (
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">Article: {newsTitle}</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DraftStatus }) {
  let cls = "";
  let label = "";

  switch (status) {
    case "draft":
      cls = "bg-slate-100 text-slate-700";
      label = "Draft";
      break;
    case "approved":
      cls = "bg-emerald-100 text-emerald-700";
      label = "Approved";
      break;
    case "rejected":
      cls = "bg-rose-100 text-rose-700";
      label = "Rejected";
      break;
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function EditTopicDialog({ row, onSaved }: { row: TopicDraftRow; onSaved: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState(row.title);
  const [summary, setSummary] = React.useState(row.summary ?? "");
  const [tags, setTags] = React.useState((row.tags ?? []).join(", "));
  const [location, setLocation] = React.useState(row.location_label ?? "");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);

    const patch: any = { title, summary };
    if (tags.trim()) patch.tags = tags.split(",").map((t) => t.trim());
    if (location.trim()) patch.location_label = location.trim();

    const { error } = await supabase.from("topic_drafts").update(patch).eq("id", row.id);

    if (error) {
      toast({
        title: "Failed to update draft",
        description: error.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    toast({
      title: "Draft updated",
      description: "Topic draft saved successfully.",
    });

    setOpen(false);
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Edit2 className="h-4 w-4 mr-1" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Topic Draft</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Topic title" />
          </div>
          <div>
            <Label>Summary</Label>
            <Textarea
              rows={4}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short topic summary used to generate questions."
            />
          </div>
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="politics, local, zoning" />
          </div>
          <div>
            <Label>Location label</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., New Jersey" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusButtons({
  row,
  onChanged,
}: {
  row: TopicDraftRow;
  onChanged: () => void;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();

  const [loadingStatus, setLoadingStatus] = React.useState<DraftStatus | null>(null);
  const [optimisticStatus, setOptimisticStatus] = React.useState<DraftStatus>(row.status);

  React.useEffect(() => {
    setOptimisticStatus(row.status);
  }, [row.status]);

  const updateStatus = async (status: DraftStatus) => {
    if (loadingStatus) return;

    setOptimisticStatus(status);
    setLoadingStatus(status);

    const now = new Date().toISOString();

    const patch: any = { status };
    if (status === "approved") {
      patch.approved_at = now;
      patch.rejected_at = null;
    } else if (status === "rejected") {
      patch.rejected_at = now;
    }

    try {
      // ✅ IMPORTANT: Use authenticated Supabase client (respects session + RLS)
      const { error } = await supabase.from("topic_drafts").update(patch).eq("id", row.id);

      if (error) throw error;

      toast({
        title: "Status updated",
        description: `Topic draft marked as ${status}.`,
      });

      void onChanged();
    } catch (e: any) {
      setOptimisticStatus(row.status);
      toast({
        title: "Status update failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setLoadingStatus(null);
    }
  };

  const effectiveStatus = optimisticStatus;

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("approved")}
        disabled={effectiveStatus === "approved" || loadingStatus === "approved"}
      >
        {loadingStatus === "approved" ? "Approving…" : effectiveStatus === "approved" ? "Approved" : "Approve"}
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("rejected")}
        disabled={effectiveStatus === "rejected" || loadingStatus === "rejected"}
      >
        {loadingStatus === "rejected" ? "Rejecting…" : effectiveStatus === "rejected" ? "Rejected" : "Reject"}
      </Button>
    </div>
  );
}

function CreateQuestionDraftButton({
  row,
  onCreated,
  disabled,
  disabledReason,
}: {
  row: TopicDraftRow;
  onCreated: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    if (loading || disabled) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-question-draft", {
        body: { topic_draft_id: row.id },
      });

      if (error) {
        console.error("admin-create-question-draft error:", error);
        toast({
          title: "Failed to create question draft",
          description: error.message ?? "Edge function returned an error.",
          variant: "destructive",
        });
        return;
      }

      const payload: any = data ?? {};
      if (!payload?.ok) {
        toast({
          title: "Question draft not created",
          description: "The function completed but did not return ok=true. Check logs.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Question draft created",
          description: "A question draft was generated from this topic.",
        });
        onCreated();
      }
    } catch (e: any) {
      console.error("admin-create-question-draft exception:", e);
      toast({
        title: "Question draft creation failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = loading || !!disabled;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={isDisabled}
      title={disabled ? disabledReason : undefined}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {disabled ? "Question Draft Exists" : loading ? "Creating…" : "Create Question Draft"}
    </Button>
  );
}
