// src/pages/MyProposalsPage.tsx
// Epic UGQ — Build Step 6: proposer history (spec §9.4). Route: /profile/proposals.
//
// Shows the signed-in user's proposals (newest first) with status, date and
// stance counts for published ones, plus their reputation score + tier.
//
// Aug 2026: publishing moved from automatic to user-confirmed (see
// ugq-confirm-publish) — the proposer reviews the preview and clicks
// Publish, normally right inside ProposeQuestionModal. But that modal is
// ephemeral: if it's closed before publishing (outside click used to do
// this silently — since fixed, see ProposeQuestionModal — or just navigating
// away), the proposal + preview are still saved server-side with nothing in
// the UI to get back to them. This page now shows an inline preview +
// Publish button for any 'in_review' proposal that has one ready, so that
// state is never a dead end.

import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Lightbulb, Loader2, MessageSquare, Sparkles, ExternalLink } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { ProposeQuestionButton } from "@/components/ugq/ProposeQuestionButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

// Shape of user_question_proposals.preview_reframe — same as
// ProposeQuestionModal's PreviewReframe, duplicated here rather than shared
// since these live in different route trees in this codebase's conventions.
type PreviewReframe = {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
  supporting_links: string[];
};

type Proposal = {
  id: string;
  raw_question: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  reframed_question_id: string | null;
  response_count: number;
  preview_reframe: PreviewReframe | null;
};

type Reputation = {
  score: number;
  tier: string;
  total_proposed: number;
  total_published: number;
  total_rejected: number;
};

function parsePreviewReframe(raw: unknown): PreviewReframe | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const question = typeof r.question === "string" ? r.question.trim() : "";
  if (!question) return null;
  return {
    question,
    slider_low_label: typeof r.slider_low_label === "string" ? r.slider_low_label : null,
    slider_high_label: typeof r.slider_high_label === "string" ? r.slider_high_label : null,
    context_summary: typeof r.context_summary === "string" && r.context_summary.trim() ? r.context_summary.trim() : null,
    supporting_links: Array.isArray(r.supporting_links)
      ? r.supporting_links.filter((u): u is string => typeof u === "string")
      : [],
  };
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// Same static preview as ProposeQuestionModal's StanceScalePreview —
// duplicated rather than shared, matching this codebase's existing
// convention of not sharing small presentational pieces across route trees.
// Matches QuestionStanceSlider's real visual language (gradient colors,
// track height, thumb border/size) so this doesn't look like a different
// component. Thumb centered at Neutral — no real position exists yet.
function StanceScalePreview({ low, high }: { low: string | null; high: string | null }) {
  if (!low && !high) return null;
  return (
    <div>
      <p className="text-[10.5px] text-slate-500 mb-2">
        Here&#x2019;s how the stance scale will appear to users:
      </p>
      <div className="relative py-1.5">
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full"
          style={{
            height: "8px",
            background: "linear-gradient(to right, rgba(248,113,113,0.3), rgba(203,213,225,0.3), rgba(74,222,128,0.3))",
          }}
          aria-hidden
        />
        <div
          className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-400 bg-white"
          aria-hidden
        />
      </div>
      <div className="flex items-start justify-between gap-2 text-[11px] text-slate-600">
        <span className="max-w-[42%] leading-tight">{low ?? "Oppose"}</span>
        <span className="text-slate-400 shrink-0">Neutral</span>
        <span className="max-w-[42%] text-right leading-tight">{high ?? "Support"}</span>
      </div>
    </div>
  );
}

async function fetchMyProposals(): Promise<Proposal[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_proposals`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to load proposals (${res.status})`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    raw_question: String(r.raw_question ?? ""),
    status: String(r.status ?? ""),
    rejection_reason: typeof r.rejection_reason === "string" ? r.rejection_reason : null,
    created_at: String(r.created_at ?? ""),
    reframed_question_id: typeof r.reframed_question_id === "string" ? r.reframed_question_id : null,
    response_count: Number(r.response_count ?? 0),
    preview_reframe: parsePreviewReframe(r.preview_reframe),
  }));
}

async function fetchMyReputation(): Promise<Reputation | null> {
  // RLS returns only the caller's own row.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_proposal_reputation?select=score,tier,total_proposed,total_published,total_rejected`,
    { headers: supabaseHeaders(getJwt()) },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Reputation[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  proposed:  { label: "Under review", cls: "bg-amber-500 hover:bg-amber-500" },
  screening: { label: "Under review", cls: "bg-amber-500 hover:bg-amber-500" },
  in_review: { label: "Under review", cls: "bg-amber-500 hover:bg-amber-500" },
  approved:  { label: "Approved",     cls: "bg-blue-600 hover:bg-blue-600" },
  reframing: { label: "Preparing",    cls: "bg-blue-600 hover:bg-blue-600" },
  published: { label: "Live",         cls: "bg-emerald-600 hover:bg-emerald-600" },
  rejected:  { label: "Not published", cls: "bg-slate-400 hover:bg-slate-400" },
  withdrawn: { label: "Withdrawn",    cls: "bg-slate-400 hover:bg-slate-400" },
};

function tierLabel(tier: string) {
  if (tier === "verified") return "Verified proposer";
  if (tier === "trusted") return "Trusted proposer";
  return "New proposer";
}

// Inline preview + Publish action for an 'in_review' proposal with a ready
// preview. Mirrors ProposeQuestionModal's review card, just embedded rather
// than in a dialog, and calls the same ugq-confirm-publish endpoint.
function InlinePublishCard({ proposal, onPublished }: { proposal: Proposal; onPublished: () => void }) {
  const [publishing, setPublishing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const preview = proposal.preview_reframe;
  if (!preview) return null;

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-confirm-publish`, {
        method: "POST",
        headers: supabaseHeaders(getJwt()),
        body: JSON.stringify({ proposal_id: proposal.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "Couldn't publish just now. Please try again.");
        setPublishing(false);
        return;
      }
      onPublished();
      // Deliberately not resetting `publishing` — the row re-renders as
      // 'published' once the list refetches, so this component unmounts.
    } catch (_e) {
      setError("Network error. Please try again.");
      setPublishing(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <Sparkles className="h-3.5 w-3.5" />
        Ready to publish
      </div>
      <p className="text-sm text-slate-800 leading-snug">{preview.question}</p>
      <StanceScalePreview low={preview.slider_low_label} high={preview.slider_high_label} />
      {preview.context_summary && (
        <div className="pt-1.5 mt-0.5 border-t border-amber-200/70 space-y-1">
          <p className="text-[11px] font-medium text-amber-700">Background</p>
          <p className="text-xs text-slate-700 leading-relaxed">{preview.context_summary}</p>
          {preview.supporting_links.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {preview.supporting_links.slice(0, 3).map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                   className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline">
                  {hostnameOf(url)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end pt-0.5">
        <Button size="sm" disabled={publishing} onClick={handlePublish}>
          {publishing ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Publishing&#x2026;</> : "Publish"}
        </Button>
      </div>
    </div>
  );
}

export default function MyProposalsPage() {
  const queryClient = useQueryClient();
  const { data: proposals, isLoading, isError } = useQuery<Proposal[]>({
    queryKey: ["my-proposals"],
    queryFn: fetchMyProposals,
    staleTime: 60_000,
  });
  const { data: rep } = useQuery<Reputation | null>({
    queryKey: ["my-proposal-reputation"],
    queryFn: fetchMyReputation,
    staleTime: 60_000,
  });

  const rows = proposals ?? [];

  function refetchAfterPublish() {
    queryClient.invalidateQueries({ queryKey: ["my-proposals"] });
    queryClient.invalidateQueries({ queryKey: ["my-proposal-reputation"] });
  }

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-500" />
            <h1 className="text-2xl font-bold text-slate-900">My Proposals</h1>
          </div>
          {/* Epic UGQ — propose entry point. Inline variant, not fab: this
              page already has a focused single-column layout, a floating
              button would be redundant with the header action here. */}
          <ProposeQuestionButton variant="inline" label="Propose a question" />
        </div>

        {/* Reputation summary */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-3xl font-bold text-slate-900">{rep?.score ?? 0}</div>
            <div className="text-xs text-slate-500">reputation</div>
          </div>
          <Badge className="bg-blue-600 hover:bg-blue-600">{tierLabel(rep?.tier ?? "new")}</Badge>
          <div className="text-sm text-slate-500 ml-auto">
            {rep?.total_published ?? 0} live · {rep?.total_proposed ?? 0} proposed
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        )}
        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Could not load your proposals.
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
            You haven&#x2019;t proposed any questions yet. Use the “Propose a question” button above to submit your first one.
          </div>
        )}

        <div className="space-y-2">
          {rows.map((p) => {
            const style = STATUS_STYLE[p.status] ?? { label: p.status, cls: "bg-slate-400" };
            const readyToPublish = p.status === "in_review" && !!p.preview_reframe;
            const inner = (
              <div className="rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors">
                <p className="text-sm text-slate-900 line-clamp-2">{p.raw_question}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge className={style.cls}>{style.label}</Badge>
                  {readyToPublish && (
                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border border-amber-300">
                      Ready to publish
                    </Badge>
                  )}
                  {p.status === "rejected" && p.rejection_reason && (
                    <span className="text-slate-400">reason: {p.rejection_reason}</span>
                  )}
                  {p.status === "published" && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> {p.response_count} stances
                    </span>
                  )}
                  {p.status === "published" && p.reframed_question_id && (
                    <span className="inline-flex items-center gap-1 text-blue-600">
                      <ExternalLink className="h-3 w-3" /> View live
                    </span>
                  )}
                  <span className="ml-auto">
                    {(() => { try { return formatDistanceToNow(new Date(p.created_at), { addSuffix: true }); } catch { return ""; } })()}
                  </span>
                </div>

                {/* readyToPublish only applies to 'in_review' rows, which are
                    never wrapped in the <Link> below (only 'published' rows
                    are) — so the Publish button here never ends up nested
                    inside an ancestor <a>, no click-swallowing to worry about. */}
                {readyToPublish && (
                  <InlinePublishCard proposal={p} onPublished={refetchAfterPublish} />
                )}
              </div>
            );
            return p.status === "published" && p.reframed_question_id ? (
              <Link key={p.id} to={`/q/${p.reframed_question_id}`} className="block">{inner}</Link>
            ) : (
              <div key={p.id}>{inner}</div>
            );
          })}
        </div>
      </div>
    </PageLayout>
  );
}
