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
import { useToast } from "@/components/ui/use-toast";
import { ExternalLink, Edit2, RefreshCw, Loader2 } from "lucide-react";

type QuestionStatus = "draft" | "approved" | "rejected";

type QuestionDraftRow = {
  id: string;
  topic_draft_id: string;
  topic_id: string | null;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  status: QuestionStatus;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  topic_drafts?: {
    id: string;
    title: string | null;
    summary: string | null;
    location_label: string | null;
    tags: string[] | null;
    news_items?: {
      id: string;
      title: string | null;
      url: string | null;
      published_at: string | null;
    } | null;
  } | null;
};

const STATUS_FILTERS: { value: "all" | QuestionStatus; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

// 👇 Change this if your RPC name differs
const PULL_BACK_RPC = "admin_pull_back_live_question";

export default function QuestionDraftsPage() {
  // ✅ Memoize Supabase client to avoid subtle auth/session issues across re-renders
  const supabase = React.useMemo(() => getSupabase()!, []);
  const { toast } = useToast();

  const [rows, setRows] = React.useState<QuestionDraftRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [generateCooldown, setGenerateCooldown] = React.useState(0);

  const [statusFilter, setStatusFilter] = React.useState<"all" | QuestionStatus>(
    "all",
  );
  const [search, setSearch] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  // ✅ persisted-by-query published state (survives refresh)
  const [publishedDraftIds, setPublishedDraftIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // cooldown timer cleanup
  const cooldownRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    return () => {
      if (cooldownRef.current != null) {
        window.clearInterval(cooldownRef.current);
        cooldownRef.current = null;
      }
    };
  }, []);

  const startGenerateCooldown = React.useCallback((seconds: number) => {
    if (cooldownRef.current != null) {
      window.clearInterval(cooldownRef.current);
      cooldownRef.current = null;
    }
    setGenerateCooldown(seconds);
    cooldownRef.current = window.setInterval(() => {
      setGenerateCooldown((s) => {
        if (s <= 1) {
          if (cooldownRef.current != null) {
            window.clearInterval(cooldownRef.current);
            cooldownRef.current = null;
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);

    let q = supabase
      .from("question_drafts")
      .select(
        `
        id,
        topic_draft_id,
        topic_id,
        question,
        summary,
        tags,
        location_label,
        status,
        created_at,
        updated_at,
        approved_at,
        rejected_at,
        topic_drafts (
          id,
          title,
          summary,
          location_label,
          tags,
          news_items (
            id,
            title,
            url,
            published_at
          )
        )
      `,
      )
      .order("created_at", { ascending: false })
      // ✅ stable secondary ordering (avoids same-timestamp ordering jitter)
      .order("id", { ascending: false })
      .limit(200);

    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (dateFrom) q = q.gte("created_at", dateFrom);
    if (dateTo) q = q.lte("created_at", dateTo);

    const { data, error } = await q;

    if (error) {
      console.error("Failed to load question_drafts:", error);
      setRows([]);
      setPublishedDraftIds(new Set());
      toast({
        title: "Failed to load question drafts",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    let items = (data ?? []) as QuestionDraftRow[];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter((r) =>
        (r.question ?? "").toLowerCase().includes(needle),
      );
    }

    setRows(items);

    // ✅ detect published drafts by checking live questions table(s)
    const ids = items.map((r) => r.id);
    const publishedSet = await fetchPublishedDraftIds(supabase, ids);
    setPublishedDraftIds(publishedSet);

    setLoading(false);
  }, [supabase, statusFilter, search, dateFrom, dateTo, toast]);

  const handleBulkGenerate = React.useCallback(async () => {
    if (generating || generateCooldown > 0) return;

    setGenerating(true);
    try {
      const { error } = await supabase.rpc("run_generate_http");

      if (error) {
        console.error("Bulk generation error:", error);
        toast({
          title: "Generate failed",
          description: error.message,
          variant: "destructive",
        });
        setGenerating(false);
        return;
      }

      // ✅ Better UX: don’t pretend it's complete in 3s; trigger + encourage refresh soon.
      toast({
        title: "Generation triggered ✅",
        description:
          "Question generation has started. New drafts may take 30–60 seconds to appear depending on workload.",
      });

      // ✅ Cooldown to prevent rapid re-triggers
      startGenerateCooldown(30);

      // optional: refresh once after a short delay (non-blocking)
      setTimeout(() => {
        void load();
      }, 2000);
    } catch (e: any) {
      console.error("Bulk generate exception:", e);
      toast({
        title: "Generate error",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [supabase, generating, generateCooldown, toast, load, startGenerateCooldown]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Question Drafts</CardTitle>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search question…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) =>
              setDateFrom(
                e.target.value ? new Date(e.target.value).toISOString() : "",
              )
            }
            className="w-48"
          />
          <Input
            type="datetime-local"
            value={dateTo}
            onChange={(e) =>
              setDateTo(
                e.target.value ? new Date(e.target.value).toISOString() : "",
              )
            }
            className="w-48"
          />
          <select
            className="border rounded px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | QuestionStatus)
            }
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            size="icon"
            onClick={load}
            disabled={loading}
            title={loading ? "Loading…" : "Refresh"}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>

          <Button
            variant="default"
            onClick={handleBulkGenerate}
            disabled={generating || loading || generateCooldown > 0}
            className="bg-green-600 hover:bg-green-700 text-white"
            title={
              generateCooldown > 0
                ? `Please wait ${generateCooldown}s before running again`
                : "Run Generate Now"
            }
          >
            {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {generating
              ? "Generating..."
              : generateCooldown > 0
                ? `Run Generate (${generateCooldown}s)`
                : "🚀 Run Generate Now"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No question drafts found.
          </div>
        )}

        {rows.map((row) => (
          <QuestionDraftRowView
            key={row.id}
            row={row}
            onChanged={load}
            isPublished={publishedDraftIds.has(row.id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Determines which question_drafts have already been published
 * by checking if they exist in the live questions table.
 *
 * Checks: questions.question_draft_id
 */
async function fetchPublishedDraftIds(
  supabase: ReturnType<typeof getSupabase>,
  draftIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (draftIds.length === 0) return out;

  // Only use columns that actually exist in the schema
  const candidates: Array<{ table: string; col: string }> = [
    { table: "questions", col: "question_draft_id" },
  ];

  for (const c of candidates) {
    const { data, error } = await supabase
      .from(c.table)
      .select(`${c.col}`)
      .in(c.col, draftIds)
      .limit(1000);

    if (error) {
      // Try next candidate silently; we’ll only warn if none work.
      continue;
    }

    for (const row of data ?? []) {
      const id = (row as any)[c.col];
      if (typeof id === "string") out.add(id);
    }
    return out; // success with this candidate
  }

  console.warn(
    "Could not detect published questions: none of the candidate live tables/columns worked. " +
      "Update fetchPublishedDraftIds() to match your schema.",
  );
  return out;
}

function QuestionDraftRowView({
  row,
  onChanged,
  isPublished,
}: {
  row: QuestionDraftRow;
  onChanged: () => void;
  isPublished: boolean;
}) {
  const topic = row.topic_drafts ?? null;
  const news = topic?.news_items ?? null;

  const sourceName = topic?.location_label ?? row.location_label ?? "—";
  const newsUrl = news?.url ?? null;
  const newsTitle = news?.title ?? null;

  const isRejected = row.status === "rejected";

  return (
    <div className="border rounded p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{sourceName}</span>
            <StatusBadge status={row.status} />
            {isPublished && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700">
                Published
              </span>
            )}
            <span>
              {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
            </span>
          </div>

          <h3 className="text-base font-semibold break-words">{row.question}</h3>

          {row.tags && row.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {row.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          )}

          {topic?.title && (
            <div className="text-xs text-muted-foreground mt-1">
              Topic: {topic.title}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 items-end">
          <EditQuestionDialog row={row} onSaved={onChanged} />
          <div className="flex gap-2 flex-wrap justify-end">
            <PublishButton
              row={row}
              onPublished={onChanged}
              isPublished={isPublished}
            />
            <StatusButtons
              row={row}
              onChanged={onChanged}
              isPublished={isPublished}
            />
            <PullBackLiveQuestionButton
              draftId={row.id}
              visible={isPublished}
              onPulledBack={onChanged}
            />
          </div>
          {isRejected && (
            <div className="text-[11px] text-muted-foreground">
              Rejected → Approve/Publish disabled
            </div>
          )}
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
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
          Article: {newsTitle}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: QuestionStatus }) {
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
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function EditQuestionDialog({
  row,
  onSaved,
}: {
  row: QuestionDraftRow;
  onSaved: () => void;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();

  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState(row.question);
  const [summary, setSummary] = React.useState(row.summary ?? "");
  const [tags, setTags] = React.useState((row.tags ?? []).join(", "));
  const [location, setLocation] = React.useState(row.location_label ?? "");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);

    const tagsArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const { error } = await supabase
      .from("question_drafts")
      .update({
        question,
        summary,
        tags: tagsArray,
        location_label: location || null,
      })
      .eq("id", row.id);

    if (error) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    toast({
      title: "Saved ✅",
      description: "Question draft updated.",
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
          <DialogTitle>Edit Question Draft</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Question</Label>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div>
            <Label>Summary</Label>
            <Textarea
              rows={4}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <div>
            <Label>Location label</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., New Jersey"
            />
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
  isPublished,
}: {
  row: QuestionDraftRow;
  onChanged: () => void;
  isPublished: boolean;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();

  const updateStatus = async (status: QuestionStatus) => {
    const now = new Date().toISOString();
    const patch: any = { status };

    if (status === "approved") {
      patch.approved_at = now;
      patch.rejected_at = null;
    } else if (status === "rejected") {
      patch.rejected_at = now;
      // ✅ improvement: keep timestamps consistent
      patch.approved_at = null;
    }

    const { error } = await supabase
      .from("question_drafts")
      .update(patch)
      .eq("id", row.id);

    if (error) {
      toast({
        title: "Status update failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Status updated",
      description: `Marked as ${status}.`,
    });

    onChanged();
  };

  // ✅ Your rules:
  // - If rejected → approve disabled
  // - If published → approve + reject disabled
  const approveDisabled = isPublished || row.status === "rejected" || row.status === "approved";
  const rejectDisabled = isPublished || row.status === "rejected";

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("approved")}
        disabled={approveDisabled}
        title={
          isPublished
            ? "Already published"
            : row.status === "rejected"
              ? "Rejected cannot be approved"
              : ""
        }
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("rejected")}
        disabled={rejectDisabled}
        title={isPublished ? "Already published" : ""}
      >
        Reject
      </Button>
    </div>
  );
}

function PublishButton({
  row,
  onPublished,
  isPublished,
}: {
  row: QuestionDraftRow;
  onPublished: () => void;
  isPublished: boolean;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    if (loading) return;

    if (isPublished) {
      toast({ title: "Already published", description: "This draft is already live." });
      return;
    }

    if (row.status === "rejected") {
      toast({
        title: "Cannot publish",
        description: "Rejected drafts cannot be published.",
        variant: "destructive",
      });
      return;
    }

    if (row.status !== "approved") {
      toast({
        title: "Approve first",
        description: "Only approved drafts can be published.",
        variant: "destructive",
      });
      return;
    }

    if (!confirm("Publish this draft as a live question?")) return;

    setLoading(true);
    try {
      const { error } = await supabase.rpc("admin_publish_question_draft", {
        p_draft_id: row.id,
      });

      if (error) {
        console.error("admin_publish_question_draft error:", error);
        toast({
          title: "Publish failed",
          description: error.message ?? "Failed to publish question.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Published ✅",
        description: "Question is now live.",
      });

      onPublished();
    } catch (err: any) {
      console.error("admin_publish_question_draft exception:", err);
      toast({
        title: "Publish error",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // ✅ Your rules:
  // - rejected → publish disabled
  // - published → publish disabled
  // - only approved → enabled
  const disabled =
    loading || isPublished || row.status === "rejected" || row.status !== "approved";

  return (
    <Button size="sm" variant="outline" onClick={handleClick} disabled={disabled}>
      {loading ? "Publishing…" : "Publish"}
    </Button>
  );
}

function PullBackLiveQuestionButton({
  draftId,
  visible,
  onPulledBack,
}: {
  draftId: string;
  visible: boolean;
  onPulledBack: () => void;
}) {
  const supabase = getSupabase()!;
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  // ✅ only visible after publish
  if (!visible) return null;

  const handlePullBack = async () => {
    if (loading) return;
    if (!confirm("Pull Back this live question?")) return;

    setLoading(true);
    try {
      const { error } = await supabase.rpc(PULL_BACK_RPC, { p_draft_id: draftId });

      if (error) {
        console.error(`${PULL_BACK_RPC} error:`, error);
        toast({
          title: "Pull back failed",
          description: error.message ?? "Failed to pull back live question.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Pulled back ✅",
        description: "Live question has been pulled back.",
      });

      onPulledBack();
    } catch (err: any) {
      console.error(`${PULL_BACK_RPC} exception:`, err);
      toast({
        title: "Pull back error",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={handlePullBack} disabled={loading}>
      {loading ? "Pulling back…" : "Pull Back Live Question"}
    </Button>
  );
}
