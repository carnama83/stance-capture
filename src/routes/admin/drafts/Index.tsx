import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
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
import { ExternalLink, Edit2, RefreshCw } from "lucide-react";

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
    // We no longer select topic_sources in the query, but keep the type relaxed.
    topic_sources?: {
      id: string;
      name: string | null;
    } | null;
  } | null;
};

const STATUS_FILTERS: { value: "all" | DraftStatus; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export default function TopicDraftsPage() {
  const supabase = React.useMemo(createSupabase, []);
  const [rows, setRows] = React.useState<TopicDraftRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<"all" | DraftStatus>(
    "all",
  );
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

    if (statusFilter !== "all") {
      q = q.eq("status", statusFilter);
    }
    if (dateFrom) {
      q = q.gte("created_at", dateFrom);
    }
    if (dateTo) {
      q = q.lte("created_at", dateTo);
    }

    const { data, error } = await q;
    if (error) {
      console.error("Failed to load topic_drafts:", error);
      setRows([]);
      setLoading(false);
      return;
    }

    let items = (data ?? []) as TopicDraftRow[];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter((r) =>
        (r.title ?? "").toLowerCase().includes(needle),
      );
    }

    setRows(items);
    setLoading(false);
  }, [supabase, statusFilter, search, dateFrom, dateTo]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Topic Drafts</CardTitle>
        <div className="flex items-center gap-2">
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
              setStatusFilter(e.target.value as "all" | DraftStatus)
            }
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Button variant="outline" size="icon" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No topic drafts found.
          </div>
        )}
        {rows.map((row) => (
          <TopicDraftRowView key={row.id} row={row} onChanged={load} />
        ))}
      </CardContent>
    </Card>
  );
}

function TopicDraftRowView({
  row,
  onChanged,
}: {
  row: TopicDraftRow;
  onChanged: () => void;
}) {
  // We no longer reliably have topic_sources; fall back to location_label if needed.
  const sourceName =
    row.news_items?.topic_sources?.name ??
    row.location_label ??
    "—";
  const newsUrl = row.news_items?.url ?? null;
  const newsTitle = row.news_items?.title ?? null;

  return (
    <div className="border rounded p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{sourceName}</span>
            <StatusBadge status={row.status} />
            <span>
              {row.created_at
                ? new Date(row.created_at).toLocaleString()
                : "—"}
            </span>
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
          <StatusButtons row={row} onChanged={onChanged} />
        </div>
      </div>

      {row.summary && (
        <p className="text-sm whitespace-pre-wrap">{row.summary}</p>
      )}

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
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function EditTopicDialog({
  row,
  onSaved,
}: {
  row: TopicDraftRow;
  onSaved: () => void;
}) {
  const supabase = React.useMemo(createSupabase, []);
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState(row.title);
  const [summary, setSummary] = React.useState(row.summary ?? "");
  const [tags, setTags] = React.useState((row.tags ?? []).join(", "));
  const [location, setLocation] = React.useState(row.location_label ?? "");

  const save = async () => {
    const tagsArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const { error } = await supabase
      .from("topic_drafts")
      .update({
        title,
        summary,
        tags: tagsArray,
        location_label: location || null,
      })
      .eq("id", row.id);

    if (error) {
      alert(error.message);
      return;
    }
    setOpen(false);
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
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
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
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
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
          <Button onClick={save}>Save</Button>
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
  const supabase = React.useMemo(createSupabase, []);

  const updateStatus = async (status: DraftStatus) => {
    const now = new Date().toISOString();
    const patch: any = { status };

    if (status === "approved") {
      patch.approved_at = now;
      patch.rejected_at = null;
    } else if (status === "rejected") {
      patch.rejected_at = now;
    }

    const { error } = await supabase
      .from("topic_drafts")
      .update(patch)
      .eq("id", row.id);

    if (error) {
      alert(error.message);
      return;
    }
    onChanged();
  };

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("approved")}
        disabled={row.status === "approved"}
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("rejected")}
        disabled={row.status === "rejected"}
      >
        Reject
      </Button>
    </div>
  );
}
