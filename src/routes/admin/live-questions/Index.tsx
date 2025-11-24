// src/routes/admin/live-questions/Index.tsx

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

type QuestionStatus = "active" | "archived";

type QuestionRow = {
  id: string;
  question_draft_id: string | null;
  topic_draft_id: string | null;
  news_item_id: string | null;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  status: QuestionStatus;
  created_at: string;
  created_by: string | null;
  published_at: string;
};

const STATUS_FILTERS: { value: "all" | QuestionStatus; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export default function LiveQuestionsPage() {
  const supabase = React.useMemo(createSupabase, []);
  const [rows, setRows] = React.useState<QuestionRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<"all" | QuestionStatus>(
    "all",
  );
  const [search, setSearch] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);

    let q = supabase
      .from("questions")
      .select(
        `
        id,
        question_draft_id,
        topic_draft_id,
        news_item_id,
        question,
        summary,
        tags,
        location_label,
        status,
        created_at,
        created_by,
        published_at
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
      console.error("Failed to load questions:", error);
      setRows([]);
      setLoading(false);
      return;
    }

    let items = (data ?? []) as QuestionRow[];
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      items = items.filter((r) =>
        (r.question ?? "").toLowerCase().includes(needle),
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
        <CardTitle>Live Questions</CardTitle>
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
            No live questions found.
          </div>
        )}
        {rows.map((row) => (
          <QuestionRowView key={row.id} row={row} onChanged={load} />
        ))}
      </CardContent>
    </Card>
  );
}

function QuestionRowView({
  row,
  onChanged,
}: {
  row: QuestionRow;
  onChanged: () => void;
}) {
  const createdAt = row.created_at
    ? new Date(row.created_at).toLocaleString()
    : "—";
  const publishedAt = row.published_at
    ? new Date(row.published_at).toLocaleString()
    : "—";

  return (
    <div className="border rounded p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status={row.status} />
            <span>Created: {createdAt}</span>
            <span>Published: {publishedAt}</span>
            {row.location_label && (
              <span className="inline-flex items-center">
                · {row.location_label}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold break-words">
            {row.question}
          </h3>
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
          <EditQuestionDialog row={row} onSaved={onChanged} />
          <StatusButtons row={row} onChanged={onChanged} />
        </div>
      </div>

      {row.summary && (
        <p className="text-sm whitespace-pre-wrap">{row.summary}</p>
      )}

      {/* Optional: you can later link into admin/drafts or news via IDs */}
      <div className="text-xs text-muted-foreground space-x-2">
        {row.question_draft_id && (
          <span>Draft: {row.question_draft_id.slice(0, 8)}…</span>
        )}
        {row.topic_draft_id && (
          <span>Topic: {row.topic_draft_id.slice(0, 8)}…</span>
        )}
        {row.news_item_id && (
          <span>News: {row.news_item_id.slice(0, 8)}…</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: QuestionStatus }) {
  let cls = "";
  let label = "";

  switch (status) {
    case "active":
      cls = "bg-emerald-100 text-emerald-700";
      label = "Active";
      break;
    case "archived":
      cls = "bg-slate-200 text-slate-700";
      label = "Archived";
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
  row: QuestionRow;
  onSaved: () => void;
}) {
  const supabase = React.useMemo(createSupabase, []);
  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState(row.question);
  const [summary, setSummary] = React.useState(row.summary ?? "");
  const [tags, setTags] = React.useState((row.tags ?? []).join(", "));
  const [location, setLocation] = React.useState(row.location_label ?? "");

  const save = async () => {
    const tagsArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const { error } = await supabase
      .from("questions")
      .update({
        question,
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
          <DialogTitle>Edit Live Question</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Question</Label>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
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
  row: QuestionRow;
  onChanged: () => void;
}) {
  const supabase = React.useMemo(createSupabase, []);

  const updateStatus = async (status: QuestionStatus) => {
    const { error } = await supabase
      .from("questions")
      .update({ status })
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
        onClick={() => updateStatus("active")}
        disabled={row.status === "active"}
      >
        Mark Active
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus("archived")}
        disabled={row.status === "archived"}
      >
        Archive
      </Button>
    </div>
  );
}
