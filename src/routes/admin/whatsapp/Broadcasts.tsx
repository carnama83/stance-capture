// src/routes/admin/whatsapp/Broadcasts.tsx
// Epic AA — AA3.1 / AA6.1
//
// Admin: WhatsApp Broadcast list + new broadcast creation.
// /admin/whatsapp/broadcasts
//
// Shows: all broadcasts with status, delivery rate, completion rate, stances.
// Allows: create new broadcast (modal), pause/cancel in-progress.

import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  Plus, RefreshCw, Loader2, Send, Clock, CheckCircle2,
  XCircle, Pause, AlertTriangle, BarChart3, MessageSquareDot,
} from "lucide-react";

const PROJECT_REF = "yzxzpnomcarnxixhjlba";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

function getJwt(): string {
  try {
    const raw = localStorage.getItem(`sb-${PROJECT_REF}-auth-token`);
    return raw ? JSON.parse(raw)?.access_token ?? "" : "";
  } catch { return ""; }
}

type BroadcastStatus = "draft" | "scheduled" | "sending" | "completed" | "partially_failed" | "cancelled";

type Broadcast = {
  id: string;
  name: string;
  status: BroadcastStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  total_contacts: number;
  total_sent: number;
  total_delivered: number;
  total_failed: number;
  total_opened: number;
  total_completed: number;
  total_stances: number;
  created_at: string;
  question_id: string;
};

type Question = { id: string; question: string };
type ContactList = { id: string; name: string; valid_count: number };

const STATUS_STYLES: Record<BroadcastStatus, string> = {
  draft:            "bg-slate-100 text-slate-700",
  scheduled:        "bg-blue-50 text-blue-700",
  sending:          "bg-amber-50 text-amber-700",
  completed:        "bg-emerald-50 text-emerald-700",
  partially_failed: "bg-orange-50 text-orange-700",
  cancelled:        "bg-slate-100 text-slate-500",
};

const STATUS_ICONS: Record<BroadcastStatus, React.ReactNode> = {
  draft:            <Clock className="h-3 w-3" />,
  scheduled:        <Clock className="h-3 w-3" />,
  sending:          <Loader2 className="h-3 w-3 animate-spin" />,
  completed:        <CheckCircle2 className="h-3 w-3" />,
  partially_failed: <AlertTriangle className="h-3 w-3" />,
  cancelled:        <XCircle className="h-3 w-3" />,
};

function pct(n: number, d: number) {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ── New Broadcast Modal ───────────────────────────────────────────────────────

interface NewBroadcastModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewBroadcastModal({ onClose, onCreated }: NewBroadcastModalProps) {
  const { toast } = useToast();
  const [name, setName]                   = React.useState("");
  const [questionId, setQuestionId]       = React.useState("");
  const [contactListId, setContactListId] = React.useState("");
  const [csvFile, setCsvFile]             = React.useState<File | null>(null);
  const [scheduleNow, setScheduleNow]     = React.useState(true);
  const [scheduleAt, setScheduleAt]       = React.useState("");
  const [busy, setBusy]                   = React.useState(false);
  const [csvError, setCsvError]           = React.useState("");
  const [csvPreview, setCsvPreview]       = React.useState<{ valid: number; invalid: number; rows: string[] } | null>(null);

  const [questions, setQuestions]     = React.useState<Question[]>([]);
  const [contactLists, setContactLists] = React.useState<ContactList[]>([]);

  React.useEffect(() => {
    const jwt = getJwt();
    const headers = {
      "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
      "Authorization": `Bearer ${jwt}`,
    };
    // Load live questions
    fetch(`${SUPABASE_URL}/rest/v1/questions?select=id,question&status=eq.active&order=created_at.desc&limit=50`, { headers })
      .then((r) => r.json()).then(setQuestions).catch(() => {});
    // Load contact lists
    fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contact_lists?select=id,name,valid_count&order=created_at.desc`, { headers })
      .then((r) => r.json()).then(setContactLists).catch(() => {});
  }, []);

  function validateE164(num: string) {
    return /^\+[1-9]\d{6,14}$/.test(num.trim());
  }

  function handleCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCsvError("");
    setCsvPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setCsvError("File must be a .csv");
      return;
    }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string ?? "";
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const valid: string[] = [];
      const invalid: string[] = [];
      for (const line of lines) {
        // Support CSV with optional header row
        const num = line.split(",")[0].trim();
        if (num.toLowerCase() === "phone" || num.toLowerCase() === "phone_number") continue;
        if (validateE164(num)) valid.push(num);
        else invalid.push(num);
      }
      if (valid.length === 0) {
        setCsvError(`No valid E.164 numbers found. ${invalid.length} invalid rows detected.`);
        return;
      }
      if (valid.length > 10000) {
        setCsvError("Maximum 10,000 numbers per broadcast.");
        return;
      }
      setCsvPreview({ valid: valid.length, invalid: invalid.length, rows: valid });
    };
    reader.readAsText(file);
  }

  async function handleCreate() {
    if (!name.trim()) { toast({ title: "Broadcast name is required", variant: "destructive" }); return; }
    if (!questionId) { toast({ title: "Select a question", variant: "destructive" }); return; }
    if (!contactListId && !csvPreview) {
      toast({ title: "Select a contact list or upload a CSV", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const jwt = getJwt();
      const headers = {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
        "Authorization": `Bearer ${jwt}`,
        "Prefer": "return=representation",
      };

      let listId = contactListId;

      // If CSV upload — create a new contact list first
      if (csvPreview && !contactListId) {
        const listRes = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contact_lists`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: `${name} — ${new Date().toLocaleDateString()}`,
            row_count: csvPreview.valid + csvPreview.invalid,
            valid_count: csvPreview.valid,
          }),
        });
        const listRows = await listRes.json();
        listId = listRows[0]?.id;

        if (!listId) throw new Error("Failed to create contact list");

        // Insert phone numbers in batches of 500
        const batches: string[][] = [];
        for (let i = 0; i < csvPreview.rows.length; i += 500) {
          batches.push(csvPreview.rows.slice(i, i + 500));
        }
        for (const batch of batches) {
          const rows = batch.map((num) => ({
            contact_list_id: listId,
            phone_number: num,
            phone_hash: `pending_${Math.random().toString(36).slice(2)}`, // hashed by Edge Function on dispatch
          }));
          await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contact_list_numbers`, {
            method: "POST",
            headers,
            body: JSON.stringify(rows),
          });
        }
      }

      // Create broadcast
      const broadcastRes = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_broadcasts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: name.trim(),
          question_id: questionId,
          contact_list_id: listId || null,
          status: scheduleNow ? "scheduled" : "draft",
          scheduled_at: scheduleNow
            ? new Date().toISOString()
            : (scheduleAt ? new Date(scheduleAt).toISOString() : null),
          total_contacts: csvPreview?.valid ?? 0,
        }),
      });
      const broadcastRows = await broadcastRes.json();
      if (!broadcastRows[0]?.id) throw new Error("Failed to create broadcast");

      toast({ title: scheduleNow ? "Broadcast queued for sending." : "Broadcast scheduled." });
      onCreated();
      onClose();
    } catch (e: any) {
      toast({ title: `Failed: ${e.message}`, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b">
          <h2 className="text-base font-semibold">New Broadcast</h2>
          <p className="text-xs text-slate-500 mt-0.5">Send a question to a WhatsApp contact list.</p>
        </div>
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium mb-1">Broadcast name <span className="text-rose-500">*</span></label>
            <input
              className="w-full rounded border px-3 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. UP Constituency — May 2027"
            />
          </div>

          {/* Question */}
          <div>
            <label className="block text-xs font-medium mb-1">Question <span className="text-rose-500">*</span></label>
            <select
              className="w-full rounded border px-3 py-1.5 text-sm"
              value={questionId}
              onChange={(e) => setQuestionId(e.target.value)}
            >
              <option value="">Select a live question</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.question.slice(0, 80)}{q.question.length > 80 ? "…" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Contact list or CSV */}
          <div>
            <label className="block text-xs font-medium mb-1">Contact list</label>
            <select
              className="w-full rounded border px-3 py-1.5 text-sm mb-2"
              value={contactListId}
              onChange={(e) => { setContactListId(e.target.value); setCsvPreview(null); setCsvFile(null); }}
            >
              <option value="">— Use existing list —</option>
              {contactLists.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.valid_count.toLocaleString()} numbers)</option>
              ))}
            </select>
            {!contactListId && (
              <>
                <label className="block text-xs text-slate-500 mb-1">Or upload a new CSV (E.164 numbers, max 10,000)</label>
                <input type="file" accept=".csv" onChange={handleCsvChange} className="text-xs" />
                {csvError && <p className="text-xs text-rose-600 mt-1">{csvError}</p>}
                {csvPreview && (
                  <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    ✓ {csvPreview.valid.toLocaleString()} valid numbers
                    {csvPreview.invalid > 0 && ` · ${csvPreview.invalid} invalid rows will be skipped`}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs font-medium mb-2">Schedule</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={scheduleNow} onChange={() => setScheduleNow(true)} />
                <span className="text-sm">Send now</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={!scheduleNow} onChange={() => setScheduleNow(false)} />
                <span className="text-sm">Schedule for later</span>
              </label>
              {!scheduleNow && (
                <input
                  type="datetime-local"
                  className="w-full rounded border px-3 py-1.5 text-sm"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
              )}
            </div>
          </div>

          {/* Question preview */}
          {questionId && questions.find((q) => q.id === questionId) && (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-500 mb-1 font-medium uppercase tracking-wide">Question preview</p>
              <p className="text-sm">{questions.find((q) => q.id === questionId)!.question}</p>
            </div>
          )}
        </div>

        <div className="p-5 border-t flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-4 py-1.5 text-sm hover:bg-slate-50"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="flex items-center gap-1.5 rounded bg-slate-900 text-white px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {scheduleNow ? "Create & send" : "Create broadcast"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminWhatsAppBroadcastsPage() {
  const { toast } = useToast();
  const [broadcasts, setBroadcasts] = React.useState<Broadcast[]>([]);
  const [loading, setLoading]       = React.useState(true);
  const [showNew, setShowNew]       = React.useState(false);

  async function loadBroadcasts() {
    setLoading(true);
    try {
      const jwt = getJwt();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_broadcasts?select=*&order=created_at.desc&limit=50`,
        {
          headers: {
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
            "Authorization": `Bearer ${jwt}`,
          },
        }
      );
      const rows = await res.json();
      setBroadcasts(Array.isArray(rows) ? rows : []);
    } catch {
      toast({ title: "Failed to load broadcasts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadBroadcasts(); }, []);

  async function handlePause(id: string) {
    const jwt = getJwt();
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_broadcasts?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify({ status: "scheduled", scheduled_at: new Date(Date.now() + 3_600_000).toISOString() }),
    });
    toast({ title: "Broadcast paused (will resume in 1 hour)." });
    loadBroadcasts();
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancel this broadcast? Unsent messages will not be delivered.")) return;
    const jwt = getJwt();
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_broadcasts?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify({ status: "cancelled" }),
    });
    toast({ title: "Broadcast cancelled." });
    loadBroadcasts();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">WhatsApp Broadcasts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Send stance questions to WhatsApp contact lists.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadBroadcasts}
            className="p-2 rounded border hover:bg-slate-50"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 rounded bg-slate-900 text-white px-3 py-1.5 text-sm"
          >
            <Plus className="h-4 w-4" />
            New broadcast
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading broadcasts…</span>
        </div>
      )}

      {!loading && broadcasts.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-400">
          <MessageSquareDot className="h-8 w-8 opacity-30" />
          <p className="text-sm">No broadcasts yet. Create your first one above.</p>
        </div>
      )}

      {!loading && broadcasts.length > 0 && (
        <div className="space-y-2">
          {broadcasts.map((b) => (
            <Card key={b.id} className="hover:border-slate-300 transition-colors">
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{b.name}</span>
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[b.status]}`}>
                        {STATUS_ICONS[b.status]}
                        {b.status.replace("_", " ").toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Created {fmtDate(b.created_at)}
                      {b.scheduled_at && b.status === "scheduled" && ` · Sends ${fmtDate(b.scheduled_at)}`}
                      {b.completed_at && ` · Completed ${fmtDate(b.completed_at)}`}
                    </p>
                  </div>

                  {/* Metrics */}
                  <div className="flex items-center gap-4 text-center shrink-0">
                    <div>
                      <p className="text-xs text-slate-400">Sent</p>
                      <p className="text-sm font-semibold">{b.total_sent.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Delivered</p>
                      <p className="text-sm font-semibold">{pct(b.total_delivered, b.total_sent)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Completed</p>
                      <p className="text-sm font-semibold">{pct(b.total_completed, b.total_sent)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Stances</p>
                      <p className="text-sm font-semibold">{b.total_stances.toLocaleString()}</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Link
                      to={`/admin/whatsapp/broadcasts/${b.id}`}
                      className="rounded border px-2 py-1 text-xs hover:bg-slate-50 flex items-center gap-1"
                    >
                      <BarChart3 className="h-3 w-3" />
                      Details
                    </Link>
                    {b.status === "sending" && (
                      <button
                        type="button"
                        onClick={() => handlePause(b.id)}
                        className="rounded border px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
                      >
                        <Pause className="h-3 w-3" />
                      </button>
                    )}
                    {(b.status === "sending" || b.status === "scheduled") && (
                      <button
                        type="button"
                        onClick={() => handleCancel(b.id)}
                        className="rounded border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showNew && (
        <NewBroadcastModal
          onClose={() => setShowNew(false)}
          onCreated={loadBroadcasts}
        />
      )}
    </div>
  );
}
