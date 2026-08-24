// src/routes/admin/ugq-queue/Index.tsx
// Epic UGQ — Admin UGQ Queue (Gate 2 review surface, spec §8.1).
//
// v2 (2026-07-06): TWO-PHASE APPROVE. "Generate question" (action: approve) now
// researches + reframes and PARKS the result at status='reframed'; the new
// Reframed tab renders ReframedReviewPanel where the admin reviews/edits the
// exact text, then Publish (action: publish_reframed) or Regenerate
// (action: discard_reframe). reframe_result is loaded on expand via the narrow
// admin_ugq_reframe_result RPC (admin_ugq_queue's RETURNS TABLE predates it).
//
// Data via the admin_ugq_queue RPC, called with the raw-fetch + getJwt pattern
// (mutex-safe) used by the other admin pages.

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Inbox, Loader2, ExternalLink, ChevronDown, ChevronRight, ShieldAlert, AlertTriangle, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";
import ReframedReviewPanel, { type ReframeResult } from "@/components/admin/ReframedReviewPanel";

type QueueRow = {
  id: string;
  raw_question: string;
  admin_edited_question: string | null;
  status: string;
  quality_score: number | null;
  rejection_reason: string | null;
  rejection_note: string | null;
  source_url: string | null;
  source_description: string | null;
  location_label: string | null;
  constituency_id: string | null;
  suggested_topic_id: string | null;
  auto_topic_id: string | null;
  auto_topic_title: string | null;
  auto_topic_status: string | null;
  ai_screen_result: Record<string, unknown> | null;
  duplicate_of_question_id: string | null;
  reframed_question_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  user_id: string;
  proposer_username: string | null;
  proposer_tier: string;
  proposer_score: number;
  proposer_total_proposed: number;
  proposer_total_published: number;
  proposer_total_rejected: number;
  proposer_flagged: boolean;
  // Aug 2026 — parallel review for auto-published questions (see
  // ugq-screen's AUTO-PUBLISH section). preview_reframe is the unverified
  // preview generated at submit time; the q_* fields describe the LIVE
  // question as it stands right now (reframed_question_id join) — q_question
  // etc. can differ from preview_reframe if an admin already used
  // edit_published. All null/undefined for proposals that never published.
  preview_reframe: Record<string, unknown> | null;
  q_question: string | null;
  q_slider_low_label: string | null;
  q_slider_high_label: string | null;
  q_context_summary: string | null;
  q_supporting_links: string[] | null;
  q_status: string | null;
  q_auto_published: boolean | null;
  q_admin_reviewed_at: string | null;
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "proposed", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "reframing", label: "Reframing" },
  { value: "reframed", label: "Reframed" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const SORTS: { value: string; label: string }[] = [
  { value: "quality", label: "Quality score" },
  { value: "recent", label: "Most recent" },
  { value: "reputation", label: "Proposer reputation" },
];

async function fetchQueue(status: string, sort: string): Promise<QueueRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_ugq_queue`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify({ p_status: status, p_sort: sort, p_limit: 50, p_offset: 0 }),
  });
  if (!res.ok) throw new Error(`Failed to load queue (${res.status})`);
  return (await res.json()) as QueueRow[];
}

type Topic = { id: string; title: string };

async function fetchTopics(): Promise<Topic[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/topics?select=id,title&order=title.asc&limit=1000`,
    { headers: supabaseHeaders(getJwt()) },
  );
  if (!res.ok) return [];
  return (await res.json()) as Topic[];
}

async function createTopic(title: string, locationLabel: string): Promise<
  { ok: true; topic: Topic } | { ok: false; error: string }
> {
  // Same insert shape as CreateParentTopicForm in AdminTopicsPage.tsx (already
  // live and working) — reused directly rather than adding a new RPC.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/topics?select=id,title`, {
    method: "POST",
    headers: { ...supabaseHeaders(getJwt()), Prefer: "return=representation" },
    body: JSON.stringify({
      title,
      tier: "global",
      location_label: locationLabel || null,
      tags: [],
      sources: [{ type: "manual", label: "Created from UGQ moderation panel" }],
      parent_topic_id: null,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: (json as { message?: string })?.message ?? `Failed to create topic (${res.status})` };
  }
  const row = Array.isArray(json) ? json[0] : json;
  if (!row?.id) return { ok: false, error: "Unexpected response creating topic" };
  return { ok: true, topic: { id: row.id, title: row.title } };
}

const REJECT_REASONS = ["duplicate", "low_quality", "safety", "not_a_question", "guidelines"];

// reframe_result is not in admin_ugq_queue's RETURNS TABLE; loaded on demand
// for expanded 'reframed' rows via the narrow admin-gated companion RPC.
async function fetchReframeResult(proposalId: string): Promise<ReframeResult | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_ugq_reframe_result`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify({ p_proposal_id: proposalId }),
  });
  if (!res.ok) throw new Error(`Failed to load reframe (${res.status})`);
  return (await res.json()) as ReframeResult | null;
}

async function moderate(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-moderate`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json?.ok, message: json?.message, error: json?.error };
}

function tierBadge(tier: string) {
  if (tier === "verified") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Verified</Badge>;
  if (tier === "trusted") return <Badge className="bg-blue-600 hover:bg-blue-600">Trusted</Badge>;
  return <Badge variant="secondary">New</Badge>;
}

function safetyBadge(flag: unknown) {
  if (flag === "reject") return <Badge className="bg-red-600 hover:bg-red-600 gap-1"><ShieldAlert className="h-3 w-3" />reject</Badge>;
  if (flag === "review") return <Badge className="bg-amber-500 hover:bg-amber-500 gap-1"><AlertTriangle className="h-3 w-3" />review</Badge>;
  if (flag === "clean") return <Badge variant="outline" className="text-emerald-700 border-emerald-300">clean</Badge>;
  return null;
}

// Aug 2026 — auto-publish parallel review: shows whether a live, UGQ-authored
// question still needs an admin look. Absent entirely for questions that
// went through the full fact-checked pipeline (q_auto_published=false) —
// those never needed review to begin with.
function needsReviewBadge(row: QueueRow) {
  if (row.q_status === "archived") {
    return <Badge className="bg-slate-500 hover:bg-slate-500">Unpublished</Badge>;
  }
  if (!row.q_auto_published) return null;
  if (row.q_admin_reviewed_at) {
    return <Badge variant="outline" className="text-emerald-700 border-emerald-300">Reviewed</Badge>;
  }
  return <Badge className="bg-amber-500 hover:bg-amber-500">Needs review</Badge>;
}

function qualityBadge(score: number | null) {
  if (score == null) return <Badge variant="outline">—</Badge>;
  const tone = score >= 70 ? "text-emerald-700 border-emerald-300"
    : score >= 40 ? "text-amber-700 border-amber-300"
    : "text-red-700 border-red-300";
  return <Badge variant="outline" className={tone}>Q{score}</Badge>;
}

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return ""; }
}

function ModerationPanel({ row, topics, onDone }: { row: QueueRow; topics: Topic[]; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Prefer the AI-resolved topic (Gate 1) over the older suggested_topic_id
  // field; admin can still change it via the dropdown either way.
  const [topicId, setTopicId] = React.useState<string>(row.auto_topic_id ?? row.suggested_topic_id ?? "");
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(row.admin_edited_question ?? row.raw_question);
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState(REJECT_REASONS[0]);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  // Inline "create new topic" — lets the admin unblock themselves without
  // leaving the queue page when nothing suitable exists yet.
  const [creatingTopic, setCreatingTopic] = React.useState(false);
  const [newTopicTitle, setNewTopicTitle] = React.useState("");
  const [newTopicLocation, setNewTopicLocation] = React.useState(row.location_label ?? "");
  const [creatingBusy, setCreatingBusy] = React.useState(false);

  async function handleCreateTopic() {
    const title = newTopicTitle.trim();
    if (title.length < 8) {
      toast({ title: "Topic title too short", description: "Use at least 8 characters — the database requires it.", variant: "destructive" });
      return;
    }
    // No DB-level uniqueness check anymore (no RPC) — guard client-side against
    // the topics already loaded. Not race-proof, but matches what a plain
    // insert form would give you anyway; good enough for an unblock-in-place tool.
    const dupe = topics.find((t) => t.title.toLowerCase() === title.toLowerCase());
    if (dupe) {
      toast({ title: "Topic already exists", description: `"${dupe.title}" is already in the list above.`, variant: "destructive" });
      return;
    }
    setCreatingBusy(true);
    const result = await createTopic(title, newTopicLocation.trim());
    setCreatingBusy(false);
    if (!result.ok) {
      toast({ title: "Could not create topic", description: result.error, variant: "destructive" });
      return;
    }
    // Merge into the shared topics cache immediately so it shows up here and
    // in any other expanded row, then reconcile with the server in the background.
    queryClient.setQueryData<Topic[]>(["admin-ugq-topics"], (old) => {
      const next = [...(old ?? []), result.topic];
      next.sort((a, b) => a.title.localeCompare(b.title));
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ["admin-ugq-topics"] });
    setTopicId(result.topic.id);
    setCreatingTopic(false);
    setNewTopicTitle("");
    toast({ title: "Topic created", description: `"${result.topic.title}" is now selected.` });
  }

  async function run(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    const { ok, message, error } = await moderate(payload);
    setBusy(null);
    if (ok) {
      toast({
        title:
          label === "reject" ? "Proposal rejected"
          : label === "flag" ? "Proposer flagged"
          : label === "rescreen" ? "Re-screen complete"
          : "Question generated",
        description: label === "approve" ? "Review it in the Reframed tab before publishing." : undefined,
      });
      onDone();
    } else {
      toast({ title: error ?? "Action failed", description: message, variant: "destructive" });
    }
  }

  // New (proposed): the only action is to (re-)run Gate 1 screening, which
  // resolves the proposal to In review, Approved, or Rejected.
  if (row.status === "proposed") {
    return (
      <div className="rounded-md border border-slate-200 p-3">
        <Button size="sm" disabled={!!busy}
          onClick={() => run({ proposal_id: row.id, action: "rescreen" }, "rescreen")}>
          {busy === "rescreen" ? "Screening…" : "Re-screen (Gate 1)"}
        </Button>
        <p className="mt-2 text-xs text-slate-500">
          Runs the AI pre-screen. On success this proposal moves to In review (or Approved / Rejected).
        </p>
      </div>
    );
  }

  // Only actionable while awaiting a decision.
  if (!["in_review", "approved"].includes(row.status)) return null;

  // A freshly-set auto_topic_id (especially a just-created pending topic) may
  // not be in the 10-min-cached `topics` list yet. Inject it as a synthetic
  // option so the <select> actually shows it as selected instead of blank.
  const pickerTopics = React.useMemo(() => {
    if (!row.auto_topic_id || !row.auto_topic_title || topics.some((t) => t.id === row.auto_topic_id)) {
      return topics;
    }
    return [...topics, { id: row.auto_topic_id, title: row.auto_topic_title }].sort((a, b) => a.title.localeCompare(b.title));
  }, [topics, row.auto_topic_id, row.auto_topic_title]);

  return (
    <div className="rounded-md border border-slate-200 p-3 space-y-3">
      {row.auto_topic_id && row.auto_topic_id === topicId && (
        row.auto_topic_status === "pending" ? (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
            🤖 AI proposed a new topic — <b>{row.auto_topic_title}</b> — not yet approved in Admin → Topics.
            You can still use it now; approve it there when convenient.
          </div>
        ) : (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1.5">
            🤖 AI-matched topic: <b>{row.auto_topic_title}</b>
          </div>
        )
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Topic</span>
        <select
          value={topicId}
          onChange={(e) => setTopicId(e.target.value)}
          className="h-8 min-w-[200px] rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">
            {pickerTopics.length === 0 ? "No topics yet — create one →" : "Select a topic…"}
          </option>
          {pickerTopics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        {!creatingTopic && (
          <Button size="sm" variant="outline" onClick={() => setCreatingTopic(true)}>
            + New topic
          </Button>
        )}
      </div>

      {creatingTopic && (
        <div className="rounded-md border border-blue-200 bg-blue-50/60 p-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={newTopicTitle}
              onChange={(e) => setNewTopicTitle(e.target.value)}
              placeholder="New topic title"
              className="h-8 flex-1 min-w-[180px] rounded-md border border-slate-300 px-2 text-sm"
            />
            <input
              value={newTopicLocation}
              onChange={(e) => setNewTopicLocation(e.target.value)}
              placeholder="Location (optional)"
              className="h-8 w-40 rounded-md border border-slate-300 px-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={creatingBusy || newTopicTitle.trim().length < 8} onClick={handleCreateTopic}>
              {creatingBusy ? "Creating…" : "Create & select"}
            </Button>
            <Button size="sm" variant="ghost" disabled={creatingBusy}
              onClick={() => { setCreatingTopic(false); setNewTopicTitle(""); }}>
              Cancel
            </Button>
            <span className="text-xs text-slate-500">Created as a global-tier topic; refine tier/tags later in Admin → Topics.</span>
          </div>
        </div>
      )}

      {editing && (
        <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
      )}

      {rejecting && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={reason} onChange={(e) => setReason(e.target.value)}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm">
            {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
            className="h-8 flex-1 min-w-[160px] rounded-md border border-slate-300 px-2 text-sm" />
          <Button size="sm" variant="destructive" disabled={!!busy}
            onClick={() => run({ proposal_id: row.id, action: "reject", reason_code: reason, note: note || null }, "reject")}>
            Confirm reject
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
        </div>
      )}

      {!rejecting && (
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <Button size="sm" disabled={!!busy || !topicId}
              onClick={() => run({ proposal_id: row.id, action: "approve", topic_id: topicId }, "approve")}>
              {busy === "approve" ? "Generating…" : "Generate question"}
            </Button>
          ) : (
            <Button size="sm" disabled={!!busy || !topicId || editText.trim().length < 20}
              onClick={() => run({ proposal_id: row.id, action: "edit_and_approve", edited_question: editText.trim(), topic_id: topicId }, "approve")}>
              {busy === "approve" ? "Generating…" : "Save & generate"}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel edit" : "Edit & generate"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setRejecting(true)}>Reject</Button>
          <Button size="sm" variant="ghost" className="text-red-600" disabled={!!busy}
            onClick={() => { if (confirm("Flag this proposer? They will be rate-limited for 7 days.")) run({ proposal_id: row.id, action: "flag_proposer" }, "flag"); }}>
            Flag proposer
          </Button>
        </div>
      )}
      {busy === "approve" && (
        <p className="text-xs text-slate-500">
          Researching &amp; reframing — with web grounding this can take up to a minute. Nothing publishes until you review it.
        </p>
      )}
    </div>
  );
}

// Phase 2 review: loads reframe_result on expand, renders the review panel.
// Also handles Reject here since ModerationPanel only renders for in_review/approved.
function ReframedSection({ row, onDone }: { row: QueueRow; onDone: () => void }) {
  const { toast } = useToast();
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState(REJECT_REASONS[0]);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const { data: rr, isLoading, isError } = useQuery<ReframeResult | null>({
    queryKey: ["ugq-reframe-result", row.id],
    queryFn: () => fetchReframeResult(row.id),
    staleTime: 0,
  });

  async function handleModerate(body: Record<string, unknown>) {
    const res = await moderate(body);
    if (res.ok && body.action === "publish_reframed") {
      toast({ title: "Question published", description: "It is now live." });
    }
    if (res.ok && body.action === "discard_reframe") {
      toast({ title: "Reframe discarded", description: "Back in In review — adjust and generate again." });
    }
    return res;
  }

  async function reject() {
    setBusy(true);
    const { ok, message, error } = await moderate({
      proposal_id: row.id, action: "reject", reason_code: reason, note: note || null,
    });
    setBusy(false);
    if (ok) { toast({ title: "Proposal rejected" }); onDone(); }
    else { toast({ title: error ?? "Action failed", description: message, variant: "destructive" }); }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reframe…
      </div>
    );
  }
  if (isError || !rr) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Could not load the reframe result. If this persists, verify the admin_ugq_reframe_result RPC is deployed.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ReframedReviewPanel
        proposal={{
          id: row.id,
          raw_question: row.raw_question,
          admin_edited_question: row.admin_edited_question,
          status: row.status,
          reframe_result: rr,
        }}
        onModerate={handleModerate}
        onChanged={onDone}
      />
      {rejecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={reason} onChange={(e) => setReason(e.target.value)}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm">
            {REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
            className="h-8 flex-1 min-w-[160px] rounded-md border border-slate-300 px-2 text-sm" />
          <Button size="sm" variant="destructive" disabled={busy} onClick={reject}>Confirm reject</Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setRejecting(true)}>
          Reject proposal
        </Button>
      )}
    </div>
  );
}

// Aug 2026 — parallel review for status='published' rows. Two very
// different populations land here:
//   1. Admin fact-checked pipeline (q_auto_published=false) — already
//      reviewed by definition (that's what Gate 2 approve/publish_reframed
//      IS), nothing to do here beyond a "View live" link.
//   2. Gate-1-only instant publish (q_auto_published=true) — went live off
//      the unverified preview; THIS is what needsReviewBadge/this section's
//      actions exist for. confirm_published / edit_published / unpublish all
//      hit ugq-moderate the same way every other action here does.
function PublishedReviewSection({ row, onDone }: { row: QueueRow; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(row.q_question ?? row.raw_question);
  const [editLow, setEditLow] = React.useState(row.q_slider_low_label ?? "");
  const [editHigh, setEditHigh] = React.useState(row.q_slider_high_label ?? "");
  const [unpublishing, setUnpublishing] = React.useState(false);
  const [unpublishNote, setUnpublishNote] = React.useState("");

  const isLive = row.q_status === "active";
  const needsReview = row.q_auto_published === true && !row.q_admin_reviewed_at;

  async function run(payload: Record<string, unknown>, label: string, successTitle: string) {
    setBusy(label);
    const { ok, message, error } = await moderate(payload);
    setBusy(null);
    if (ok) {
      toast({ title: successTitle });
      setEditing(false);
      setUnpublishing(false);
      onDone();
    } else {
      toast({ title: error ?? "Action failed", description: message, variant: "destructive" });
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-3 space-y-3">
      <div className="flex items-center gap-2">
        {needsReviewBadge(row)}
        {row.reframed_question_id && (
          <a
            href={`#/q/${row.reframed_question_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline ml-auto"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View live
          </a>
        )}
      </div>

      <div className="rounded-md bg-slate-50 border border-slate-200 p-2.5 space-y-1.5">
        <div className="text-xs font-medium text-slate-500">Live question text</div>
        {editing ? (
          <div className="space-y-2">
            <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} />
            <div className="flex flex-wrap gap-2">
              <input value={editLow} onChange={(e) => setEditLow(e.target.value)} placeholder="Oppose-end label"
                className="h-8 flex-1 min-w-[160px] rounded-md border border-slate-300 px-2 text-sm" />
              <input value={editHigh} onChange={(e) => setEditHigh(e.target.value)} placeholder="Support-end label"
                className="h-8 flex-1 min-w-[160px] rounded-md border border-slate-300 px-2 text-sm" />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-800">{row.q_question ?? "—"}</p>
            {(row.q_slider_low_label || row.q_slider_high_label) && (
              <p className="text-xs text-slate-500">
                {row.q_slider_low_label ?? "Oppose"} <span className="text-slate-300">↔</span> {row.q_slider_high_label ?? "Support"}
              </p>
            )}
          </>
        )}
      </div>

      {row.q_context_summary && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-2.5 space-y-1">
          <div className="text-xs font-medium text-blue-700">Background context (web-search grounded)</div>
          <p className="text-xs text-blue-900">{row.q_context_summary}</p>
          {row.q_supporting_links && row.q_supporting_links.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {row.q_supporting_links.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer"
                   className="text-[11px] text-blue-600 hover:underline">
                  {(() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })()}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {row.q_admin_reviewed_at && (
        <p className="text-xs text-slate-500">
          Reviewed {timeAgo(row.q_admin_reviewed_at)}.
        </p>
      )}

      {!isLive ? (
        <p className="text-xs text-slate-500">This question was unpublished — no further actions available here.</p>
      ) : unpublishing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input value={unpublishNote} onChange={(e) => setUnpublishNote(e.target.value)}
            placeholder="Reason (shown in audit log only)"
            className="h-8 flex-1 min-w-[200px] rounded-md border border-slate-300 px-2 text-sm" />
          <Button size="sm" variant="destructive" disabled={!!busy}
            onClick={() => run({ proposal_id: row.id, action: "unpublish", note: unpublishNote || null }, "unpublish", "Question unpublished")}>
            {busy === "unpublish" ? "Unpublishing…" : "Confirm unpublish"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setUnpublishing(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {needsReview && !editing && (
            <Button size="sm" disabled={!!busy}
              onClick={() => run({ proposal_id: row.id, action: "confirm_published" }, "confirm", "Marked as reviewed")}>
              {busy === "confirm" ? "Confirming…" : "Confirm as-is"}
            </Button>
          )}
          {!editing ? (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setEditing(true)}>
              Edit text
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={!!busy || editText.trim().length < 20}
                onClick={() => run({
                  proposal_id: row.id, action: "edit_published",
                  edited_question: editText.trim(),
                  slider_low_label: editLow.trim() || null,
                  slider_high_label: editHigh.trim() || null,
                }, "edit", "Question updated & marked reviewed")}>
                {busy === "edit" ? "Saving…" : "Save & mark reviewed"}
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy}
                onClick={() => {
                  setEditing(false);
                  setEditText(row.q_question ?? row.raw_question);
                  setEditLow(row.q_slider_low_label ?? "");
                  setEditHigh(row.q_slider_high_label ?? "");
                }}>
                Cancel
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="text-red-600 ml-auto" disabled={!!busy}
            onClick={() => setUnpublishing(true)}>
            Unpublish
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AdminUGQQueuePage() {
  const [status, setStatus] = React.useState("in_review");
  const [sort, setSort] = React.useState("quality");
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<QueueRow[]>({
    queryKey: ["admin-ugq-queue", status, sort],
    queryFn: () => fetchQueue(status, sort),
    staleTime: 30_000,
  });

  const rows = data ?? [];

  const { data: topicsData } = useQuery<Topic[]>({
    queryKey: ["admin-ugq-topics"],
    queryFn: fetchTopics,
    staleTime: 10 * 60 * 1000,
  });
  const topics = topicsData ?? [];

  return (
    <div className="max-w-5xl mx-auto py-6 px-2 space-y-5">
      <div className="flex items-center gap-2">
        <Inbox className="h-6 w-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">UGQ Queue</h1>
        <span className="text-sm text-slate-500">Community-proposed questions · Gate 2</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((t) => (
            <Button
              key={t.value}
              size="sm"
              variant={status === t.value ? "default" : "outline"}
              onClick={() => setStatus(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-slate-500">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading proposals…
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {(error as Error)?.message ?? "Could not load the queue."}
        </div>
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          No proposals with status “{STATUS_TABS.find((t) => t.value === status)?.label}”.
        </div>
      )}

      {/* Rows */}
      <div className="space-y-2">
        {rows.map((r) => {
          const isOpen = expanded === r.id;
          const ai = r.ai_screen_result ?? {};
          return (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white">
              <button
                className="w-full text-left p-3 flex items-start gap-3"
                onClick={() => setExpanded(isOpen ? null : r.id)}
              >
                <span className="pt-0.5 text-slate-400">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900 font-medium line-clamp-2">{r.raw_question}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>@{r.proposer_username ?? "unknown"}</span>
                    {tierBadge(r.proposer_tier)}
                    {r.proposer_flagged && <Badge className="bg-red-600 hover:bg-red-600">flagged</Badge>}
                    {qualityBadge(r.quality_score)}
                    {safetyBadge((ai as Record<string, unknown>).safety_flag)}
                    {r.status === "published" && needsReviewBadge(r)}
                    {r.location_label && (
                      <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{r.location_label}</span>
                    )}
                    <span className="ml-auto">{timeAgo(r.created_at)}</span>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 p-3 pl-10 space-y-3 text-sm">
                  {r.admin_edited_question && (
                    <div>
                      <div className="text-xs font-medium text-slate-500">Admin-edited</div>
                      <p className="text-slate-800">{r.admin_edited_question}</p>
                    </div>
                  )}

                  {r.source_url && (
                    <a href={r.source_url} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> Source link
                    </a>
                  )}
                  {r.source_description && <p className="text-slate-600">{r.source_description}</p>}

                  {/* AI screen */}
                  <div className="rounded-md bg-slate-50 border border-slate-200 p-2.5">
                    <div className="text-xs font-medium text-slate-500 mb-1">AI screen (Gate 1)</div>
                    {Object.keys(ai).length === 0 ? (
                      <p className="text-xs text-slate-400">Not screened yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700">
                        <span>Valid question: <b>{String((ai as Record<string, unknown>).is_valid_question ?? "—")}</b></span>
                        <span>Duplicate: <b>{String((ai as Record<string, unknown>).is_duplicate ?? "—")}</b></span>
                        <span>Safety: <b>{String((ai as Record<string, unknown>).safety_flag ?? "—")}</b></span>
                        <span>Quality: <b>{String((ai as Record<string, unknown>).quality_score ?? r.quality_score ?? "—")}</b></span>
                        {(ai as Record<string, unknown>).topic_suggestion ? (
                          <span className="col-span-2">Topic hint: <b>{String((ai as Record<string, unknown>).topic_suggestion)}</b></span>
                        ) : null}
                        {(ai as Record<string, unknown>).reason ? (
                          <span className="col-span-2 text-slate-500">{String((ai as Record<string, unknown>).reason)}</span>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {r.status === "rejected" && (
                    <div className="text-xs text-red-600">
                      Rejected — reason: <b>{r.rejection_reason ?? "—"}</b>
                      {r.rejection_note ? ` · ${r.rejection_note}` : ""}
                    </div>
                  )}

                  {/* Proposer history */}
                  <div className="text-xs text-slate-500">
                    Proposer history — proposed {r.proposer_total_proposed} · published {r.proposer_total_published}
                    · rejected {r.proposer_total_rejected} · score {r.proposer_score}
                  </div>

                  {/* Gate 2 moderation actions */}
                  {r.status === "reframed" ? (
                    <ReframedSection row={r} onDone={() => refetch()} />
                  ) : r.status === "published" ? (
                    <PublishedReviewSection row={r} onDone={() => refetch()} />
                  ) : (
                    <ModerationPanel row={r} topics={topics} onDone={() => refetch()} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
