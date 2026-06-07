// src/routes/admin/whatsapp/Contacts.tsx
// Epic AA — AA3.2
//
// Admin: WhatsApp contact list management.
// /admin/whatsapp/contacts

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, getJwt } from "@/lib/env";
import {
  Plus, Trash2, RefreshCw, Loader2, Users, Upload, CheckCircle2,
} from "lucide-react";



type ContactList = {
  id: string;
  name: string;
  row_count: number;
  valid_count: number;
  created_at: string;
  last_used_at: string | null;
};

interface UploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
}

function UploadModal({ onClose, onUploaded }: UploadModalProps) {
  const { toast } = useToast();
  const [name, setName]         = React.useState("");
  const [csvFile, setCsvFile]   = React.useState<File | null>(null);
  const [preview, setPreview]   = React.useState<{ valid: number; invalid: number; rows: string[] } | null>(null);
  const [csvError, setCsvError] = React.useState("");
  const [busy, setBusy]         = React.useState(false);

  function validateE164(num: string) {
    return /^\+[1-9]\d{6,14}$/.test(num.trim());
  }

  function handleCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCsvError(""); setPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) { setCsvError("File must be .csv"); return; }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string ?? "";
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const valid: string[] = [], invalid: string[] = [];
      for (const line of lines) {
        const num = line.split(",")[0].trim();
        if (/^(phone|phone_number)$/i.test(num)) continue;
        if (validateE164(num)) valid.push(num);
        else invalid.push(num);
      }
      if (valid.length === 0) { setCsvError(`No valid E.164 numbers found. ${invalid.length} invalid rows.`); return; }
      if (valid.length > 10000) { setCsvError("Maximum 10,000 numbers per list."); return; }
      setPreview({ valid: valid.length, invalid: invalid.length, rows: valid });
    };
    reader.readAsText(file);
  }

  async function handleUpload() {
    if (!name.trim()) { toast({ title: "List name required", variant: "destructive" }); return; }
    if (!preview) { toast({ title: "Upload a valid CSV first", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const jwt = getJwt();
      const headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY ?? "",
        "Authorization": `Bearer ${jwt}`,
        "Prefer": "return=representation",
      };

      const listRes = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contact_lists`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: name.trim(),
          row_count: preview.valid + preview.invalid,
          valid_count: preview.valid,
        }),
      });
      const listRows = await listRes.json();
      const listId = listRows[0]?.id;
      if (!listId) throw new Error("Failed to create contact list");

      // Insert numbers in batches
      for (let i = 0; i < preview.rows.length; i += 500) {
        const batch = preview.rows.slice(i, i + 500);
        const rows = batch.map((num) => ({
          contact_list_id: listId,
          phone_number: num,
          phone_hash: `pending_${Math.random().toString(36).slice(2)}`,
        }));
        await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contact_list_numbers`, {
          method: "POST",
          headers,
          body: JSON.stringify(rows),
        });
      }

      toast({ title: `Contact list "${name}" created with ${preview.valid.toLocaleString()} numbers.` });
      onUploaded();
      onClose();
    } catch (e: any) {
      toast({ title: `Upload failed: ${e.message}`, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b">
          <h2 className="text-base font-semibold">Upload Contact List</h2>
          <p className="text-xs text-slate-500 mt-0.5">CSV with one E.164 phone number per row (max 10,000).</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">List name <span className="text-rose-500">*</span></label>
            <input
              className="w-full rounded border px-3 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. UP Constituency Varanasi North"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">CSV file</label>
            <input type="file" accept=".csv" onChange={handleCsvChange} className="text-xs w-full" />
            <p className="text-[11px] text-slate-400 mt-0.5">One number per row in +CountryCode format, e.g. +919876543210</p>
            {csvError && <p className="text-xs text-rose-600 mt-1">{csvError}</p>}
            {preview && (
              <div className="mt-2 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                {preview.valid.toLocaleString()} valid numbers
                {preview.invalid > 0 && ` · ${preview.invalid} invalid rows skipped`}
              </div>
            )}
          </div>
        </div>
        <div className="p-5 border-t flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="rounded border px-4 py-1.5 text-sm hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={busy || !preview}
            className="flex items-center gap-1.5 rounded bg-slate-900 text-white px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminWhatsAppContactsPage() {
  const { toast } = useToast();
  const [lists, setLists]       = React.useState<ContactList[]>([]);
  const [loading, setLoading]   = React.useState(true);
  const [showUpload, setShowUpload] = React.useState(false);

  async function loadLists() {
    setLoading(true);
    try {
      const jwt = getJwt();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_contact_lists?select=*&order=created_at.desc`,
        {
          headers: {
            "apikey": SUPABASE_ANON_KEY ?? "",
            "Authorization": `Bearer ${jwt}`,
          },
        }
      );
      const rows = await res.json();
      setLists(Array.isArray(rows) ? rows : []);
    } catch {
      toast({ title: "Failed to load contact lists", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadLists(); }, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone. Historical broadcast records are preserved.`)) return;
    const jwt = getJwt();
    // Delete numbers first (FK)
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contact_list_numbers?contact_list_id=eq.${id}`, {
      method: "DELETE",
      headers: {
        "apikey": SUPABASE_ANON_KEY ?? "",
        "Authorization": `Bearer ${jwt}`,
      },
    });
    await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_contact_lists?id=eq.${id}`, {
      method: "DELETE",
      headers: {
        "apikey": SUPABASE_ANON_KEY ?? "",
        "Authorization": `Bearer ${jwt}`,
      },
    });
    toast({ title: `"${name}" deleted.` });
    loadLists();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Contact Lists</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Reusable phone number lists for WhatsApp broadcasts.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={loadLists} className="p-2 rounded border hover:bg-slate-50" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 rounded bg-slate-900 text-white px-3 py-1.5 text-sm"
          >
            <Plus className="h-4 w-4" />
            Upload list
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-8 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading lists…</span>
        </div>
      )}

      {!loading && lists.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-400">
          <Users className="h-8 w-8 opacity-30" />
          <p className="text-sm">No contact lists yet. Upload a CSV to get started.</p>
        </div>
      )}

      {!loading && lists.length > 0 && (
        <div className="space-y-2">
          {lists.map((list) => (
            <Card key={list.id} className="hover:border-slate-300 transition-colors">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{list.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {list.valid_count.toLocaleString()} valid numbers
                      {list.row_count !== list.valid_count && ` (${list.row_count - list.valid_count} invalid)`}
                      {" · "}Created {new Date(list.created_at).toLocaleDateString()}
                      {list.last_used_at && ` · Last used ${new Date(list.last_used_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(list.id, list.name)}
                    className="p-1.5 rounded border text-slate-400 hover:border-rose-300 hover:text-rose-600 transition-colors"
                    title="Delete list"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
        <p className="text-xs text-amber-700">
          <strong>Note:</strong> Phone numbers opted out via STOP reply are automatically excluded from all broadcasts,
          regardless of which contact list they appear in.
        </p>
      </div>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onUploaded={loadLists} />
      )}
    </div>
  );
}
