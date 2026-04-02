// src/routes/admin/embed-analytics/Index.tsx
// Epic T — T5: Admin Embed Analytics
// Full funnel: impressions → submissions → CTA clicks → signups
// Per-publisher and per-question breakdowns.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Eye, Send, UserPlus, TrendingUp, MousePointerClick } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FunnelStats {
  total_impressions: number;
  total_submissions: number;
  total_cta_clicks: number;
  total_conversions: number;
  submission_rate: number;
  conversion_rate: number;
}

interface PublisherRow {
  publisher_ref: string;
  impressions: number;
  submissions: number;
  submission_rate: number;
}

interface QuestionRow {
  question_id: string;
  question_text: string;
  impressions: number;
  submissions: number;
  submission_rate: number;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useFunnelStats() {
  return useQuery<FunnelStats>({
    queryKey: ["admin-embed-funnel"],
    staleTime: 60_000,
    queryFn: async () => {
      const [impressionsRes, submissionsRes, ctaRes] = await Promise.all([
        supabase.from("embed_impressions").select("id", { count: "exact", head: true }),
        supabase.from("embedded_stances").select("id", { count: "exact", head: true }),
        supabase.from("embed_cta_events").select("id, converted_at", { count: "exact" }),
      ]);

      const impressions = impressionsRes.count ?? 0;
      const submissions = submissionsRes.count ?? 0;
      const ctaClicks = ctaRes.count ?? 0;
      const conversions = (ctaRes.data ?? []).filter((r) => r.converted_at).length;

      return {
        total_impressions: impressions,
        total_submissions: submissions,
        total_cta_clicks: ctaClicks,
        total_conversions: conversions,
        submission_rate: impressions > 0 ? (submissions / impressions) * 100 : 0,
        conversion_rate: submissions > 0 ? (conversions / submissions) * 100 : 0,
      };
    },
  });
}

function usePublisherBreakdown() {
  return useQuery<PublisherRow[]>({
    queryKey: ["admin-embed-by-publisher"],
    staleTime: 60_000,
    queryFn: async () => {
      const [impRes, subRes] = await Promise.all([
        supabase
          .from("embed_impressions")
          .select("publisher_ref")
          .not("publisher_ref", "is", null),
        supabase
          .from("embedded_stances")
          .select("publisher_ref")
          .not("publisher_ref", "is", null),
      ]);

      const impCounts: Record<string, number> = {};
      for (const r of impRes.data ?? []) {
        if (r.publisher_ref) impCounts[r.publisher_ref] = (impCounts[r.publisher_ref] ?? 0) + 1;
      }
      const subCounts: Record<string, number> = {};
      for (const r of subRes.data ?? []) {
        if (r.publisher_ref) subCounts[r.publisher_ref] = (subCounts[r.publisher_ref] ?? 0) + 1;
      }

      const refs = new Set([...Object.keys(impCounts), ...Object.keys(subCounts)]);
      return Array.from(refs).map((ref) => {
        const imp = impCounts[ref] ?? 0;
        const sub = subCounts[ref] ?? 0;
        return { publisher_ref: ref, impressions: imp, submissions: sub, submission_rate: imp > 0 ? (sub / imp) * 100 : 0 };
      }).sort((a, b) => b.submissions - a.submissions);
    },
  });
}

function useQuestionBreakdown() {
  return useQuery<QuestionRow[]>({
    queryKey: ["admin-embed-by-question"],
    staleTime: 60_000,
    queryFn: async () => {
      const [impRes, subRes] = await Promise.all([
        supabase.from("embed_impressions").select("question_id"),
        supabase
          .from("embedded_stances")
          .select("question_id, questions!inner(question)"),
      ]);

      const impCounts: Record<string, number> = {};
      for (const r of impRes.data ?? []) {
        impCounts[r.question_id] = (impCounts[r.question_id] ?? 0) + 1;
      }

      const subMap: Record<string, { count: number; text: string }> = {};
      for (const r of (subRes.data ?? []) as any[]) {
        const qid = r.question_id;
        if (!subMap[qid]) subMap[qid] = { count: 0, text: r.questions?.question ?? "" };
        subMap[qid].count += 1;
      }

      return Object.entries(subMap).map(([qid, info]) => {
        const imp = impCounts[qid] ?? 0;
        return {
          question_id: qid,
          question_text: info.text,
          impressions: imp,
          submissions: info.count,
          submission_rate: imp > 0 ? (info.count / imp) * 100 : 0,
        };
      }).sort((a, b) => b.submissions - a.submissions);
    },
  });
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, highlight }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${highlight ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"}`}>
          {icon}
        </div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Funnel bar ───────────────────────────────────────────────────────────────

function FunnelBar({ stats }: { stats: FunnelStats }) {
  const steps = [
    { label: "Impressions", value: stats.total_impressions, color: "bg-slate-300" },
    { label: "Submissions", value: stats.total_submissions, color: "bg-blue-400" },
    { label: "CTA Clicks", value: stats.total_cta_clicks, color: "bg-violet-400" },
    { label: "Signups", value: stats.total_conversions, color: "bg-emerald-400" },
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-4">Conversion funnel</h3>
      <div className="space-y-3">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-3">
            <div className="w-24 text-xs text-slate-500 text-right shrink-0">{step.label}</div>
            <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
              <div
                className={`h-full rounded-full ${step.color} transition-all`}
                style={{ width: `${(step.value / max) * 100}%` }}
              />
            </div>
            <div className="w-12 text-xs font-medium text-slate-700 text-right shrink-0">
              {step.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmbedAnalyticsPage() {
  const { data: funnel, isLoading: funnelLoading } = useFunnelStats();
  const { data: byPublisher } = usePublisherBreakdown();
  const { data: byQuestion } = useQuestionBreakdown();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Embed Analytics</h1>
        <p className="text-sm text-slate-500 mt-1">
          Impression → submission → signup funnel for embedded widgets across publisher sites.
        </p>
      </div>

      {funnelLoading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : funnel ? (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Impressions" value={funnel.total_impressions.toLocaleString()} icon={<Eye className="h-4 w-4" />} />
            <StatCard label="Submissions" value={funnel.total_submissions.toLocaleString()} sub={`${funnel.submission_rate.toFixed(1)}% rate`} icon={<Send className="h-4 w-4" />} highlight />
            <StatCard label="CTA Clicks" value={funnel.total_cta_clicks.toLocaleString()} icon={<MousePointerClick className="h-4 w-4" />} />
            <StatCard label="Signups" value={funnel.total_conversions.toLocaleString()} sub={`${funnel.conversion_rate.toFixed(1)}% of submissions`} icon={<UserPlus className="h-4 w-4" />} />
            <StatCard label="Sub. rate" value={`${funnel.submission_rate.toFixed(1)}%`} sub="Imp → submission" icon={<TrendingUp className="h-4 w-4" />} />
          </div>

          {/* Funnel chart */}
          <FunnelBar stats={funnel} />
        </>
      ) : null}

      {/* By publisher */}
      {byPublisher && byPublisher.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">By publisher</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Publisher ref</th>
                <th className="px-4 py-2 text-right font-medium">Impressions</th>
                <th className="px-4 py-2 text-right font-medium">Submissions</th>
                <th className="px-4 py-2 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byPublisher.map((row, i) => (
                <tr key={row.publisher_ref} className={i % 2 === 1 ? "bg-slate-50" : ""}>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{row.publisher_ref}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{row.impressions}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-900">{row.submissions}</td>
                  <td className="px-4 py-2 text-right text-slate-500 text-xs">{row.submission_rate.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* By question */}
      {byQuestion && byQuestion.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">By question</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Question</th>
                <th className="px-4 py-2 text-right font-medium">Impressions</th>
                <th className="px-4 py-2 text-right font-medium">Submissions</th>
                <th className="px-4 py-2 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byQuestion.slice(0, 20).map((row, i) => (
                <tr key={row.question_id} className={i % 2 === 1 ? "bg-slate-50" : ""}>
                  <td className="px-4 py-2 max-w-xs">
                    <p className="text-xs text-slate-700 line-clamp-2">{row.question_text}</p>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600">{row.impressions}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-900">{row.submissions}</td>
                  <td className="px-4 py-2 text-right text-slate-500 text-xs">{row.submission_rate.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(!byPublisher || byPublisher.length === 0) && (!byQuestion || byQuestion.length === 0) && !funnelLoading && (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm text-slate-400">No embed activity yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Publish the embed snippet on a partner site and data will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
