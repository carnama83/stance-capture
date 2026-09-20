// src/routes/admin/rendition-lifecycle/Index.tsx
//
// PR 2b.8 — the invalidation surface.
//
// invalidate_rendition() has existed since f2_10 with NO user interface at all.
// The rendition-review screen only handles DRAFTS awaiting publish; there was
// nowhere to act on a rendition that is already live. So the operation the
// whole measurement-lifecycle design turns on could only be performed by
// someone with direct database access.
//
// WHY THIS IS A SEPARATE SCREEN FROM RENDITION REVIEW.
//
// Publishing a correction and withdrawing a defective instrument look similar
// and are not:
//
//   Publish a new version          Invalidate a rendition
//   ───────────────────────        ──────────────────────────────────
//   routine                        exceptional
//   previous → superseded          previous → invalidated (TERMINAL)
//   responses stay valid           responses stop counting
//   nobody is interrupted          respondents are notified and re-asked
//                                  in-flight WhatsApp cards are rejected
//
// Sitting them side by side as two buttons is precisely how invalidate gets
// read as "delete the old translation". The brief asks for them to be visibly
// distinct; separate screens, destructive styling, a required reason and a
// typed confirmation are that.
//
// The impact numbers are shown BEFORE the action, from
// rendition_invalidation_impact(), so the cost is on screen rather than
// discovered afterwards.

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type LiveRendition = {
  id: string;
  question_id: string;
  language_code: string;
  lifecycle_status: string;
  rendition_type: string;
  rendered_text: string | null;
  published_at: string | null;
};

type Impact = {
  question_id: string;
  language_code: string;
  lifecycle_status: string;
  rendition_type: string;
  lineage_size: number;
  responses_affected: number;
  respondents_notified: number;
  in_flight_sessions: number;
};

/** Reason is mandatory and must be substantive — it is the audit record. */
const MIN_REASON_LENGTH = 15;
const CONFIRM_PHRASE = "INVALIDATE";

async function fetchLiveRenditions(): Promise<LiveRendition[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/question_renditions` +
      `?select=id,question_id,language_code,lifecycle_status,rendition_type,rendered_text,published_at` +
      `&lifecycle_status=in.(published,superseded)` +
      `&rendition_type=eq.translated` +
      `&order=published_at.desc&limit=100`,
    { headers: supabaseHeaders(getJwt()) },
  );
  if (!res.ok) throw new Error(`Failed to load renditions (${res.status})`);
  return (await res.json()) as LiveRendition[];
}

async function fetchImpact(renditionId: string): Promise<Impact | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rendition_invalidation_impact`, {
    method: "POST",
    headers: { ...supabaseHeaders(getJwt()), "Content-Type": "application/json" },
    body: JSON.stringify({ p_rendition_id: renditionId }),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Impact[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function ImpactRow({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs text-slate-600">{label}</span>
      <span
        className={`text-sm font-semibold tabular-nums ${
          tone === "warn" && value > 0 ? "text-rose-700" : "text-slate-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function InvalidatePanel({
  rendition,
  onDone,
}: {
  rendition: LiveRendition;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const impactQuery = useQuery({
    queryKey: ["invalidation-impact", rendition.id],
    queryFn: () => fetchImpact(rendition.id),
    staleTime: 30_000,
  });
  const impact = impactQuery.data ?? null;

  // The original is the question's authoritative wording; invalidating it would
  // leave the question unanswerable, and the RPC refuses. Say so here rather
  // than letting the admin discover it from an exception.
  const isOriginal = rendition.rendition_type === "original";

  const reasonOk = reason.trim().length >= MIN_REASON_LENGTH;
  const confirmOk = confirmText.trim().toUpperCase() === CONFIRM_PHRASE;
  const canSubmit = !busy && !isOriginal && reasonOk && confirmOk;

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/invalidate_rendition`, {
        method: "POST",
        headers: { ...supabaseHeaders(getJwt()), "Content-Type": "application/json" },
        body: JSON.stringify({ p_rendition_id: rendition.id, p_reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body.slice(0, 300) || `HTTP ${res.status}`);
      }
      toast({
        title: "Rendition invalidated",
        description:
          "Affected responses have stopped counting and respondents have been asked to answer again.",
      });
      onDone();
    } catch (e: any) {
      toast({ title: "Could not invalidate", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border-2 border-rose-300 bg-rose-50/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert className="h-4 w-4 text-rose-700" />
        <span className="text-sm font-semibold text-rose-900">
          Invalidate this rendition
        </span>
      </div>

      <p className="text-xs text-rose-900/80 mb-3">
        This is not the same as publishing a correction. Invalidating affects
        measurement data: the responses below stop counting, the people who gave
        them are asked to answer again, and this cannot be undone.
      </p>

      {isOriginal && (
        <div className="mb-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
          <span className="text-xs text-amber-900">
            This is the source-language original. It cannot be invalidated —
            the question would have no authoritative wording left. Withdraw the
            question instead.
          </span>
        </div>
      )}

      <div className="rounded border border-rose-200 bg-white p-3 mb-3">
        {impactQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Calculating impact…
          </div>
        ) : impact ? (
          <>
            <ImpactRow label="Responses that stop counting" value={impact.responses_affected} tone="warn" />
            <ImpactRow label="Respondents who will be notified" value={impact.respondents_notified} />
            <ImpactRow label="Delivered WhatsApp cards that will be re-asked" value={impact.in_flight_sessions} tone="warn" />
            <ImpactRow label="Renditions affected (including derived)" value={impact.lineage_size} />
            {impact.responses_affected === 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                No responses recorded against this wording yet — invalidating it
                now costs nothing.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-500">Impact unavailable.</p>
        )}
      </div>

      <label className="block text-xs font-medium text-slate-700 mb-1">
        Reason (required, recorded for audit — never shown to respondents)
      </label>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. pole labels reversed in translation, inverting the measurement axis"
        className="mb-1 bg-white"
      />
      <p className="text-[11px] text-slate-500 mb-3">
        {reasonOk
          ? " "
          : `At least ${MIN_REASON_LENGTH} characters. This is the audit record for a terminal action.`}
      </p>

      <label className="block text-xs font-medium text-slate-700 mb-1">
        Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> to confirm
      </label>
      <Input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={CONFIRM_PHRASE}
        className="mb-3 bg-white font-mono"
      />

      <div className="flex items-center gap-2">
        <Button variant="destructive" disabled={!canSubmit} onClick={submit}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Invalidate — responses stop counting
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function AdminRenditionLifecyclePage() {
  const qc = useQueryClient();
  const [openFor, setOpenFor] = React.useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-live-renditions"],
    queryFn: fetchLiveRenditions,
    staleTime: 30_000,
  });

  const rows = data ?? [];

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-semibold text-slate-900">Rendition lifecycle</h1>
      <p className="mt-1 text-sm text-slate-600">
        Live wording that respondents can answer. Use this only to withdraw a
        rendition whose framing is defective — to publish an improved version,
        use Rendition Review, which supersedes the previous one and leaves every
        existing response valid.
      </p>

      {isLoading && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {isError && (
        <p className="mt-6 text-sm text-rose-700">{(error as Error)?.message}</p>
      )}

      <div className="mt-6 space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">{r.language_code}</Badge>
                  <Badge variant={r.lifecycle_status === "published" ? "default" : "secondary"}>
                    {r.lifecycle_status}
                  </Badge>
                </div>
                <p className="text-sm text-slate-800 break-words">
                  {r.rendered_text ?? "(no wording)"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-rose-300 text-rose-700 hover:bg-rose-50"
                onClick={() => setOpenFor(openFor === r.id ? null : r.id)}
              >
                {openFor === r.id ? "Close" : "Invalidate…"}
              </Button>
            </div>

            {openFor === r.id && (
              <InvalidatePanel
                rendition={r}
                onDone={() => {
                  setOpenFor(null);
                  qc.invalidateQueries({ queryKey: ["admin-live-renditions"] });
                }}
              />
            )}
          </div>
        ))}
        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-slate-500">No live translated renditions.</p>
        )}
      </div>
    </div>
  );
}
