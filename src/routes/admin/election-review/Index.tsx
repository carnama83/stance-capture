// src/routes/admin/election-review/Index.tsx
//
// Admin: Election Question Review Queue (Epic EL — Phase EL-5)
//
// Layout:
//   - Election selector + phase selector
//   - Balance Dashboard  — per-party and per-candidate question counts
//   - Review Queue       — filterable list of DRAFT questions with
//                          approve / reject / edit actions
//   - Bulk Approve       — approve all in filter set (blocked if balance check fails)
//
// Compliance guards built in:
//   - Contradiction flag (amber warning, EL-QA-P10)
//   - Low confidence score <0.5 (amber flag, EL-QA-P11)
//   - Balance check blocks bulk approval (EL-QA-P12)
//   - Express advocacy detection on edit (EL-QA-021, EL-QA-G13)
//   - Publish blocked when election in SILENCE (HTTP 451 shown)
//
// QA gates: EL-QA-P10, P11, P12, P15, P16, EL-QA-021, EL-QA-G13

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  RefreshCw, Loader2, CheckCircle2, XCircle, Pencil, AlertTriangle,
  Info, BarChart3, ListFilter, Vote, ChevronDown, ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Election = { id: string; name: string; tier_code: string; state: string };

type Draft = {
  id: string;
  election_id: string;
  party_id: string | null;
  candidate_id: string | null;
  constituency_id: string | null;
  question: string;
  context_summary: string | null;
  issue_tag: string | null;
  framing_style: string | null;
  question_type: string;
  confidence_score: number | null;
  potential_contradiction: boolean;
  slider_low_label: string;
  slider_high_label: string;
  status: string;
  review_notes: string | null;
  created_at: string;
  // joined
  party_name?: string;
  party_abbreviation?: string;
  party_colour?: string;
  candidate_name?: string;
  constituency_name?: string;
};

type BalanceRow = {
  entity_type: string;
  entity_id: string;
  entity_name: string;
  entity_abbrev: string;
  draft_count: number;
  approved_count: number;
  rejected_count: number;
  contradiction_count: number;
  avg_confidence: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXPRESS_ADVOCACY = [
  /\bvote for\b/i, /\bvote against\b/i, /\belect\b/i,
  /\bdo not elect\b/i, /\bpoll\b/i,
];

function checkAdvocacy(text: string): string | null {
  for (const p of EXPRESS_ADVOCACY) {
    if (p.test(text)) return `Forbidden language: "${text.match(p)?.[0]}"`;
  }
  return null;
}

function getRpcFetchHeaders() {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const projectRef = import.meta.env.VITE_SUPABASE_URL?.replace("https://", "")?.split(".")[0] ?? "";
  let jwt = anonKey;
  try {
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (raw) { const p = JSON.parse(raw); if (p?.access_token) jwt = p.access_token; }
  } catch {}
  return { anonKey, jwt, baseUrl: import.meta.env.VITE_SUPABASE_URL as string };
}

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const colour = score < 0.5
    ? "bg-amber-50 text-amber-700 border-amber-300"
    : "bg-green-50 text-green-700 border-green-300";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${colour}`}>
      {pct}%
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT:    "bg-slate-100 text-slate-700 border-slate-300",
    APPROVED: "bg-green-50 text-green-700 border-green-300",
    REJECTED: "bg-red-50 text-red-700 border-red-300",
    ARCHIVED: "bg-gray-100 text-gray-500 border-gray-200",
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold border uppercase ${styles[status] ?? styles.DRAFT}`}>
      {status}
    </span>
  );
}

// ─── Balance Dashboard ─────────────────────────────────────────────────────────

function BalanceDashboard({ rows, loading }: { rows: BalanceRow[]; loading: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  if (loading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading balance…</div>;
  if (!rows.length) return null;

  const parties = rows.filter((r) => r.entity_type === "party");
  const candidates = rows.filter((r) => r.entity_type === "candidate");
  const totalDrafts = rows.reduce((s, r) => s + Number(r.draft_count), 0);
  const totalApproved = rows.reduce((s, r) => s + Number(r.approved_count), 0);
  const contradictions = rows.reduce((s, r) => s + Number(r.contradiction_count), 0);
  const lowConfidence = rows.filter((r) => r.avg_confidence !== null && r.avg_confidence < 0.5).length;

  return (
    <Card>
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Balance Dashboard</span>
          <span className="text-xs text-muted-foreground">{totalDrafts} drafts · {totalApproved} approved</span>
          {contradictions > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-300">
              ⚠ {contradictions} contradictions
            </span>
          )}
          {lowConfidence > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-300">
              ⚠ {lowConfidence} low confidence
            </span>
          )}
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>

      {expanded && (
        <CardContent className="pt-0 pb-4 space-y-4">
          {parties.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Parties</p>
              <div className="divide-y rounded border text-xs">
                {parties.map((r) => (
                  <div key={r.entity_id} className="grid grid-cols-5 px-3 py-2 items-center">
                    <span className="font-semibold">{r.entity_abbrev}</span>
                    <span className="text-muted-foreground">{r.draft_count} drafts</span>
                    <span className="text-green-700">{r.approved_count} approved</span>
                    <span className={r.contradiction_count > 0 ? "text-amber-700" : "text-muted-foreground"}>
                      {r.contradiction_count > 0 ? `⚠ ${r.contradiction_count} contradiction` : "—"}
                    </span>
                    <span className={r.avg_confidence !== null && r.avg_confidence < 0.5 ? "text-amber-700" : "text-muted-foreground"}>
                      {r.avg_confidence !== null ? `${Math.round(r.avg_confidence * 100)}% conf` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Candidates ({candidates.length})
              </p>
              <div className="divide-y rounded border text-xs max-h-48 overflow-y-auto">
                {candidates.map((r) => (
                  <div key={r.entity_id} className="grid grid-cols-5 px-3 py-2 items-center">
                    <span className="font-medium truncate">{r.entity_name}</span>
                    <span className="text-muted-foreground">{r.entity_abbrev}</span>
                    <span className="text-muted-foreground">{r.draft_count} drafts</span>
                    <span className="text-green-700">{r.approved_count} approved</span>
                    <span className={r.contradiction_count > 0 ? "text-amber-700" : "text-muted-foreground"}>
                      {r.contradiction_count > 0 ? `⚠ ${r.contradiction_count}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
              {candidates.some((r) => r.draft_count === 0) && (
                <p className="text-xs text-amber-700">
                  ⚠ Some candidates have 0 draft questions — bulk approve blocked (EL-QA-P12).
                </p>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Edit Dialog ───────────────────────────────────────────────────────────────

function EditDraftDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [question, setQuestion] = React.useState(draft.question);
  const [context, setContext] = React.useState(draft.context_summary ?? "");
  const [reviewNotes, setReviewNotes] = React.useState(draft.review_notes ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const advocacyError = React.useMemo(() => checkAdvocacy(question) ?? checkAdvocacy(context), [question, context]);

  const handleSave = async () => {
    if (advocacyError) { setError(advocacyError); return; }
    setSaving(true);
    setError(null);
    try {
      const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
      const res = await fetch(`${baseUrl}/rest/v1/election_question_drafts?id=eq.${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${jwt}`, "Prefer": "return=minimal" },
        body: JSON.stringify({
          question: question.trim(),
          context_summary: context.trim() || null,
          review_notes: reviewNotes.trim() || null,
          version: (draft as any).version + 1,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      toast({ title: "Draft updated", description: "Version incremented (EL-QA-P16)" });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Edit Question Draft</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-start gap-2 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Editing creates a new version (EL-QA-P16). Paraphrase only — no verbatim quotes. Party attribution stored separately.
          </div>

          <div className="space-y-1.5">
            <Label>Question *</Label>
            <Textarea
              rows={3}
              value={question}
              onChange={(e) => { setQuestion(e.target.value); setError(null); }}
              className={advocacyError ? "border-red-400" : ""}
            />
            {checkAdvocacy(question) && (
              <p className="text-xs text-red-600">⚠ {checkAdvocacy(question)}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Context / Paraphrase</Label>
            <Textarea
              rows={3}
              value={context}
              onChange={(e) => { setContext(e.target.value); setError(null); }}
            />
            <p className="text-xs text-muted-foreground">Paraphrase of party/candidate's stated position. "Based on [party] manifesto…" — no verbatim quotes (Decision #4).</p>
          </div>

          <div className="space-y-1.5">
            <Label>Review Notes</Label>
            <Input value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Reason for edit…" />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !!advocacyError}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save Version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Draft Row ─────────────────────────────────────────────────────────────────

function DraftRow({
  draft,
  onAction,
}: {
  draft: Draft;
  onAction: (id: string, action: "APPROVED" | "REJECTED") => Promise<void>;
}) {
  const [acting, setActing] = React.useState(false);
  const [editing, setEditing] = React.useState(false);

  const act = async (action: "APPROVED" | "REJECTED") => {
    setActing(true);
    await onAction(draft.id, action);
    setActing(false);
  };

  return (
    <>
      <Card className="overflow-hidden">
        <div className="px-4 py-3 space-y-3">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              {/* Party / candidate attribution */}
              <div className="flex items-center gap-2 flex-wrap">
                {draft.party_colour && (
                  <span className="h-3 w-3 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: draft.party_colour }} />
                )}
                {draft.party_abbreviation && (
                  <Badge variant="outline" className="text-[10px]">{draft.party_abbreviation}</Badge>
                )}
                {draft.candidate_name && (
                  <Badge variant="outline" className="text-[10px]">{draft.candidate_name}</Badge>
                )}
                {draft.constituency_name && (
                  <span className="text-[10px] text-muted-foreground">{draft.constituency_name}</span>
                )}
                {draft.issue_tag && (
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                    {draft.issue_tag.replace(/_/g, " ")}
                  </span>
                )}
                {draft.framing_style && (
                  <span className="text-[10px] text-muted-foreground italic">
                    {draft.framing_style.replace(/_/g, " ")}
                  </span>
                )}
              </div>

              {/* Question text */}
              <p className="text-sm font-medium leading-snug">{draft.question}</p>

              {/* Context */}
              {draft.context_summary && (
                <p className="text-xs text-muted-foreground line-clamp-2">{draft.context_summary}</p>
              )}
            </div>

            {/* Status + confidence */}
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <StatusBadge status={draft.status} />
              <ConfidenceBadge score={draft.confidence_score} />
            </div>
          </div>

          {/* Warning flags */}
          {draft.potential_contradiction && (
            <div className="flex items-center gap-2 rounded bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              AI flagged a potential contradiction with another position from this party/candidate (EL-QA-P10).
            </div>
          )}
          {draft.confidence_score !== null && draft.confidence_score < 0.5 && (
            <div className="flex items-center gap-2 rounded bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Low confidence score ({Math.round(draft.confidence_score * 100)}%) — review carefully before approving (EL-QA-P11).
            </div>
          )}
          {checkAdvocacy(draft.question) && (
            <div className="flex items-center gap-2 rounded bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-800">
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              Express advocacy language detected — cannot approve (EL-QA-021).
            </div>
          )}

          {/* Actions */}
          {draft.status === "DRAFT" && (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                onClick={() => act("APPROVED")}
                disabled={acting || !!checkAdvocacy(draft.question)}
              >
                {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => act("REJECTED")}
                disabled={acting}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
            </div>
          )}
        </div>
      </Card>

      {editing && (
        <EditDraftDialog
          draft={draft}
          onClose={() => setEditing(false)}
          onSaved={() => {}}
        />
      )}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminElectionReviewPage() {
  const { toast } = useToast();

  const [elections, setElections] = React.useState<Election[]>([]);
  const [selectedElectionId, setSelectedElectionId] = React.useState("");
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [balance, setBalance] = React.useState<BalanceRow[]>([]);
  const [loadingDrafts, setLoadingDrafts] = React.useState(false);
  const [loadingBalance, setLoadingBalance] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = React.useState<"DRAFT" | "APPROVED" | "REJECTED" | "all">("DRAFT");
  const [typeFilter, setTypeFilter] = React.useState("all");
  const [searchText, setSearchText] = React.useState("");
  const [showContradictionsOnly, setShowContradictionsOnly] = React.useState(false);
  const [showLowConfOnly, setShowLowConfOnly] = React.useState(false);

  // Load elections
  React.useEffect(() => {
    (async () => {
      const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
      const res = await fetch(`${baseUrl}/rest/v1/elections?select=id,name,tier_code,state&order=created_at.desc`, {
        headers: { "apikey": anonKey, "Authorization": `Bearer ${jwt}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setElections(data ?? []);
      if (data?.length) setSelectedElectionId(data[0].id);
    })();
  }, []);

  // Fetch drafts
  const fetchDrafts = React.useCallback(async () => {
    if (!selectedElectionId) return;
    setLoadingDrafts(true);
    try {
      const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
      const headers = { "apikey": anonKey, "Authorization": `Bearer ${jwt}` };
      const statusParam = statusFilter !== "all" ? `&status=eq.${statusFilter}` : "";
      const res = await fetch(
        `${baseUrl}/rest/v1/election_question_drafts?select=*&election_id=eq.${selectedElectionId}&order=created_at.desc${statusParam}`,
        { headers }
      );
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      const raw: any[] = await res.json();

      // Enrich with party + candidate + constituency
      const partyIds  = [...new Set(raw.map((d) => d.party_id).filter(Boolean))];
      const candIds   = [...new Set(raw.map((d) => d.candidate_id).filter(Boolean))];
      const constIds  = [...new Set(raw.map((d) => d.constituency_id).filter(Boolean))];

      const [partyRes, candRes, constRes] = await Promise.all([
        partyIds.length  ? fetch(`${baseUrl}/rest/v1/election_parties?select=id,name,abbreviation,brand_colour&id=in.(${partyIds.join(",")})`, { headers }) : Promise.resolve(null),
        candIds.length   ? fetch(`${baseUrl}/rest/v1/election_candidates?select=id,full_name&id=in.(${candIds.join(",")})`, { headers }) : Promise.resolve(null),
        constIds.length  ? fetch(`${baseUrl}/rest/v1/election_constituencies?select=id,name&id=in.(${constIds.join(",")})`, { headers }) : Promise.resolve(null),
      ]);

      const pm  = new Map((partyRes?.ok  ? await partyRes.json()  : []).map((x: any) => [x.id, x]));
      const cm  = new Map((candRes?.ok   ? await candRes.json()   : []).map((x: any) => [x.id, x]));
      const com = new Map((constRes?.ok  ? await constRes.json()  : []).map((x: any) => [x.id, x]));

      setDrafts(raw.map((d: any) => ({
        ...d,
        party_name:         (pm.get(d.party_id) as any)?.name,
        party_abbreviation: (pm.get(d.party_id) as any)?.abbreviation,
        party_colour:       (pm.get(d.party_id) as any)?.brand_colour,
        candidate_name:     (cm.get(d.candidate_id) as any)?.full_name,
        constituency_name:  (com.get(d.constituency_id) as any)?.name,
      })));
    } catch (e: any) {
      toast({ title: "Failed to load drafts", description: e.message, variant: "destructive" });
    } finally { setLoadingDrafts(false); }
  }, [selectedElectionId, statusFilter, toast]);

  // Fetch balance
  const fetchBalance = React.useCallback(async () => {
    if (!selectedElectionId) return;
    setLoadingBalance(true);
    try {
      const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
      const res = await fetch(`${baseUrl}/rest/v1/rpc/get_question_draft_balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${jwt}` },
        body: JSON.stringify({ p_election_id: selectedElectionId }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      setBalance(await res.json());
    } catch (e: any) {
      toast({ title: "Failed to load balance", description: e.message, variant: "destructive" });
    } finally { setLoadingBalance(false); }
  }, [selectedElectionId, toast]);

  React.useEffect(() => {
    if (selectedElectionId) { fetchDrafts(); fetchBalance(); }
  }, [selectedElectionId, fetchDrafts, fetchBalance]);

  // Action: approve / reject single draft
  const handleAction = React.useCallback(async (draftId: string, action: "APPROVED" | "REJECTED") => {
    const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
    const res = await fetch(`${baseUrl}/rest/v1/election_question_drafts?id=eq.${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${jwt}`, "Prefer": "return=minimal" },
      body: JSON.stringify({ status: action }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast({ title: "Action failed", description: b?.message ?? `HTTP ${res.status}`, variant: "destructive" });
      return;
    }
    toast({ title: action === "APPROVED" ? "✓ Approved" : "✗ Rejected" });
    fetchDrafts();
    fetchBalance();
  }, [fetchDrafts, fetchBalance, toast]);

  // Action: bulk publish approved drafts
  const handleBulkPublish = async () => {
    const approvedIds = drafts.filter((d) => d.status === "APPROVED").map((d) => d.id);
    if (!approvedIds.length) {
      toast({ title: "No approved drafts to publish", variant: "destructive" });
      return;
    }

    // Balance check: any entity with 0 approved questions?
    const zeroApproved = balance.filter((r) => r.approved_count === 0);
    if (zeroApproved.length > 0) {
      toast({
        title: "Balance check failed (EL-QA-P12)",
        description: `${zeroApproved.length} parties/candidates have 0 approved questions. Approve at least 1 for each before bulk publishing.`,
        variant: "destructive",
      });
      return;
    }

    setPublishing(true);
    try {
      const { jwt, baseUrl } = getRpcFetchHeaders();
      const res = await fetch(`${baseUrl}/functions/v1/publish-election-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
        body: JSON.stringify({ election_id: selectedElectionId, draft_ids: approvedIds }),
      });

      if (res.status === 451) {
        toast({
          title: "HTTP 451 — Silence Period",
          description: "Election is in SILENCE state. Publishing blocked until silence lifts.",
          variant: "destructive",
        });
        return;
      }

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }

      const result = await res.json();
      toast({
        title: "Published",
        description: `${result.succeeded} questions published. ${result.failed} failed.`,
      });
      fetchDrafts();
      fetchBalance();
    } catch (e: any) {
      toast({ title: "Publish failed", description: e.message, variant: "destructive" });
    } finally { setPublishing(false); }
  };

  // Filtered drafts
  const filteredDrafts = React.useMemo(() => {
    let list = drafts;
    if (typeFilter !== "all") list = list.filter((d) => d.question_type === typeFilter);
    if (showContradictionsOnly) list = list.filter((d) => d.potential_contradiction);
    if (showLowConfOnly) list = list.filter((d) => d.confidence_score !== null && d.confidence_score < 0.5);
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      list = list.filter((d) =>
        d.question.toLowerCase().includes(q) ||
        (d.party_abbreviation ?? "").toLowerCase().includes(q) ||
        (d.issue_tag ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [drafts, typeFilter, showContradictionsOnly, showLowConfOnly, searchText]);

  const selectedElection = elections.find((e) => e.id === selectedElectionId);
  const isSilence = selectedElection?.state === "SILENCE";
  const approvedCount = drafts.filter((d) => d.status === "APPROVED").length;
  const draftCount = drafts.filter((d) => d.status === "DRAFT").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ListFilter className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Election Question Review</h1>
            <p className="text-xs text-muted-foreground">Epic EL-5 · Review, edit and publish AI-generated question drafts</p>
          </div>
        </div>
        <Select value={selectedElectionId} onValueChange={setSelectedElectionId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select election" /></SelectTrigger>
          <SelectContent>
            {elections.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedElectionId ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p className="text-sm">Select an election to begin reviewing drafts.</p>
        </Card>
      ) : (
        <>
          {/* Silence warning */}
          {isSilence && (
            <div className="flex items-center gap-2 rounded bg-red-50 border-2 border-red-300 px-4 py-3 text-sm text-red-800 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              HTTP 451 — Election is in SILENCE state. Publishing is blocked. You may review and approve drafts but they cannot be published until silence lifts.
            </div>
          )}

          {/* Balance Dashboard */}
          <BalanceDashboard rows={balance} loading={loadingBalance} />

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status tabs */}
            <div className="flex gap-1">
              {(["DRAFT","APPROVED","REJECTED","all"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "All" : s}
                  {s === "DRAFT" && draftCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-primary-foreground text-primary text-[9px] font-bold px-1.5">{draftCount}</span>
                  )}
                </Button>
              ))}
            </div>

            {/* Type filter */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All types</SelectItem>
                <SelectItem value="PARTY_POLICY" className="text-xs">Party Policy</SelectItem>
                <SelectItem value="CANDIDATE_STATEMENT" className="text-xs">Candidate Statement</SelectItem>
                <SelectItem value="MANUAL" className="text-xs">Manual</SelectItem>
              </SelectContent>
            </Select>

            {/* Flag filters */}
            <Button
              size="sm"
              variant={showContradictionsOnly ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setShowContradictionsOnly((v) => !v)}
            >
              ⚠ Contradictions
            </Button>
            <Button
              size="sm"
              variant={showLowConfOnly ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setShowLowConfOnly((v) => !v)}
            >
              ⚠ Low Confidence
            </Button>

            <Input
              placeholder="Search question text…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="h-8 w-48 text-sm"
            />

            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchDrafts} disabled={loadingDrafts}>
                {loadingDrafts ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
              <Button
                size="sm"
                onClick={handleBulkPublish}
                disabled={publishing || approvedCount === 0 || isSilence}
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Vote className="h-4 w-4 mr-1" />}
                Publish {approvedCount > 0 ? `(${approvedCount})` : ""}
              </Button>
            </div>
          </div>

          {/* Draft list */}
          {loadingDrafts ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading drafts…
            </div>
          ) : filteredDrafts.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              <ListFilter className="h-8 w-8 mx-auto opacity-30 mb-3" />
              <p className="text-sm">No drafts match the current filters.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredDrafts.map((d) => (
                <DraftRow key={d.id} draft={d} onAction={handleAction} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
