// src/components/admin/ReframedReviewPanel.tsx
// Epic UGQ — Phase 2 review panel for the two-phase approve flow.
//
// Renders for proposals with status='reframed'. Shows the raw question beside
// the AI-reframed question (editable), slider labels (editable), quality score,
// hard-flag chips (fidelity_violation / pattern_dropped / presumes_guilt),
// framing style, and the web sources that grounded the reframe. Actions:
//   Publish          → ugq-moderate action 'publish_reframed'
//   Regenerate       → ugq-moderate action 'discard_reframe' (back to In review)
//
// Deliberately prop-driven: the parent page owns the authenticated call to
// ugq-moderate (raw fetch + getJwt + supabaseHeaders discipline — NEVER
// sb.rpc()/sb.from() for mutations). This component performs no imports from
// app internals and no network calls of its own.

import { useMemo, useState } from "react";

export interface ReframeResult {
  question?: string | null;
  framing_style?: string | null;
  core_tension?: string | null;
  slider_low_label?: string | null;
  slider_high_label?: string | null;
  quality_score?: number | null;
  quality_notes?: string | null;
  sources?: string[] | null;
  topic_id?: string | null;
  model?: string | null;
  web_search?: boolean | null;
  generated_at?: string | null;
  published_question?: string | null;
  published_at?: string | null;
}

export interface ReframedProposal {
  id: string;
  raw_question: string;
  admin_edited_question?: string | null;
  status: string;
  reframe_result: ReframeResult | null;
}

export interface ModerateResponse {
  ok: boolean;
  error?: string;
  message?: string;
  status?: string;
  question_id?: string;
  published_question?: string;
}

interface Props {
  proposal: ReframedProposal;
  /** Parent-owned authenticated POST to ugq-moderate. Must return parsed JSON. */
  onModerate: (body: Record<string, unknown>) => Promise<ModerateResponse>;
  /** Called after any successful action so the parent can refetch the queue. */
  onChanged: () => void;
}

const FLAG_LABELS: Record<string, string> = {
  fidelity_violation: "Fidelity violation — tradeoff not in source",
  pattern_dropped: "Pattern dropped — multi-case proposal collapsed",
  presumes_guilt: "Presumes guilt — un-convicted suspect implicated",
};

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export default function ReframedReviewPanel({ proposal, onModerate, onChanged }: Props) {
  const rr = proposal.reframe_result ?? {};
  const [question, setQuestion] = useState(rr.question ?? "");
  const [sliderLow, setSliderLow] = useState(rr.slider_low_label ?? "");
  const [sliderHigh, setSliderHigh] = useState(rr.slider_high_label ?? "");
  const [busy, setBusy] = useState<"publish" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flags = useMemo(() => {
    const notes = rr.quality_notes ?? "";
    return Object.keys(FLAG_LABELS).filter((f) => notes.includes(f));
  }, [rr.quality_notes]);

  const words = wordCount(question);
  const overLimit = words > 65;
  const edited = question.trim() !== (rr.question ?? "").trim();

  async function publish() {
    setError(null);
    if (!question.trim()) { setError("Question text is empty."); return; }
    setBusy("publish");
    try {
      const res = await onModerate({
        proposal_id: proposal.id,
        action: "publish_reframed",
        final_question: question.trim(),
        slider_low_label: sliderLow.trim() || null,
        slider_high_label: sliderHigh.trim() || null,
      });
      if (!res.ok) {
        setError(res.message ?? res.error ?? "Publish failed.");
        return;
      }
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    setError(null);
    if (!window.confirm("Discard this reframe and send the proposal back to In review?")) return;
    setBusy("discard");
    try {
      const res = await onModerate({ proposal_id: proposal.id, action: "discard_reframe" });
      if (!res.ok) {
        setError(res.message ?? res.error ?? "Could not discard the reframe.");
        return;
      }
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
      {/* Hard-flag chips: should be rare here, but if present they must be loud. */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {flags.map((f) => (
            <span
              key={f}
              className="inline-flex items-center rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-medium text-red-700"
            >
              {FLAG_LABELS[f]}
            </span>
          ))}
        </div>
      )}

      {/* Raw vs reframed, side by side on wide screens. */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
            Proposer's question
          </div>
          <div className="rounded-md bg-slate-50 border border-slate-100 p-3 text-sm text-slate-600 whitespace-pre-wrap">
            {proposal.admin_edited_question || proposal.raw_question}
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Question to publish {edited && <span className="text-indigo-500 normal-case">(edited)</span>}
            </div>
            <div className={`text-xs ${overLimit ? "text-red-600 font-semibold" : "text-slate-400"}`}>
              {words}/65 words
            </div>
          </div>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-slate-300 p-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      </div>

      {/* Slider labels. */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1 block">
            Slider — oppose end (−2)
          </label>
          <input
            value={sliderLow}
            onChange={(e) => setSliderLow(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1 block">
            Slider — support end (+2)
          </label>
          <input
            value={sliderHigh}
            onChange={(e) => setSliderHigh(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      </div>

      {/* Reframe metadata. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {typeof rr.quality_score === "number" && (
          <span>
            Quality:{" "}
            <span className={rr.quality_score >= 8 ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
              {rr.quality_score}/10
            </span>
          </span>
        )}
        {rr.framing_style && <span>Style: {rr.framing_style}</span>}
        {rr.model && <span>Model: {rr.model}</span>}
        {rr.web_search && <span>Web-grounded</span>}
      </div>
      {rr.quality_notes && (
        <div className="text-xs text-slate-500 italic">Notes: {rr.quality_notes}</div>
      )}
      {rr.core_tension && (
        <div className="text-xs text-slate-500">Tension: {rr.core_tension}</div>
      )}

      {/* Grounding sources — the audit trail of what informed this question. */}
      {Array.isArray(rr.sources) && rr.sources.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
            Sources consulted
          </div>
          <ul className="space-y-0.5">
            {rr.sources.map((url) => (
              <li key={url} className="truncate">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Actions. Reject stays with the page's existing controls. */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={publish}
          disabled={busy !== null || !question.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === "publish" ? "Publishing…" : "Publish"}
        </button>
        <button
          onClick={regenerate}
          disabled={busy !== null}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "discard" ? "Discarding…" : "Regenerate"}
        </button>
        {overLimit && (
          <span className="text-xs text-red-600">Over the 65-word ceiling — trim before publishing.</span>
        )}
      </div>
    </div>
  );
}
