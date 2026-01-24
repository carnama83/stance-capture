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

export default function TopicDraftsPage() {
  const supabase = getSupabase()!;
  const { toast } = useToast();

  const [rows, setRows] = React.useState<TopicDraftRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Pipeline button states
  const [clusterLoading, setClusterLoading] = React.useState(false);
  const [createDraftsLoading, setCreateDraftsLoading] = React.useState(false);

  const [statusFilter, setStatusFilter] = React.useState<"all" | DraftStatus>("all");
  const [search, setSearch] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

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
      setLoading(false);
      return;
    }

    let items = (data ?? []) as TopicDraftRow[];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter((r) => (r.title ?? "").toLowerCase().includes(needle));
    }

    setRows(items);
    setLoading(false);
  }, [supabase, statusFilter, search, dateFrom, dateTo, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Run cluster via RPC function
  const runCluster = React.useCallback(async () => {
    if (clusterLoading) return;
    setClusterLoading(true);
    
    // Show initial toast with instructions
    toast({
      title: "Clustering started",
      description: "This may take 20-30 seconds. The button will re-enable when complete.",
    });

    try {
      const { error } = await supabase.rpc("run_cluster_http");

      if (error) {
        console.error("run_cluster_http error:", error);
        toast({
          title: "Cluster failed",
          description: error.message ?? "Failed to trigger cluster job.",
          variant: "destructive",
        });
        setClusterLoading(false);
        return;
      }

      // Success - function triggered (runs in background)
      toast({
        title: "Cluster job triggered",
        description: "Clustering articles... Wait 20-30 seconds then refresh.",
      });

      // Wait longer for cluster to complete (it's slower than drafts)
      setTimeout(() => {
        setClusterLoading(false);
        toast({
          title: "Clustering complete (probably)",
          description: "Click Refresh to see if clusters were created. Then run step 2.",
        });
      }, 25000); // 25 seconds

    } catch (e: any) {
      console.error("runCluster exception:", e);
      toast({
        title: "Cluster failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
      setClusterLoading(false);
    }
  }, [clusterLoading, supabase, toast]);

  // Run create-topic-drafts via RPC function
  const runCreateDrafts = React.useCallback(async () => {
    if (createDraftsLoading) return;
    setCreateDraftsLoading(true);
    
    // Show initial toast
    toast({
      title: "Create drafts started",
      description: "This may take 15-20 seconds. Drafts will appear when complete.",
    });

    try {
      const { error } = await supabase.rpc("run_create_drafts_http");

      if (error) {
        console.error("run_create_drafts_http error:", error);
        toast({
          title: "Create drafts failed",
          description: error.message ?? "Failed to trigger create drafts job.",
          variant: "destructive",
        });
        setCreateDraftsLoading(false);
        return;
      }

      // Success - function triggered
      toast({
        title: "Draft creation triggered",
        description: "Creating topic drafts from clusters... Wait 15-20 seconds.",
      });

      // Wait for draft creation then auto-refresh
      setTimeout(async () => {
        await load();
        setCreateDraftsLoading(false);
        
        // Check if drafts were actually created
        const { count } = await supabase
          .from("topic_drafts")
          .select("*", { count: "exact", head: true });
        
        if (count && count > 0) {
          toast({
            title: "Drafts created successfully!",
            description: `${count} topic drafts are ready for review.`,
          });
        } else {
          toast({
            title: "No drafts created",
            description: "Check if clusters exist. Run step 1 first.",
            variant: "destructive",
          });
        }
      }, 18000); // 18 seconds

    } catch (e: any) {
      console.error("runCreateDrafts exception:", e);
      toast({
        title: "Create drafts failed",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
      setCreateDraftsLoading(false);
    }
  }, [createDraftsLoading, supabase, toast, load]);

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
            onChange={(e) =>
              setDateFrom(e.target.value ? new Date(e.target.value).toISOString() : "")
            }
            className="w-48"
          />
          <Input
            type="datetime-local"
            value={dateTo}
            onChange={(e) =>
              setDateTo(e.target.value ? new Date(e.target.value).toISOString() : "")
            }
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

          {/* Pipeline buttons with spinner */}
          <Button 
            variant="outline" 
            onClick={runCluster} 
            disabled={clusterLoading}
            className="min-w-[140px]"
          >
            {clusterLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {clusterLoading ? "Clustering... (~25s)" : "1. Run Cluster"}
          </Button>

          <Button 
            variant="outline" 
            onClick={runCreateDrafts} 
            disabled={createDraftsLoading}
            className="min-w-[180px]"
          >
            {createDraftsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {createDraftsLoading ? "Creating... (~18s)" : "2. Create Topic Drafts"}
          </Button>

          <Button variant="outline" size="icon" onClick={load} title="Refresh" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
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
            <div className="text-xs space-y-2 bg-slate-50 p-3 rounded">
              <p className="font-semibold">📋 Pipeline Instructions:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li><strong>Run Cluster</strong> (~25 seconds) - Groups similar articles into clusters</li>
                <li><strong>Create Topic Drafts</strong> (~18 seconds) - Generates drafts from clusters using AI</li>
                <li><strong>Refresh</strong> - See your new drafts and review/approve them</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-2">
                💡 Tip: Wait for each button to re-enable before clicking the next one.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={runCluster} disabled={clusterLoading}>
                {clusterLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {clusterLoading ? "Clustering..." : "1. Run Cluster"}
              </Button>
              <Button variant="outline" onClick={runCreateDrafts} disabled={createDraftsLoading}>
                {createDraftsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {createDraftsLoading ? "Creating..." : "2. Create Topic Drafts"}
              </Button>
              <Button variant="outline" onClick={load} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Refresh
              </Button>
            </div>
          </div>
        )}

        {rows.map((row) => (
          <TopicDraftRowView key={row.id} row={row} onChanged={load} />
        ))}
      </CardContent>
    </Card>
  );
}

function TopicDraftRowView({ row, onChanged }: { row: TopicDraftRow; onChanged: () => void }) {
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
            <CreateQuestionDraftButton row={row} onCreated={onChanged} />
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
      const supabaseUrl = 'https://yzxzpnomcarnxixhjlba.supabase.co';
      const response = await fetch(`${supabaseUrl}/rest/v1/topic_drafts?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabase['supabaseKey'] || '',
          'Authorization': `Bearer ${supabase['supabaseKey'] || ''}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(patch)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

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

function CreateQuestionDraftButton({ row, onCreated }: { row: TopicDraftRow; onCreated: () => void }) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    if (loading) return;
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

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={loading}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {loading ? "Creating…" : "Create Question Draft"}
    </Button>
  );
}
