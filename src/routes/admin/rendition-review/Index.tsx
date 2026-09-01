// src/routes/admin/rendition-review/Index.tsx
// Admin review queue for question_renditions — the screen that finally calls
// the four RPCs built earlier (admin_publish_rendition,
// admin_edit_and_publish_rendition, admin_flag_rendition,
// admin_regenerate_rendition) against rows sitting in
// admin_rendition_review_queue.
//
// Raw fetch + getJwt()/supabaseHeaders(), matching every other admin page in
// this app (see routes/admin/ugq-queue/Index.tsx) — the mutex-safe pattern
// for exactly the same reason it's used everywhere else.

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Check, Pencil, Flag, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type ReviewQueueRow = {
  rendition_id: string;
  question_id: string;
  language_code: string;
  language_name: string;
  rendered_text: string | null;
  slider_low_label: string | null;
  slider_high_label: string | null;
  transform_status: string;
  axis_equivalence_check: string | null;
  axis_equivalence_notes: string | null;
  review_notes: string | null;
  generation_reason: string | null;
  rendition_created_at: string;
  rendition_updated_at: string;
  canonical_text: string;
  canonical_slider_low_label: string | null;
  canonical_slider_high_label: string | null;
  canonical_language: string;
};

// Mirrors the view's own intended triage order (worst axis_equivalence_check
// first) client-side. A bare `select *` against a view isn't guaranteed to
// preserve its internal ORDER BY, and that ORDER BY is a CASE expression
// anyway — not something PostgREST's order= query param can express, so this
// re-sort is the correct place for it rather than a fragile query-string trick.
const TRIAGE_ORDER: Record<string, number> = { failed: 0, needs_review: 1 };

async function fetchReviewQueue(): Promise<ReviewQueueRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_rendition_review_queue?select=*`, {
    headers: supabaseHeaders(getJwt()),
  });
  if (!res.ok) throw new Error(`Failed to load review queue (${res.status})`);
  const rows = (await res.json()) as ReviewQueueRow[];
  return [...rows].sort((a, b) => {
    const ta = TRIAGE_ORDER[a.axis_equivalence_check ?? ""] ?? 2;
    const tb = TRIAGE_ORDER[b.axis_equivalence_check ?? ""] ?? 2;
    if (ta !== tb) return ta - tb;
    return new Date(a.rendition_created_at).getTime() - new Date(b.rendition_created_at).getTime();
  });
}

async function callRpc(fn: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const json = await res.json().catch(() => null);
  return { ok: false, error: (json as { message?: string } | null)?.message ?? `${fn} failed (${res.status})` };
}

function equivalenceBadge(check: string | null) {
  if (check === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (check === "needs_review") return <Badge className="bg-amber-500 hover:bg-amber-500">Needs review</Badge>;
  if (check === "pass") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Pass</Badge>;
  return <Badge variant="secondary">—</Badge>;
}

function ReviewRow({ row, onDone }: { row: ReviewQueueRow; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [flagging, setFlagging] = React.useState(false);
  const [editedText, setEditedText] = React.useState(row.rendered_text ?? "");
  const [editedLow, setEditedLow] = React.useState(row.slider_low_label ?? "");
  const [editedHigh, setEditedHigh] = React.useState(row.slider_high_label ?? "");
  const [flagNote, setFlagNote] = React.useState("");

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, successTitle: string) {
    setBusy(true);
    const { ok, error } = await action();
    setBusy(false);
    if (ok) {
      toast({ title: successTitle });
      onDone();
    } else {
      toast({ title: "Action failed", description: error, variant: "destructive" });
    }
  }

  const approve = () =>
    run(() => callRpc("admin_publish_rendition", { p_rendition_id: row.rendition_id }), "Published");

  const saveEdit = () =>
    run(
      () =>
        callRpc("admin_edit_and_publish_rendition", {
          p_rendition_id: row.rendition_id,
          p_rendered_text: editedText,
          p_slider_low_label: editedLow || null,
          p_slider_high_label: editedHigh || null,
        }),
      "Edited and published"
    );

  const confirmFlag = () =>
    run(
      () => callRpc("admin_flag_rendition", { p_rendition_id: row.rendition_id, p_review_notes: flagNote }),
      "Flagged"
    );

  const regenerate = () =>
    run(() => callRpc("admin_regenerate_rendition", { p_rendition_id: row.rendition_id }), "Queued for regeneration");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{row.language_name}</Badge>
          {equivalenceBadge(row.axis_equivalence_check)}
          {row.transform_status === "flagged" && <Badge variant="secondary">Previously flagged</Badge>}
        </div>
        <span className="text-xs text-slate-400">
          {row.generation_reason === "community_proposer" ? "From a user-proposed question" : "Editorial pipeline"}
        </span>
      </div>

      {row.axis_equivalence_notes && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{row.axis_equivalence_notes}</span>
        </div>
      )}

      {row.review_notes && (
        <div className="rounded-md bg-slate-50 border border-slate-200 p-2 text-xs text-slate-600">
          <span className="font-medium">Previous reviewer note:</span> {row.review_notes}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Canonical ({row.canonical_language})
          </p>
          <p className="text-sm text-slate-800">{row.canonical_text}</p>
          <p className="text-xs text-slate-500">
            {row.canonical_slider_low_label ?? "—"} / {row.canonical_slider_high_label ?? "—"}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {row.language_name} rendition
          </p>
          {editing ? (
            <div className="space-y-2">
              <Textarea value={editedText} onChange={(e) => setEditedText(e.target.value)} rows={3} />
              <div className="flex gap-2">
                <input
                  value={editedLow}
                  onChange={(e) => setEditedLow(e.target.value)}
                  placeholder="Low label"
                  className="h-8 flex-1 rounded-md border border-slate-300 px-2 text-sm"
                />
                <input
                  value={editedHigh}
                  onChange={(e) => setEditedHigh(e.target.value)}
                  placeholder="High label"
                  className="h-8 flex-1 rounded-md border border-slate-300 px-2 text-sm"
                />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-800">
                {row.rendered_text || <span className="italic text-slate-400">No text yet</span>}
              </p>
              <p className="text-xs text-slate-500">
                {row.slider_low_label ?? "—"} / {row.slider_high_label ?? "—"}
              </p>
            </>
          )}
        </div>
      </div>

      {flagging ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={flagNote}
            onChange={(e) => setFlagNote(e.target.value)}
            placeholder="Why is this flagged?"
            className="h-8 flex-1 min-w-[200px] rounded-md border border-slate-300 px-2 text-sm"
          />
          <Button size="sm" variant="destructive" disabled={busy || !flagNote.trim()} onClick={confirmFlag}>
            Confirm flag
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFlagging(false)}>
            Cancel
          </Button>
        </div>
      ) : editing ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !editedText.trim()} onClick={saveEdit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
            Save & publish
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={approve}>
            <Check className="h-4 w-4 mr-1" /> Approve & publish
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setFlagging(true)}>
            <Flag className="h-4 w-4 mr-1" /> Flag
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={regenerate}>
            <RotateCcw className="h-4 w-4 mr-1" /> Regenerate
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AdminRenditionReviewPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-rendition-review-queue"],
    queryFn: fetchReviewQueue,
    staleTime: 15_000,
  });

  const onDone = () => queryClient.invalidateQueries({ queryKey: ["admin-rendition-review-queue"] });

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Rendition review</h1>
        <p className="text-sm text-slate-500">Renditions awaiting publish — worst axis-equivalence checks first.</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading queue…
        </div>
      )}
      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Failed to load the review queue. Verify admin_rendition_review_queue is deployed.
        </div>
      )}
      {!isLoading && !isError && (data ?? []).length === 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 text-center">
          Nothing waiting for review right now.
        </div>
      )}

      <div className="space-y-3">
        {(data ?? []).map((row) => (
          <ReviewRow key={row.rendition_id} row={row} onDone={onDone} />
        ))}
      </div>
    </div>
  );
}
