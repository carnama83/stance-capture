// src/routes/admin/manifesto-promises/Index.tsx
//
// Admin: Manifesto Performance (Epic MP — Phase 1)
//
// Data access uses raw PostgREST fetch (not supabase-js) with a token read
// directly via getJwt() and an AbortController timeout. This mirrors the proven
// pattern in admin/sources: the supabase-js client's internal getSession() can
// stall after navigating away and back, leaving writes hung forever. Raw fetch
// bypasses that request layer entirely.

import * as React from "react";
import { SUPABASE_URL, SUPABASE_ANON_KEY, getJwt } from "@/lib/env";
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
import { RefreshCw, Loader2, Plus, FileText, CheckCircle2, ExternalLink, Trash2, Sparkles } from "lucide-react";

// ─── Raw PostgREST helper (bypasses the stalling supabase-js request layer) ────

async function pgrest<T = any>(
  pathAndQuery: string,
  init: { method?: string; body?: unknown; prefer?: string; timeoutMs?: number } = {}
): Promise<T> {
  const { method = "GET", body, prefer, timeoutMs = 12000 } = init;
  const token = getJwt(); // reads localStorage directly — no getSession() stall
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery.replace(/^\/+/, "")}`, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Timed out — please try again.");
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

type Jurisdiction = "up_state" | "central";
type SourceType = "manual_upload" | "party_site" | "archive" | "eci";
type PromiseStatus = "draft" | "curated" | "published" | "archived" | "rejected";

interface Party { id: string; name: string; abbreviation: string }
interface Topic { id: string; title: string }
interface Manifesto {
  id: string;
  party_id: string;
  jurisdiction: Jurisdiction;
  election_year: number | null;
  source_type: SourceType;
  ingestion_status: string;
}
interface PromiseRow {
  id: string;
  manifesto_id: string;
  category: string | null;
  promise_text: string;
  verbatim_quote: string | null;
  citation: string | null;
  topic_id: string | null;
  status: PromiseStatus;
  question_id: string | null;
}

const JURISDICTIONS: { value: Jurisdiction; label: string }[] = [
  { value: "up_state", label: "Uttar Pradesh (State)" },
  { value: "central", label: "Central Government" },
];
const SOURCE_TYPES: { value: SourceType; label: string }[] = [
  { value: "manual_upload", label: "Manual upload" },
  { value: "party_site", label: "Party website" },
  { value: "archive", label: "Archive" },
  { value: "eci", label: "ECI (where hosted)" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminManifestoPromisesPage() {
  const { toast } = useToast();
  const mountedRef = React.useRef(true);
  const [parties, setParties] = React.useState<Party[]>([]);
  const [topics, setTopics] = React.useState<Topic[]>([]);
  const [manifestos, setManifestos] = React.useState<Manifesto[]>([]);
  const [promises, setPromises] = React.useState<PromiseRow[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [showManifesto, setShowManifesto] = React.useState(false);
  const [showPromise, setShowPromise] = React.useState(false);
  const [publishingId, setPublishingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const partyLabel = React.useCallback(
    (id: string) => {
      const p = parties.find((x) => x.id === id);
      return p ? `${p.name} (${p.abbreviation})` : id;
    },
    [parties]
  );

  const loadRefData = React.useCallback(async () => {
    try {
      const [pData, tData] = await Promise.all([
        pgrest<Party[]>("election_parties?select=id,name,abbreviation&order=name"),
        pgrest<Topic[]>("topics?select=id,title&order=title"),
      ]);
      if (!mountedRef.current) return;
      setParties(pData ?? []);
      setTopics(tData ?? []);
    } catch (e) {
      toast({ title: "Failed to load parties/topics", description: (e as Error).message, variant: "destructive" });
    }
  }, [toast]);

  const loadManifestos = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await pgrest<Manifesto[]>(
        "manifestos?select=id,party_id,jurisdiction,election_year,source_type,ingestion_status&order=created_at.desc"
      );
      if (mountedRef.current) setManifestos(data ?? []);
    } catch (e) {
      toast({ title: "Failed to load manifestos", description: (e as Error).message, variant: "destructive" });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [toast]);

  const loadPromises = React.useCallback(
    async (manifestoId: string) => {
      try {
        const data = await pgrest<PromiseRow[]>(
          `manifesto_promises?select=id,manifesto_id,category,promise_text,verbatim_quote,citation,topic_id,status,question_id&manifesto_id=eq.${manifestoId}&order=created_at.asc`
        );
        if (mountedRef.current) setPromises(data ?? []);
      } catch (e) {
        toast({ title: "Failed to load promises", description: (e as Error).message, variant: "destructive" });
      }
    },
    [toast]
  );

  React.useEffect(() => {
    loadRefData();
    loadManifestos();
  }, [loadRefData, loadManifestos]);

  React.useEffect(() => {
    if (selectedId) loadPromises(selectedId);
    else setPromises([]);
  }, [selectedId, loadPromises]);

  const publish = async (id: string) => {
    setPublishingId(id);
    try {
      const data = await pgrest<string>("rpc/mp_publish_promise", {
        method: "POST",
        body: { p_promise_id: id },
      });
      toast({ title: "Promise published", description: `Question ${String(data).slice(0, 8)}… is live` });
      if (selectedId) loadPromises(selectedId);
    } catch (e) {
      toast({ title: "Publish blocked", description: (e as Error).message, variant: "destructive" });
    } finally {
      if (mountedRef.current) setPublishingId(null);
    }
  };

  const refreshAll = () => {
    loadRefData();
    loadManifestos();
    if (selectedId) loadPromises(selectedId);
  };

  const deleteManifesto = async (id: string, label: string) => {
    if (!window.confirm(`Delete manifesto "${label}" and all its promises? This cannot be undone.`)) return;
    try {
      const proms = await pgrest<{ question_id: string | null }[]>(
        `manifesto_promises?select=question_id&manifesto_id=eq.${id}`
      );
      const qids = (proms ?? []).map((p) => p.question_id).filter(Boolean) as string[];
      if (qids.length) await pgrest(`questions?id=in.(${qids.join(",")})`, { method: "DELETE" });
      await pgrest(`manifestos?id=eq.${id}`, { method: "DELETE" });
      toast({ title: "Manifesto deleted" });
      if (selectedId === id) setSelectedId(null);
      loadManifestos();
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const deletePromise = async (p: PromiseRow) => {
    if (!window.confirm("Delete this promise?")) return;
    try {
      if (p.question_id) await pgrest(`questions?id=eq.${p.question_id}`, { method: "DELETE" });
      await pgrest(`manifesto_promises?id=eq.${p.id}`, { method: "DELETE" });
      toast({ title: "Promise deleted" });
      if (selectedId) loadPromises(selectedId);
    } catch (e) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const coverage = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const p of promises) {
      const k = p.category?.trim() || "Uncategorised";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries());
  }, [promises]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Manifesto Performance</h1>
          <p className="text-sm text-muted-foreground">
            Epic MP — quote a promise verbatim; the public judges delivery.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={() => setShowManifesto(true)}>
            <Plus className="h-4 w-4 mr-1" /> New manifesto
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Manifestos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {manifestos.length === 0 && (
              <p className="text-sm text-muted-foreground">No manifestos yet. Create one to begin.</p>
            )}
            {manifestos.map((m) => (
              <div
                key={m.id}
                className={`rounded-md border p-2 transition ${
                  selectedId === m.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => setSelectedId(m.id)} className="flex-1 text-left text-sm">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="font-medium">{partyLabel(m.party_id)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {JURISDICTIONS.find((j) => j.value === m.jurisdiction)?.label}
                      {m.election_year ? ` · ${m.election_year}` : ""} · {m.ingestion_status}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteManifesto(m.id, partyLabel(m.party_id))}
                    className="shrink-0 text-muted-foreground hover:text-destructive p-1"
                    title="Delete manifesto"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Promises</CardTitle>
            {selectedId && (
              <Button size="sm" variant="outline" onClick={() => setShowPromise(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add promise
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedId && <p className="text-sm text-muted-foreground">Select a manifesto.</p>}
            {selectedId && coverage.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-1">
                <span className="text-xs text-muted-foreground mr-1">Coverage:</span>
                {coverage.map(([cat, n]) => (
                  <Badge key={cat} variant="secondary" className="text-xs">{cat}: {n}</Badge>
                ))}
              </div>
            )}
            {selectedId && promises.length === 0 && (
              <p className="text-sm text-muted-foreground">No promises yet.</p>
            )}
            {promises.map((p) => {
              const canPublish =
                !!p.verbatim_quote?.trim() && !!p.citation?.trim() && !!p.topic_id &&
                (p.status === "draft" || p.status === "curated");
              const isPublished = p.status === "published";
              return (
                <div key={p.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{p.promise_text}</p>
                    <Badge variant={isPublished ? "default" : "secondary"} className="shrink-0">
                      {p.status}
                    </Badge>
                  </div>
                  {p.verbatim_quote && (
                    <p className="text-xs italic text-muted-foreground border-l-2 pl-2">
                      “{p.verbatim_quote}”
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {p.category && <Badge variant="outline">{p.category}</Badge>}
                    {p.citation ? <span>{p.citation}</span> : <span className="text-amber-600">no citation</span>}
                    {!p.topic_id && <span className="text-amber-600">· no topic</span>}
                  </div>
                  <div className="flex justify-end items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deletePromise(p)}
                      title="Delete promise"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    {isPublished ? (
                      <span className="inline-flex items-center text-xs text-green-600">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Live
                        {p.question_id && <ExternalLink className="h-3.5 w-3.5 ml-1" />}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        disabled={!canPublish || publishingId === p.id}
                        onClick={() => publish(p.id)}
                      >
                        {publishingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <NewManifestoDialog
        open={showManifesto}
        onClose={() => setShowManifesto(false)}
        parties={parties}
        onCreated={() => { setShowManifesto(false); loadManifestos(); }}
      />
      {selectedId && (
        <NewPromiseDialog
          open={showPromise}
          onClose={() => setShowPromise(false)}
          manifestoId={selectedId}
          manifesto={manifestos.find((m) => m.id === selectedId) ?? null}
          topics={topics}
          onCreated={() => { setShowPromise(false); loadPromises(selectedId); }}
        />
      )}
    </div>
  );
}

// ─── New manifesto dialog ──────────────────────────────────────────────────────

function NewManifestoDialog(props: {
  open: boolean; onClose: () => void; parties: Party[]; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [partyId, setPartyId] = React.useState("");
  const [jurisdiction, setJurisdiction] = React.useState<Jurisdiction>("up_state");
  const [year, setYear] = React.useState("");
  const [sourceType, setSourceType] = React.useState<SourceType>("manual_upload");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (!partyId) { toast({ title: "Pick a party", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await pgrest("manifestos", {
        method: "POST",
        prefer: "return=minimal",
        body: {
          party_id: partyId,
          jurisdiction,
          election_year: year ? Number(year) : null,
          source_type: sourceType,
        },
      });
      toast({ title: "Manifesto created" });
      props.onCreated();
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New manifesto</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Party</Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger><SelectValue placeholder="Select party" /></SelectTrigger>
              <SelectContent>
                {props.parties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.abbreviation})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Jurisdiction</Label>
            <Select value={jurisdiction} onValueChange={(v) => setJurisdiction(v as Jurisdiction)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {JURISDICTIONS.map((j) => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Election year</Label>
            <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2017" />
          </div>
          <div>
            <Label>Source</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── New promise dialog ──────────────────────────────────────────────────────

function NewPromiseDialog(props: {
  open: boolean; onClose: () => void; manifestoId: string;
  manifesto: Manifesto | null; topics: Topic[]; onCreated: () => void;
}) {
  const { toast } = useToast();
  const [promiseText, setPromiseText] = React.useState("");
  const [verbatim, setVerbatim] = React.useState("");
  const [citation, setCitation] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [topicId, setTopicId] = React.useState("");
  const [lowLabel, setLowLabel] = React.useState("");
  const [highLabel, setHighLabel] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [suggesting, setSuggesting] = React.useState(false);

  // Reuses the same model config as the reframe pipeline (REFRAME_MODEL_*) to
  // generate context-driven poles from the delivery question, WITHOUT rewriting
  // the question. Fills the two fields for review; the curator can edit before publishing.
  const suggestPoles = async () => {
    if (!promiseText.trim()) {
      toast({ title: "Add the delivery question first", variant: "destructive" });
      return;
    }
    setSuggesting(true);
    try {
      const token = getJwt();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mp-suggest-poles`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question_text: promiseText.trim(),
          verbatim_quote: verbatim.trim() || null,
          category: category.trim() || null,
        }),
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.slider_low_label) setLowLabel(data.slider_low_label);
      if (data.slider_high_label) setHighLabel(data.slider_high_label);
      toast({ title: "Poles suggested", description: "Review and edit before publishing." });
    } catch (e) {
      toast({ title: "Suggestion failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSuggesting(false);
    }
  };

  const save = async () => {
    if (!props.manifesto) return;
    if (!promiseText.trim()) { toast({ title: "Promise text required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await pgrest("manifesto_promises", {
        method: "POST",
        prefer: "return=minimal",
        body: {
          manifesto_id: props.manifestoId,
          party_id: props.manifesto.party_id,
          jurisdiction: props.manifesto.jurisdiction,
          category: category.trim() || null,
          promise_text: promiseText.trim(),
          verbatim_quote: verbatim.trim() || null,
          citation: citation.trim() || null,
          topic_id: topicId || null,
          slider_low_label: lowLabel.trim() || null,
          slider_high_label: highLabel.trim() || null,
          status: "curated",
        },
      });
      toast({ title: "Promise added" });
      setPromiseText(""); setVerbatim(""); setCitation(""); setCategory(""); setTopicId("");
      setLowLabel(""); setHighLabel("");
      props.onCreated();
    } catch (e) {
      toast({ title: "Failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add promise</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Delivery question (neutral prompt shown to users)</Label>
            <Textarea
              value={promiseText}
              onChange={(e) => setPromiseText(e.target.value)}
              placeholder="How fully has the promise of 24x7 power supply been delivered?"
            />
          </div>
          <div>
            <Label>Verbatim quote (exact manifesto wording)</Label>
            <Textarea
              value={verbatim}
              onChange={(e) => setVerbatim(e.target.value)}
              placeholder="We will ensure 24-hour electricity to every village and household."
            />
          </div>
          <div>
            <Label>Citation (page / section)</Label>
            <Input value={citation} onChange={(e) => setCitation(e.target.value)} placeholder="2017 manifesto, p.12" />
          </div>
          <div>
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Infrastructure" />
          </div>
          <div className="flex items-center justify-between">
            <Label>Stance poles</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={suggestPoles}
              disabled={suggesting || !promiseText.trim()}
            >
              {suggesting
                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              Suggest with AI
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Low pole (−2 label)</Label>
              <Input value={lowLabel} onChange={(e) => setLowLabel(e.target.value)} placeholder="Loan not waived" />
            </div>
            <div>
              <Label>High pole (+2 label)</Label>
              <Input value={highLabel} onChange={(e) => setHighLabel(e.target.value)} placeholder="Loan fully waived" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Context-driven poles per question. Leave blank to default to "Not delivered" / "Fully delivered".
            The wording also drives how the AI explains a stance.
          </p>
          <div>
            <Label>Topic</Label>
            <Select value={topicId} onValueChange={setTopicId}>
              <SelectTrigger><SelectValue placeholder="Select topic" /></SelectTrigger>
              <SelectContent>
                {props.topics.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Verbatim quote, citation and topic are all required before a promise can be published.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
