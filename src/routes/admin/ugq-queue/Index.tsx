// src/routes/admin/ugq-queue/Index.tsx
// Epic UGQ — Build Step 4: Admin UGQ Queue (Gate 2 review surface, spec §8.1).
//
// Read surface only: lists community proposals with proposer identity, reputation
// tier, AI-screen results and quality score. Moderation actions (approve / reject /
// edit) are wired in step 5 once ugq-moderate is deployed.
//
// Data via the admin_ugq_queue RPC, called with the raw-fetch + getJwt pattern
// (mutex-safe) used by the other admin pages.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
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
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "reframing", label: "Reframing" },
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

const REJECT_REASONS = ["duplicate", "low_quality", "safety", "not_a_question", "guidelines"];

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
  const [topicId, setTopicId] = React.useState<string>(row.suggested_topic_id ?? "");
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(row.admin_edited_question ?? row.raw_question);
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState(REJECT_REASONS[0]);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  // Only actionable while awaiting a decision.
  if (!["in_review", "approved"].includes(row.status)) return null;

  async function run(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    const { ok, message, error } = await moderate(payload);
    setBusy(null);
    if (ok) {
      toast({ title: label === "reject" ? "Proposal rejected" : label === "flag" ? "Proposer flagged" : "Question published" });
      onDone();
    } else {
      toast({ title: error ?? "Action failed", description: message, variant: "destructive" });
    }
  }

  return (
    <div className="rounded-md border border-slate-200 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Topic</span>
        <select
          value={topicId}
          onChange={(e) => setTopicId(e.target.value)}
          className="h-8 min-w-[200px] rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">Select a topic…</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </div>

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
              {busy === "approve" ? "Publishing…" : "Approve"}
            </Button>
          ) : (
            <Button size="sm" disabled={!!busy || !topicId || editText.trim().length < 20}
              onClick={() => run({ proposal_id: row.id, action: "edit_and_approve", edited_question: editText.trim(), topic_id: topicId }, "approve")}>
              {busy === "approve" ? "Publishing…" : "Save & approve"}
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel edit" : "Edit & approve"}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setRejecting(true)}>Reject</Button>
          <Button size="sm" variant="ghost" className="text-red-600" disabled={!!busy}
            onClick={() => { if (confirm("Flag this proposer? They will be rate-limited for 7 days.")) run({ proposal_id: row.id, action: "flag_proposer" }, "flag"); }}>
            Flag proposer
          </Button>
        </div>
      )}
      {busy === "approve" && (
        <p className="text-xs text-slate-500">Reframing &amp; publishing — this can take a few seconds.</p>
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
                  <ModerationPanel row={r} topics={topics} onDone={() => refetch()} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
