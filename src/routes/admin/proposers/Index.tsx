// src/routes/admin/proposers/Index.tsx
// Epic UGQ — Build Step 7: proposer management (spec §8.3). Route: /admin/proposers.
//
// Lists everyone with proposer reputation and lets an admin grant/revoke Verified
// status, unflag, and set/clear a rate limit. Data + actions via the
// admin_list_proposers / admin_moderate_proposer RPCs (raw-fetch + getJwt).

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Loader2, ShieldCheck, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type Proposer = {
  user_id: string;
  username: string | null;
  score: number;
  tier: string;
  total_proposed: number;
  total_published: number;
  total_rejected: number;
  flagged: boolean;
  rate_limited_until: string | null;
  verified_at: string | null;
};

async function fetchProposers(): Promise<Proposer[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_list_proposers`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to load proposers (${res.status})`);
  return (await res.json()) as Proposer[];
}

async function moderateProposer(userId: string, action: string, rateLimitedUntil: string | null = null): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_moderate_proposer`, {
    method: "POST",
    headers: supabaseHeaders(getJwt()),
    body: JSON.stringify({ p_user_id: userId, p_action: action, p_rate_limited_until: rateLimitedUntil }),
  });
  return res.ok;
}

function tierBadge(tier: string) {
  if (tier === "verified") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Verified</Badge>;
  if (tier === "trusted") return <Badge className="bg-blue-600 hover:bg-blue-600">Trusted</Badge>;
  return <Badge variant="secondary">New</Badge>;
}

export default function AdminProposerPage() {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Proposer[]>({
    queryKey: ["admin-proposers"],
    queryFn: fetchProposers,
    staleTime: 30_000,
  });
  const [busy, setBusy] = React.useState<string | null>(null);
  const rows = data ?? [];

  async function act(userId: string, action: string, rateLimitedUntil: string | null = null, label?: string) {
    setBusy(`${userId}:${action}`);
    const ok = await moderateProposer(userId, action, rateLimitedUntil);
    setBusy(null);
    if (ok) { toast({ title: label ?? "Updated" }); refetch(); }
    else toast({ title: "Action failed", variant: "destructive" });
  }

  return (
    <div className="max-w-5xl mx-auto py-6 px-2 space-y-5">
      <div className="flex items-center gap-2">
        <Users className="h-6 w-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Proposers</h1>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load proposers.</div>
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          No proposers yet.
        </div>
      )}

      <div className="space-y-2">
        {rows.map((p) => {
          const limited = p.rate_limited_until && new Date(p.rate_limited_until).getTime() > Date.now();
          return (
            <div key={p.user_id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">@{p.username ?? "unknown"}</span>
                {tierBadge(p.tier)}
                {p.flagged && <Badge className="bg-red-600 hover:bg-red-600 gap-1"><Flag className="h-3 w-3" />flagged</Badge>}
                {limited && <Badge variant="outline" className="text-amber-700 border-amber-300">rate-limited</Badge>}
                <span className="text-xs text-slate-500 ml-auto">
                  score {p.score} · {p.total_published} live · {p.total_proposed} proposed · {p.total_rejected} rejected
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {p.tier !== "verified" ? (
                  <Button size="sm" variant="outline" className="gap-1" disabled={!!busy}
                    onClick={() => act(p.user_id, "grant_verified", null, "Granted Verified")}>
                    <ShieldCheck className="h-4 w-4" /> Grant Verified
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => act(p.user_id, "revoke_verified", null, "Revoked Verified")}>
                    Revoke Verified
                  </Button>
                )}
                {p.flagged && (
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => act(p.user_id, "unflag", null, "Unflagged")}>
                    Unflag
                  </Button>
                )}
                {limited ? (
                  <Button size="sm" variant="ghost" disabled={!!busy}
                    onClick={() => act(p.user_id, "set_rate_limit", null, "Rate limit cleared")}>
                    Clear rate limit
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="text-amber-700" disabled={!!busy}
                    onClick={() => act(p.user_id, "set_rate_limit", new Date(Date.now() + 7 * 86400 * 1000).toISOString(), "Rate-limited 7 days")}>
                    Rate-limit 7d
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
