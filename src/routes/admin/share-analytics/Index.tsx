// src/routes/admin/share-analytics/Index.tsx
// Epic W — Share Analytics (W6)
// Shows per-question share performance: shares by platform, click-through rates,
// total reach, and viral coefficient.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Share2, MousePointerClick, TrendingUp, Users } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShareSummaryRow {
  question_id: string;
  question_text: string;
  total_shares: number;
  total_clicks: number;
  platforms: string;
  last_shared_at: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useShareSummary() {
  return useQuery<ShareSummaryRow[]>({
    queryKey: ["admin-share-summary"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("share_events")
        .select(`
          question_id,
          platform,
          click_count,
          created_at,
          questions!inner(question)
        `)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      // Aggregate by question
      const map = new Map<string, ShareSummaryRow>();
      for (const row of data ?? []) {
        const q = row as any;
        const qid = q.question_id;
        if (!map.has(qid)) {
          map.set(qid, {
            question_id: qid,
            question_text: q.questions?.question ?? "",
            total_shares: 0,
            total_clicks: 0,
            platforms: "",
            last_shared_at: q.created_at,
          });
        }
        const entry = map.get(qid)!;
        entry.total_shares += 1;
        entry.total_clicks += q.click_count ?? 0;
        if (!entry.platforms.includes(q.platform)) {
          entry.platforms = entry.platforms
            ? `${entry.platforms}, ${q.platform}`
            : q.platform;
        }
        if (q.created_at > entry.last_shared_at) {
          entry.last_shared_at = q.created_at;
        }
      }

      return Array.from(map.values()).sort(
        (a, b) => b.total_shares - a.total_shares
      );
    },
  });
}

function useShareTotals() {
  return useQuery({
    queryKey: ["admin-share-totals"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("share_events")
        .select("id, click_count, platform");
      if (error) throw error;
      const rows = data ?? [];
      return {
        totalShares: rows.length,
        totalClicks: rows.reduce((s, r) => s + (r.click_count ?? 0), 0),
        topPlatform: (() => {
          const counts: Record<string, number> = {};
          for (const r of rows) counts[r.platform] = (counts[r.platform] ?? 0) + 1;
          return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
        })(),
      };
    },
  });
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
          {icon}
        </div>
        <p className="text-xs text-slate-500 font-medium">{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Platform badge ───────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  twitter: "bg-black text-white",
  facebook: "bg-[#1877F2] text-white",
  whatsapp: "bg-[#25D366] text-white",
  linkedin: "bg-[#0A66C2] text-white",
  copy: "bg-slate-200 text-slate-700",
  native: "bg-slate-200 text-slate-700",
};

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium capitalize ${
        PLATFORM_COLORS[platform] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {platform}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShareAnalyticsPage() {
  const { data: summary, isLoading } = useShareSummary();
  const { data: totals } = useShareTotals();

  const ctr =
    totals && totals.totalShares > 0
      ? ((totals.totalClicks / totals.totalShares) * 100).toFixed(1) + "%"
      : "—";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Share Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Track how questions are being shared and the resulting reach.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total shares"
          value={totals?.totalShares ?? "—"}
          icon={<Share2 className="h-4 w-4" />}
        />
        <StatCard
          label="Total clicks"
          value={totals?.totalClicks ?? "—"}
          icon={<MousePointerClick className="h-4 w-4" />}
          sub={`CTR: ${ctr}`}
        />
        <StatCard
          label="Top platform"
          value={totals?.topPlatform ?? "—"}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Questions shared"
          value={summary?.length ?? "—"}
          icon={<Users className="h-4 w-4" />}
        />
      </div>

      {/* Per-question table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Per-question breakdown</h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : !summary || summary.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No shares recorded yet. Share buttons will appear on question cards and detail pages.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Question</th>
                  <th className="px-4 py-2 text-right font-medium">Shares</th>
                  <th className="px-4 py-2 text-right font-medium">Clicks</th>
                  <th className="px-4 py-2 text-right font-medium">CTR</th>
                  <th className="px-4 py-2 text-left font-medium">Platforms</th>
                  <th className="px-4 py-2 text-left font-medium">Last shared</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.map((row) => {
                  const rowCtr =
                    row.total_shares > 0
                      ? ((row.total_clicks / row.total_shares) * 100).toFixed(0) + "%"
                      : "—";
                  return (
                    <tr key={row.question_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-xs text-slate-700 line-clamp-2 leading-relaxed">
                          {row.question_text}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        {row.total_shares}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">
                        {row.total_clicks}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 text-xs">
                        {rowCtr}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {row.platforms.split(", ").map((p) => (
                            <PlatformBadge key={p} platform={p} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {new Date(row.last_shared_at).toLocaleDateString(undefined, {
                          dateStyle: "medium",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
