// src/routes/admin/questions/Index.tsx
import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RegionMultiSelect } from "@/components/admin/RegionMultiSelect";
import { JsonViewer } from "@/components/admin/JsonViewer";
import { Pencil, SendHorizontal } from "lucide-react";

const PAGE_SIZE = 25;
const TABLE_NAME = "ai_question_drafts";

type DraftRow = {
  id: string;
  lang: string;
  title: string;
  summary: string | null;
  tags: string[];
  sources: any[];
  state: string | null;
  status: string | null;
  created_at: string | null;
  topic_id: string | null;
};

function normalizeRow(raw: any): DraftRow {
  const lang = raw.lang ?? "en";
  const title =
    raw.title ??
    raw.question_text ??
    raw.question ??
    raw.prompt ??
    raw.text ??
    "(untitled)";

  const summary = raw.summary ?? null;
  const tags: string[] = Array.isArray(raw.tags)
    ? raw.tags
    : typeof raw.tags === "string"
    ? raw.tags.split(",").map((t: string) => t.trim())
    : [];

  const sources = Array.isArray(raw.sources) ? raw.sources : [];

  const created_at =
    raw.created_at ??
    raw.inserted_at ??
    raw.created_on ??
    raw.created_ts ??
    raw.created ??
    null;

  const state =
    raw.state ??
    raw.review_status ??
    raw.status ??
    null;

  const status = raw.status ?? state ?? null;

  const topic_id =
    raw.topic_id ??
    raw.topic ??
    raw.topic_slug ??
    null;

  return {
    id: raw.id,
    lang,
    title,
    summary,
    tags,
    sources,
    state,
    status,
    created_at,
    topic_id,
  };
}

export default function AdminQuestionsPage() {
  const sb = React.useMemo(createSupabase, []);
  const [rows, setRows] = React.useState<DraftRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [q, setQ] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = sb
        .from(TABLE_NAME)
        .select("*")
        .eq("state", "draft") // match your existing Drafts page filter
        .range(from, to);

      const { data, error } = await query;
      if (error) throw error;

      let items = (data ?? []).map(normalizeRow);

      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        items = items.filter((r) =>
          (r.title || "").toLowerCase().includes(needle)
        );
      }

      items.sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        return tb - ta;
      });

      setRows(items);
    } catch (e: any) {
      console.error("AdminQuestions load error:", e);
      setError(e?.message ?? "Failed to load question drafts");
    } finally {
      setLoading(false);
    }
  }, [sb, page, q]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(id: string) {
    if (!confirm("Approve this draft?")) return;
    setBusyId(id);
    try {
      const r = await sb.rpc("admin_approve_draft", { p_draft_id: id });
      if (r.error) {
        // Fallback: direct update to status/state
        const u = await sb
          .from(TABLE_NAME)
          .update({ status: "approved", state: "approved" })
          .eq("id", id);
        if (u.error) throw u.error;
      }
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Failed to approve draft");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    if (!confirm("Reject this draft?")) return;
    setBusyId(id);
    try {
      const r = await sb.rpc("admin_reject_draft", { p_draft_id: id });
      if (r.error) {
        const u = await sb
          .from(TABLE_NAME)
          .update({ status: "rejected", state: "rejected" })
          .eq("id", id);
        if (u.error) throw u.error;
      }
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Failed to reject draft");
    } finally {
      setBusyId(null);
    }
  }

  const isBusy = (id: string) => busyId === id;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-semibold">AI Question Drafts</h1>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => {
              setPage(0);
              setQ(e.target.value);
            }}
            placeholder="Search question title…"
            className="w-64"
          />
          <Button variant="outline" onClick={() => load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Status */}
      {loading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}
      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">
          {error}
        </div>
      )}

      {/* List */}
      <div className="grid gap-3">
        {rows.map((row) => (
          <Card key={row.id} className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="text-xs text-muted-foreground">
                  {(row.lang ?? "en").toUpperCase()}
                </div>
                <div className="font-medium break-words">
                  {row.title}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {row.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary">
                    {row.state ?? row.status ?? "draft"}
                  </Badge>
                  {row.topic_id && <span>topic: {row.topic_id}</span>}
                  <span>
                    {row.created_at
                      ? new Date(row.created_at).toLocaleString()
                      : "—"}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="shrink-0 flex flex-col gap-2 items-end">
                <EditDraftDialog row={row} onSaved={load} />
                <PublishDraftDialog draftId={row.id} onPublished={load} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isBusy(row.id)}
                    onClick={() => handleApprove(row.id)}
                    title="Mark as approved (keeps it in drafts; not yet public)"
                  >
                    {isBusy(row.id) ? "Working…" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy(row.id)}
                    onClick={() => handleReject(row.id)}
                    className="text-destructive border-destructive"
                    title="Reject (moves out of active queue)"
                  >
                    {isBusy(row.id) ? "Working…" : "Reject"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Summary */}
            {row.summary && (
              <div className="text-sm whitespace-pre-wrap">
                {row.summary}
              </div>
            )}

            {/* Sources JSON */}
            {row.sources && row.sources.length > 0 && (
              <div className="mt-2">
                <JsonViewer value={row.sources} />
              </div>
            )}
          </Card>
        ))}

        {!loading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No question drafts found.
          </div>
        )}
      </div>

      {/* Pager */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Page {page + 1} · Showing up to {PAGE_SIZE} items
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading || rows.length < PAGE_SIZE}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditDraftDialog({ row, onSaved }: { row: DraftRow; onSaved: () => void }) {
  const supabase = React.useMemo(createSupabase, []);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    title: row.title ?? "",
    summary: row.summary ?? "",
    tags: row.tags ?? [],
    sources: row.sources ?? [],
    lang: row.lang ?? "en",
  });

  const save = async () => {
    if (form.title.length < 8 || form.title.length > 140) {
      alert("Title must be 8–140 characters.");
      return;
    }
    if (!Array.isArray(form.sources) || form.sources.length === 0) {
      alert("Sources must be a non-empty JSON array.");
      return;
    }
    const { error } = await supabase
      .from(TABLE_NAME)
      .update(form)
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
          <Pencil className="h-4 w-4 mr-1" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Question Draft</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Language</Label>
            <Input
              value={form.lang}
              onChange={(e) => setForm({ ...form, lang: e.target.value })}
            />
          </div>
          <div>
            <Label>Title / Question</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <Label>Summary</Label>
            <Textarea
              rows={4}
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </div>
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input
              value={form.tags.join(", ")}
              onChange={(e) =>
                setForm({
                  ...form,
                  tags: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
          <div>
            <Label>Sources (JSON array)</Label>
            <Textarea
              rows={6}
              value={JSON.stringify(form.sources, null, 2)}
              onChange={(e) => {
                try {
                  const v = JSON.parse(e.target.value);
                  setForm({ ...form, sources: v });
                } catch {
                  // ignore until valid JSON
                }
              }}
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

function PublishDraftDialog({
  draftId,
  onPublished,
}: {
  draftId: string;
  onPublished: () => void;
}) {
  const supabase = React.useMemo(createSupabase, []);
  const [open, setOpen] = React.useState(false);
  const [regions, setRegions] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  const publish = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_publish_draft", {
      p_draft_id: draftId,
      p_region_ids: regions,
    });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setOpen(false);
    onPublished();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <SendHorizontal className="h-4 w-4 mr-1" /> Publish
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish Draft</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select regions (optional). Leave empty for global/no regional
            targeting.
          </p>
          <RegionMultiSelect value={regions} onChange={setRegions} />
        </div>
        <DialogFooter>
          <Button onClick={publish} disabled={busy}>
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
