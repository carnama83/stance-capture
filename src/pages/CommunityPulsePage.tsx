// src/pages/CommunityPulsePage.tsx
// Epic F — Community Pulse & Aggregation
// F1: Aggregated stance dashboard with region selector
// F2: Macro trends trendline chart with confidence bands
// F3: Regional comparison + demographic breakdown

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import PageLayout from "@/components/PageLayout";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Area, ComposedChart, Legend,
} from "recharts";
import { Loader2, TrendingUp, Users, MapPin, BarChart3, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RegionScope = "city" | "county" | "state" | "country" | "global";

interface PulseRow {
  question_id: string;
  question_text: string;
  topic_title: string;
  total_responses: number;
  pct_support: number | null;
  pct_neutral: number | null;
  pct_oppose: number | null;
  avg_score: number | null;
  updated_at: string;
  macro_total_responses: number;
  macro_avg_support: number | null;
  macro_avg_neutral: number | null;
  macro_avg_oppose: number | null;
  macro_avg_score: number | null;
  macro_last_updated: string | null;
}

interface TrendPoint {
  snapshot_date: string;
  total_responses: number;
  avg_score: number | null;
  pct_support: number | null;
  pct_neutral: number | null;
  pct_oppose: number | null;
  confidence_low: number | null;
  confidence_high: number | null;
  is_low_sample: boolean;
}

interface RegionRow {
  region_scope: string;
  region_key: string;
  region_label: string;
  total_responses: number;
  pct_support: number | null;
  pct_neutral: number | null;
  pct_oppose: number | null;
  avg_score: number | null;
  updated_at: string;
}

interface DemoRow {
  dimension: string;
  dimension_value: string;
  total_responses: number;
  pct_support: number | null;
  pct_neutral: number | null;
  pct_oppose: number | null;
  avg_score: number | null;
  snapshot_date: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REGION_OPTIONS: Array<{ value: RegionScope; label: string }> = [
  { value: "global",  label: "Global" },
  { value: "country", label: "Country" },
  { value: "state",   label: "State" },
  { value: "county",  label: "County" },
  { value: "city",    label: "City" },
];

const TREND_DAYS_OPTIONS = [
  { value: 7,  label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

const GENDER_LABELS: Record<string, string> = {
  male:              "Male",
  female:            "Female",
  nonbinary:         "Non-binary",
  prefer_not_to_say: "Prefer not to say",
  self_described:    "Self-described",
};

function fmt(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

function fmtScore(v: number | null): string {
  return v == null ? "—" : v.toFixed(2);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function scoreColor(score: number | null): string {
  if (score == null) return "#94a3b8";
  if (score >= 0.5)  return "#10b981";
  if (score <= -0.5) return "#f43f5e";
  return "#94a3b8";
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, icon, children }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <span className="text-slate-500">{icon}</span>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// F1 — Aggregated Stance Dashboard
// ---------------------------------------------------------------------------

function AggregatedStanceSection({
  regionScope, regionKey,
}: { regionScope: RegionScope; regionKey: string }) {
  const { data, isLoading, isError } = useQuery<PulseRow[]>({
    queryKey: ["community-pulse", regionScope, regionKey],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_community_pulse", {
        p_region_scope: regionScope,
        p_region_key: regionKey,
        p_limit: 20,
      });
      if (error) throw error;
      return (data ?? []) as PulseRow[];
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (isError || !data?.length) return <p className="text-sm text-slate-500 py-4">No data available for this region yet.</p>;

  const macro = data[0];

  // Build histogram data: count of questions per support bucket
  const buckets = [
    { label: "0–20%", count: data.filter(r => (r.pct_support ?? 0) < 20).length },
    { label: "20–40%", count: data.filter(r => (r.pct_support ?? 0) >= 20 && (r.pct_support ?? 0) < 40).length },
    { label: "40–60%", count: data.filter(r => (r.pct_support ?? 0) >= 40 && (r.pct_support ?? 0) < 60).length },
    { label: "60–80%", count: data.filter(r => (r.pct_support ?? 0) >= 60 && (r.pct_support ?? 0) < 80).length },
    { label: "80–100%", count: data.filter(r => (r.pct_support ?? 0) >= 80).length },
  ];

  return (
    <div className="space-y-5">
      {/* Macro totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total responses", value: fmtNum(macro.macro_total_responses) },
          { label: "Avg support", value: fmt(macro.macro_avg_support) },
          { label: "Avg oppose", value: fmt(macro.macro_avg_oppose) },
          { label: "Avg score", value: fmtScore(macro.macro_avg_score) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
            <p className="text-lg font-semibold text-slate-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {macro.macro_last_updated && (
        <p className="text-[10px] text-slate-400">
          Last updated: {new Date(macro.macro_last_updated).toLocaleString()}
        </p>
      )}

      {/* Support distribution histogram */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">Questions by support level</p>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={buckets} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v: number) => [`${v} questions`, "Count"]}
            />
            <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-question table */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">Questions ({data.length})</p>
        <div className="rounded-lg border border-slate-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-3 py-2 font-medium text-slate-600">Question</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-16">Support</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-16">Oppose</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-16">n</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={row.question_id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  <td className="px-3 py-2 text-slate-800 max-w-xs">
                    <p className="truncate">{row.question_text}</p>
                    <p className="text-[10px] text-slate-400">{row.topic_title}</p>
                  </td>
                  <td className="px-3 py-2 text-right font-medium" style={{ color: "#10b981" }}>
                    {fmt(row.pct_support)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium" style={{ color: "#f43f5e" }}>
                    {fmt(row.pct_oppose)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {fmtNum(row.total_responses)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F2 — Macro Trends
// ---------------------------------------------------------------------------

function MacroTrendsSection({
  regionScope, regionKey, days,
}: { regionScope: RegionScope; regionKey: string; days: number }) {
  const { data, isLoading, isError } = useQuery<TrendPoint[]>({
    queryKey: ["macro-trends", regionScope, regionKey, days],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_macro_trends", {
        p_region_scope: regionScope,
        p_region_key: regionKey,
        p_days: days,
        p_question_id: null,
      });
      if (error) throw error;
      return (data ?? []) as TrendPoint[];
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (isError || !data?.length) return <p className="text-sm text-slate-500 py-4">No trend data available yet. Snapshots accumulate daily.</p>;

  const chartData = data.map((p) => ({
    date: fmtDate(p.snapshot_date),
    support: p.pct_support,
    oppose: p.pct_oppose,
    neutral: p.pct_neutral,
    avgScore: p.avg_score,
    confLow: p.confidence_low,
    confHigh: p.confidence_high,
    lowSample: p.is_low_sample,
    responses: p.total_responses,
  }));

  // % change vs baseline (first point)
  const first = data[0];
  const last  = data[data.length - 1];
  const supportDelta = first.pct_support != null && last.pct_support != null
    ? (last.pct_support - first.pct_support).toFixed(1)
    : null;

  return (
    <div className="space-y-4">
      {supportDelta !== null && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Support change over {days}d:</span>
          <span className={`font-semibold ${parseFloat(supportDelta) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {parseFloat(supportDelta) >= 0 ? "+" : ""}{supportDelta}%
          </span>
        </div>
      )}

      {/* Support / Oppose / Neutral over time */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">Support vs Opposition trend</p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} unit="%" />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v: number, name: string) => [`${Math.round(v)}%`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="support" stroke="#10b981" strokeWidth={2} dot={false} name="Support" />
            <Line type="monotone" dataKey="oppose"  stroke="#f43f5e" strokeWidth={2} dot={false} name="Oppose" />
            <Line type="monotone" dataKey="neutral" stroke="#94a3b8" strokeWidth={1.5} dot={false} name="Neutral" strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Avg score with confidence band */}
      <div>
        <p className="text-xs font-medium text-slate-600 mb-1">
          Avg score over time
          <span className="ml-1 text-slate-400 font-normal">(shaded = confidence band)</span>
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} domain={[-2, 2]} />
            <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [v.toFixed(2), ""]} />
            <ReferenceLine y={0} stroke="#e2e8f0" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="confHigh"
              stroke="transparent"
              fill="#6366f1"
              fillOpacity={0.12}
              legendType="none"
            />
            <Area
              type="monotone"
              dataKey="confLow"
              stroke="transparent"
              fill="#ffffff"
              fillOpacity={1}
              legendType="none"
            />
            <Line
              type="monotone"
              dataKey="avgScore"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              name="Avg score"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {data.some((p) => p.is_low_sample) && (
        <div className="flex items-start gap-1.5 text-[10px] text-amber-600 bg-amber-50 rounded px-3 py-2">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          Some data points have fewer than 10 responses — treat those days with caution.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// F3 — Regional Comparison
// ---------------------------------------------------------------------------

function RegionalComparisonSection({ questionId }: { questionId: string | null }) {
  const { data, isLoading } = useQuery<RegionRow[]>({
    queryKey: ["regional-comparison", questionId],
    enabled: !!questionId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_regional_comparison", {
        p_question_id: questionId,
      });
      if (error) throw error;
      return (data ?? []) as RegionRow[];
    },
  });

  if (!questionId) return <p className="text-sm text-slate-500">Select a question above to see regional comparison.</p>;
  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>;
  if (!data?.length) return <p className="text-sm text-slate-500">No regional data available for this question.</p>;

  const chartData = data.map((r) => ({
    region: r.region_label,
    support: r.pct_support ?? 0,
    neutral: r.pct_neutral ?? 0,
    oppose:  r.pct_oppose  ?? 0,
    n:       r.total_responses,
  }));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 60, left: 40, bottom: 0 }}>
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
          <YAxis type="category" dataKey="region" tick={{ fontSize: 10 }} width={60} />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(v: number, name: string) => [`${Math.round(v)}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="support" stackId="a" fill="#10b981" name="Support" />
          <Bar dataKey="neutral" stackId="a" fill="#94a3b8" name="Neutral" />
          <Bar dataKey="oppose"  stackId="a" fill="#f43f5e" name="Oppose" />
        </BarChart>
      </ResponsiveContainer>

      {/* Sample sizes */}
      <div className="flex flex-wrap gap-2">
        {data.map((r) => (
          <span key={r.region_key} className="text-[10px] text-slate-500 bg-slate-50 border rounded px-2 py-1">
            {r.region_label}: {fmtNum(r.total_responses)} responses
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F3 — Demographic Breakdown
// ---------------------------------------------------------------------------

function DemographicSection({ questionId }: { questionId: string | null }) {
  const { data, isLoading } = useQuery<DemoRow[]>({
    queryKey: ["demographic-breakdown", questionId],
    enabled: !!questionId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_demographic_breakdown", {
        p_question_id: questionId,
        p_dimension: "gender",
      });
      if (error) throw error;
      return (data ?? []) as DemoRow[];
    },
  });

  if (!questionId) return <p className="text-sm text-slate-500">Select a question above to see demographic breakdown.</p>;
  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>;
  if (!data?.length) return <p className="text-sm text-slate-500">Demographic data not yet available (requires minimum 3 responses per group).</p>;

  const chartData = data.map((r) => ({
    group:   GENDER_LABELS[r.dimension_value] ?? r.dimension_value,
    support: r.pct_support ?? 0,
    neutral: r.pct_neutral ?? 0,
    oppose:  r.pct_oppose  ?? 0,
    n:       r.total_responses,
  }));

  return (
    <div className="space-y-4">
      <p className="text-[10px] text-slate-400">By gender — latest snapshot</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="group" tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            formatter={(v: number, name: string) => [`${Math.round(v)}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="support" stackId="a" fill="#10b981" name="Support" />
          <Bar dataKey="neutral" stackId="a" fill="#94a3b8" name="Neutral" />
          <Bar dataKey="oppose"  stackId="a" fill="#f43f5e" name="Oppose" />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2">
        {data.map((r) => (
          <span key={r.dimension_value} className="text-[10px] text-slate-500 bg-slate-50 border rounded px-2 py-1">
            {GENDER_LABELS[r.dimension_value] ?? r.dimension_value}: n={r.total_responses}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommunityPulsePage() {
  const [regionScope, setRegionScope] = React.useState<RegionScope>("global");
  const [regionKey, setRegionKey] = React.useState("global");
  const [trendDays, setTrendDays] = React.useState(30);
  const [selectedQuestionId, setSelectedQuestionId] = React.useState<string | null>(null);

  // Fetch pulse data to populate question selector for F3
  const { data: pulseData } = useQuery<PulseRow[]>({
    queryKey: ["community-pulse", regionScope, regionKey],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("get_community_pulse", {
        p_region_scope: regionScope,
        p_region_key: regionKey,
        p_limit: 20,
      });
      if (error) throw error;
      return (data ?? []) as PulseRow[];
    },
  });

  // Auto-select first question when data loads
  React.useEffect(() => {
    if (pulseData?.length && !selectedQuestionId) {
      setSelectedQuestionId(pulseData[0].question_id);
    }
  }, [pulseData]);

  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-6 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Community Pulse</h1>
            <p className="text-sm text-slate-500 mt-1">
              Explore how the community stands across questions, regions, and time.
            </p>
          </div>

          {/* Region selector */}
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs text-slate-600 font-medium">Region</label>
            <select
              value={regionScope}
              onChange={(e) => {
                const scope = e.target.value as RegionScope;
                setRegionScope(scope);
                setRegionKey(scope === "global" ? "global" : scope);
              }}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {REGION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* F1 — Aggregated Stance Dashboard */}
        <Section title="Stance Distribution" icon={<BarChart3 className="h-4 w-4" />}>
          <AggregatedStanceSection regionScope={regionScope} regionKey={regionKey} />
        </Section>

        {/* F2 — Macro Trends */}
        <Section title="Macro Trends Over Time" icon={<TrendingUp className="h-4 w-4" />}>
          <div className="flex items-center gap-2 mb-4">
            <label className="text-xs text-slate-600">Window</label>
            <div className="flex gap-1">
              {TREND_DAYS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setTrendDays(o.value)}
                  className={[
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    trendDays === o.value
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 text-slate-600 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <MacroTrendsSection regionScope={regionScope} regionKey={regionKey} days={trendDays} />
        </Section>

        {/* F3 — Comparative Views */}
        <Section title="Comparative Views" icon={<MapPin className="h-4 w-4" />}>
          <div className="space-y-5">
            {/* Question selector */}
            {pulseData && pulseData.length > 0 && (
              <div className="flex items-start gap-2">
                <label className="text-xs text-slate-600 font-medium mt-2 shrink-0">Question</label>
                <select
                  value={selectedQuestionId ?? ""}
                  onChange={(e) => setSelectedQuestionId(e.target.value || null)}
                  className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Select a question…</option>
                  {pulseData.map((r) => (
                    <option key={r.question_id} value={r.question_id}>
                      {r.question_text.slice(0, 80)}{r.question_text.length > 80 ? "…" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Regional comparison */}
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> Regional breakdown
              </p>
              <RegionalComparisonSection questionId={selectedQuestionId} />
            </div>

            {/* Demographic breakdown */}
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <Users className="h-3 w-3" /> By gender
              </p>
              <DemographicSection questionId={selectedQuestionId} />
            </div>
          </div>
        </Section>

      </div>
    </PageLayout>
  );
}
