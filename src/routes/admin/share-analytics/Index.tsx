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

// ─── Per-link data ────────────────────────────────────────────────────────────
// Each share_events row is one copied/shared link; its id is the `sid=` in the
// URL, so an admin can match a row to the post it was pasted into. Clicks only
// count from 30 Sep 2026: before that, /s/ dropped sid on redirect and no click
// was ever recorded.

interface LinkRow {
  id: string;
  platform: string;
  created_at: string;
  click_count: number;
  question_text: string;
  clicks_today: number;
  last_click: string | null;
}

interface DayCount { day: string; clicks: number }

const DAY_MS = 86_400_000;
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function useLinkBreakdown() {
  return useQuery<{ links: LinkRow[]; days: DayCount[] }>({
    queryKey: ["admin-share-links"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data: shares, error } = await supabase
        .from("share_events")
        .select("id, platform, created_at, click_count, questions!inner(question)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      const since = new Date(Date.now() - 13 * DAY_MS);
      since.setHours(0, 0, 0, 0);
      const { data: clicks, error: cErr } = await supabase
        .from("share_click_events")
        .select("share_event_id, clicked_at")
        .gte("clicked_at", since.toISOString())
        .order("clicked_at", { ascending: false })
        .limit(5000);
      if (cErr) throw cErr;

      const today = localDay(new Date());
      const perLink = new Map<string, { today: number; last: string | null }>();
      const perDay = new Map<string, number>();
      for (const c of clicks ?? []) {
        const day = localDay(new Date(c.clicked_at));
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
        const e = perLink.get(c.share_event_id) ?? { today: 0, last: null };
        if (day === today) e.today += 1;
        if (!e.last || c.clicked_at > e.last) e.last = c.clicked_at;
        perLink.set(c.share_event_id, e);
      }

      const days: DayCount[] = [];
      for (let i = 13; i >= 0; i--) {
        const day = localDay(new Date(Date.now() - i * DAY_MS));
        days.push({ day, clicks: perDay.get(day) ?? 0 });
      }

      const links = (shares ?? []).map((s: any) => ({
        id: s.id,
        platform: s.platform,
        created_at: s.created_at,
        click_count: s.click_count ?? 0,
        question_text: s.questions?.question ?? "",
        clicks_today: perLink.get(s.id)?.today ?? 0,
        last_click: perLink.get(s.id)?.last ?? null,
      }));
      return { links, days };
    },
  });
}

// Labels ("Pune Rising group — Day 7") are a per-admin note, kept in this
// browser only; nothing about a link changes server-side.
const LABELS_KEY = "sc_share_link_labels";
function readLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LABELS_KEY) || "{}"); } catch { return {}; }
}
function useLinkLabels() {
  const [labels, setLabels] = React.useState<Record<string, string>>(readLabels);
  const setLabel = (id: string, text: string) => {
    setLabels((prev) => {
      const next = { ...prev, [id]: text };
      if (!text.trim()) delete next[id];
      try { localStorage.setItem(LABELS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };
  return { labels, setLabel };
}

function ClicksByDay({ days }: { days: DayCount[] }) {
  const max = Math.max(1, ...days.map((d) => d.clicks));
  const total = days.reduce((s, d) => s + d.clicks, 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-800">Clicks by day</h2>
        <span className="text-xs text-slate-400">last 14 days · {total} clicks</span>
      </div>
      <div className="flex items-end gap-1.5 h-28">
        {days.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.day}: ${d.clicks} clicks`}>
            <span className="text-[10px] text-slate-500 mb-0.5">{d.clicks || ""}</span>
            <div className="w-full rounded-t bg-indigo-500" style={{ height: `${(d.clicks / max) * 100}%`, minHeight: d.clicks ? 3 : 1, opacity: d.clicks ? 1 : 0.15 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {days.map((d) => (
          <span key={d.day} className="flex-1 text-center text-[9px] text-slate-400">{Number(d.day.slice(8))}</span>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-2">Click counting started 30 Sep 2026 — earlier days read 0 because clicks weren't recorded, not because nobody clicked.</p>
    </div>
  );
}

function LinkBreakdown({ links }: { links: LinkRow[] }) {
  const { labels, setLabel } = useLinkLabels();
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Per-link breakdown</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Each row is one shared or copied link. Match it to your post by the link ID — the start of <code className="font-mono">sid=</code> in the URL. Labels are saved in this browser only.
        </p>
      </div>
      {links.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">No links shared yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Link ID</th>
                <th className="px-4 py-2 text-left font-medium">Label</th>
                <th className="px-4 py-2 text-left font-medium">Question</th>
                <th className="px-4 py-2 text-left font-medium">Via</th>
                <th className="px-4 py-2 text-left font-medium">Created</th>
                <th className="px-4 py-2 text-right font-medium">Clicks</th>
                <th className="px-4 py-2 text-right font-medium">Today</th>
                <th className="px-4 py-2 text-left font-medium">Last click</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {links.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5"><code className="font-mono text-xs text-slate-700">{l.id.slice(0, 8)}</code></td>
                  <td className="px-4 py-2.5">
                    <input
                      defaultValue={labels[l.id] ?? ""}
                      onBlur={(e) => setLabel(l.id, e.target.value)}
                      placeholder="e.g. Pune Rising — Day 7"
                      className="w-44 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-slate-700 placeholder:text-slate-300 hover:border-slate-200 focus:border-indigo-300 focus:bg-white focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-2.5 max-w-[16rem]"><p className="text-xs text-slate-500 truncate">{l.question_text}</p></td>
                  <td className="px-4 py-2.5"><PlatformBadge platform={l.platform} /></td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">{fmt(l.created_at)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-900">{l.click_count}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-600">{l.clicks_today || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">{l.last_click ? fmt(l.last_click) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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
  const { data: breakdown } = useLinkBreakdown();

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

      {breakdown && <ClicksByDay days={breakdown.days} />}
      {breakdown && <LinkBreakdown links={breakdown.links} />}

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
