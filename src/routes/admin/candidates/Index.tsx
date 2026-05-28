// src/routes/admin/candidates/Index.tsx
//
// Admin: Candidates & Document Library (Epic EL — Phase EL-3)
//
// Two-tab layout:
//   Tab 1 — Candidates
//     - Election selector (dropdown)
//     - Candidate list with status badges, party colour, constituency
//     - Status lifecycle actions: CONFIRMED, WITHDRAWN, DISQUALIFIED
//     - WITHDRAWN: shows archiving note (EL-QA-P05)
//     - Party switch recording (EL-IN-008, EL-QA-G06)
//     - CSV bulk import dialog (EL-QA-P04)
//
//   Tab 2 — Document Library
//     - Two sub-tabs: Party Documents / Candidate Documents
//     - Per-document status chain: Ingestion → Translation → AI Processing
//     - Add document (URL or note-only; file upload is via Edge Function)
//     - SLA indicator: pipeline_seconds vs 300s limit (EL-NF-003)
//
// QA gates:
//   EL-QA-P04: CSV bulk import with party abbreviation matching
//   EL-QA-P05: WITHDRAWN candidate — archiving note shown
//   EL-QA-P07: Candidate speech scoped to single constituency
//   EL-QA-P08: Non-English document queued for translation
//   EL-QA-G06: Party switch recorded + old cards archiving note

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  RefreshCw, Loader2, Plus, Upload, Users,
  FileText, ChevronDown, ChevronRight, AlertTriangle,
  CheckCircle2, XCircle, Clock, Info, Play,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Election = {
  id: string;
  name: string;
  tier_code: string;
  state: string;
};

type Candidate = {
  id: string;
  election_id: string;
  constituency_id: string;
  party_id: string | null;
  full_name: string;
  full_name_local: string | null;
  status: string;
  status_changed_at: string;
  party_switched_at: string | null;
  previous_party_id: string | null;
  import_batch_id: string | null;
  created_at: string;
  // joined
  party_name?: string;
  party_abbreviation?: string;
  party_colour?: string;
  constituency_name?: string;
};

type SourceDocument = {
  id: string;
  document_type: string;
  party_name: string | null;
  party_abbreviation: string | null;
  candidate_name: string | null;
  constituency_name: string | null;
  detected_language: string | null;
  ingestion_status: string;
  translation_status: string;
  ai_processing_status: string;
  ai_question_drafts_count: number;
  total_pipeline_seconds: number | null;
  scope_region: string | null;
  created_at: string;
};

type Party = { id: string; name: string; abbreviation: string; brand_colour: string | null };
type Constituency = { id: string; name: string; constituency_code: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  DECLARED:      "bg-slate-100 text-slate-700 border-slate-300",
  CONFIRMED:     "bg-green-50 text-green-700 border-green-300",
  WITHDRAWN:     "bg-red-50 text-red-700 border-red-300",
  DISQUALIFIED:  "bg-red-100 text-red-800 border-red-400",
  ELECTED:       "bg-emerald-50 text-emerald-700 border-emerald-300",
  DEFEATED:      "bg-gray-100 text-gray-500 border-gray-300",
};

const PIPELINE_STATUS_ICON = {
  PENDING:      <Clock className="h-3.5 w-3.5 text-slate-400" />,
  IN_PROGRESS:  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
  DONE:         <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />,
  FAILED:       <XCircle className="h-3.5 w-3.5 text-red-500" />,
  NOT_NEEDED:   <CheckCircle2 className="h-3.5 w-3.5 text-slate-400" />,
  SKIPPED:      <CheckCircle2 className="h-3.5 w-3.5 text-slate-400" />,
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold border uppercase ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {status}
    </span>
  );
}

function PipelineStep({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {PIPELINE_STATUS_ICON[status as keyof typeof PIPELINE_STATUS_ICON] ?? <Clock className="h-3.5 w-3.5 text-slate-400" />}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// rpcFetch helper
function getRpcFetchHeaders() {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const projectRef = import.meta.env.VITE_SUPABASE_URL?.replace("https://","")?.split(".")[0] ?? "";
  let jwt = anonKey;
  try {
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (raw) { const p = JSON.parse(raw); if (p?.access_token) jwt = p.access_token; }
  } catch {}
  return { anonKey, jwt, baseUrl: import.meta.env.VITE_SUPABASE_URL as string };
}

// ─── CSV Import Dialog ────────────────────────────────────────────────────────

function CsvImportDialog({
  open,
  electionId,
  onClose,
  onImported,
}: {
  open: boolean;
  electionId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [csvText, setCsvText] = React.useState("");
  const [importing, setImporting] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);

  const handleImport = async () => {
    if (!csvText.trim()) return;
    setImporting(true);
    setResult(null);
    try {
      // Parse CSV: full_name, full_name_local, party_abbreviation, constituency_code, gender, affidavit_url
      const lines = csvText.trim().split("\n").filter(Boolean);
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        const obj: Record<string,string> = {};
        headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
        return obj;
      });

      const batchId = `csv_${Date.now()}`;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
      let jwt = anonKey;
      try { const r = localStorage.getItem(`sb-${projectRef}-auth-token`); if (r) { const p = JSON.parse(r); if (p?.access_token) jwt = p.access_token; } } catch {}
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/bulk_import_candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${jwt}` },
        body: JSON.stringify({ p_election_id: electionId, p_import_batch: batchId, p_candidates: rows }),
      });
      if (!rpcRes.ok) { const b = await rpcRes.json().catch(() => ({})); throw new Error(b?.message ?? `HTTP ${rpcRes.status}`); }
      const data = await rpcRes.json();

      setResult(data);
      toast({
        title: "Import complete",
        description: `${data.inserted} inserted, ${data.skipped} skipped`,
      });
      onImported();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally { setImporting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setResult(null); setCsvText(""); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Import Candidates (CSV)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800 space-y-1">
            <p className="font-semibold">Required CSV columns:</p>
            <p className="font-mono">full_name, party_abbreviation, constituency_code</p>
            <p>Optional: <span className="font-mono">full_name_local, gender, affidavit_url</span></p>
            <p>
              <strong>party_abbreviation</strong> must match exactly (e.g. BJP, SP, BSP).
              <strong> constituency_code</strong> must match ECI code (e.g. UP-001).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Paste CSV data</Label>
            <Textarea
              rows={10}
              placeholder={`full_name,party_abbreviation,constituency_code,gender\nYogi Adityanath,BJP,UP-001,M\nAkhilesh Yadav,SP,UP-073,M`}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          {result && (
            <div className="rounded border p-3 space-y-2 text-sm">
              <div className="flex gap-4">
                <span className="text-green-700 font-semibold">✓ {result.inserted} inserted</span>
                <span className="text-amber-700 font-semibold">⚠ {result.skipped} skipped</span>
              </div>
              {result.errors?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-red-700">Errors:</p>
                  {result.errors.map((e: any, i: number) => (
                    <p key={i} className="text-xs text-red-600 font-mono">
                      {e.error} — {JSON.stringify(e.row)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleImport} disabled={importing || !csvText.trim()}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Document Dialog ──────────────────────────────────────────────────────

const DOC_TYPES = [
  "manifesto","candidate_statement","party_policy_brief","leadership_speech",
  "candidate_speech","expenditure_disclosure","affidavit","voting_record",
  "legislative_record","interview","press_release",
];

function AddDocumentDialog({
  open,
  electionId,
  parties,
  candidates,
  onClose,
  onAdded,
}: {
  open: boolean;
  electionId: string;
  parties: Party[];
  candidates: Candidate[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [scope, setScope] = React.useState<"party" | "candidate">("party");
  const [partyId, setPartyId] = React.useState("");
  const [candidateId, setCandidateId] = React.useState("");
  const [docType, setDocType] = React.useState("manifesto");
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [originalLanguage, setOriginalLanguage] = React.useState("en");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    if (scope === "party" && !partyId) { toast({ title: "Select a party", variant: "destructive" }); return; }
    if (scope === "candidate" && !candidateId) { toast({ title: "Select a candidate", variant: "destructive" }); return; }
    if (!sourceUrl.trim() && !notes.trim()) { toast({ title: "Provide a source URL or notes", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
      const payload: Record<string,any> = {
        election_id: electionId,
        document_type: docType,
        source_url: sourceUrl.trim() || null,
        original_language: originalLanguage,
        notes: notes.trim() || null,
        ingestion_status: sourceUrl.trim() ? "PENDING" : "DONE",
        translation_status: originalLanguage === "en" ? "NOT_NEEDED" : "PENDING",
        ai_processing_status: "PENDING",
      };
      if (scope === "party") payload.party_id = partyId;
      else payload.candidate_id = candidateId;

      const res = await fetch(`${baseUrl}/rest/v1/election_source_documents`, {
        method: "POST",
        headers: { "Content-Type":"application/json","apikey":anonKey,"Authorization":`Bearer ${jwt}`,"Prefer":"return=minimal" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const b = await res.json().catch(()=>{}); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      toast({ title: "Document added", description: originalLanguage !== "en" ? "Queued for translation (EL-QA-P08)" : "Queued for AI processing" });
      onAdded();
      onClose();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Source Document</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {/* Scope */}
          <div className="flex gap-2">
            <Button size="sm" variant={scope === "party" ? "default" : "outline"} onClick={() => setScope("party")}>Party Document</Button>
            <Button size="sm" variant={scope === "candidate" ? "default" : "outline"} onClick={() => setScope("candidate")}>Candidate Document</Button>
          </div>

          {scope === "party" ? (
            <div className="space-y-1.5">
              <Label>Party *</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger><SelectValue placeholder="Select party" /></SelectTrigger>
                <SelectContent>
                  {parties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.abbreviation})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Candidate *</Label>
              <Select value={candidateId} onValueChange={setCandidateId}>
                <SelectTrigger><SelectValue placeholder="Select candidate" /></SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name} — {c.constituency_name ?? "?"} ({c.party_abbreviation ?? "IND"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {scope === "candidate" && (
                <p className="text-xs text-muted-foreground">
                  Candidate documents are scoped to their single constituency (EL-QA-P07).
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Document Type *</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g," ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Original Language</Label>
              <Select value={originalLanguage} onValueChange={setOriginalLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="hi">Hindi (हिन्दी)</SelectItem>
                  <SelectItem value="ur">Urdu (اردو)</SelectItem>
                  <SelectItem value="mr">Marathi</SelectItem>
                  <SelectItem value="ta">Tamil</SelectItem>
                  <SelectItem value="te">Telugu</SelectItem>
                  <SelectItem value="bn">Bengali</SelectItem>
                </SelectContent>
              </Select>
              {originalLanguage !== "en" && (
                <p className="text-[10px] text-amber-700">Will be queued for translation (EL-QA-P08)</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Source URL</Label>
            <Input placeholder="https://…" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground">PDF or webpage URL. Leave blank if uploading file separately.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} placeholder="Any context or notes about this document…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Add Document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Candidate Row ─────────────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  parties,
  onRefresh,
}: {
  candidate: Candidate;
  parties: Party[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [updating, setUpdating] = React.useState(false);
  const [showPartySwitch, setShowPartySwitch] = React.useState(false);
  const [newPartyId, setNewPartyId] = React.useState("");
  const [switchNotes, setSwitchNotes] = React.useState("");

  const setStatus = async (status: string) => {
    setUpdating(true);
    try {
      const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
      const res = await fetch(`${baseUrl}/rest/v1/election_candidates?id=eq.${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type":"application/json","apikey":anonKey,"Authorization":`Bearer ${jwt}`,"Prefer":"return=minimal" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const b = await res.json().catch(()=>{}); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      toast({
        title: `Status → ${status}`,
        description: status === "WITHDRAWN"
          ? "All draft questions for this candidate will be archived (EL-QA-P05)."
          : undefined,
      });
      onRefresh();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setUpdating(false); }
  };

  const recordPartySwitch = async () => {
    if (!newPartyId) return;
    setUpdating(true);
    try {
      const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
      const res = await fetch(`${baseUrl}/rest/v1/election_candidates?id=eq.${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type":"application/json","apikey":anonKey,"Authorization":`Bearer ${jwt}`,"Prefer":"return=minimal" },
        body: JSON.stringify({
          previous_party_id: candidate.party_id,
          party_id: newPartyId,
          party_switched_at: new Date().toISOString(),
          party_switch_notes: switchNotes.trim() || null,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(()=>{}); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      toast({
        title: "Party switch recorded",
        description: "Questions attributed to the old party affiliation will be archived (EL-QA-G06).",
      });
      setShowPartySwitch(false);
      onRefresh();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setUpdating(false); }
  };

  return (
    <div className="rounded border bg-card text-sm overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Party colour bar */}
        <span
          className="h-8 w-1 rounded-full shrink-0"
          style={{ backgroundColor: candidate.party_colour ?? "#e5e7eb" }}
        />

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{candidate.full_name}</span>
            {candidate.full_name_local && (
              <span className="text-xs text-muted-foreground">{candidate.full_name_local}</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <span>{candidate.party_abbreviation ?? "IND"}</span>
            <span>·</span>
            <span>{candidate.constituency_name ?? "—"}</span>
            {candidate.party_switched_at && (
              <span className="text-amber-600 font-medium">⚡ Party switched</span>
            )}
          </div>
        </div>

        {/* Status */}
        <StatusBadge status={candidate.status} />

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {candidate.status === "DECLARED" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus("CONFIRMED")} disabled={updating}>
              Confirm
            </Button>
          )}
          {["DECLARED","CONFIRMED"].includes(candidate.status) && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => setStatus("WITHDRAWN")} disabled={updating}>
              Withdraw
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPartySwitch((s) => !s)}>
            Switch Party
          </Button>
        </div>
      </div>

      {/* WITHDRAWN archiving notice */}
      {candidate.status === "WITHDRAWN" && (
        <div className="flex items-center gap-2 bg-red-50 border-t border-red-200 px-4 py-2 text-xs text-red-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Candidate withdrawn — all draft questions are archived and no new questions will be distributed (EL-QA-P05).
        </div>
      )}

      {/* Party switch panel */}
      {showPartySwitch && (
        <div className="border-t bg-amber-50 px-4 py-3 space-y-3">
          <div className="flex items-center gap-2 text-xs text-amber-800 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Recording a party switch will archive questions attributed to the old party affiliation (EL-QA-G06).
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={newPartyId} onValueChange={setNewPartyId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="New party" /></SelectTrigger>
              <SelectContent>
                {parties.filter((p) => p.id !== candidate.party_id && p.id !== "").map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">{p.name} ({p.abbreviation})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Reason / notes"
              value={switchNotes}
              onChange={(e) => setSwitchNotes(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={recordPartySwitch} disabled={updating || !newPartyId}>
              {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Record Switch
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPartySwitch(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Document Row ──────────────────────────────────────────────────────────────

function DocumentRow({ doc }: { doc: SourceDocument }) {
  const slaBreached = doc.total_pipeline_seconds !== null && doc.total_pipeline_seconds > 300;

  return (
    <div className="rounded border bg-card text-sm px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium capitalize">{doc.document_type.replace(/_/g," ")}</span>
            {doc.party_abbreviation && (
              <Badge variant="outline" className="text-[10px]">{doc.party_abbreviation}</Badge>
            )}
            {doc.candidate_name && (
              <Badge variant="outline" className="text-[10px]">{doc.candidate_name}</Badge>
            )}
            {doc.detected_language && doc.detected_language !== "en" && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                {doc.detected_language.toUpperCase()}
              </Badge>
            )}
          </div>
          {doc.constituency_name && (
            <p className="text-xs text-muted-foreground">Constituency: {doc.constituency_name}</p>
          )}
        </div>

        {/* SLA indicator */}
        {doc.total_pipeline_seconds !== null && (
          <span className={`text-[10px] font-mono shrink-0 ${slaBreached ? "text-red-600" : "text-green-600"}`}>
            {doc.total_pipeline_seconds}s {slaBreached ? "⚠ SLA" : "✓"}
          </span>
        )}
      </div>

      {/* Pipeline status chain */}
      <div className="flex items-center gap-4 flex-wrap">
        <PipelineStep label="Ingestion" status={doc.ingestion_status} />
        <PipelineStep label="Translation" status={doc.translation_status} />
        <PipelineStep label="AI Processing" status={doc.ai_processing_status} />
        {doc.ai_question_drafts_count > 0 && (
          <span className="text-xs text-green-700 font-medium">
            {doc.ai_question_drafts_count} drafts generated
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminCandidatesPage() {
  const { toast } = useToast();

  // State
  const [elections, setElections] = React.useState<Election[]>([]);
  const [selectedElectionId, setSelectedElectionId] = React.useState("");
  const [tab, setTab] = React.useState<"candidates" | "documents">("candidates");
  const [docSubTab, setDocSubTab] = React.useState<"party" | "candidate">("party");

  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [documents, setDocuments] = React.useState<SourceDocument[]>([]);
  const [parties, setParties] = React.useState<Party[]>([]);

  const [loadingCandidates, setLoadingCandidates] = React.useState(false);
  const [loadingDocs, setLoadingDocs] = React.useState(false);
  const [showCsvImport, setShowCsvImport] = React.useState(false);
  const [showAddDoc, setShowAddDoc] = React.useState(false);
  const [runningPipeline, setRunningPipeline] = React.useState(false);

  // Run full ingestion pipeline for selected election:
  // Step 1: ingest-election-document → Step 2: detect-and-translate → Step 3: generate-party-policy-questions
  const runPipeline = React.useCallback(async () => {
    if (!selectedElectionId) return;
    setRunningPipeline(true);
    const { jwt, baseUrl } = getRpcFetchHeaders();
    const steps = [
      { name: "Ingest documents",  fn: "ingest-election-document" },
      { name: "Translate",         fn: "detect-and-translate" },
      { name: "Generate questions",fn: "generate-party-policy-questions" },
    ];
    try {
      for (const step of steps) {
        toast({ title: `Pipeline: ${step.name}…` });
        const res = await fetch(`${baseUrl}/functions/v1/${step.fn}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
          body: JSON.stringify({ election_id: selectedElectionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `${step.name} failed: HTTP ${res.status}`);
        toast({ title: `✓ ${step.name}`, description: `${data.succeeded ?? data.processed ?? 0} processed` });
      }
      toast({ title: "Pipeline complete", description: "Check Question Review for new drafts." });
      fetchDocuments();
    } catch (e: any) {
      toast({ title: "Pipeline error", description: e.message, variant: "destructive" });
    } finally {
      setRunningPipeline(false);
    }
  }, [selectedElectionId, fetchDocuments, toast]);

  const [searchCandidate, setSearchCandidate] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");

  // Shared rpcFetch helper
  const getHeaders = React.useCallback(() => {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
    let jwt = anonKey;
    try { const r = localStorage.getItem(`sb-${projectRef}-auth-token`); if (r) { const p = JSON.parse(r); if (p?.access_token) jwt = p.access_token; } } catch {}
    return { headers: { "apikey": anonKey, "Authorization": `Bearer ${jwt}` }, supabaseUrl };
  }, []);

  // Load elections on mount
  React.useEffect(() => {
    (async () => {
      const { headers, supabaseUrl } = getHeaders();
      const res = await fetch(`${supabaseUrl}/rest/v1/elections?select=id,name,tier_code,state&order=created_at.desc`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      setElections(data ?? []);
      if (data?.length) setSelectedElectionId(data[0].id);
    })();
  }, [getHeaders]);

  // Load parties
  React.useEffect(() => {
    (async () => {
      const { headers, supabaseUrl } = getHeaders();
      const res = await fetch(`${supabaseUrl}/rest/v1/election_parties?select=id,name,abbreviation,brand_colour&country=eq.IN&party_type=eq.PARTY&order=name`, { headers });
      if (!res.ok) return;
      setParties(await res.json());
    })();
  }, [getHeaders]);

  // Load candidates
  const fetchCandidates = React.useCallback(async () => {
    if (!selectedElectionId) return;
    setLoadingCandidates(true);
    try {
      const { headers, supabaseUrl } = getHeaders();
      // Fetch candidates with party and constituency via separate requests (avoids embed join mutex issue)
      const res = await fetch(
        `${supabaseUrl}/rest/v1/election_candidates?select=*&election_id=eq.${selectedElectionId}&order=full_name`,
        { headers }
      );
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      const raw: any[] = await res.json();

      // Batch enrich with party + constituency data
      const partyIds = [...new Set(raw.map((c) => c.party_id).filter(Boolean))];
      const constIds = [...new Set(raw.map((c) => c.constituency_id).filter(Boolean))];

      const [partyRes, constRes] = await Promise.all([
        partyIds.length
          ? fetch(`${supabaseUrl}/rest/v1/election_parties?select=id,name,abbreviation,brand_colour&id=in.(${partyIds.join(",")})`, { headers })
          : Promise.resolve(null),
        constIds.length
          ? fetch(`${supabaseUrl}/rest/v1/election_constituencies?select=id,name&id=in.(${constIds.join(",")})`, { headers })
          : Promise.resolve(null),
      ]);

      const partiesMap = new Map((partyRes?.ok ? await partyRes.json() : []).map((p: any) => [p.id, p]));
      const constsMap = new Map((constRes?.ok ? await constRes.json() : []).map((c: any) => [c.id, c]));

      const enriched = raw.map((c: any) => ({
        ...c,
        party_name:         (partiesMap.get(c.party_id) as any)?.name,
        party_abbreviation: (partiesMap.get(c.party_id) as any)?.abbreviation,
        party_colour:       (partiesMap.get(c.party_id) as any)?.brand_colour,
        constituency_name:  (constsMap.get(c.constituency_id) as any)?.name,
      }));
      setCandidates(enriched);
    } catch (e: any) {
      toast({ title: "Failed to load candidates", description: e.message, variant: "destructive" });
    } finally { setLoadingCandidates(false); }
  }, [selectedElectionId, getHeaders, toast]);

  // Load documents
  const fetchDocuments = React.useCallback(async () => {
    if (!selectedElectionId) return;
    setLoadingDocs(true);
    try {
      const { headers, supabaseUrl } = getHeaders();
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_document_pipeline_status`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ p_election_id: selectedElectionId }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      setDocuments(await res.json());
    } catch (e: any) {
      toast({ title: "Failed to load documents", description: e.message, variant: "destructive" });
    } finally { setLoadingDocs(false); }
  }, [selectedElectionId, getHeaders, toast]);

  React.useEffect(() => {
    if (selectedElectionId) { fetchCandidates(); fetchDocuments(); }
  }, [selectedElectionId, fetchCandidates, fetchDocuments]);

  // Filtered candidates
  const filteredCandidates = React.useMemo(() => {
    let list = candidates;
    if (statusFilter !== "all") list = list.filter((c) => c.status === statusFilter);
    if (searchCandidate.trim()) {
      const q = searchCandidate.toLowerCase();
      list = list.filter((c) =>
        c.full_name.toLowerCase().includes(q) ||
        (c.party_abbreviation ?? "").toLowerCase().includes(q) ||
        (c.constituency_name ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [candidates, statusFilter, searchCandidate]);

  // Filtered documents
  const filteredDocs = React.useMemo(() => {
    if (docSubTab === "party") return documents.filter((d) => d.party_abbreviation);
    return documents.filter((d) => d.candidate_name);
  }, [documents, docSubTab]);

  const STATUS_FILTERS = ["all","DECLARED","CONFIRMED","WITHDRAWN","DISQUALIFIED","ELECTED","DEFEATED"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Candidates & Document Library</h1>
            <p className="text-xs text-muted-foreground">Epic EL-3 · Manage candidates and source documents per election</p>
          </div>
        </div>

        {/* Election selector */}
        <Select value={selectedElectionId} onValueChange={setSelectedElectionId}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select election" />
          </SelectTrigger>
          <SelectContent>
            {elections.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedElectionId ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p className="text-sm">Select an election to manage candidates and documents.</p>
        </Card>
      ) : (
        <>
          {/* Main tabs */}
          <div className="flex gap-2 border-b pb-0">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "candidates" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab("candidates")}
            >
              Candidates ({candidates.length})
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "documents" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab("documents")}
            >
              Documents ({documents.length})
            </button>
          </div>

          {/* ── Candidates Tab ── */}
          {tab === "candidates" && (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  placeholder="Search name, party, constituency…"
                  value={searchCandidate}
                  onChange={(e) => setSearchCandidate(e.target.value)}
                  className="h-8 w-56 text-sm"
                />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs">{s === "all" ? "All statuses" : s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchCandidates} disabled={loadingCandidates}>
                    {loadingCandidates ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowCsvImport(true)}>
                    <Upload className="h-3.5 w-3.5 mr-1" /> CSV Import
                  </Button>
                </div>
              </div>

              {loadingCandidates ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading candidates…
                </div>
              ) : filteredCandidates.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground space-y-3">
                  <Users className="h-8 w-8 mx-auto opacity-30" />
                  <p className="text-sm">No candidates found. Use CSV Import to bulk-add candidates.</p>
                  <Button size="sm" variant="outline" onClick={() => setShowCsvImport(true)}>
                    <Upload className="h-4 w-4 mr-1" /> CSV Import
                  </Button>
                </Card>
              ) : (
                <div className="space-y-2">
                  {filteredCandidates.map((c) => (
                    <CandidateRow key={c.id} candidate={c} parties={parties} onRefresh={fetchCandidates} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Documents Tab ── */}
          {tab === "documents" && (
            <div className="space-y-4">
              {/* Sub-tabs */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-2">
                  <Button size="sm" variant={docSubTab === "party" ? "default" : "outline"} onClick={() => setDocSubTab("party")}>
                    Party Documents ({documents.filter((d) => d.party_abbreviation).length})
                  </Button>
                  <Button size="sm" variant={docSubTab === "candidate" ? "default" : "outline"} onClick={() => setDocSubTab("candidate")}>
                    Candidate Documents ({documents.filter((d) => d.candidate_name).length})
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchDocuments} disabled={loadingDocs}>
                    {loadingDocs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={runPipeline}
                    disabled={runningPipeline}
                    title="Ingest → Translate → Generate questions"
                  >
                    {runningPipeline
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      : <Play className="h-3.5 w-3.5 mr-1" />
                    }
                    Run Pipeline
                  </Button>
                  <Button size="sm" onClick={() => setShowAddDoc(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Document
                  </Button>
                </div>
              </div>

              {/* SLA note */}
              <div className="flex items-center gap-2 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
                <Info className="h-3.5 w-3.5 shrink-0" />
                EL-NF-003: AI pipeline SLA is 300 seconds (5 min) for a 100-page document. Red indicator = SLA breached.
              </div>

              {loadingDocs ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading documents…
                </div>
              ) : filteredDocs.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground space-y-3">
                  <FileText className="h-8 w-8 mx-auto opacity-30" />
                  <p className="text-sm">No {docSubTab} documents yet.</p>
                  <Button size="sm" variant="outline" onClick={() => setShowAddDoc(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Add Document
                  </Button>
                </Card>
              ) : (
                <div className="space-y-2">
                  {filteredDocs.map((d) => (
                    <DocumentRow key={d.id} doc={d} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      {showCsvImport && selectedElectionId && (
        <CsvImportDialog
          open={showCsvImport}
          electionId={selectedElectionId}
          onClose={() => setShowCsvImport(false)}
          onImported={fetchCandidates}
        />
      )}

      {showAddDoc && selectedElectionId && (
        <AddDocumentDialog
          open={showAddDoc}
          electionId={selectedElectionId}
          parties={parties}
          candidates={candidates}
          onClose={() => setShowAddDoc(false)}
          onAdded={fetchDocuments}
        />
      )}
    </div>
  );
}
