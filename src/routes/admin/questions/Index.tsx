// src/routes/admin/questions/Index.tsx
import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type QuestionRow = {
  id: string;
  topic_id: string | null;
  question_text: string;
  created_at: string | null;
  status: string | null;
};

const PAGE_SIZE = 25;
const TABLE_NAME = "ai_question_drafts";

/** Normalize a raw row into our UI shape without assuming exact column names. */
function normalizeRow(raw: any): QuestionRow {
  const question_text =
    raw.question_text ??
    raw.question ??
    raw.prompt ??
    raw.text ??
    "";

  const created_at =
    raw.created_at ??
    raw.inserted_at ??
    raw.created_on ??
    raw.created_ts ??
    raw.created ??
    null;

  const status =
    raw.status ??
    raw.state ??
    raw.review_status ??
    null;

  const topic_id =
    raw.topic_id ??
    raw.topic ??
    raw.topic_slug ??
    null;

  return {
    id: raw.id,
    topic_id,
    question_text,
    created_at,
    status,
  };
}

export default function AdminQuestionsPage() {
  const sb = React.useMemo(createSupabase, []);
  const [rows, setRows] = React.useState<QuestionRow[]>([]);
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

      // ✅ No explicit column list, so no "column X does not exist" errors.
      const { data, error } = await sb
        .from(TABLE_NAME)
        .select("*")
        .range(from, to);

      if (error) throw error;

      let items = (data ?? []).map(normalizeRow);

      // Optional client-side search
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        items = items.filter((r) =>
          (r.question_text || "").toLowerCase().includes(needle)
        );
      }

      // Client-side sort by created_at desc
      items.sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        return tb - ta;
      });

      setRows(items);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("AdminQuestions load error:", e);
      setError(e?.message ?? "Failed to load questions");
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
        // Fallback: direct update if RPC not present or fails
        const u = await sb
          .from(TABLE_NAME)
          .update({ status: "approved" })
          .eq("id", id);
        if (u.error) throw u.error;
      }
      await load();
    } catch (e: any) {
      // eslint-disable-next-line no-alert
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
          .update({ status: "rejected" })
          .eq("id", id);
        if (u.error) throw u.error;
      }
      await load();
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      alert(e?.message ?? "Failed to reject draft");
    } finally {
      setBusyId(null);
    }
  }

  async function handlePublish(id: string) {
    if (!confirm("Publish this draft? This will make it live.")) return;
    setBusyId(id);
    try {
      const r = await sb.rpc("admin_publish_draft", { p_draft_id: id });
      if (r.error) throw r.error; // publishing should go through RPC for invariants
      await load();
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      alert(e?.message ?? "Failed to publish draft");
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
            placeholder="Search question text…"
            className="w-64"
          />
          <Button variant="outline" onClick={() => load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Status */}
      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-3">
          {error}
        </div>
      )}

      {/* List */}
      <div className="grid gap-3">
        {rows.map((row) => (
          <Card key={row.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium break-words">
                  {row.question_text}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{row.status ?? "pending"}</Badge>
                  {row.topic_id && <span>topic: {row.topic_id}</span>}
                  <span>
                    {row.created_at
                      ? new Date(row.created_at).toLocaleString()
                      : "—"}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="shrink-0 flex items-center gap-2">
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
                <Button
                  size="sm"
                  disabled={isBusy(row.id)}
                  onClick={() => handlePublish(row.id)}
                  title="Publish (creates a live question; irreversible in most flows)"
                >
                  {isBusy(row.id) ? "Working…" : "Publish"}
                </Button>
              </div>
            </div>
          </Card>
        ))}

        {!loading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground">No questions found.</div>
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
