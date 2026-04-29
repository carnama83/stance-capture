import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, RefreshCw, CheckCircle2, CornerDownRight } from "lucide-react";

type QuestionStatus = "active" | "archived";
type QuestionPhase  = "initial" | "update" | "resolution" | "follow_up";

type QuestionDetail = {
  id: string;
  question_draft_id: string | null;
  topic_draft_id: string | null;
  news_item_id: string | null;
  question: string;
  summary: string | null;
  tags: string[] | null;
  location_label: string | null;
  status: QuestionStatus;
  phase: QuestionPhase;
  context_summary: string | null;
  context_version: number | null;
  created_at: string;
  published_at: string;
  question_drafts?: {
    id: string; question: string | null; summary: string | null;
    tags: string[] | null; location_label: string | null; status: string | null;
  } | null;
  topic_drafts?: {
    id: string; title: string | null; summary: string | null;
    tags: string[] | null; location_label: string | null; status: string | null;
  } | null;
  news_items?: {
    id: string; title: string | null; summary: string | null;
    url: string | null; published_at: string | null;
  } | null;
};

const PHASE_OPTIONS: { value: QuestionPhase; label: string; icon: string }[] = [
  { value: "update",     label: "Update",     icon: "🔄" },
  { value: "resolution", label: "Resolution", icon: "✅" },
  { value: "follow_up",  label: "Follow-up",  icon: "↩️" },
];

// ── M-C03: Add Context Panel ──────────────────────────────────────────────────
function AddContextPanel({ questionId, onSuccess }: { questionId: string; onSuccess: () => void }) {
  const sb = getSupabase()!;
  const [newContext,    setNewContext]    = React.useState("");
  const [supportingLink, setSupportingLink] = React.useState("");
  const [reactivate,    setReactivate]    = React.useState(false);
  const [loading,       setLoading]       = React.useState(false);
  const [error,         setError]         = React.useState<string | null>(null);
  const [success,       setSuccess]       = React.useState(false);

  const handleSubmit = async () => {
    if (!newContext.trim()) { setError("Context text is required."); return; }
    setLoading(true); setError(null); setSuccess(false);
    const { error: rpcErr } = await sb.rpc("add_context_to_existing_question", {
      p_question_id:       questionId,
      p_new_context:       newContext.trim(),
      p_supporting_link:   supportingLink.trim() || null,
      p_should_reactivate: reactivate,
    });
    if (rpcErr) { setError(rpcErr.message); }
    else { setSuccess(true); setNewContext(""); setSupportingLink(""); setReactivate(false); onSuccess(); }
    setLoading(false);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-blue-600" />
        <h2 className="text-sm font-semibold">Add Context Update</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Appends to the question's context summary and increments context_version.
        Optionally reactivates the question if it has cooled.
      </p>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-context" className="text-xs">Context text <span className="text-red-500">*</span></Label>
          <Textarea
            id="new-context"
            placeholder="Describe what has changed or what new information is relevant…"
            value={newContext}
            onChange={(e) => setNewContext(e.target.value)}
            rows={3}
            className="text-sm resize-none"
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="supporting-link" className="text-xs">Supporting link (optional)</Label>
          <Input
            id="supporting-link"
            type="url"
            placeholder="https://example.com/article"
            value={supportingLink}
            onChange={(e) => setSupportingLink(e.target.value)}
            className="text-sm"
            disabled={loading}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={reactivate}
            onChange={(e) => setReactivate(e.target.checked)}
            disabled={loading}
            className="rounded"
          />
          <span className="text-xs text-slate-700">Reactivate question (transition state back to 'active')</span>
        </label>
        {error   && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
        {success && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Context added successfully.</p>}
        <Button size="sm" onClick={handleSubmit} disabled={loading || !newContext.trim()}>
          {loading ? "Saving…" : "Add Context"}
        </Button>
      </div>
    </section>
  );
}

// ── M-C04: Update Phase Panel ─────────────────────────────────────────────────
function UpdatePhasePanel({ questionId, currentPhase, onSuccess }: { questionId: string; currentPhase: QuestionPhase; onSuccess: () => void }) {
  const sb = getSupabase()!;
  const [newPhase,        setNewPhase]        = React.useState<QuestionPhase>("update");
  const [newContext,      setNewContext]      = React.useState("");
  const [supportingLinks, setSupportingLinks] = React.useState("");
  const [loading,         setLoading]         = React.useState(false);
  const [error,           setError]           = React.useState<string | null>(null);
  const [success,         setSuccess]         = React.useState(false);

  const parseLinks = (raw: string): string[] => raw.split(",").map((s) => s.trim()).filter(Boolean);

  const handleSubmit = async () => {
    if (!newContext.trim()) { setError("Context text is required."); return; }
    setLoading(true); setError(null); setSuccess(false);
    const { error: rpcErr } = await sb.rpc("admin_mark_question_updated", {
      p_question_id:      questionId,
      p_new_phase:        newPhase,
      p_new_context:      newContext.trim(),
      p_supporting_links: parseLinks(supportingLinks),
    });
    if (rpcErr) { setError(rpcErr.message); }
    else { setSuccess(true); setNewContext(""); setSupportingLinks(""); onSuccess(); }
    setLoading(false);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <CornerDownRight className="h-4 w-4 text-purple-600" />
        <h2 className="text-sm font-semibold">Update Phase</h2>
        {currentPhase !== "initial" && (
          <Badge variant="secondary" className="text-xs">Current: {currentPhase}</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Transitions the question to a new phase, writes a question_context_updates row,
        and bumps context_version. Admin-only.
      </p>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="space-y-1.5">
          <Label className="text-xs">New phase <span className="text-red-500">*</span></Label>
          <div className="flex gap-2">
            {PHASE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setNewPhase(opt.value)}
                disabled={loading}
                className={[
                  "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  newPhase === opt.value
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
                ].join(" ")}
              >
                <span>{opt.icon}</span>{opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase-context" className="text-xs">Context <span className="text-red-500">*</span></Label>
          <Textarea
            id="phase-context"
            placeholder="Describe what changed that warrants this phase update…"
            value={newContext}
            onChange={(e) => setNewContext(e.target.value)}
            rows={3}
            className="text-sm resize-none"
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phase-links" className="text-xs">Supporting links (optional, comma-separated)</Label>
          <Input
            id="phase-links"
            type="text"
            placeholder="https://link1.com, https://link2.com"
            value={supportingLinks}
            onChange={(e) => setSupportingLinks(e.target.value)}
            className="text-sm"
            disabled={loading}
          />
        </div>
        {error   && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
        {success && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Phase updated to '{newPhase}' successfully.</p>}
        <Button size="sm" onClick={handleSubmit} disabled={loading || !newContext.trim()}>
          {loading ? "Saving…" : "Update Phase"}
        </Button>
      </div>
    </section>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AdminLiveQuestionShowPage() {
  const { id } = useParams();
  const supabase = getSupabase()!;
  const [loading, setLoading] = React.useState(true);
  const [row,     setRow]     = React.useState<QuestionDetail | null>(null);
  const [error,   setError]   = React.useState<string | null>(null);

  const loadQuestion = React.useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from("questions")
      .select(`
        id, question_draft_id, topic_draft_id, news_item_id,
        question, summary, tags, location_label,
        status, phase, context_summary, context_version,
        created_at, published_at,
        question_drafts (id, question, summary, tags, location_label, status),
        topic_drafts    (id, title,    summary, tags, location_label, status),
        news_items      (id, title,    summary, url,  published_at)
      `)
      .eq("id", id)
      .single();
    if (error) { console.error("Failed to load question detail:", error); setError(error.message); setRow(null); }
    else { setRow(data as QuestionDetail); }
    setLoading(false);
  }, [id, supabase]);

  React.useEffect(() => { loadQuestion(); }, [loadQuestion]);

  if (!id) return (
    <Card className="max-w-4xl mx-auto"><CardHeader><CardTitle>Live Question</CardTitle></CardHeader>
      <CardContent>Missing question id.</CardContent></Card>
  );
  if (loading) return (
    <Card className="max-w-4xl mx-auto"><CardHeader><CardTitle>Live Question</CardTitle></CardHeader>
      <CardContent>Loading…</CardContent></Card>
  );
  if (error || !row) return (
    <Card className="max-w-4xl mx-auto"><CardHeader><CardTitle>Live Question</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm text-red-600">Failed to load question: {error ?? "Unknown error"}</div>
        <Button asChild variant="outline"><Link to="/admin/live-questions">Back to Live Questions</Link></Button>
      </CardContent></Card>
  );

  const createdAt   = row.created_at   ? new Date(row.created_at).toLocaleString()   : "—";
  const publishedAt = row.published_at ? new Date(row.published_at).toLocaleString() : "—";
  const news = row.news_items ?? null;
  const phaseLabel: Record<QuestionPhase, string> = {
    initial: "Initial", update: "🔄 Update", resolution: "✅ Resolution", follow_up: "↩️ Follow-up",
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">
            /admin/live-questions/:id
          </span>
          <span className="text-slate-300">→</span>
          <span>
            src/routes/admin/live-questions/<strong>Show.tsx</strong>
          </span>
        </div>
        <h1 className="text-lg font-bold text-slate-900">Live Question Detail</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          Inspect a published question and manage its lifecycle. From here you can:
        </p>
        <ul className="text-sm text-slate-600 space-y-1 ml-4 list-disc">
          <li>
            <strong>Add Context</strong> — append new information to the question's context summary
            and optionally reactivate a cooled question. Writes to{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">question_context_updates</code>{" "}
            and increments <code className="text-xs bg-slate-100 px-1 rounded">context_version</code>.
            Changes are immediately visible to users on the question detail page.
          </li>
          <li>
            <strong>Update Phase</strong> — transition the question to Update (🔄), Resolution (✅),
            or Follow-up (↩️) phase. Bumps the phase badge users see in the feed and on the detail page.
            Admin-only; calls{" "}
            <code className="text-xs bg-slate-100 px-1 rounded">admin_mark_question_updated()</code>.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground pt-1">
          Management controls are only shown for <strong>active</strong> questions.
          Archived questions are read-only.
        </p>
      </div>

    <Card className="space-y-4">
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <CardTitle className="flex items-center gap-2">
            <Badge variant={row.status === "active" ? "default" : "secondary"}>
              {row.status === "active" ? "Active" : "Archived"}
            </Badge>
            {row.phase && row.phase !== "initial" && (
              <Badge variant="outline" className="text-xs">{phaseLabel[row.phase] ?? row.phase}</Badge>
            )}
            <span>Live Question</span>
          </CardTitle>
          <div className="text-xs text-muted-foreground space-x-3">
            <span>Created: {createdAt}</span>
            <span>Published: {publishedAt}</span>
            {row.location_label && <span>· {row.location_label}</span>}
            {row.context_version != null && row.context_version > 0 && (
              <span>· Context v{row.context_version}</span>
            )}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/live-questions">Back to list</Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Question content */}
        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-muted-foreground">Question</h2>
          <p className="text-lg font-semibold whitespace-pre-wrap">{row.question}</p>
          {row.tags && row.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {row.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
            </div>
          )}
          {row.summary && (
            <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{row.summary}</p>
          )}
          {row.context_summary && (
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-xs font-medium text-blue-700 mb-1">Context summary</p>
              <p className="text-sm text-blue-900 whitespace-pre-wrap">{row.context_summary}</p>
            </div>
          )}
        </section>

        {row.topic_drafts && (
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">Source Topic Draft</h2>
            <div className="text-sm">
              <div className="font-medium">{row.topic_drafts.title ?? "(untitled topic)"}</div>
              {row.topic_drafts.summary && <p className="text-muted-foreground whitespace-pre-wrap">{row.topic_drafts.summary}</p>}
            </div>
          </section>
        )}

        {row.question_drafts && (
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">Source Question Draft</h2>
            <div className="text-sm">
              <div className="font-medium">{row.question_drafts.question ?? "(question draft)"}</div>
              {row.question_drafts.summary && <p className="text-muted-foreground whitespace-pre-wrap">{row.question_drafts.summary}</p>}
            </div>
          </section>
        )}

        {news && (
          <section className="space-y-1">
            <h2 className="text-sm font-semibold text-muted-foreground">Related News Article</h2>
            <div className="text-sm space-y-1">
              <div className="font-medium">{news.title ?? "(no title)"}</div>
              {news.published_at && <div className="text-xs text-muted-foreground">Published: {new Date(news.published_at).toLocaleString()}</div>}
              {news.summary && <p className="text-muted-foreground whitespace-pre-wrap">{news.summary}</p>}
              {news.url && (
                <a href={news.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 underline mt-1">
                  View article <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </section>
        )}

        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-muted-foreground">IDs</h2>
          <div className="text-xs text-muted-foreground space-y-1 break-all">
            <div>Question id: {row.id}</div>
            {row.question_draft_id && <div>Question draft id: {row.question_draft_id}</div>}
            {row.topic_draft_id    && <div>Topic draft id: {row.topic_draft_id}</div>}
            {row.news_item_id      && <div>News item id: {row.news_item_id}</div>}
          </div>
        </section>

        {/* ── M-C03 + M-C04: Question Management (active questions only) ── */}
        {row.status === "active" && (
          <>
            <Separator />
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Question Management</h2>
              <p className="text-xs text-muted-foreground">
                Add context or update the question phase. All changes are logged in
                question_context_updates and visible to users on the question detail page.
              </p>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <AddContextPanel questionId={row.id} onSuccess={loadQuestion} />
              <UpdatePhasePanel questionId={row.id} currentPhase={row.phase ?? "initial"} onSuccess={loadQuestion} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
