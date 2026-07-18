// src/pages/MyProposalsPage.tsx
// Epic UGQ — Build Step 6: proposer history (spec §9.4). Route: /profile/proposals.
//
// Shows the signed-in user's proposals (newest first) with status, date and
// stance counts for published ones, plus their reputation score + tier.

import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Lightbulb, Loader2, MessageSquare } from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { Badge } from "@/components/ui/badge";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type Proposal = {
  id: string;
  raw_question: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  reframed_question_id: string | null;
  response_count: number;
};

type Reputation = {
  score: number;
  tier: string;
  total_proposed: number;
  total_published: number;
  total_rejected: number;
};

async function fetchMyProposals(): Promise<Proposal[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_proposals`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to load proposals (${res.status})`);
  return (await res.json()) as Proposal[];
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

export default function MyProposalsPage() {
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

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto py-6 space-y-6">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-6 w-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-slate-900">My Proposals</h1>
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
            You haven&#x2019;t proposed any questions yet. Look for the “Propose” button on your feed.
          </div>
        )}

        <div className="space-y-2">
          {rows.map((p) => {
            const style = STATUS_STYLE[p.status] ?? { label: p.status, cls: "bg-slate-400" };
            const inner = (
              <div className="rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors">
                <p className="text-sm text-slate-900 line-clamp-2">{p.raw_question}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge className={style.cls}>{style.label}</Badge>
                  {p.status === "rejected" && p.rejection_reason && (
                    <span className="text-slate-400">reason: {p.rejection_reason}</span>
                  )}
                  {p.status === "published" && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> {p.response_count} stances
                    </span>
                  )}
                  <span className="ml-auto">
                    {(() => { try { return formatDistanceToNow(new Date(p.created_at), { addSuffix: true }); } catch { return ""; } })()}
                  </span>
                </div>
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
